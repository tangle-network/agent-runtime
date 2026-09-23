/**
 * A real isolation boundary for code mode.
 *
 * A program runs in one disposable Tangle Sandbox with egress blocked at creation.
 * Its only route back to Runtime is a framed terminal bridge.  Each `api.*` call is
 * dispatched through the binding that `codeModeSupervisorTools()` already gates, so
 * authorization, budget reservation, and the journal remain Runtime-owned.
 *
 * The Node vm below is ergonomic capability shaping inside the remote sandbox.  It
 * is not the isolation boundary.  The disposable Sandbox is the boundary that
 * contains a hostile program if the vm is escaped.
 */
import { randomUUID } from 'node:crypto'

import type { Sandbox, SandboxInstance, TerminalStream } from '@tangle-network/sandbox'
import { ValidationError } from '../../errors'
import { assertAuthoredCode } from '../authored-code'
import type { CodeModeRunner } from './code-mode'

/** The caller owns credentials and supplies the published Sandbox client. */
export type TangleSandboxCodeModeClient = Pick<Sandbox, 'create'>

/**
 * Bounds for the terminal protocol.  They limit untrusted terminal output, not
 * execution time.  Cancellation remains caller-owned through `CodeModeRunner`.
 */
export interface TangleSandboxCodeModeRunnerOptions {
  readonly client: TangleSandboxCodeModeClient
  /** Largest decoded JSON protocol message, including the submitted program. */
  readonly maxFrameBytes?: number
  /** Largest aggregate raw PTY output accepted from one program. */
  readonly maxOutputBytes?: number
  /** Largest number of console records returned beside the program result. */
  readonly maxLogs?: number
  /** Largest number of host binding calls that may wait at once. */
  readonly maxPendingCalls?: number
}

const protocolPrefix = '__tangle_code_mode_v1__:'
const defaultMaxFrameBytes = 512 * 1024
const defaultMaxOutputBytes = 2 * 1024 * 1024
const defaultMaxLogs = 200
const defaultMaxPendingCalls = 64

type ProtocolMessage = Record<string, unknown> & { readonly type: string }

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
  reject(error: Error): void
}

/**
 * Execute code mode in a fresh egress-blocked Tangle Sandbox.
 *
 * This class deliberately takes a caller-owned client.  Runtime never reads
 * credentials from the environment and never creates a second coordinator.
 */
export class TangleSandboxCodeModeRunner implements CodeModeRunner {
  private readonly client: TangleSandboxCodeModeClient
  private readonly maxFrameBytes: number
  private readonly maxOutputBytes: number
  private readonly maxLogs: number
  private readonly maxPendingCalls: number

  constructor(options: TangleSandboxCodeModeRunnerOptions) {
    if (options.client === undefined || typeof options.client.create !== 'function') {
      throw new ValidationError('TangleSandboxCodeModeRunner: a Sandbox client is required')
    }
    this.client = options.client
    this.maxFrameBytes = boundedPositiveInteger(
      options.maxFrameBytes,
      defaultMaxFrameBytes,
      'maxFrameBytes',
    )
    this.maxOutputBytes = boundedPositiveInteger(
      options.maxOutputBytes,
      defaultMaxOutputBytes,
      'maxOutputBytes',
    )
    this.maxLogs = boundedPositiveInteger(options.maxLogs, defaultMaxLogs, 'maxLogs')
    this.maxPendingCalls = boundedPositiveInteger(
      options.maxPendingCalls,
      defaultMaxPendingCalls,
      'maxPendingCalls',
    )
  }

