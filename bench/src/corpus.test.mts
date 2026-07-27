import assert from 'node:assert/strict'
import { isRunRecord } from '@tangle-network/agent-eval'
import {
  type AttemptRecord,
  benchRecordToCorpusRecords,
  buildRunRecord,
  buildRunRecordFromAttempts,
  type RunRecord,
} from './corpus'
import { createRuntimeHookRecorder } from './runtime-hook-recorder'

const measuredAttempt = (round: number, output: string, valid: boolean): AttemptRecord => ({
  round,
  prompt: `q${round}`,
  output,
  valid,
  score: valid ? 1 : 0,
  costUsd: 0.01 + round / 1000,
  tokensIn: 100 + round,
  tokensOut: 30 + round,
  wallMs: 500 + round,
  eventCount: 2,
  eventTypes: { llm_call: 1, tool_call: 1 },
})

const baseRec = (attempts: AttemptRecord[], over: Partial<RunRecord> = {}): RunRecord => ({
  ts: '2026-06-03T00:00:00.000Z',
  benchmark: 'finsearchcomp',
  instanceId: 'i1',
  condition: 'random@3',
  // canonical RunRecord requires a snapshot-pinned model; bench writes bare
  // aliases, so the happy path supplies the resolved snapshot via opts.model.
  model: 'gpt-5',
  blindResolved: attempts[0]?.valid === true,
  resolved: attempts.some((a) => a.valid === true),
  attempts,
  infraError: false,
  ...over,
})

// --- runtime recorder snapshots decision points before persistent corpus storage ---
{
  const recorder = createRuntimeHookRecorder()
  const largeContext = `Bearer abc.def.ghi ${'ctx'.repeat(10_000)}`
  const largeDetail = `token=supersecret ${'detail'.repeat(1_000)}`
  recorder.hooks.onDecisionPoint?.(
    {
      id: 'run-1:agent.turn:0:failure-recovery',
      runId: 'run-1',
      scenarioId: 'task-1',
      stepIndex: 0,
      kind: 'retry',
      candidateActions: Array.from({ length: 75 }, (_, index) => `candidate-${index}`),
      context: largeContext,
      evidence: [
        {
          source: 'tool_result',
          id: 'tool-1:result',
          detail: largeDetail,
          metadata: { authorization: 'Bearer should-not-survive', nested: { apiKey: 'also-redacted' } },
        },
      ],
      metadata: { token: 'should-not-survive', safe: 'kept' },
    },
    {},
  )

  const [point] = recorder.decisionPoints
  assert.ok(point, 'decision point recorded')
  assert.notEqual(point, undefined)
  assert.equal(point.candidateActions.length, 50, 'candidate actions are bounded')
  assert.equal(point.context?.length, 20_000, 'context is bounded')
  assert.equal(point.evidence[0]?.detail?.length, 2_000, 'evidence detail is bounded')
  assert.equal(point.context?.includes('abc.def.ghi'), false, 'context secrets are redacted')
  assert.equal(point.evidence[0]?.detail?.includes('supersecret'), false, 'evidence detail secrets are redacted')
  assert.equal(point.metadata?.token, '[REDACTED]', 'top-level sensitive metadata is redacted')
  assert.equal(point.metadata?.safe, 'kept', 'non-sensitive metadata is preserved')
  assert.equal(point.evidence[0]?.metadata?.authorization, '[REDACTED]', 'evidence metadata is redacted')
  assert.equal(
    (point.evidence[0]?.metadata?.nested as { apiKey?: unknown } | undefined)?.apiKey,
    '[REDACTED]',
    'nested sensitive metadata is redacted',
  )
}

