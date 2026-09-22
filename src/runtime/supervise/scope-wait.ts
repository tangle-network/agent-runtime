import { contentAddress } from '../../durable/spawn-journal'
import { notifyRuntimeHookEvent } from '../../runtime-hooks'
import { errMessage, zeroSpend } from './scope-support'
import type { LiveChild, PreSeqSettled, WaitContext } from './scope-types'
import type { Handle, NodeId, NodeStatus } from './types'
import { assertWaitWithinDeadline, runWait, validateWaitSpec, type WaitOutcome } from './wait'

export function createWait(context: WaitContext) {
  const { args, children, unclaimedWaits, now } = context
  return function wait(
    spec: import('./wait').WaitSpec,
    opts: import('./types').WaitOpts,
  ):
    | { ok: true; handle: Handle<WaitOutcome> }
    | { ok: false; reason: import('./wait').WaitRejection } {
    if (args.signal.aborted) return { ok: false, reason: 'deadline-exceeded' }
    if (validateWaitSpec(spec) !== null) return { ok: false, reason: 'invalid-spec' }
    if (spec.kind === 'poll' && args.probes?.resolve(spec.probe) === undefined) {
      return { ok: false, reason: 'unknown-probe' }
    }
    const adopted = unclaimedWaits.get(opts.label)
    if (adopted) unclaimedWaits.delete(opts.label)
    const effectiveSpec = adopted?.spec ?? spec
    const armedAt = adopted?.armedAt ?? now()
    if (!assertWaitWithinDeadline(effectiveSpec, args.pool.readout().deadlineMs)) {
      return { ok: false, reason: 'deadline-exceeded' }
    }
    const id: NodeId = adopted ? adopted.id : `${args.parentId}:w${context.nextOrdinal()}`
    const ordinal = adopted ? adopted.ordinal : Number(id.slice(id.lastIndexOf(':w') + 2))
    const waitAbort = new AbortController()
    const cascadeAbort = () => waitAbort.abort(args.signal.reason)
    if (args.signal.aborted) waitAbort.abort(args.signal.reason)
    else args.signal.addEventListener('abort', cascadeAbort, { once: true })
    const handle: Handle<WaitOutcome> = {
      id,
      label: opts.label,
      get status(): NodeStatus {
        return children.get(id)?.status ?? 'cancelled'
      },
      abort(reason?: string): void {
        waitAbort.abort(reason)
      },
    }
    const live: LiveChild = {
      id,
      status: 'waiting',
      runtime: 'wait',
      budget: { maxIterations: 0, maxTokens: 0 },
      label: opts.label,
      spent: zeroSpend(),
      settled: undefined as unknown as Promise<PreSeqSettled>,
      delivered: false,
      executorDone: false,
      cleanupConfirmed: true,
      executionBindings: [],
      abort: (reason?: string) => waitAbort.abort(reason),
      isAborted: () => waitAbort.signal.aborted,
      startedAt: armedAt,
      lastActivityAt: now(),
      wait: {
        spec: effectiveSpec,
        armedAt,
        label: opts.label,
        armCommitted: adopted !== undefined,
      },
    }
    children.set(id, live)
    const armCommitted = adopted
      ? Promise.resolve()
      : args.journal.appendEvent(args.root, {
          kind: 'waiting',
          id,
          parent: args.parentId,
          label: opts.label,
          spec: effectiveSpec,
          armedAt,
          seq: ordinal,
          at: new Date(now()).toISOString(),
        })
    const settled = armCommitted
      .then(() => {
        if (live.wait) live.wait.armCommitted = true
        notifyRuntimeHookEvent(
          args.hooks,
          {
            id: `${id}:waiting`,
            runId: args.root,
            target: 'agent.spawn',
            phase: 'after',
            timestamp: now(),
            stepIndex: ordinal,
            parentId: args.parentId,
            payload: {
              childId: id,
              label: opts.label,
              runtime: 'wait',
              wait: effectiveSpec,
              armedAt,
              resumed: adopted !== undefined,
            },
          },
          { signal: args.signal },
        )
        return runWait({
          spec: effectiveSpec,
          label: opts.label,
          armedAt,
          resumed: adopted !== undefined,
          signal: waitAbort.signal,
          ...(args.probes ? { probes: args.probes } : {}),
          now,
          ...(args.waitSleep ? { sleep: args.waitSleep } : {}),
        })
      })
      .then(async (resolution): Promise<PreSeqSettled> => {
        live.executorDone = true
        live.lastActivityAt = now()
        if (resolution.kind === 'cancelled') {
          return {
            kind: 'down',
            reason: resolution.reason,
            infra: false,
            restartCount: 0,
            trace: { status: 'unavailable', reason: 'not-an-executor' },
          }
        }
        const outRef = contentAddress(resolution.outcome)
        await args.blobs.put(outRef, resolution.outcome)
        return {
          kind: 'done',
          out: resolution.outcome,
          outRef,
          spent: zeroSpend(),
          trace: { status: 'unavailable', reason: 'not-an-executor' },
        }
      })
      .catch((err): PreSeqSettled => {
        live.executorDone = true
        return {
          kind: 'down',
          reason: errMessage(err),
          infra: true,
          restartCount: 0,
          trace: { status: 'unavailable', reason: 'not-an-executor' },
        }
      })
      .then((settlement) => {
        live.resolved = settlement
        return settlement
      })
      .finally(() => args.signal.removeEventListener('abort', cascadeAbort))
    ;(live as { settled: Promise<PreSeqSettled> }).settled = settled
    return { ok: true, handle }
  }
}
