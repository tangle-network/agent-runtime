import vm from 'node:vm'
import { ValidationError } from '../errors'
import type {
  WorkflowAgentOptions,
  WorkflowBudgetCaps,
  WorkflowBudgetView,
  WorkflowCheckpointOptions,
  WorkflowLoopOptions,
} from './types'

export interface WorkflowRuntimeGlobals {
  agent(prompt: string, options?: WorkflowAgentOptions): Promise<unknown>
  loop(input: unknown, options?: WorkflowLoopOptions): Promise<unknown>
  verify(input: unknown, options?: WorkflowCheckpointOptions): Promise<unknown>
  analyzeTrace(input: unknown, options?: WorkflowCheckpointOptions): Promise<unknown>
  review(input: unknown, options?: WorkflowCheckpointOptions): Promise<unknown>
  parallel<T>(thunks: Array<() => Promise<T> | T>): Promise<T[]>
  pipeline<T, R>(
    items: T[],
    ...stages: Array<(value: unknown, original: T, index: number) => R>
  ): Promise<R[]>
  phase(title: string): void
  log(message: string): void
  budget: WorkflowBudgetView
}

export function installWorkflowGlobals(context: vm.Context, globals: WorkflowRuntimeGlobals): void {
  const wrapAsync = async (run: () => Promise<unknown>) => {
    try {
      return encodeBridgeSuccess(await run())
    } catch (err) {
      return encodeBridgeError(err)
    }
  }
  const wrapSync = (run: () => unknown) => {
    try {
      return encodeBridgeSuccess(run())
    } catch (err) {
      return encodeBridgeError(err)
    }
  }
  const install = vm.compileFunction(
    `
const __unwrap = (payload) => {
  const envelope = JSON.parse(payload)
  if (envelope.ok) return envelope.value
  const error = new Error(envelope.error.message)
  error.name = envelope.error.name || 'Error'
  throw error
}

const __safeMath = Object.freeze({
  abs: Math.abs,
  ceil: Math.ceil,
  floor: Math.floor,
  max: Math.max,
  min: Math.min,
  pow: Math.pow,
  round: Math.round,
  sign: Math.sign,
  sqrt: Math.sqrt,
  trunc: Math.trunc,
})

Object.defineProperties(globalThis, {
  agent: { value: async (...args) => __unwrap(await __agent(...args)), enumerable: true },
  loop: { value: async (...args) => __unwrap(await __loop(...args)), enumerable: true },
  verify: { value: async (...args) => __unwrap(await __verify(...args)), enumerable: true },
  analyzeTrace: { value: async (...args) => __unwrap(await __analyzeTrace(...args)), enumerable: true },
  review: { value: async (...args) => __unwrap(await __review(...args)), enumerable: true },
  parallel: { value: async (...args) => __unwrap(await __parallel(...args)), enumerable: true },
  pipeline: { value: async (...args) => __unwrap(await __pipeline(...args)), enumerable: true },
  phase: { value: (...args) => __unwrap(__phase(...args)), enumerable: true },
  log: { value: (...args) => __unwrap(__log(...args)), enumerable: true },
  budget: {
    value: Object.freeze({
      get total() {
        return __unwrap(__budgetTotal())
      },
      spent() {
        return __unwrap(__budgetSpent())
      },
      remaining() {
        return __unwrap(__budgetRemaining())
      },
    }),
    enumerable: true,
  },
  Math: { value: __safeMath },
  Date: { value: undefined },
  Function: { value: undefined },
  eval: { value: undefined },
  fetch: { value: undefined },
  XMLHttpRequest: { value: undefined },
  WebSocket: { value: undefined },
  WebAssembly: { value: undefined },
  setTimeout: { value: undefined },
  setInterval: { value: undefined },
  setImmediate: { value: undefined },
  queueMicrotask: { value: undefined },
  process: { value: undefined },
  require: { value: undefined },
  module: { value: undefined },
  exports: { value: undefined },
  globalThis: { value: undefined },
  window: { value: undefined },
  document: { value: undefined },
  self: { value: undefined },
})
`,
    [
      '__agent',
      '__loop',
      '__verify',
      '__analyzeTrace',
      '__review',
      '__parallel',
      '__pipeline',
      '__phase',
      '__log',
      '__budgetTotal',
      '__budgetSpent',
      '__budgetRemaining',
    ],
    { parsingContext: context },
  )
  install(
    (prompt: string, options?: WorkflowAgentOptions) =>
      wrapAsync(() => globals.agent(prompt, options)),
    (input: unknown, options?: WorkflowLoopOptions) =>
      wrapAsync(() => globals.loop(input, options)),
    (input: unknown, options?: WorkflowCheckpointOptions) =>
      wrapAsync(() => globals.verify(input, options)),
    (input: unknown, options?: WorkflowCheckpointOptions) =>
      wrapAsync(() => globals.analyzeTrace(input, options)),
    (input: unknown, options?: WorkflowCheckpointOptions) =>
      wrapAsync(() => globals.review(input, options)),
    (thunks: Array<() => Promise<unknown> | unknown>) => wrapAsync(() => globals.parallel(thunks)),
    (
      items: unknown[],
      ...stages: Array<(value: unknown, original: unknown, index: number) => unknown>
    ) => wrapAsync(() => globals.pipeline(items, ...stages)),
    (title: string) => wrapSync(() => globals.phase(title)),
    (message: string) => wrapSync(() => globals.log(message)),
    () => wrapSync(() => finiteCaps(globals.budget.total)),
    () => wrapSync(() => globals.budget.spent()),
    () => wrapSync(() => finiteRemaining(globals.budget.remaining())),
  )
}