  async run({ code, bindings, signal }: Parameters<CodeModeRunner['run']>[0]): Promise<{
    readonly result: unknown
    readonly logs: ReadonlyArray<string>
  }> {
    throwIfAborted(signal)
    // Callers normally reach this through `execute`, which already applies this
    // lint. Keep the runner independently safe when directly composed elsewhere.
    assertAuthoredCode(code, { context: 'Tangle Sandbox code mode' })

    let sandbox: SandboxInstance | undefined
    let terminal: TerminalStream | undefined
    let removedAbortListener = false
    let cleanup: Promise<void> | undefined
    let terminalClosed = false
    const logs: string[] = []
    const complete = deferred<{ readonly result: unknown; readonly logs: ReadonlyArray<string> }>()
    const pending = new Set<string>()
    let resultReceived = false
    let resultValue: unknown = null
    let settled = false
    let outputBytes = 0
    let outputBuffer = ''
    const decoder = new TextDecoder()
    // A cancellation can arrive while `create()` or `attach()` is pending.
    // Keep that rejection observed until the main path awaits it.
    void complete.promise.catch(() => undefined)

    const closeAndDelete = (): Promise<void> => {
      // Do not memoize a no-op before `create()` resolves. Its continuation
      // calls this again after it receives the box, which prevents a late-create
      // cancellation leak.
      if (sandbox === undefined) return Promise.resolve()
      if (cleanup !== undefined) return cleanup
      cleanup = (async () => {
        if (terminal !== undefined && !terminalClosed) {
          terminalClosed = true
          try {
            await terminal.close()
          } catch {
            // Detaching is best-effort. Sandbox deletion is the authoritative kill.
          }
        }
        if (sandbox !== undefined) await sandbox.delete()
      })()
      return cleanup
    }

    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      complete.reject(error)
    }
    const succeed = (result: unknown): void => {
      if (settled) return
      settled = true
      complete.resolve({ result, logs })
    }
    const succeedWhenIdle = (): void => {
      if (!settled && resultReceived && pending.size === 0) succeed(resultValue)
    }
    const onAbort = (): void => {
      fail(abortReason(signal))
      // Do not make cancellation wait for remote cleanup.  If creation/attach is
      // still pending, their continuations below delete the box once it exists.
      void closeAndDelete().catch(() => undefined)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()

    const write = (message: ProtocolMessage): void => {
      if (terminal === undefined || settled) return
      try {
        const line = encodeMessage(message, this.maxFrameBytes)
        terminal.write(line)
      } catch (error) {
        fail(asError(error, 'code mode sandbox terminal rejected protocol input'))
      }
    }

    const handleCall = (message: ProtocolMessage): void => {
      const id = protocolId(message.id)
      const name = protocolName(message.name)
      if (id === null || name === null) {
        fail(new ValidationError('code mode sandbox protocol call is malformed'))
        return
      }
      if (resultReceived) {
        fail(
          new ValidationError(
            `code mode sandbox requested api.${name} after reporting its program result`,
          ),
        )
        return
      }
      if (!Object.hasOwn(bindings, name)) {
        fail(new ValidationError(`code mode sandbox requested ungranted api.${name}`))
        return
      }
      if (pending.has(id)) {
        fail(
          new ValidationError(`code mode sandbox repeated protocol call id ${JSON.stringify(id)}`),
        )
        return
      }
      if (pending.size >= this.maxPendingCalls) {
        fail(
          new ValidationError(
            `code mode sandbox exceeded ${this.maxPendingCalls} pending API calls`,
          ),
        )
        return
      }
      pending.add(id)
      const binding = bindings[name]
      if (binding === undefined) {
        fail(new ValidationError(`code mode sandbox requested ungranted api.${name}`))
        return
      }
      void Promise.resolve()
        .then(() => binding(message.args))
        .then(
          (value) => {
            pending.delete(id)
            try {
              write({ type: 'response', id, ok: true, value: detachedJson(value) })
              succeedWhenIdle()
            } catch (error) {
              fail(asError(error, 'code mode sandbox could not encode API response'))
            }
          },
          (error: unknown) => {
            pending.delete(id)
            if (resultReceived) {
              fail(
                new ValidationError(
                  `code mode sandbox returned before api.${name} failed: ${errorMessage(error)}`,
                ),
              )
              return
            }
            try {
              write({ type: 'response', id, ok: false, error: errorMessage(error) })
            } catch (responseError) {
              fail(asError(responseError, 'code mode sandbox could not encode API failure'))
            }
          },
        )
        .catch((error: unknown) => fail(asError(error, 'code mode sandbox API bridge failed')))
    }

    const handleMessage = (message: ProtocolMessage): void => {
      if (settled) return
      switch (message.type) {
        case 'call':
          handleCall(message)
          return
        case 'log': {
          if (typeof message.text !== 'string') {
            fail(new ValidationError('code mode sandbox protocol log is malformed'))
            return
          }
          if (logs.length < this.maxLogs) logs.push(message.text)
          return
        }
        case 'result':
          if (resultReceived) {
            fail(new ValidationError('code mode sandbox reported more than one program result'))
            return
          }
          resultReceived = true
          resultValue = message.value ?? null
          // A program may accidentally omit `await` on an API call. Do not report success while
          // that Runtime operation can still change the run. The bootstrap also delays this frame;
          // this host-side check preserves the invariant if the remote process is compromised.
          succeedWhenIdle()
          return
        case 'error':
          fail(new ValidationError(`code mode sandbox failed: ${protocolErrorMessage(message)}`))
          return
        default:
          fail(
            new ValidationError(
              `code mode sandbox sent unknown protocol frame ${JSON.stringify(message.type)}`,
            ),
          )
      }
    }

    const handleData = (data: Uint8Array): void => {
      if (settled) return
      outputBytes += data.byteLength
      if (outputBytes > this.maxOutputBytes) {
        fail(
          new ValidationError(
            `code mode sandbox exceeded ${this.maxOutputBytes} bytes of terminal output`,
          ),
        )
        return
      }
      outputBuffer += decoder.decode(data, { stream: true })
      if (outputBuffer.length > this.maxOutputBytes) {
        fail(new ValidationError('code mode sandbox terminal output has no bounded line framing'))
        return
      }
      for (;;) {
        const newline = outputBuffer.indexOf('\n')
        if (newline < 0) return
        const raw = outputBuffer.slice(0, newline)
        outputBuffer = outputBuffer.slice(newline + 1)
        const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
        if (!line.startsWith(protocolPrefix)) continue
        let message: ProtocolMessage
        try {
          message = decodeMessage(line, this.maxFrameBytes)
        } catch (error) {
          fail(asError(error, 'code mode sandbox sent malformed protocol output'))
          return
        }
        handleMessage(message)
        if (settled) return
      }
    }

    try {
      const created = this.client.create({
        agent: false,
        ephemeral: true,
        egressPolicy: { mode: 'blocked' },
      })
      void created
        .then((box) => {
          sandbox = box
          if (signal.aborted) void closeAndDelete().catch(() => undefined)
        })
        .catch(() => undefined)
      sandbox = await waitForAbort(created, signal)
      await assertBlockedEgress(sandbox)
      throwIfAborted(signal)

      const attached = sandbox.terminals.attach(`code-mode-${randomUUID()}`, {
        command: bootstrapCommand(),
        handlers: {
          onData: handleData,
          onError: (error) => fail(asError(error, 'code mode sandbox terminal failed')),
          onExit: (info) => {
            if (!settled) {
              fail(
                new ValidationError(
                  `code mode sandbox terminal exited before a result (code ${info.exitCode}${
                    info.exitSignal ? `, signal ${info.exitSignal}` : ''
                  })`,
                ),
              )
            }
          },
          onClose: (_code, reason) => {
            if (!settled) {
              fail(
                new ValidationError(
                  `code mode sandbox terminal closed before a result${reason ? `: ${reason}` : ''}`,
                ),
              )
            }
          },
        },
      })
      void attached
        .then((stream) => {
          terminal = stream
          if (signal.aborted) {
            void closeAndDelete().catch(() => undefined)
            return
          }
          write({
            type: 'start',
            code,
            grants: Object.keys(bindings),
            maxFrameBytes: this.maxFrameBytes,
          })
        })
        .catch(() => undefined)
      terminal = await waitForAbort(attached, signal)

      const outcome = await complete.promise
      return outcome
    } finally {
      if (!removedAbortListener) {
        signal.removeEventListener('abort', onAbort)
        removedAbortListener = true
      }
      if (signal.aborted) {
        void closeAndDelete().catch(() => undefined)
      } else {
        await closeAndDelete()
      }
    }
  }
}

function boundedPositiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new ValidationError(
      `TangleSandboxCodeModeRunner: ${name} must be a positive safe integer`,
    )
  }
  return resolved
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal)
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new ValidationError('code mode sandbox program aborted')
}

function asError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new ValidationError(`${fallback}: ${String(error)}`)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function waitForAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(abortReason(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((resolveValue, rejectValue) => {
    resolve = resolveValue
    reject = rejectValue
  })
  return { promise, resolve, reject }
}

async function assertBlockedEgress(sandbox: SandboxInstance): Promise<void> {
  const actual = (await sandbox.egress.get()).policy
  const allowDomains = (actual as { allowDomains?: unknown }).allowDomains
  if (
    actual.mode !== 'blocked' ||
    (allowDomains !== undefined && (!Array.isArray(allowDomains) || allowDomains.length > 0))
  ) {
    throw new ValidationError(
      `code mode sandbox requires effective blocked egress; received ${JSON.stringify(actual)}`,
    )
  }
}

function encodeMessage(message: ProtocolMessage, maxFrameBytes: number): string {
  const json = JSON.stringify(message)
  if (json === undefined)
    throw new ValidationError('code mode sandbox protocol message is not JSON')
  if (Buffer.byteLength(json) > maxFrameBytes) {
    throw new ValidationError(`code mode sandbox protocol frame exceeds ${maxFrameBytes} bytes`)
  }
  return `${protocolPrefix}${Buffer.from(json).toString('base64')}\n`
}

function decodeMessage(line: string, maxFrameBytes: number): ProtocolMessage {
  const encoded = line.slice(protocolPrefix.length)
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new ValidationError('code mode sandbox protocol frame is not base64')
  }
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.byteLength > maxFrameBytes || bytes.toString('base64') !== encoded) {
    throw new ValidationError('code mode sandbox protocol frame is invalid or too large')
  }
  const value: unknown = JSON.parse(bytes.toString('utf8'))
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof (value as { type?: unknown }).type !== 'string'
  ) {
    throw new ValidationError('code mode sandbox protocol message is not an object with a type')
  }
  return value as ProtocolMessage
}

