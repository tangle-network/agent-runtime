import { randomUUID } from 'node:crypto'
import {
  type CampaignStorage,
  developmentClaim,
  type OptimizationMethod,
  openSearchLedger,
  SearchRecorder,
  scopedOptimizationMethod,
  sequentialOptimizationMethod,
  surfaceNode,
  verifySearchHistoryArtifact,
} from '@tangle-network/agent-eval/campaign'
import { describe, expect, it } from 'vitest'
import { canonicalCandidateDigest } from '../src/candidate-execution/digest'
import { ConfigError } from '../src/errors'
import { improve } from '../src/improvement/improve'
import { type ImprovementScenario, improvementOptions } from './helpers/improvement-method-fixture'

type LedgerEnding = 'closed' | 'open' | 'changed-after-receipt'

/**
 * A search that records its ledger as official GEPA does through Eval's
 * recorder: the stage's baseline as the root node, then a close. `open` leaves
 * the root undecided and the search unclosed; `changed-after-receipt` closes it
 * and then rewrites the ledger bytes the receipt names.
 */
function ledgerMethod(
  name: string,
  winnerSurface: string,
  storage: CampaignStorage,
  ending: LedgerEnding = 'closed',
): OptimizationMethod<ImprovementScenario, string> {
  return {
    name,
    async optimize(input) {
      const searchId = `${name}-${randomUUID()}`
      // An absolute path keeps the receipt's file URI equal to the in-memory key.
      const path = `/improve-method-search-ledgers/${searchId}/ledger.jsonl`
      const source = {
        uri: 'test://improve-method-search-ledgers',
        revision: canonicalCandidateDigest({ fixture: 'improve-method-search-ledgers' }),
      }
      const recorder = await SearchRecorder.open(
        { ledger: openSearchLedger({ path, searchId, store: storage }), storage },
        {
          subject: name,
          process: { name, executionRef: source },
          artifactKind: 'prompt',
          objective: {
            metric: 'composite',
            direction: 'maximize',
            judge: { unknown: 'the fixture judge is a function' },
            claim: developmentClaim(searchId),
          },
          splits: {
            train: input.trainScenarios.map((scenario) => ({
              taskId: scenario.id,
              unitId: scenario.id,
              source: {
                uri: `scenario://${scenario.id}`,
                revision: canonicalCandidateDigest(scenario),
              },
            })),
            selection: [],
            test: [],
            heldOutUnits: true,
          },
          policy: { expansion: 'fixture', allocation: 'none', seed: 0 },
          budget: {
            maxUsd: null,
            maxCells: null,
            maxNodes: 1,
            deadline: null,
            maxConcurrency: null,
            reservedClaimUsd: 0,
          },
          containment: null,
          derivedFrom: null,
          identity: {
            model: { provider: 'test', snapshot: 'deterministic-test@2026-07-01' },
            agent: source,
            benchmark: source,
          },
        },
      )
      const { nodeId } = await recorder.registerNode(surfaceNode(recorder, input.baselineSurface))
      await recorder.recordEdge({
        childNodeId: nodeId,
        parents: [],
        operator: 'seed',
        attribution: 'explicit',
        proposer: null,
        proposalKey: 'root',
        rationale: { unknown: 'the root is the stage baseline' },
        diffs: [],
        label: 'root',
      })
      if (ending !== 'open') {
        await recorder.decideNode({
          nodeId,
          decision: { status: 'pruned' },
          rule: 'fixture',
          reason: 'the fixture measures no candidate',
        })
        await recorder.close({ reason: 'converged', claim: null })
      }
      const searchHistory = recorder.receipt({ producerId: name, runId: searchId })
      if (ending === 'changed-after-receipt') storage.write(path, `${storage.read(path)}\n`)
      return {
        winnerSurface,
        cost: {
          totalCostUsd: 0,
          costProvenance: { kind: 'observed', usd: 0 },
          accountingComplete: true,
          incompleteReasons: [],
        },
        searchHistory,
      }
    },
  }
}

/** Sequential search over two scoped searches, the shape the Sandbox CLI runs per graph node. */
function twoStageMethod(storage: CampaignStorage, secondStage: LedgerEnding = 'closed') {
  const scoped = (name: string, method: OptimizationMethod<ImprovementScenario, string>) =>
    scopedOptimizationMethod<ImprovementScenario, string>({
      name,
      method,
      project: (surface) => surface,
      merge: (_baseline, selected) => selected,
    })
  return sequentialOptimizationMethod<ImprovementScenario, string>({
    name: 'two-stage-sequence',
    methods: [
      scoped('scope-a', ledgerMethod('ledger-a', 'STAGE-A', storage)),
      scoped('scope-b', ledgerMethod('ledger-b', 'PROMOTED', storage, secondStage)),
    ],
  })
}

const baselineProfile = { prompt: { systemPrompt: 'BASELINE' } }

describe('improve() method mode with a composed method', () => {
  it('returns and verifies the closed ledger of every stage', async () => {
    const options = improvementOptions()
    const result = await improve(baselineProfile, {
      ...options,
      method: twoStageMethod(options.storage),
    })
    if (result.mode !== 'method') throw new Error(`expected method mode, got ${result.mode}`)

    expect(result.candidate.value).toBe('PROMOTED')
    // The sequence records no ledger of its own; its stages each record one.
    expect(result.searchHistory).toBeNull()
    expect(result.searchHistories).toHaveLength(2)
    const histories = result.searchHistories ?? []
    expect(histories.map((receipt) => [receipt.producerId, receipt.complete])).toEqual([
      ['ledger-a', true],
      ['ledger-b', true],
    ])
    expect(new Set(histories.map((receipt) => receipt.ledger.sha256)).size).toBe(2)
    for (const receipt of histories) verifySearchHistoryArtifact(receipt, options.storage)
  })

  it('refuses a stage whose ledger is left open, naming the stage', async () => {
    const options = improvementOptions()
    const run = improve(baselineProfile, {
      ...options,
      method: twoStageMethod(options.storage, 'open'),
    })
    await expect(run).rejects.toBeInstanceOf(ConfigError)
    await expect(run).rejects.toThrow(
      "improve(): method 'two-stage-sequence' stage 'scope-b > ledger-b' returned an open search ledger: search is open",
    )
  })

  it('refuses a stage whose ledger bytes changed after its receipt', async () => {
    const options = improvementOptions()
    await expect(
      improve(baselineProfile, {
        ...options,
        method: twoStageMethod(options.storage, 'changed-after-receipt'),
      }),
    ).rejects.toThrow('search history ledger byte length mismatch')
  })
})
