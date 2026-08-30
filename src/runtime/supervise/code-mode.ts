/**
 * Code mode — the pattern Cloudflare ("Code Mode") and Anthropic ("code execution with MCP")
 * define, over this runtime's coordination verbs: generate a typed API from the tools' schemas,
 * expose exactly two tools (`search`, `execute`), and run model-written code whose only intended
 * capability is the API bindings. One model turn where the tool-calling loop pays one round trip
 * per call; intermediates live in the program, not the context window.
 *
 * WHAT THIS RUNTIME OWNS AND THE SOURCES' CENTRAL PROPERTY — read this before choosing a runner.
 * The sources isolate execution in a REAL boundary: Cloudflare runs the code in a V8 isolate with
 * a separate heap; Anthropic runs it out of process. That is not a detail — it is the whole reason
 * "let the model write code" is safe. This runtime does NOT ship an isolate, so `execute`'s
 * execution boundary is a SEAM you must fill: `codeModeSupervisorTools(runner)` REQUIRES a
 * `CodeModeRunner`, and there is no default. For untrusted model output, supply a jailed runner
 * (a sub-sandbox, a worker isolate). {@link unsafeInProcessRunner} is provided for TRUSTED output
 * only — your own eval harness, an offline test, a model you control — and is named for what it is:
 * `node:vm` shares the host realm, so host code is reachable from inside it and it is not a
 * security boundary. Choosing it for a hostile model is remote code execution, by construction.
 *
 * WHAT IS GENUINELY THIS RUNTIME'S CONTRIBUTION, and survives audit: every call the program makes
 * crosses the IDENTICAL kernel path an MCP verb crosses. Bindings dispatch through `context.verbs`
 * → the live coordination descriptor's own handler → authorization, the conserved pool, the
 * journal ("there is no second spawn path"). The model authors a workflow as code at runtime and
 * the kernel still meters and records every edge of it — a dynamic workflow system, not a bypass.
 * Verb RESULTS are detached (JSON round-trip) before they re-enter the program, so in-code calls
 * cannot mutate live coordination state the MCP transport would have copied.
 *
 * WHAT STAYS THE MODEL'S: `submit_result`, `stop`, `ask_parent` are never in the API — a program
 * that could settle the run would be a second brain. `search` names them and says why. Code does
 * the mechanics; the model keeps the judgment, the same split the sources draw.
 *
 * THE GRANT CANNOT DRIFT FROM THE DOCS: `search` renders from `context.coordinationTools()`, the
 * same descriptor objects the verbs are served from — never prose written beside them.
 */
import { createContext, runInContext } from 'node:vm'
import { ValidationError } from '../../errors'
import { assertAuthoredCode } from '../authored-code'
import type {
  CoordinationToolFace,
  ResolveSupervisorTools,
  SupervisorToolInvocationContext,
} from './supervisor-agent'

/** The seven coordination verbs callable in code, and the `context.verbs` member each maps to. */
const CODE_CALLABLE_VERBS = {
  spawn_worker: 'spawnAgent',
  await_event: 'awaitEvent',
  steer_agent: 'steerAgent',
  observe_agent: 'observeAgent',
  list_questions: 'listQuestions',
  answer_question: 'answerQuestion',
  run_analyst: 'runAnalyst',
} as const

/** The manager's own lifecycle verbs — never callable from code; `search` names them and why. */
const LIFECYCLE_VERBS = ['submit_result', 'stop', 'ask_parent'] as const

// ── JSON Schema → TypeScript, for the generated API ─────────────────────────────

/** Render a JSON Schema as TypeScript type text. Bounded and structural: enough for tool input
 *  schemas (objects, enums, arrays, unions); anything unrecognized renders `unknown`, never a
 *  guess. Module-level (not root) export: consumed by `renderCodeModeApi` and its tests only. */
