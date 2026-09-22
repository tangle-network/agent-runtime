import assert from 'node:assert/strict'
import { isRunRecord } from '@tangle-network/agent-eval'
import {
  type AttemptRecord,
  buildRunRecord,
  buildRunRecordFromAttempts,
  type CorpusAttemptRecord,
  type CorpusProjectionIdentity,
  projectCorpusAttempts,
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

const corpusAttempt = (
  round: number,
  output: string,
  valid: boolean,
): CorpusAttemptRecord => ({
  ...measuredAttempt(round, output, valid),
  runId: `run-${round}`,
  seed: 42 + round,
  output,
  score: valid ? 1 : 0,
  costUsd: 0.01 + round / 1000,
  costProvenance: { kind: 'observed', usd: 0.01 + round / 1000 },
  tokensIn: 100 + round,
  tokensOut: 30 + round,
  wallMs: 500 + round,
  terminalOutcome: 'succeeded',
})

const projectionIdentity: CorpusProjectionIdentity = {
  commitSha: 'abc123',
  experimentId: 'exp-1',
  candidateId: 'random@3',
  scenarioId: 'i1',
  splitTag: 'search',
  model: 'gpt-5-2025-08-07',
  configHash: 'b'.repeat(64),
}

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
  const records = await projectCorpusAttempts(
    [corpusAttempt(0, 'alpha', false), corpusAttempt(1, 'beta', true)],
    projectionIdentity,
  )
  assert.equal(records.length, 2, 'one record per attempt')
  for (const r of records) {
    assert.ok(isRunRecord(r), 'each is a valid canonical RunRecord')
  }
  const [r0, r1] = records
  assert.equal(r0?.candidateId, 'random@3', 'candidateId = condition (the gate-pairing arm)')
  assert.equal(r0?.scenarioId, 'i1', 'scenarioId = instanceId (the pairing key)')
  assert.equal(r0?.seed, 42, 'attempt seed is preserved')
  assert.equal(r1?.seed, 43, 'each attempt carries its own seed')
  assert.notEqual(r0?.seed, r1?.seed, 'no (scenarioId, seed) collision across a run\'s attempts')
  assert.equal(r0?.model, 'gpt-5-2025-08-07', 'snapshot-pinned model override applied')
  assert.equal(r0?.commitSha, 'abc123')
  assert.equal(r0?.tokenUsage.input, 100, 'real tokens carried (not zeroed)')
  assert.equal(r0?.costUsd, 0.01, 'real cost carried')
  assert.equal(r0?.prompt, 'q0', 'verbatim prompt survives the validator')
  assert.equal(r0?.completion, 'alpha', 'verbatim completion survives the validator')
  assert.equal(r0?.outcome.searchScore, 0, 'search split → searchScore from attempt score')
  assert.equal(r0?.outcome.raw.valid, 0)
  assert.equal(r1?.outcome.raw.valid, 1)
  assert.notEqual(r0?.runId, r1?.runId, 'per-attempt runIds are distinct')
}

// --- unknown cost is retained as null, never converted to zero or dropped ---
{
  const unknown = corpusAttempt(0, 'x', true)
  unknown.costUsd = null
  unknown.costProvenance = { kind: 'uncaptured', usd: null }
  const records = await projectCorpusAttempts([unknown], projectionIdentity)
  assert.equal(records.length, 1)
  assert.equal(records[0]?.costUsd, null)
  assert.deepEqual(records[0]?.costProvenance, { kind: 'uncaptured', usd: null })
}

// --- estimated cost remains separate from observed billing data ---
{
  const estimated = corpusAttempt(0, 'x', true)
  estimated.costUsd = 0.02
  estimated.costProvenance = { kind: 'estimated', usd: 0.02 }
  const records = await projectCorpusAttempts([estimated], projectionIdentity)
  assert.deepEqual(records[0]?.costProvenance, { kind: 'estimated', usd: 0.02 })
}

// --- canonical evidence is required; no field is inferred from order, validity, or errors ---
{
  for (const field of [
    'runId',
    'seed',
    'score',
    'costUsd',
    'costProvenance',
    'tokensIn',
    'tokensOut',
    'wallMs',
    'terminalOutcome',
    'output',
  ] as const) {
    const malformed = { ...corpusAttempt(0, 'x', true) } as Record<string, unknown>
    delete malformed[field]
    await assert.rejects(
      projectCorpusAttempts(
        [malformed as unknown as CorpusAttemptRecord],
        projectionIdentity,
      ),
      Error,
      `missing ${field} must reject the projection`,
    )
  }
}

// --- every cross-run identity is explicit ---
{
  for (const field of [
    'commitSha',
    'experimentId',
    'candidateId',
    'scenarioId',
    'splitTag',
    'model',
    'configHash',
  ] as const) {
    const malformed = { ...projectionIdentity } as Record<string, unknown>
    delete malformed[field]
    await assert.rejects(
      projectCorpusAttempts(
        [corpusAttempt(0, 'x', true)],
        malformed as unknown as CorpusProjectionIdentity,
      ),
      Error,
      `missing ${field} must reject the projection`,
    )
  }
}

// --- duplicate run or pairing identities reject instead of double-counting ---
{
  const first = corpusAttempt(0, 'a', true)
  const duplicateRun = { ...corpusAttempt(1, 'b', true), runId: first.runId }
  await assert.rejects(
    projectCorpusAttempts([first, duplicateRun], projectionIdentity),
    /duplicate runId/,
  )

  const duplicateSeed = { ...corpusAttempt(1, 'b', true), seed: first.seed }
  await assert.rejects(
    projectCorpusAttempts([first, duplicateSeed], projectionIdentity),
    /duplicate seed/,
  )
}

// --- terminal outcome and score are preserved even when local hints disagree ---
{
  const explicit = corpusAttempt(0, 'x', false)
  explicit.score = 0.75
  explicit.error = 'child tool recovered'
  explicit.terminalOutcome = 'succeeded'
  delete explicit.valid
  const records = await projectCorpusAttempts([explicit], projectionIdentity)
  assert.equal(records[0]?.outcome.searchScore, 0.75)
  assert.equal(records[0]?.outcome.raw.valid, undefined)
  assert.equal(records[0]?.terminalOutcome, 'succeeded')
  assert.equal(records[0]?.terminalFailureReason, undefined)
}

// --- contradictory cost evidence rejects the whole projection ---
{
  const contradictory = corpusAttempt(0, 'x', true)
  contradictory.costUsd = null
  contradictory.costProvenance = { kind: 'observed', usd: 0.01 }
  await assert.rejects(
    projectCorpusAttempts([contradictory], projectionIdentity),
    /cost/i,
  )
}

// --- bare model aliases reject the whole projection ---
{
  await assert.rejects(
    projectCorpusAttempts([corpusAttempt(0, 'alpha', true)], {
      ...projectionIdentity,
      model: 'gpt-5',
    }),
    /snapshot/i,
  )
}

// --- holdout split routes the score to holdoutScore ---
{
  const records = await projectCorpusAttempts([corpusAttempt(0, 'alpha', true)], {
    ...projectionIdentity,
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
