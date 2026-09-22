import {
  canonicalCandidateDigest,
  type Sha256Digest,
  sha256DigestSchema,
} from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import type { Iteration } from '../types'
import type { LiveChild, PreSeqSettled } from './scope-types'
import { detachedSnapshot } from './snapshot'
import type {
  AgentSpec,
  Handle,
  NodeExecutionIdentity,
  NodeId,
  NodeSnapshot,
  Settled,
  Spend,
  TreeView,
  UsageEvent,
  WorkerTraceEvidence,
} from './types'

/** Rehydrate a successful settlement into the legacy Iteration result shape. */
export function settledToIteration<Out>(settled: Settled<Out>): Iteration<unknown, Out> {
  if (settled.kind === 'down') {
    throw new ValidationError(
      `settledToIteration: cannot adapt a 'down' settlement (node '${settled.handle.id}', seq ${settled.seq}) to an Iteration`,
    )
  }
  return {
    index: settled.seq,
    task: undefined,
    agentRunName: settled.handle.label,
    output: settled.out,
    ...(settled.verdict ? { verdict: settled.verdict } : {}),
    events: [],
    startedAt: 0,
    endedAt: settled.spent.ms,
    costUsd: settled.spent.usd,
    tokenUsage: { input: settled.spent.tokens.input, output: settled.spent.tokens.output },
  }
}

export function normalizeLiveWorkerLimit(value: number | undefined): number | undefined {
  if (value === undefined || value <= 0) return undefined
  if (!Number.isSafeInteger(value)) {
    throw new ValidationError(
      `createScope: maxLiveWorkers must be a positive safe integer or <= 0 for uncapped, got ${String(value)}`,
    )
  }
  return value
}

export function makeTreeView(root: NodeId, children: Map<NodeId, LiveChild>): TreeView {
  const nodes: NodeSnapshot[] = [...children.values()].map((child) => ({
    id: child.id,
    parent: root,
    label: child.label,
    status: child.status,
    runtime: child.runtime,
    budget: child.budget,
    ...(child.ownedTreeRoot === undefined ? {} : { ownedTreeRoot: child.ownedTreeRoot }),
    ...(child.assignmentId === undefined ? {} : { assignmentId: child.assignmentId }),
    ...(child.identity ? { identity: child.identity } : {}),
    ...(child.materialization ? { materialization: child.materialization } : {}),
    ...(child.executionBindings.length > 0
      ? { executionBindings: Object.freeze([...child.executionBindings]) }
      : {}),
    spent: child.spent,
    ...(child.settledAt === undefined ? {} : { settledAt: child.settledAt }),
    ...(child.outRef ? { outRef: child.outRef } : {}),
    ...(child.trace ? { trace: child.trace } : {}),
  }))
  return {
    root,
    nodes,
    inFlight: nodes.filter((node) => node.status === 'running' || node.status === 'acquiring')
      .length,
    waiting: nodes.filter((node) => node.status === 'waiting').length,
  }
}

export function frozenHandle<C>(child: LiveChild): Handle<C> {
  return {
    id: child.id,
    label: child.label,
    status: child.status,
    ...(child.assignmentId === undefined ? {} : { assignmentId: child.assignmentId }),
    ...(child.identity ? { identity: child.identity } : {}),
    ...(child.materialization ? { materialization: child.materialization } : {}),
    ...(child.executionBindings.length > 0
      ? { executionBindings: Object.freeze([...child.executionBindings]) }
      : {}),
    abort(): void {},
  }
}

export function deriveNodeExecutionIdentity(
  spec: Pick<AgentSpec, 'profile' | 'execution'>,
  task: unknown,
): NodeExecutionIdentity | undefined {
  const digest = (value: unknown): Sha256Digest | undefined => {
    try {
      return canonicalCandidateDigest(value)
    } catch {
      return undefined
    }
  }
  const profileDigest = digest(spec.profile)
  const taskDigest = digest(task)
  const candidateDigest = spec.execution?.candidateDigest
  if (candidateDigest !== undefined && !sha256DigestSchema.safeParse(candidateDigest).success) {
    throw new ValidationError('scope.spawn: execution.candidateDigest must be a sha256 digest')
  }
  const correlation = freezeCorrelation(spec.execution?.correlation)
  if (!profileDigest && !taskDigest && !candidateDigest && !correlation) return undefined
  return Object.freeze({
    ...(profileDigest ? { profileDigest } : {}),
    ...(taskDigest ? { taskDigest } : {}),
    ...(candidateDigest ? { candidateDigest } : {}),
    ...(correlation ? { correlation } : {}),
  })
}

