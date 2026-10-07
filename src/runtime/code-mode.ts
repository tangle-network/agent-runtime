/**
 * Runtime's code-mode execution, independent of the model and harness.
 *
 * The interpreter is the standalone pi-codemode package, not Pi Coding Agent.
 * Runtime supplies the already-authorized tools; nested calls use their original
 * handlers. This module owns no agent loop, provider, budget, or durable journal.
 */
import type {
  CodemodeExecuteOptions,
  CodemodeJsonSchema,
  CodemodeResult,
  CodemodeSandboxOptions,
  CodemodeTool,
} from '@earendil-works/pi-codemode'

export type CodeModeResult = CodemodeResult
export type CodeModeStore = NonNullable<CodemodeExecuteOptions['store']>

export interface CodeModeToolContext {
  /** Aborted on script return, failure, timeout, or cancellation. */
  readonly signal: AbortSignal
  /** Parent tool-call identity, supplied by the existing Runtime loop. */
  readonly parentCallId: string
  /** Identity for this nested call, not an external-effect idempotency key. */
  readonly callId: string
}

export interface CodeModeTool {
  readonly name: string
  readonly description?: string
  readonly inputSchema?: CodemodeJsonSchema
  readonly outputSchema?: CodemodeJsonSchema
  /** Use the host's normal authorized, validated, metered dispatch here. */
  readonly execute: (args: unknown, context: CodeModeToolContext) => Promise<unknown> | unknown
}

export interface CodeModeOptions {
  /** Includes time in tools. Infinity explicitly disables the wall deadline. */
  readonly timeoutMs?: number
  readonly memoryLimitBytes?: number
  /** Excess calls queue; Promise.all does not fail simply because the queue is full. */
  readonly concurrency?: number
  /** Bounds total admitted calls, including queued calls. */
  readonly maxCalls?: number
  /** Only bundled hosts need to override upstream's on-disk worker/wasm resolution. */
  readonly wasm?: CodemodeSandboxOptions['wasm']
  readonly workerUrl?: CodemodeSandboxOptions['workerUrl']
}

export interface RunCodeModeOptions extends CodeModeOptions {
  readonly tools: ReadonlyArray<CodeModeTool>
  readonly signal?: AbortSignal
  readonly callId: string
  /** An explicit snapshot from the caller's existing state owner. */
  readonly store?: CodeModeStore
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1) {
    throw new RangeError(`code mode: ${name} must be a positive safe integer`)
  }
  return result
}

/** Render the same tool descriptors that are executed, including their result schemas. */
export async function describeCodeModeTools(
  tools: ReadonlyArray<CodeModeTool>,
  query?: string,
): Promise<string> {
  const needle = query?.trim().toLowerCase()
  const selected = tools.filter(
    (tool) =>
      !needle ||
      tool.name.toLowerCase().includes(needle) ||
      tool.description?.toLowerCase().includes(needle),
  )
  const { renderDeclarations } = await import('@earendil-works/pi-codemode')
  return renderDeclarations({
    tools: selected.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      execute: () => {
        throw new Error('Declaration-only tool')
      },
    })),
  })
}

/**
 * Execute a JS async-function body against Runtime capabilities. The upstream
 * QuickJS/WASM worker is the boundary; there is no node:vm or unsafe fallback.
 * Every invocation has a fresh VM. Only successful storeWrites may be committed
 * by the caller. External tool effects are neither transactional nor retried.
 */