// --- happy path: a measured run projects to one canonical CorpusRecord per attempt ---
{
  const rec = baseRec([
    measuredAttempt(0, 'alpha', false),
    measuredAttempt(1, 'beta', true),
  ])
  const { records, unmappable } = await benchRecordToCorpusRecords(rec, {
    commitSha: 'abc123',
    model: 'gpt-5-2025-08-07',
    seed: 42,
  })
  assert.equal(unmappable.length, 0, 'all measured attempts map')
  assert.equal(records.length, 2, 'one record per attempt')
  for (const r of records) {
    assert.ok(isRunRecord(r), 'each is a valid canonical RunRecord')
  }
  const [r0, r1] = records
  assert.equal(r0?.candidateId, 'random@3', 'candidateId = condition (the gate-pairing arm)')
  assert.equal(r0?.scenarioId, 'i1', 'scenarioId = instanceId (the pairing key)')
  assert.equal(r0?.seed, 42, 'opts.seed is the base seed for attempt 0')
  assert.equal(r1?.seed, 43, 'each attempt offsets the base → DISTINCT seeds')
  assert.notEqual(r0?.seed, r1?.seed, 'no (scenarioId, seed) collision across a run\'s attempts')
  assert.equal(r0?.model, 'gpt-5-2025-08-07', 'snapshot-pinned model override applied')
  assert.equal(r0?.commitSha, 'abc123')
  assert.equal(r0?.tokenUsage.input, 100, 'real tokens carried (not zeroed)')
  assert.equal(r0?.costUsd, 0.01, 'real cost carried')
  assert.deepEqual(r0?.costProvenance, { kind: 'observed', usd: 0.01 }, 'reported cost remains observed')
  assert.equal(r0?.terminalOutcome, 'succeeded', 'failed task quality is not an execution failure')
  assert.equal(r0?.prompt, 'q0', 'verbatim prompt survives the validator')
  assert.equal(r0?.completion, 'alpha', 'verbatim completion survives the validator')
  assert.equal(r0?.outcome.searchScore, 0, 'search split → searchScore from attempt score')
  assert.equal(r0?.outcome.raw.valid, 0)
  assert.equal(r1?.outcome.raw.valid, 1)
  assert.notEqual(r0?.runId, r1?.runId, 'per-attempt runIds are distinct')
}

// --- attempt error is execution state, not a fabricated zero-quality label ---
{
  const { records, unmappable } = await benchRecordToCorpusRecords(
    baseRec([{ ...measuredAttempt(0, 'partial output', false), error: 'provider disconnected' }]),
    { commitSha: 'abc123', model: 'gpt-5-2025-08-07' },
  )
  assert.equal(unmappable.length, 0)
  assert.equal(records[0]?.terminalOutcome, 'failed')
  assert.equal(records[0]?.outcome.searchScore, 0, 'task quality remains independently recorded')
}

// --- unmeasured economics → unmappable, never forged with phantom zeros ---
{
  const bare: AttemptRecord = { round: 0, prompt: 'q', output: 'x', valid: true, eventCount: 0, eventTypes: {} }
  const { records, unmappable } = await benchRecordToCorpusRecords(baseRec([bare]), {
    commitSha: 'abc',
    model: 'gpt-5-2025-08-07',
  })
  assert.equal(records.length, 0, 'no record forged from unmeasured economics')
  assert.equal(unmappable.length, 1)
  assert.match(unmappable[0]!.reason, /unmeasured/, 'reason names the missing measurement')
  assert.match(unmappable[0]!.reason, /costUsd/, 'reason lists the missing fields')
}

// --- bare-alias model (no override) → unmappable with the validator's reason ---
{
  const { records, unmappable } = await benchRecordToCorpusRecords(
    baseRec([measuredAttempt(0, 'alpha', true)]),
    { commitSha: 'abc' },
  )
  assert.equal(records.length, 0, 'a bare-alias model is not a reproducibility artifact')
  assert.equal(unmappable.length, 1)
  assert.match(unmappable[0]!.reason, /invalid RunRecord/, 'surfaces the validator rejection')
  assert.match(unmappable[0]!.reason, /snapshot/, 'reason explains the snapshot-pin requirement')
}

// --- holdout split routes the score to holdoutScore ---
{
  const { records } = await benchRecordToCorpusRecords(baseRec([measuredAttempt(0, 'alpha', true)]), {
    commitSha: 'abc',
    model: 'gpt-5-2025-08-07',
    splitTag: 'holdout',
  })
  assert.equal(records.length, 1)
  assert.equal(records[0]?.splitTag, 'holdout')
  assert.equal(records[0]?.outcome.holdoutScore, 1, 'holdout split → holdoutScore')
  assert.equal(records[0]?.outcome.searchScore, undefined, 'no searchScore on a holdout record')
}