export function renderJsonSchemaType(schema: unknown, depth = 0): string {
  if (depth > 6 || typeof schema !== 'object' || schema === null) return 'unknown'
  const node = schema as Record<string, unknown>
  if (node.const !== undefined) return JSON.stringify(node.const)
  if (Array.isArray(node.enum)) return node.enum.map((value) => JSON.stringify(value)).join(' | ')
  const variants = (node.anyOf ?? node.oneOf) as unknown[] | undefined
  if (Array.isArray(variants)) {
    return variants.map((variant) => renderJsonSchemaType(variant, depth + 1)).join(' | ')
  }
  const type = Array.isArray(node.type) ? node.type : [node.type]
  if (type.includes('object') || (node.type === undefined && node.properties !== undefined)) {
    const properties = (node.properties ?? {}) as Record<string, unknown>
    const required = new Set(Array.isArray(node.required) ? (node.required as string[]) : [])
    const fields = Object.entries(properties).map(([name, property]) => {
      const doc = describeSchema(property)
      const optional = required.has(name) ? '' : '?'
      return `${doc}${JSON.stringify(name).slice(1, -1)}${optional}: ${renderJsonSchemaType(property, depth + 1)}`
    })
    if (fields.length === 0) return 'Record<string, unknown>'
    const indent = '  '.repeat(depth + 1)
    return `{\n${fields.map((field) => `${indent}${field}`).join('\n')}\n${'  '.repeat(depth)}}`
  }
  if (type.includes('array')) {
    return `Array<${renderJsonSchemaType(node.items, depth + 1)}>`
  }
  const primitives = type
    .map((entry) =>
      entry === 'integer' ? 'number' : typeof entry === 'string' ? entry : undefined,
    )
    .filter(
      (entry): entry is string =>
        entry === 'string' || entry === 'number' || entry === 'boolean' || entry === 'null',
    )
  return primitives.length > 0 ? primitives.join(' | ') : 'unknown'
}

function describeSchema(schema: unknown): string {
  const description =
    typeof schema === 'object' && schema !== null
      ? (schema as Record<string, unknown>).description
      : undefined
  if (typeof description !== 'string' || description.length === 0) return ''
  const first = description.split('\n')[0] ?? ''
  return `/** ${first.length > 140 ? `${first.slice(0, 140)}…` : first} */ `
}

/** Render the callable API from tool faces — `declare function` per tool, doc from its own
 *  description. This is the text `search` answers; generated, never hand-written. Module-level
 *  export for tests. */
export function renderCodeModeApi(
  tools: ReadonlyArray<CoordinationToolFace>,
  query?: string,
): string {
  const needle = query?.trim().toLowerCase()
  const matches = tools.filter(
    (tool) =>
      !needle ||
      tool.name.toLowerCase().includes(needle) ||
      (tool.description ?? '').toLowerCase().includes(needle),
  )
  const blocks = matches.map((tool) => {
    const doc = (tool.description ?? '').split('\n')[0] ?? ''
    const args = tool.inputSchema === undefined ? 'unknown' : renderJsonSchemaType(tool.inputSchema)
    return `/** ${doc} */\ndeclare function ${tool.name}(args: ${args}): Promise<unknown>`
  })
  const header = [
    '// Call these as `api.<name>(args)` from code passed to `execute`.',
    '// Results are the same JSON the tools return. Intermediates stay in your program;',
    '// return only what the next decision needs.',
    `// NOT callable from code: ${LIFECYCLE_VERBS.join(', ')} — those are your own tools,`,
    '// because a program that could settle the run would be a second brain.',
  ].join('\n')
  if (blocks.length === 0) {
    return `${header}\n\n// No API member matches ${JSON.stringify(query ?? '')}. Call search with no query for the full API.`
  }
  return `${header}\n\n${blocks.join('\n\n')}`
}

// ── The execution seam ──────────────────────────────────────────────────────────

/** Where model-written code runs. THE isolation boundary — see the module doc: this runtime ships
 *  no default, so a caller chooses trusted-in-process or a real jail deliberately. */
