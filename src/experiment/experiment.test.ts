import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertExecutableEvidence,
  CampaignIntegrityError,
  MissingCampaignAdapterError,
  normalizeEvidence,
  shouldRetryEvidence,
} from './integrity'
import {
  appendCampaignCell,
  assertCampaignManifest,
  campaignConfigHash,
  readCampaignLedger,
  summarizeCampaign,
  writeCampaignArtifact,
} from './ledger'
import type {
  ExperimentArm,
  ExperimentCampaignManifest,
  ExperimentCellRecord,
  RunEvidence,
} from './types'

const policy = {
  carrier: 'original_text',
  promptTransformation: 'none',
  reasoningRepresentation: 'tool_contract',
  reasoningBudget: { kind: 'max_turns', maxTurns: 12 },
  sampling: 'single',
  verification: 'tool_state_check',
  stopRule: 'validator_success',
  outputContract: 'runtime_tool_loop',
} as const

const arm = (id: string, role: ExperimentArm['role']): ExperimentArm => ({
  id,
  role,
  origin: role === 'baseline' ? 'baseline' : 'compiler_generated',
  description: `${id} arm`,
  policy,
  runtime: { adapter: 'run-agentic', evidenceKind: 'stateful-agent' },
})

const manifest: ExperimentCampaignManifest = {
  schemaVersion: 1,
  campaignId: 'demo',
  title: 'demo campaign',
  researchQuestion: 'does the contract policy beat the baseline?',
  objective: 'quality',
  createdAt: '2026-06-28T00:00:00.000Z',
  taskSlices: [{ id: 't1', family: 'fam', split: 'holdout', taskId: 'task-1' }],
  deploymentTargets: [{ id: 'm1', model: 'demo-model', runtime: 'router' }],
  arms: [arm('baseline', 'baseline'), arm('policy', 'treatment')],
  reps: 1,
}

const cell = (armId: string, result: RunEvidence): ExperimentCellRecord => ({
  schemaVersion: 1,
  campaignId: 'demo',
  configHash: campaignConfigHash(manifest),
  cellId: `demo:t1:m1:${armId}:r1`,
  task: manifest.taskSlices[0]!,
  target: manifest.deploymentTargets[0]!,
  arm: manifest.arms.find((a) => a.id === armId)!,
  rep: 1,
  seed: 1,
  recordedAt: '2026-06-28T00:00:01.000Z',
  adapter: 'run-agentic',
  evidenceKind: 'stateful-agent',
  result,
})

const realUsage = { inputTokens: 1200, outputTokens: 300, costUsd: 0.004, latencyMs: 5000 }

describe('experiment ledger', () => {
  it('validates a well-formed manifest and rejects a one-arm manifest', () => {
    expect(() => assertCampaignManifest(manifest)).not.toThrow()
    expect(() => assertCampaignManifest({ ...manifest, arms: [manifest.arms[0]] })).toThrow(
      /at least 2 arms/,
    )
  })

  it('config hash is deterministic and ignores createdAt', () => {
    const a = campaignConfigHash(manifest)
    const b = campaignConfigHash({ ...manifest, createdAt: '2030-01-01T00:00:00.000Z' })
    expect(a).toBe(b)
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('round-trips cells through an append-only ledger', () => {
    const dir = mkdtempSync(join(tmpdir(), 'exp-'))
    const path = join(dir, 'cells.jsonl')
    appendCampaignCell(
      path,
      cell('baseline', { score: 0, passed: false, usage: realUsage, outputContractValid: true }),
    )
    appendCampaignCell(
      path,
      cell('policy', { score: 1, passed: true, usage: realUsage, outputContractValid: true }),
    )
    expect(readCampaignLedger(path)).toHaveLength(2)
  })

  it('flags a zero-usage real cell as a fake-backend signal', () => {
    const cells = [
      cell('baseline', { score: 0, passed: false, usage: realUsage, outputContractValid: true }),
      // scored 1.0 but spent zero tokens and zero dollars on a live (run-agentic) adapter
      cell('policy', {
        score: 1,
        passed: true,
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0 },
        outputContractValid: true,
      }),
    ]
    const summary = summarizeCampaign(manifest, cells)
    expect(summary.integrity.zeroUsageRealCells).toBe(1)
    expect(summary.cells).toBe(2)
    expect(summary.arms).toHaveLength(2)
  })

  it('writes a presentation-free artifact and an optional report', () => {
    const dir = mkdtempSync(join(tmpdir(), 'exp-'))
    const cells = [
      cell('baseline', { score: 0, passed: false, usage: realUsage, outputContractValid: true }),
      cell('policy', { score: 1, passed: true, usage: realUsage, outputContractValid: true }),
    ]
    writeCampaignArtifact(
      dir,
      manifest,
      cells,
      (a) => `# ${a.manifest.campaignId}: ${a.cells.length} cells\n`,
    )
    expect(JSON.parse(readFileSync(join(dir, 'artifact.json'), 'utf8')).cells).toHaveLength(2)
    expect(readFileSync(join(dir, 'REPORT.md'), 'utf8')).toContain('demo: 2 cells')
  })
})

describe('capture integrity', () => {
  it('normalizeEvidence rejects out-of-range scores and negative usage', () => {
    expect(() =>
      normalizeEvidence({ score: 1.5, passed: true, usage: realUsage, outputContractValid: true }),
    ).toThrow(CampaignIntegrityError)
    expect(() =>
      normalizeEvidence({
        score: 0.5,
        passed: true,
        usage: { ...realUsage, costUsd: -1 },
        outputContractValid: true,
      }),
    ).toThrow(/non-negative/)
  })

  it('shouldRetryEvidence catches tokenless, unscored, and invalid-contract cells', () => {
    expect(
      shouldRetryEvidence({
        score: 1,
        passed: true,
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0 },
        outputContractValid: true,
      }),
    ).toBe(true)
    expect(
      shouldRetryEvidence({
        score: null,
        passed: null,
        usage: realUsage,
        outputContractValid: true,
      }),
    ).toBe(true)
    expect(
      shouldRetryEvidence({ score: 1, passed: true, usage: realUsage, outputContractValid: false }),
    ).toBe(true)
    expect(
      shouldRetryEvidence({ score: 1, passed: true, usage: realUsage, outputContractValid: true }),
    ).toBe(false)
  })

  it('assertExecutableEvidence accepts executable kinds and the adapter error is descriptive', () => {
    expect(() => assertExecutableEvidence('stateful-agent')).not.toThrow()
    expect(new MissingCampaignAdapterError('run-agentic', 'demo:cell').message).toMatch(
      /do not substitute a fixture/,
    )
  })
})