export async function runCodeMode(
  code: string,
  options: RunCodeModeOptions,
): Promise<CodeModeResult> {
  if (typeof code !== 'string' || !code.trim()) throw new TypeError('code mode: source is required')
  options.signal?.throwIfAborted()
  if (!options.callId.trim()) throw new TypeError('code mode: callId is required')
  const concurrency = positiveInteger(options.concurrency, 4, 'concurrency')
  const maxCalls = positiveInteger(options.maxCalls, 1024, 'maxCalls')
  const memoryLimitBytes = positiveInteger(
    options.memoryLimitBytes,
    64 * 1024 * 1024,
    'memoryLimitBytes',
  )
  const timeoutMs =
    options.timeoutMs === Infinity
      ? Infinity
      : positiveInteger(options.timeoutMs, 300_000, 'timeoutMs')
  const names = new Set<string>()
  for (const tool of options.tools) {
    if (!tool.name || names.has(tool.name))
      throw new TypeError(`code mode: duplicate or empty tool ${tool.name}`)
    names.add(tool.name)
  }
  const queue = new CallQueue(concurrency)
  let ordinal = 0
  const tools: CodemodeTool[] = options.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    execute: async (args, { signal }) => {
      signal.throwIfAborted()
      const index = ++ordinal
      if (index > maxCalls) throw new Error(`code mode: call limit ${maxCalls} exceeded`)
      const release = await queue.acquire(signal)
      try {
        signal.throwIfAborted()
        const value = await tool.execute(
          args,
          Object.freeze({
            signal,
            parentCallId: options.callId,
            callId: `${options.callId}/tool/${index}`,
          }),
        )
        signal.throwIfAborted()
        return value
      } finally {
        release()
      }
    },
  }))
  // Import only on execution: edge-safe users of Runtime's unrelated paths do
  // not initialize Node workers or load a wasm binary.
  const { CodemodeSandbox } = await import('@earendil-works/pi-codemode')
  const sandbox = new CodemodeSandbox({
    tools,
    timeoutMs,
    memoryLimitBytes,
    ...(options.wasm === undefined ? {} : { wasm: options.wasm }),
    ...(options.workerUrl === undefined ? {} : { workerUrl: options.workerUrl }),
  })
  try {
    return await sandbox.execute(code, { signal: options.signal, store: options.store })
  } finally {
    await sandbox.close()
  }
}

/** A per-invocation FIFO, not another scheduler. Aborted waiters never dispatch. */
class CallQueue {
  private active = 0
  private readonly waiting: Array<{
    signal: AbortSignal
    resolve: (release: () => void) => void
    reject: (reason: unknown) => void
    abort: () => void
  }> = []

  private readonly concurrency: number

  constructor(concurrency: number) {
    this.concurrency = concurrency
  }

  acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted()
    if (this.active < this.concurrency) {
      this.active++
      return Promise.resolve(this.release())
    }
    return new Promise((resolve, reject) => {
      const waiter = { signal, resolve, reject, abort: () => {} }
      waiter.abort = () => {
        const index = this.waiting.indexOf(waiter)
        if (index !== -1) this.waiting.splice(index, 1)
        reject(signal.reason)
      }
      signal.addEventListener('abort', waiter.abort, { once: true })
      this.waiting.push(waiter)
      if (signal.aborted) waiter.abort()
    })
  }

  private release(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      this.active--
      for (;;) {
        const next = this.waiting.shift()
        if (!next) return
        next.signal.removeEventListener('abort', next.abort)
        if (next.signal.aborted) {
          next.reject(next.signal.reason)
          continue
        }
        this.active++
        next.resolve(this.release())
        return
      }
    }
  }
}

/** Session data is explicit so the existing run owner can retain and restore it. */
export interface CodeModeToolsOptions extends CodeModeOptions {
  readonly store?: CodeModeStore
  /** These capabilities keep their direct model tools and are not callable from code. */
  readonly directTools?: ReadonlyArray<string>
}

export interface CodeModeToolset {
  readonly tools: ReadonlyArray<CodeModeTool>
  /** Detached successful store state, never the guest heap or a program checkpoint. */
  snapshotStore(): CodeModeStore
}

/**
 * Present an existing authorized tool set as code mode. This is used by Runtime's
 * existing loops; it does not execute a model, create an agent, or grant authority.
 * One toolset belongs to one conversation. Concurrent programs are refused to
 * avoid silently losing store writes; concurrency within a program is queued.
 */