export interface CodeModeRunner {
  run(args: {
    readonly code: string
    /** The granted operations, already deadline-gated and result-detached by the caller. The
     *  runner exposes these to the program as `api.<name>` and adds nothing else reachable. */
    readonly bindings: Readonly<Record<string, (args: unknown) => Promise<unknown>>>
    /** Aborts when the whole-program deadline passes or the manager scope cancels. */
    readonly signal: AbortSignal
  }): Promise<{ readonly result: unknown; readonly logs: ReadonlyArray<string> }>
}

/**
 * An in-process runner for TRUSTED model output ONLY. NOT a security boundary.
 *
 * It runs the program in a `node:vm` context whose globals are the bindings (`api`) and a
 * capturing `console`, with code generation disabled and inherited properties stripped. Those are
 * capability discipline, not containment: `node:vm` shares the host realm, and a host function's
 * `.constructor` is the host `Function`, so code that WANTS out can get out
 * (`api.<binding>.constructor('return process')()`). Use this for your own eval harness, offline
 * tests, or a model you trust; for untrusted output supply a jailed `CodeModeRunner` instead.
 */
export function unsafeInProcessRunner(): CodeModeRunner {
  return {
    async run({ code, bindings, signal }) {
      const logs: string[] = []
      const capture =
        (level: string) =>
        (...args: unknown[]) => {
          const line = args
            .map((value) => (typeof value === 'string' ? value : safeJson(value)))
            .join(' ')
          if (logs.length < 200) logs.push(level === 'log' ? line : `[${level}] ${line}`)
        }
      // Own-only, null-prototype target: `api.constructor` / `api.toString` do not resolve to
      // inherited host intrinsics. (This closes the api.constructor route; it does NOT make vm a
      // boundary — api.<binding>.constructor still reaches host Function. See the doc.)
      const target = Object.create(null) as Record<string, unknown>
      for (const [name, fn] of Object.entries(bindings)) target[name] = fn
      const sandbox = Object.create(null) as Record<string, unknown>
      sandbox.api = new Proxy(Object.freeze(target), {
        get(owned, member) {
          if (typeof member !== 'string') return undefined
          if (Object.hasOwn(owned, member)) return (owned as Record<string, unknown>)[member]
          const lifecycle = (LIFECYCLE_VERBS as ReadonlyArray<string>).includes(member)
          throw new ValidationError(
            lifecycle
              ? `code mode: api.${member} is not callable from code — it is the manager's own lifecycle verb; return from your program and call it as a tool`
              : `code mode: api.${member} is not in the granted API — call search to see what is`,
          )
        },
      })
      sandbox.console = Object.freeze({
        log: capture('log'),
        warn: capture('warn'),
        error: capture('error'),
      })
      const context = createContext(sandbox, { codeGeneration: { strings: false, wasm: false } })
      const program = runInContext(`(async () => {\n${code}\n})()`, context) as Promise<unknown>
      const aborted = new Promise<never>((_resolve, reject) => {
        if (signal.aborted) reject(abortReason(signal))
        else signal.addEventListener('abort', () => reject(abortReason(signal)), { once: true })
      })
      const result = await Promise.race([program, aborted])
      return { result: result ?? null, logs }
    },
  }
}

function abortReason(signal: AbortSignal): Error {
  const reason = signal.reason
  return reason instanceof Error ? reason : new ValidationError('code mode: program aborted')
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/** Detach a verb result before it re-enters the program — the deep copy the MCP transport makes,
 *  so in-code calls cannot mutate live coordination state. Matches the MCP path exactly (both
 *  JSON round-trip); a non-serializable result degrades to a marker rather than leaking a live
 *  reference. */
function detach(value: unknown): unknown {
  if (value === undefined) return undefined
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return { nonSerializable: true }
  }
}

// ── The two tools ───────────────────────────────────────────────────────────────

export interface CodeModeOptions {
  /** Whole-program deadline per `execute` call. Default 60_000. After it passes, the running
   *  program's next `api` call fails closed, so a runaway loop cannot keep spawning workers the
   *  model can no longer see. */
  readonly timeoutMs?: number
}