export function normalizeRuntimeError(err: unknown): Error {
  if (err instanceof Error) return err
  const message = errorMessage(err)
  const name = errorName(err)
  if (name === 'ValidationError') return new ValidationError(message, { cause: err })
  const out = new Error(message, { cause: err })
  if (name) out.name = name
  return out
}

function encodeBridgeSuccess(value: unknown): string {
  return JSON.stringify({ ok: true, value: toBridgeValue(value) })
}

function encodeBridgeError(err: unknown): string {
  return JSON.stringify({
    ok: false,
    error: {
      name: errorName(err),
      message: errorMessage(err),
    },
  })
}

function toBridgeValue(value: unknown, path = '$', seen = new Set<object>()): unknown {
  if (value === undefined) return undefined
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ValidationError(`workflow bridge cannot return non-finite number at ${path}`)
    }
    return value
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new ValidationError(`workflow bridge cannot return cycle at ${path}`)
    seen.add(value)
    const out = value.map((item, index) => toBridgeValue(item, `${path}[${index}]`, seen))
    seen.delete(value)
    return out
  }
  if (typeof value === 'object') {
    if (Object.prototype.toString.call(value) !== '[object Object]') {
      throw new ValidationError(`workflow bridge cannot return non-plain object at ${path}`)
    }
    if (seen.has(value)) throw new ValidationError(`workflow bridge cannot return cycle at ${path}`)
    seen.add(value)
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined) continue
      out[key] = toBridgeValue(child, `${path}.${key}`, seen)
    }
    seen.delete(value)
    return out
  }
  throw new ValidationError(`workflow bridge cannot return ${typeof value} at ${path}`)
}

function finiteCaps(caps: WorkflowBudgetCaps): WorkflowBudgetCaps {
  return finiteNumberRecord(caps) as WorkflowBudgetCaps
}

function finiteRemaining(remaining: ReturnType<WorkflowBudgetView['remaining']>) {
  return finiteNumberRecord(remaining)
}

function finiteNumberRecord(input: object): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
  }
  return out
}

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return String(err)
}

function errorName(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'name' in err) {
    const name = (err as { name?: unknown }).name
    if (typeof name === 'string') return name
  }
  return undefined
}