export function createCodeModeTools(
  granted: ReadonlyArray<CodeModeTool>,
  options: CodeModeToolsOptions = {},
): CodeModeToolset {
  const reserved = new Set(['codemode', 'tool_search'])
  const names = new Set<string>()
  for (const tool of granted) {
    if (reserved.has(tool.name)) {
      throw new TypeError(
        `code mode: ${tool.name} is already present; use the existing code mode, do not nest it`,
      )
    }
    if (!tool.name || names.has(tool.name))
      throw new TypeError(`code mode: duplicate or empty tool ${tool.name}`)
    names.add(tool.name)
  }
  const direct = new Set(options.directTools ?? [])
  for (const name of direct) {
    if (!names.has(name)) throw new TypeError(`code mode: direct tool ${name} is not granted`)
  }
  const copied = granted.map((tool) =>
    Object.freeze({
      ...tool,
      ...(tool.inputSchema === undefined ? {} : { inputSchema: structuredClone(tool.inputSchema) }),
      ...(tool.outputSchema === undefined
        ? {}
        : { outputSchema: structuredClone(tool.outputSchema) }),
    }),
  )
  const callable = Object.freeze(copied.filter((tool) => !direct.has(tool.name)))
  let store: Record<string, unknown> = structuredClone(options.store ?? {})
  let running = false
  const tools: CodeModeTool[] = [
    {
      name: 'tool_search',
      description:
        'Discover the tools available inside codemode. Returns generated TypeScript input and output declarations. Use an optional name/description substring query, or omit it for all tools.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        additionalProperties: false,
      },
      execute: async (raw) => {
        const args = codeModeArguments(raw)
        if (args.query !== undefined && typeof args.query !== 'string')
          throw new TypeError('query must be a string')
        return describeCodeModeTools(callable, args.query as string | undefined)
      },
    },
    {
      name: 'codemode',
      description:
        'Run a JavaScript async-function body to compose the granted tools. Call tools.name(args) or tools["original-name"](args); inspect ALL_TOOLS or tool_search to discover them. Await tool calls, use loops and Promise.all, keep intermediate data in variables, and return only the result needed for the next decision. text(value) prints, image({type:"image",data,mimeType}) emits an image. store(key,value) and load(key) retain JSON across successful calls in this conversation. No imports, process, filesystem, network, or timers. Side effects are not rolled back or automatically retried.',
      inputSchema: {
        type: 'object',
        properties: { code: { type: 'string' } },
        required: ['code'],
        additionalProperties: false,
      },
      execute: async (raw, context) => {
        const args = codeModeArguments(raw)
        if (typeof args.code !== 'string') throw new TypeError('codemode requires {code: string}')
        if (running)
          throw new Error('code mode: another program is still running in this conversation')
        running = true
        try {
          const result = await runCodeMode(args.code, {
            ...options,
            tools: callable,
            signal: context.signal,
            callId: context.callId,
            store,
          })
          if (result.ok) {
            const next = Object.assign(
              Object.create(null),
              store,
              result.storeWrites.set,
            ) as Record<string, unknown>
            for (const key of result.storeWrites.delete) delete next[key]
            store = structuredClone(next)
          }
          // Store values and intermediate tool results are not model-visible output.
          return result.ok
            ? { ok: true, value: result.value ?? null, output: result.output }
            : { ok: false, error: result.error, output: result.output }
        } finally {
          running = false
        }
      },
    },
    ...copied.filter((tool) => direct.has(tool.name)),
  ]
  return { tools: Object.freeze(tools), snapshotStore: () => structuredClone(store) }
}

/** Model tools have object arguments. Validation against a tool's schema remains host-owned. */
export function codeModeArguments(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('tool arguments must be a JSON object')
  }
  return value as Record<string, unknown>
}

/** Preserve legacy text tool results; structured tool handlers keep their actual JSON values. */
export function toolResultText(value: unknown): string {
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? 'null')
}

/**
 * OpenAI-compatible output projection. All tool replies must precede the optional
 * user image message, so the loop appends returned images after the tool batch.
 * Image bytes never become a stringified pseudo-image in the tool's text.
 */
export function codeModeModelOutput(value: unknown): {
  text: string
  images: Array<{ type: 'image_url'; image_url: { url: string } }>
} {
  const reply = value as {
    ok: boolean
    value?: unknown
    error?: unknown
    output: CodemodeResult['output']
  }
  return {
    text: JSON.stringify({
      ok: reply.ok,
      ...(reply.ok ? { value: reply.value } : { error: reply.error }),
      output: reply.output.map((item) =>
        item.type === 'text' ? item : { type: 'image', mimeType: item.mimeType },
      ),
    }),
    images: reply.output.flatMap((item) =>
      item.type === 'image'
        ? [
            {
              type: 'image_url' as const,
              image_url: { url: `data:${item.mimeType};base64,${item.data}` },
            },
          ]
        : [],
    ),
  }
}