/**
 * Put a supervisor in code mode: its product tool surface becomes exactly `search` and `execute`.
 *
 * `runner` is REQUIRED and has no default — this runtime ships no isolate, so the execution
 * boundary is the caller's explicit choice (see the module doc). Use {@link unsafeInProcessRunner}
 * for trusted output; a jailed runner for untrusted models.
 *
 * Pass the result as `SuperviseOptions.resolveSupervisorTools` (which `runGraph` forwards to its
 * root supervisor). The graph engine's `supervisorKind` does not accept it yet, so a graph
 * supervisor node cannot be put in code mode through node config today.
 */
export function codeModeSupervisorTools(
  runner: CodeModeRunner,
  options: CodeModeOptions = {},
): ResolveSupervisorTools {
  if (runner === undefined || typeof runner.run !== 'function') {
    throw new ValidationError(
      'codeModeSupervisorTools: a CodeModeRunner is required (no default) — pass unsafeInProcessRunner() for trusted output, or a jailed runner for untrusted models',
    )
  }
  const timeoutMs = options.timeoutMs ?? 60_000

  const faces = (context: SupervisorToolInvocationContext): ReadonlyArray<CoordinationToolFace> =>
    context
      .coordinationTools()
      .filter((tool) => (CODE_CALLABLE_VERBS as Record<string, unknown>)[tool.name] !== undefined)

  return () => [
    {
      name: 'search',
      description:
        'Search the callable API. Returns TypeScript declarations for the operations your code ' +
        'may call, generated from the live grant. Optional `query` filters by name or ' +
        'description; omit it for the full API.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Substring filter over names and descriptions.' },
        },
      },
      handler: async (raw, context) => {
        const query =
          typeof raw === 'object' && raw !== null ? (raw as { query?: unknown }).query : undefined
        return renderCodeModeApi(faces(context), typeof query === 'string' ? query : undefined)
      },
    },
    {
      name: 'execute',
      description:
        'Run JavaScript against the API from `search`. Write the BODY of an async function: ' +
        'call `api.<name>(args)` (await each call), use loops and Promise.all for fan-out, keep ' +
        'intermediates in variables, `return` only what the next decision needs. `console.log` ' +
        'lines come back beside the result. No imports, no network, no filesystem — the API is ' +
        'the intended capability.',
      inputSchema: {
        type: 'object',
        properties: { code: { type: 'string', description: 'The async function body to run.' } },
        required: ['code'],
      },
      handler: async (raw, context) => {
        const code =
          typeof raw === 'object' && raw !== null ? (raw as { code?: unknown }).code : undefined
        if (typeof code !== 'string' || code.trim().length === 0) {
          throw new ValidationError('code mode: execute needs { code: string }')
        }
        // A lint, never the boundary: it refuses obvious escapes so a typo does not run, but the
        // runner is what isolates. See the module doc.
        assertAuthoredCode(code, { context: `code mode (${context.nodeId})` })

        // The whole-program deadline: a local controller linked to the manager scope signal and a
        // timer. After it fires, every binding fails closed, so no api call lands post-deadline;
        // the listener is removed in finally so it never outlives this execute call.
        const deadline = new AbortController()
        const onScopeAbort = () => deadline.abort(abortReason(context.signal))
        const timer = setTimeout(
          () =>
            deadline.abort(
              new ValidationError(`code mode: program timed out after ${timeoutMs}ms`),
            ),
          timeoutMs,
        )
        if (context.signal.aborted) deadline.abort(abortReason(context.signal))
        else context.signal.addEventListener('abort', onScopeAbort, { once: true })

        const bindings: Record<string, (args: unknown) => Promise<unknown>> = {}
        for (const [wire, member] of Object.entries(CODE_CALLABLE_VERBS)) {
          bindings[wire] = async (args: unknown) => {
            if (deadline.signal.aborted) {
              throw new ValidationError(
                `code mode: the execute deadline passed; api.${wire} is refused so no work outlives the call`,
              )
            }
            return detach(await context.verbs[member](args))
          }
        }
        try {
          return await runner.run({ code, bindings, signal: deadline.signal })
        } finally {
          clearTimeout(timer)
          context.signal.removeEventListener('abort', onScopeAbort)
        }
      },
    },
  ]
}