export function isCompleteIdentity(
  identity: NodeExecutionIdentity | undefined,
): identity is NodeExecutionIdentity & {
  readonly profileDigest: string
  readonly taskDigest: string
} {
  return identity?.profileDigest !== undefined && identity.taskDigest !== undefined
}

export function sameNodeExecutionIdentity(
  a: NodeExecutionIdentity,
  b: NodeExecutionIdentity,
): boolean {
  return canonicalCandidateDigest(a) === canonicalCandidateDigest(b)
}

function freezeCorrelation(
  value: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError('scope.spawn: execution.correlation must be a string record')
  }
  const entries = Object.entries(value)
  for (const [key, item] of entries) {
    if (key.length === 0 || typeof item !== 'string' || item.length === 0) {
      throw new ValidationError(
        'scope.spawn: execution.correlation keys and values must be non-empty strings',
      )
    }
  }
  return Object.freeze(Object.fromEntries(entries))
}

export async function foldStream(
  stream: AsyncIterable<UsageEvent>,
  onProgress?: (running: Spend) => void,
  signal?: AbortSignal,
): Promise<Spend> {
  const tokens = { input: 0, output: 0 }
  let usd = 0
  let usdKnown = true
  let iterations = 0
  const iterator = stream[Symbol.asyncIterator]()
  try {
    for (;;) {
      const next = signal
        ? await awaitAbortable(Promise.resolve(iterator.next()), signal)
        : await iterator.next()
      if (next.done) break
      const event = next.value
      if (event.kind === 'tokens') {
        tokens.input += event.input
        tokens.output += event.output
      } else if (event.kind === 'cost') {
        usd += event.usd
        if (event.usdKnown === false) usdKnown = false
      } else if (event.kind === 'iteration') iterations += 1
      onProgress?.({
        iterations,
        tokens: { ...tokens },
        usd,
        ...(usdKnown ? {} : { usdKnown: false }),
        ms: 0,
      })
    }
  } catch (error) {
    void Promise.resolve(iterator.return?.()).catch(() => undefined)
    throw error
  }
  return {
    iterations,
    tokens,
    usd,
    ...(usdKnown ? {} : { usdKnown: false }),
    ms: 0,
  }
}

export function preserveUnknownTelemetry(streamed: Spend, terminal: Spend): Spend {
  return {
    ...streamed,
    ...(terminal.tokensKnown === false ? { tokensKnown: false } : {}),
    ...(terminal.usdKnown === false ? { usdKnown: false } : {}),
    ms: terminal.ms,
  }
}

export async function awaitAbortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void work.catch(() => undefined)
    throw abortError(signal)
  }
  return await new Promise<T>((resolve, reject) => {
    let settled = false
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      queueMicrotask(() => {
        if (settled) return
        settled = true
        cleanup()
        reject(abortError(signal))
      })
    }
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(
      (value) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      },
    )
  })
}

export function abortError(signal: AbortSignal): Error {
  const reason = signal.reason
  const error = new Error(
    reason instanceof Error
      ? reason.message
      : typeof reason === 'string' && reason.length > 0
        ? reason
        : reason === undefined
          ? 'execution aborted'
          : String(reason),
  )
  error.name = 'AbortError'
  return error
}

export function downRecord(
  reason: string,
  infra: boolean,
  trace: WorkerTraceEvidence,
  metered?: Spend,
): PreSeqSettled {
  return { kind: 'down', reason, infra, restartCount: 0, trace, ...(metered ? { metered } : {}) }
}

export function zeroSpend(): Spend {
  return { iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 }
}

export function isAsyncIterable(value: unknown): value is AsyncIterable<UsageEvent> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AsyncIterable<UsageEvent>)[Symbol.asyncIterator] === 'function'
  )
}

export function isAgentSpec(value: unknown): value is AgentSpec {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return 'profile' in record && 'harness' in record
}

export function snapshotAgentSpec(raw: AgentSpec): AgentSpec {
  const {
    profile: rawProfile,
    harness,
    execution: rawExecution,
    ...runtimeExtensions
  } = raw as AgentSpec & Readonly<Record<string, unknown>>
  const profile = detachedSnapshot(rawProfile, 'scope.spawn profile')
  const execution =
    rawExecution === undefined ? undefined : detachedSnapshot(rawExecution, 'scope.spawn execution')
  return Object.freeze({
    ...runtimeExtensions,
    profile,
    harness,
    ...(execution === undefined ? {} : { execution }),
  }) as AgentSpec
}

export function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name: unknown }).name === 'AbortError'
  )
}

export function isInfraError(err: unknown): boolean {
  return err instanceof ValidationError
}

export function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
