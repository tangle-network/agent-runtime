import type { AgentEnvironment } from '@tangle-network/agent-interface/environment-provider'
import { abortError } from './retained-run-binding'

const INTERACTIVE_CLEANUP_TIMEOUT_MS = 30_000

/** Create one environment while retaining ownership if cancellation wins the race. */
export async function createInteractiveEnvironment(
  create: () => Promise<AgentEnvironment>,
  signal?: AbortSignal,
): Promise<AgentEnvironment> {
  if (signal?.aborted) throw abortError(signal.reason)
  const creation = Promise.resolve().then(create)
  if (signal === undefined) return creation

  return new Promise<AgentEnvironment>((resolve, reject) => {
    let owner: 'pending' | 'caller' | 'runtime' = 'pending'
    const removeAbortListener = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      if (owner !== 'pending') return
      owner = 'runtime'
      removeAbortListener()
      disposeInteractiveEnvironment(creation, signal.reason)
      reject(abortError(signal.reason))
    }

    signal.addEventListener('abort', onAbort, { once: true })
    creation.then(
      (environment) => {
        if (owner !== 'pending') return
        owner = 'caller'
        removeAbortListener()
        resolve(environment)
      },
      (error) => {
        if (owner !== 'pending') return
        owner = 'runtime'
        removeAbortListener()
        reject(error)
      },
    )
  })
}

/** Start one process while destroying its unreturned environment on cancellation. */
export async function startInteractiveProcess<T>(
  environment: AgentEnvironment,
  start: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) {
    disposeInteractiveEnvironment(Promise.resolve(environment), signal.reason)
    throw abortError(signal.reason)
  }
  const pending = Promise.resolve().then(start)
  if (signal === undefined) return pending

  return new Promise<T>((resolve, reject) => {
    let owner: 'pending' | 'caller' | 'runtime' = 'pending'
    const removeAbortListener = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      if (owner !== 'pending') return
      owner = 'runtime'
      removeAbortListener()
      disposeInteractiveEnvironment(Promise.resolve(environment), signal.reason)
      reject(abortError(signal.reason))
    }

    signal.addEventListener('abort', onAbort, { once: true })
    pending.then(
      (result) => {
        if (owner !== 'pending') return
        owner = 'caller'
        removeAbortListener()
        resolve(result)
      },
      (error) => {
        if (owner !== 'pending') return
        owner = 'runtime'
        removeAbortListener()
        reject(error)
      },
    )
  })
}

/** Destroy an environment with fresh, bounded cleanup authority. */
export async function destroyInteractiveEnvironment(environment: AgentEnvironment): Promise<void> {
  if (!environment.destroy) {
    throw new Error(`provider environment "${environment.id}" does not expose destroy()`)
  }

  const controller = new AbortController()
  const timeout = new Error('interactive environment cleanup timed out')
  let timer: ReturnType<typeof setTimeout> | undefined
  const destruction = Promise.resolve().then(() =>
    environment.destroy?.({ signal: controller.signal }),
  )
  void destruction.catch(() => undefined)
  try {
    await Promise.race([
      destruction,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort(timeout)
          reject(timeout)
        }, INTERACTIVE_CLEANUP_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function disposeInteractiveEnvironment(
  environment: Promise<AgentEnvironment>,
  abortReason: unknown,
): void {
  void environment
    .then(destroyInteractiveEnvironment, () => undefined)
    .catch((cleanupError: unknown) => {
      const reason = abortReason instanceof Error ? abortReason : new Error(String(abortReason))
      const failure = new AggregateError(
        [reason, cleanupError],
        'cancelled interactive environment cleanup failed',
      )
      process.emitWarning(failure, {
        code: 'AGENT_RUNTIME_INTERACTIVE_CLEANUP_FAILED',
      })
    })
}