function detachedJson(value: unknown): unknown {
  const encoded = JSON.stringify(value)
  return encoded === undefined ? null : JSON.parse(encoded)
}

function protocolId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : null
}

function protocolName(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z][a-z0-9_]*$/.test(value) ? value : null
}

function protocolErrorMessage(message: ProtocolMessage): string {
  return typeof message.message === 'string' && message.message.length > 0
    ? message.message
    : 'unknown sandbox program error'
}

function bootstrapCommand(): string {
  const encoded = Buffer.from(bootstrapSource).toString('base64')
  return `stty -echo; exec node -e 'eval(Buffer.from("${encoded}", "base64").toString("utf8"))'`
}

const bootstrapSource = String.raw`
const vm = require('node:vm')
const readline = require('node:readline')
const prefix = '${protocolPrefix}'
let started = false
let cancelled = false
let maxFrameBytes = 0
let callSequence = 0
const pending = new Map()
let programSettled = false
let programResult = null
let programFailure = null

function fail(message) {
  try { send({ type: 'error', message: String(message) }) } catch {}
  process.exitCode = 1
  input.close()
}

function jsonValue(value) {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) return null
  return JSON.parse(encoded)
}

function send(message) {
  const text = JSON.stringify(message)
  if (Buffer.byteLength(text) > maxFrameBytes) {
    throw new Error('protocol output exceeds its declared frame limit')
  }
  process.stdout.write(prefix + Buffer.from(text).toString('base64') + '\n')
}

function format(values) {
  return values.map((value) => {
    try { return typeof value === 'string' ? value : JSON.stringify(value) }
    catch { return String(value) }
  }).join(' ')
}

function hardenedCallback(callback) {
  // The callback crosses into bootstrap code, so do not expose its host-realm
  // Function prototype to the program.  The Sandbox remains the real boundary.
  Object.setPrototypeOf(callback, null)
  return Object.freeze(callback)
}

function finishProgramWhenIdle() {
  if (cancelled || !programSettled || pending.size > 0) return
  if (programFailure !== null) send({ type: 'error', message: programFailure })
  else send({ type: 'result', value: programResult })
}

function scheduleProgramFinish() {
  // Resolving an API promise can enqueue another API call in its continuation. Let those promise
  // reactions run before deciding that the program has no more work in flight.
  queueMicrotask(finishProgramWhenIdle)
}

function start(message) {
  if (started) return fail('duplicate start frame')
  if (typeof message.code !== 'string' || !Array.isArray(message.grants)) {
    return fail('invalid start frame')
  }
  if (!Number.isSafeInteger(message.maxFrameBytes) || message.maxFrameBytes <= 0) {
    return fail('invalid protocol frame limit')
  }
  if (!message.grants.every((name) => typeof name === 'string' && /^[a-z][a-z0-9_]*$/.test(name))) {
    return fail('invalid granted API name')
  }
  started = true
  maxFrameBytes = message.maxFrameBytes
  const target = Object.create(null)
  for (const name of message.grants) {
    target[name] = hardenedCallback((args) => {
      if (cancelled) return Promise.reject(new Error('program cancelled'))
      let value
      try { value = jsonValue(args) } catch (error) { return Promise.reject(error) }
      const id = String(++callSequence)
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        try { send({ type: 'call', id, name, args: value }) }
        catch (error) { pending.delete(id); reject(error) }
      })
    })
  }
  const api = new Proxy(Object.freeze(target), {
    get(owned, member) {
      if (typeof member !== 'string') return undefined
      if (Object.hasOwn(owned, member)) return owned[member]
      throw new Error('api.' + member + ' is not in the granted API')
    },
  })
  const sandbox = Object.create(null)
  sandbox.api = api
  const consoleApi = Object.create(null)
  consoleApi.log = hardenedCallback((...values) => send({ type: 'log', text: format(values) }))
  consoleApi.warn = hardenedCallback((...values) => send({ type: 'log', text: '[warn] ' + format(values) }))
  consoleApi.error = hardenedCallback((...values) => send({ type: 'log', text: '[error] ' + format(values) }))
  sandbox.console = Object.freeze(consoleApi)
  const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } })
  void Promise.resolve()
    .then(() => vm.runInContext('(async () => {\n' + message.code + '\n})()', context))
    .then(
      (result) => {
        programSettled = true
        programResult = jsonValue(result)
        scheduleProgramFinish()
      },
      (error) => {
        programSettled = true
        programFailure = error && error.message ? error.message : String(error)
        scheduleProgramFinish()
      },
    )
}

function response(message) {
  if (typeof message.id !== 'string' || typeof message.ok !== 'boolean') return fail('invalid response frame')
  const request = pending.get(message.id)
  if (!request) return fail('response does not match a pending API call')
  pending.delete(message.id)
  if (message.ok) request.resolve(message.value)
  else {
    const error = new Error(typeof message.error === 'string' ? message.error : 'host API call failed')
    if (programSettled) programFailure = error.message
    request.reject(error)
  }
  scheduleProgramFinish()
}

function cancel() {
  cancelled = true
  for (const request of pending.values()) request.reject(new Error('program cancelled'))
  pending.clear()
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false })
input.on('line', (line) => {
  if (!line.startsWith(prefix)) return fail('unframed protocol input')
  const encoded = line.slice(prefix.length)
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return fail('protocol input is not base64')
  let message
  try {
    const bytes = Buffer.from(encoded, 'base64')
    if (bytes.byteLength > maxFrameBytes && started) throw new Error('protocol input exceeds its frame limit')
    message = JSON.parse(bytes.toString('utf8'))
  } catch (error) { return fail(error && error.message ? error.message : 'invalid protocol input') }
  if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.type !== 'string') {
    return fail('invalid protocol input object')
  }
  if (message.type === 'start') return start(message)
  if (message.type === 'response') return response(message)
  if (message.type === 'cancel') return cancel()
  return fail('unknown protocol input frame')
})
`
