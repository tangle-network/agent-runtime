import { REDACTION_VERSION, type TraceStore } from '@tangle-network/agent-eval'

import { type ProtectedRedactionReport, redactProtectedValue } from './protected-redaction'

/** Trace-store proxy that removes live credentials before any write reaches durable storage. */
export class ProtectedAgentCandidateTraceStore implements TraceStore {
  private readonly aggregate: ProtectedRedactionReport = {
    version: REDACTION_VERSION,
    redactionCount: 0,
    byRule: {},
  }

  constructor(
    private readonly inner: TraceStore,
    private readonly protectedValues: readonly string[],
  ) {}

  report(): ProtectedRedactionReport {
    return {
      version: this.aggregate.version,
      redactionCount: this.aggregate.redactionCount,
      byRule: { ...this.aggregate.byRule },
    }
  }

  async appendRun(run: Parameters<TraceStore['appendRun']>[0]): Promise<void> {
    await this.inner.appendRun(this.redact(run))
  }

  async updateRun(
    runId: Parameters<TraceStore['updateRun']>[0],
    patch: Parameters<TraceStore['updateRun']>[1],
  ): Promise<void> {
    await this.inner.updateRun(this.redact(runId), this.redact(patch))
  }

  async appendSpan(span: Parameters<TraceStore['appendSpan']>[0]): Promise<void> {
    if (span.kind === 'llm') {
      throw new Error('candidate executors cannot author protected model spans')
    }
    await this.inner.appendSpan(this.redact(span))
  }

  async updateSpan(
    spanId: Parameters<TraceStore['updateSpan']>[0],
    patch: Parameters<TraceStore['updateSpan']>[1],
  ): Promise<void> {
    if (patch.kind === 'llm') {
      throw new Error('candidate executors cannot author protected model spans')
    }
    await this.inner.updateSpan(this.redact(spanId), this.redact(patch))
  }

  async appendEvent(event: Parameters<TraceStore['appendEvent']>[0]): Promise<void> {
    await this.inner.appendEvent(this.redact(event))
  }

  async appendArtifact(artifact: Parameters<TraceStore['appendArtifact']>[0]): Promise<void> {
    await this.inner.appendArtifact(this.redact(artifact))
  }

  async appendBudgetEntry(entry: Parameters<TraceStore['appendBudgetEntry']>[0]): Promise<void> {
    await this.inner.appendBudgetEntry(this.redact(entry))
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

  private redact<T>(value: T): T {
    const redacted = redactProtectedValue(value, this.protectedValues)
    this.aggregate.version = redacted.report.version
    this.aggregate.redactionCount += redacted.report.redactionCount
    for (const [rule, count] of Object.entries(redacted.report.byRule)) {
      this.aggregate.byRule[rule] = (this.aggregate.byRule[rule] ?? 0) + count
    }
    return redacted.value
  }
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
