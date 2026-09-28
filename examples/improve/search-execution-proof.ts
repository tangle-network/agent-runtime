/**
 * Offline proof of a nested execution id and a transient judge retry through
 * `improve(searchMethod)`, the same entrypoint a consumer uses.
 *
 *   pnpm exec tsx examples/improve/search-execution-proof.ts <empty-run-dir>
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { validateRunRecord } from '@tangle-network/agent-eval'
import { incumbent, uniform } from '@tangle-network/agent-eval/campaign'
import { canonicalAgentProfileDigest } from '@tangle-network/agent-interface'
import {
  dedicatedLane,
  improve,
  SearchEnvironmentFault,
  searchMethod,
} from '@tangle-network/agent-runtime'

import {
  claim,
  executionRef,
  profile,
  type RuleScenario,
  ruleProposer,
  selectionScenarios,
  testScenarios,
  trainScenarios,
} from './search.js'

const runDir = process.argv[2]
if (!runDir) throw new Error('pass an empty run directory')
const outages = new Set<string>()
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const promptHash = canonicalAgentProfileDigest(profile).replace(/^sha256:/, '')
const result = await improve<RuleScenario, { execRunId: string }>(profile, {
  surface: 'prompt',
  executionRef,
  method: searchMethod({
    proposer: ruleProposer,
    maxExpansions: 0,
    policy: incumbent(),
    allocation: uniform(),
    lanes: [dedicatedLane({ capacity: 2, cellUsd: 0.01 })],
    maxAttempts: 2,
  }),
  claim,
  trainScenarios: trainScenarios.slice(0, 2),
  selectionScenarios: selectionScenarios.slice(0, 6),
  testScenarios: testScenarios.slice(0, 6),
  judges: [
    {
      name: 'transient-judge',
      judgeVersion: 'search-execution-proof/1',
      dimensions: [{ key: 'quality', description: 'constant fixture score' }],
      score({ scenario }) {
        if (scenario.id === 'train-0' && !outages.has(scenario.id)) {
          outages.add(scenario.id)
          throw new SearchEnvironmentFault('fixture judge endpoint unavailable')
        }
        return { dimensions: { quality: 0.5 }, composite: 0.5, notes: 'fixture' }
      },
    },
  ],
  async agent(_candidate, _scenario, ctx) {
    const paid = await ctx.cost.runPaidCall({
      channel: 'agent',
      actor: 'search-execution-proof',
      model: 'gpt-4o-2024-11-20',
      maximumCharge: { externallyEnforcedMaximumUsd: 0.0001 },
      execute: async () => ({ execRunId: `graph-${ctx.search.runId}` }),
      receipt: () => ({
        model: 'gpt-4o-2024-11-20',
        inputTokens: 1,
        outputTokens: 1,
        actualCostUsd: 0.0001,
      }),
    })
    if (!paid.succeeded) throw paid.error
    return paid.value
  },
  executionRunId: (artifact) => artifact.execRunId,
  recordCell({ cell, search, result: settled }) {
    if (settled.outcome.status !== 'passed')
      throw new Error('recordCell received an unscored attempt')
    if (settled.accounting.cost.status !== 'known') throw new Error('fixture cost became unknown')
    const tokens = settled.accounting.tokens
    return validateRunRecord({
      runId: search.runId,
      experimentId: 'search-execution-proof',
      candidateId: search.nodeId,
      seed: 42,
      model: 'gpt-4o-2024-11-20',
      promptHash,
      configHash: promptHash,
      commitSha: revision,
      wallMs: Math.round(settled.wallMs ?? cell.durationMs),
      costUsd: settled.accounting.cost.usd,
      costProvenance: { kind: 'observed', usd: settled.accounting.cost.usd },
      tokenUsage:
        tokens.status === 'known'
          ? { input: tokens.inputTokens, output: tokens.outputTokens }
          : { input: 0, output: 0, tokensKnown: false },
      terminalOutcome: 'succeeded',
      outcome: {
        raw: { fixture: 1 },
        ...(search.split === 'test'
          ? { holdoutScore: settled.outcome.score }
          : { searchScore: settled.outcome.score }),
      },
      splitTag:
        search.split === 'train' ? 'search' : search.split === 'selection' ? 'dev' : 'holdout',
      scenarioId: search.taskId,
      search: {
        searchId: search.searchId,
        nodeId: search.nodeId,
        cellId: search.cellId,
        attempt: search.attempt,
      },
      ...('traceId' in settled.traceRef!
        ? { traceRef: { traceId: settled.traceRef.traceId, execRunId: cell.artifact.execRunId } }
        : {}),
    })
  },
  costCeiling: 1,
  runDir,
})

const ledgerPath = new URL(result.searchHistory.ledger.uri)
const events = readFileSync(ledgerPath, 'utf8')
  .trim()
  .split('\n')
  .map(
    (line) =>
      JSON.parse(line) as {
        event: {
          kind: string
          runId?: string
          taskId?: string
          attempt?: number
          outcome?: { status: string; error?: { retryable?: boolean } }
          traceRef?: { execRunId?: string | null }
          artifacts?: Array<{ role: string }>
        }
      },
  )
const settled = events.map((entry) => entry.event).filter((event) => event.kind === 'cell-settled')
const retry = settled.find(
  (event) => event.outcome?.status === 'errored' && event.outcome.error?.retryable,
)
const linked = settled.filter(
  (event) =>
    event.outcome?.status === 'passed' && event.traceRef?.execRunId === `graph-${event.runId}`,
)
assert.ok(retry, 'judge environment fault must settle retryable')
assert.ok(
  settled.some((event) => event.attempt === 2 && event.outcome?.status === 'passed'),
  'the same cell must pass on attempt 2',
)
assert.ok(linked.length > 0, 'passed cells must carry their nested execution id')
assert.ok(
  linked.every((event) => event.artifacts?.some((artifact) => artifact.role === 'run-record')),
  'every passed cell must atomically bind its record',
)
console.log(
  JSON.stringify({
    settled: settled.length,
    retryableFaults: settled.filter((event) => event.outcome?.error?.retryable).length,
    linkedPassedCells: linked.length,
    boundRecords: settled.filter((event) =>
      event.artifacts?.some((artifact) => artifact.role === 'run-record'),
    ).length,
    ledger: ledgerPath.pathname,
  }),
)