// --- bench writer preserves runtime trajectory evidence and semantic decision points ---
{
  const record = buildRunRecord({
    benchmark: 'commit0',
    instanceId: 'task-1',
    condition: 'random@2',
    model: 'gpt-5',
    resolved: true,
    infraError: false,
    now: () => new Date('2026-06-03T00:00:00.000Z'),
    iterations: [
      {
        index: 0,
        task: 'prompt',
        agentRunName: 'worker',
        output: 'completion',
        verdict: { valid: true, score: 1 },
        events: [],
        startedAt: 10,
        endedAt: 20,
        costUsd: 0.01,
        tokenUsage: { input: 10, output: 5 },
      },
    ],
    runtimeEvents: [
      {
        id: 'run-1:agent.run:before',
        runId: 'run-1',
        scenarioId: 'task-1',
        target: 'agent.run',
        phase: 'before',
        timestamp: 1,
      },
    ],
    runtimeDecisionPoints: [
      {
        id: 'run-1:agent.turn:0:failure-recovery',
        runId: 'run-1',
        scenarioId: 'task-1',
        stepIndex: 0,
        kind: 'retry',
        candidateActions: ['retry', 'verify', 'stop'],
        evidence: [{ source: 'tool_result', id: 'tool-1:result' }],
        metadata: { target: 'failure-recovery' },
      },
    ],
  })
  assert.equal(record.runtimeEvents?.length, 1, 'runtime lifecycle events survive the writer')
  assert.equal(record.runtimeDecisionPoints?.length, 1, 'runtime decision points survive the writer')
  assert.equal(record.runtimeDecisionPoints?.[0]?.metadata?.target, 'failure-recovery')
}

// --- buildRunRecordFromAttempts: default derivations from the attempts ---
{
  const rec = buildRunRecordFromAttempts([measuredAttempt(0, 'a', false), measuredAttempt(1, 'b', true)], {
    benchmark: 'aec-bench',
    instanceId: 'i9',
    condition: 'random@2',
    model: 'gpt-5',
    now: () => new Date('2026-06-06T00:00:00.000Z'),
    runtimeEvents: [
      {
        id: 'run-2:agent.run:before',
        runId: 'run-2',
        target: 'agent.run',
        phase: 'before',
        timestamp: 1,
      },
    ],
    runtimeDecisionPoints: [
      {
        id: 'run-2:agent.turn:0:failure-recovery',
        runId: 'run-2',
        stepIndex: 0,
        kind: 'retry',
        candidateActions: ['retry', 'verify', 'stop'],
        evidence: [{ source: 'tool_result', id: 'tool-2:result' }],
      },
    ],
  })
  assert.equal(rec.ts, '2026-06-06T00:00:00.000Z', 'now() seam stamps ts')
  assert.equal(rec.blindResolved, false, 'blindResolved = attempts[0].valid === true')
  assert.equal(rec.resolved, true, 'resolved = any attempt valid')
  assert.equal(rec.infraError, false, 'scored+valid attempts ⇒ not infra')
  assert.equal(rec.attempts.length, 2)
  assert.equal(rec.runtimeEvents?.length, 1, 'attempt writer preserves lifecycle events')
  assert.equal(rec.runtimeDecisionPoints?.length, 1, 'attempt writer preserves decision points')
}

// --- no scored + no valid attempt ⇒ derived infraError ---
{
  const bare: AttemptRecord = { round: 0, prompt: 'q', output: '', eventCount: 0, eventTypes: {} }
  const rec = buildRunRecordFromAttempts([bare], { benchmark: 'aec-bench', instanceId: 'i', condition: 'random@1', model: 'gpt-5' })
  assert.equal(rec.infraError, true, 'no scored + no valid ⇒ infraError true')
  assert.equal(rec.blindResolved, false)
  assert.equal(rec.resolved, false)
}

// --- explicit overrides preserve a gate's bespoke recorded values ---
{
  const partial: AttemptRecord = { round: 0, prompt: 'q', output: 'x', valid: true, score: 0.5, costUsd: 0.01, tokensIn: 1, tokensOut: 1, wallMs: 1, eventCount: 1, eventTypes: {} }
  const rec = buildRunRecordFromAttempts([partial], {
    benchmark: 'clbench-codebase',
    instanceId: 'i',
    condition: 'random@1',
    model: 'gpt-5',
    // a partial-credit (score 0.5) first shot is valid but NOT a full blind-resolve.
    blindResolved: false,
    infraError: false,
  })
  assert.equal(rec.blindResolved, false, 'override beats the attempts[0].valid default')
  assert.equal(rec.resolved, true, 'resolved still derives from valid when not overridden')
  assert.equal(rec.infraError, false)
}

console.log('corpus.test.mts: all assertions passed')
