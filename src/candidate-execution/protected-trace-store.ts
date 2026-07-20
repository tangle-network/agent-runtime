import type { TraceStore } from '@tangle-network/agent-eval'

import {
  createProtectedRecordRedactor,
  type ProtectedRedactionReport,
  type ProtectedTraceIdentity,
} from './protected-redaction'

export interface ProtectedAgentCandidateTraceAccess {
  readonly store: TraceStore
  closeWrites(): Promise<void>
  identity(trace: ProtectedTraceIdentity): ProtectedTraceIdentity
  report(): ProtectedRedactionReport
}

/** Keep the identity key in evaluator-owned closures and expose only the redacting store to code. */
export function createProtectedAgentCandidateTraceAccess(
  inner: TraceStore,
  protectedValues: readonly string[],
): ProtectedAgentCandidateTraceAccess {
  const redactor = createProtectedRecordRedactor(protectedValues)
  const pendingWrites = new Set<Promise<void>>()
  let acceptsWrites = true
  const write = (operation: () => Promise<void>): Promise<void> => {
    if (!acceptsWrites) {
      return Promise.reject(new Error('candidate trace writes are closed'))
    }
    let started: Promise<void>
    try {
      started = operation()
    } catch (error) {
      return Promise.reject(error)
    }
    let tracked: Promise<void>
    tracked = started.finally(() => pendingWrites.delete(tracked))
    pendingWrites.add(tracked)
    return tracked
  }
  const store = Object.freeze<TraceStore>({
    appendRun: (run) => write(() => inner.appendRun(redactor.record(run))),
    updateRun: (runId, patch) =>
      write(() => inner.updateRun(redactor.identifier(runId), redactor.record(patch))),
    appendSpan: (span) =>
      write(async () => {
        if (span.kind === 'llm') {
          throw new Error('candidate executors cannot author protected model spans')
        }
        await inner.appendSpan(redactor.record(span))
      }),
    updateSpan: (spanId, patch) =>
      write(async () => {
        if (patch.kind === 'llm') {
          throw new Error('candidate executors cannot author protected model spans')
        }
        await inner.updateSpan(redactor.identifier(spanId), redactor.record(patch))
      }),
    appendEvent: (event) => write(() => inner.appendEvent(redactor.record(event))),
    appendArtifact: (artifact) => write(() => inner.appendArtifact(redactor.record(artifact))),
    appendBudgetEntry: (entry) => write(() => inner.appendBudgetEntry(redactor.record(entry))),
    getRun: async (runId) => inner.getRun(redactor.identifier(runId)),
    listRuns: async (filter) => inner.listRuns(filter ? redactor.query(filter) : undefined),
    spans: async (filter) => inner.spans(filter ? redactor.query(filter) : undefined),
    events: async (filter) => inner.events(filter ? redactor.query(filter) : undefined),
    budget: async (runId) => inner.budget(redactor.identifier(runId)),
    artifacts: async (runId) => inner.artifacts(redactor.identifier(runId)),
  })
  return Object.freeze({
    store,
    closeWrites: async () => {
      acceptsWrites = false
      await Promise.all([...pendingWrites])
    },
    identity: (trace: ProtectedTraceIdentity) => redactor.traceIdentity(trace),
    report: () => redactor.report(),
  })
}

/** Recovery can read existing trace state but must never accept new unredactable writes. */
export class RecoveryAgentCandidateTraceStore implements TraceStore {
  constructor(private readonly inner: TraceStore) {}

  appendRun(): Promise<void> {
    return this.rejectWrite()
  }

  updateRun(): Promise<void> {
    return this.rejectWrite()
  }

  appendSpan(): Promise<void> {
    return this.rejectWrite()
  }

  updateSpan(): Promise<void> {
    return this.rejectWrite()
  }

  appendEvent(): Promise<void> {
    return this.rejectWrite()
  }

  appendArtifact(): Promise<void> {
    return this.rejectWrite()
  }

  appendBudgetEntry(): Promise<void> {
    return this.rejectWrite()
  }

  getRun(...args: Parameters<TraceStore['getRun']>): ReturnType<TraceStore['getRun']> {
    return this.inner.getRun(...args)
  }

  listRuns(...args: Parameters<TraceStore['listRuns']>): ReturnType<TraceStore['listRuns']> {
    return this.inner.listRuns(...args)
  }

  spans(...args: Parameters<TraceStore['spans']>): ReturnType<TraceStore['spans']> {
    return this.inner.spans(...args)
  }

  events(...args: Parameters<TraceStore['events']>): ReturnType<TraceStore['events']> {
    return this.inner.events(...args)
  }

  budget(...args: Parameters<TraceStore['budget']>): ReturnType<TraceStore['budget']> {
    return this.inner.budget(...args)
  }

  artifacts(...args: Parameters<TraceStore['artifacts']>): ReturnType<TraceStore['artifacts']> {
    return this.inner.artifacts(...args)
  }

  private rejectWrite(): Promise<never> {
    return Promise.reject(new Error('expired candidate recovery cannot append trace evidence'))
  }
}
