/**
 * Settle-time capture with LABEL v2: the contribution rule (delivered worker
 * vs sibling bystander vs identity gap), baseline-relative proposer rewards,
 * campaign-path attribution, and end-to-end line validity on a synthetic
 * supervisor run dir (opencode store absent → labeled gap lines).
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readRolloutLedger } from '@tangle-network/agent-eval/rollout'
import {
  campaignCoordsFromCellPath,
  createSettleCapture,
  deliveredWorkerLabels,
  PROPOSER_REWARD_SOURCE_V2,
  proposerRewardV2,
  readWorkerEvidence,
  WORKER_REWARD_SOURCE_V2,
  workerRewardV2,
  type CellCaptureArgs,
} from './settle-capture.mts'

describe('workerRewardV2 (contribution rule)', () => {
  it('rewards ONLY the delivering worker in a resolved cell', () => {
    expect(workerRewardV2({ resolved: true, isDelivered: true, identityKnown: true })).toEqual({
      reward: 1,
      bystander: false,
      deliveredMatch: 'delivered',
    })
  })

  it('marks resolved-cell siblings as bystanders with reward 0', () => {
    expect(workerRewardV2({ resolved: true, isDelivered: false, identityKnown: true })).toEqual({
      reward: 0,
      bystander: true,
      deliveredMatch: 'bystander',
    })
  })

  it('gives every worker 0 in an unresolved cell (no bystander flag)', () => {
    expect(workerRewardV2({ resolved: false, isDelivered: false, identityKnown: true })).toEqual({
      reward: 0,
      bystander: false,
      deliveredMatch: 'unresolved',
    })
  })

  it('labels an identity gap as reward null (never fabricated credit) and an inconclusive cell as null', () => {
    expect(workerRewardV2({ resolved: true, isDelivered: false, identityKnown: false })).toEqual({
      reward: null,
      bystander: false,
      deliveredMatch: 'unknown',
    })
    expect(workerRewardV2({ resolved: null, isDelivered: false, identityKnown: false }).reward).toBeNull()
  })
})

describe('deliveredWorkerLabels', () => {
  const workers = [
    { label: 'w1', cwd: '/tmp/w1', patch: 'diff --git a/x b/x\n+fix\n' },
    { label: 'w2', cwd: '/tmp/w2', patch: 'diff --git a/y b/y\n+other\n' },
    { label: 'w3', cwd: null, patch: null },
  ]

  it('matches by trimmed patch equality', () => {
    expect(deliveredWorkerLabels('diff --git a/x b/x\n+fix\n\n', workers)).toEqual(['w1'])
  })

  it('returns [] for an empty delivery or no match', () => {
    expect(deliveredWorkerLabels('', workers)).toEqual([])
    expect(deliveredWorkerLabels('diff --git a/z b/z\n+mystery\n', workers)).toEqual([])
  })
})

describe('proposerRewardV2 (baseline-relative)', () => {
  it('is positive for an improvement, negative for a regression, zero for a tie', () => {
    expect(proposerRewardV2(3, 1, 6)).toBeCloseTo(2 / 6)
    expect(proposerRewardV2(0, 1, 6)).toBeCloseTo(-1 / 6)
    expect(proposerRewardV2(1, 1, 6)).toBe(0)
  })

  it('rejects a zero instance count', () => {
    expect(() => proposerRewardV2(1, 0, 0)).toThrow(/instanceCount/)
  })
})

describe('campaignCoordsFromCellPath (directory attribution, never dispatch order)', () => {
  it('parses candidate and baseline cells; unknown shapes return null', () => {
    expect(campaignCoordsFromCellPath('/x/improve-run/gen-0/candidate-2/cell-1/arm-summary.json')).toEqual({
      generation: 0,
      candidateIndex: 2,
    })
    expect(campaignCoordsFromCellPath('/x/improve-run/baseline/cell-1/arm-summary.json')).toEqual({
      generation: -1,
      candidateIndex: -1,
    })
    expect(campaignCoordsFromCellPath('/x/somewhere/else.json')).toBeNull()
  })
})

describe('readWorkerEvidence', () => {
  let supRunDir: string

  beforeEach(async () => {
    supRunDir = await mkdtemp(join(tmpdir(), 'sup-'))
    const workers = join(supRunDir, 'workers')
    await mkdir(workers, { recursive: true })
    await writeFile(
      join(workers, 'w1.ndjson'),
      `${JSON.stringify({ kind: 'started', cwd: '/tmp/clone-w1' })}\n${JSON.stringify({ kind: 'settled' })}\n`,
    )
    await writeFile(join(workers, 'w1.patch'), 'diff --git a/x b/x\n+fix\n')
    await writeFile(join(workers, 'w2.ndjson'), `${JSON.stringify({ kind: 'started', cwd: '/tmp/clone-w2' })}\n`)
    // Inbox files must not create phantom workers.
    await writeFile(join(workers, 'w1.inbox.ndjson'), '{}\n')
  })

  afterEach(async () => {
    await rm(supRunDir, { recursive: true, force: true })
  })

  it('joins per-worker cwd + patch; a worker without a patch reads patch:null', async () => {
    const records = await readWorkerEvidence(supRunDir)
    expect(records).toEqual([
      { label: 'w1', cwd: '/tmp/clone-w1', patch: 'diff --git a/x b/x\n+fix\n' },
      { label: 'w2', cwd: '/tmp/clone-w2', patch: null },
    ])
  })

  it('returns [] for a run dir without worker evidence', async () => {
    expect(await readWorkerEvidence(join(supRunDir, 'nope'))).toEqual([])
  })
})

describe('createSettleCapture end-to-end (opencode store absent)', () => {
  let root: string
  let supRunDir: string
  let ledgerPath: string

  const cellArgs = (over: Partial<CellCaptureArgs> = {}): CellCaptureArgs => ({
    generation: 0,
    candidateIndex: 1,
    iid: 'pydata__xarray-4687',
    rep: 0,
    seed: 42,
    splitVisibility: 'public',
    commit: 'c'.repeat(40),
    resolved: true,
    judgeVerdict: { resolved: true, attempts: 1 },
    runDir: join(root, 'runs', 'pydata__xarray-4687', 'R4'),
    patchPath: join(root, 'delivered.patch'),
    supRunDir,
    deliveredPatch: 'diff --git a/x b/x\n+fix\n',
    workerModel: 'zai-coding-plan/glm-5.2',
    metrics: { resolved: true, verify_pass: true },
    cost: { usd: 1.25, wallS: 900, spentTokens: 1000 },
    ...over,
  })

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'settle-'))
    ledgerPath = join(root, 'rollout-ledger.jsonl')
    supRunDir = join(root, 'ws', '.loops', 'supervisor', 's1')
    const workers = join(supRunDir, 'workers')
    await mkdir(workers, { recursive: true })
    await writeFile(join(workers, 'w1.ndjson'), `${JSON.stringify({ kind: 'started', cwd: '/tmp/clone-w1' })}\n`)
    await writeFile(join(workers, 'w1.patch'), 'diff --git a/x b/x\n+fix\n')
    await writeFile(join(workers, 'w2.ndjson'), `${JSON.stringify({ kind: 'started', cwd: '/tmp/clone-w2' })}\n`)
    await writeFile(join(workers, 'w2.patch'), 'diff --git a/y b/y\n+other\n')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  const capture = () =>
    createSettleCapture({
      ledgerPath,
      runId: 'r4-test',
      instanceCount: 6,
      opencodeDb: join(root, 'no-such.db'),
      now: () => new Date('2026-07-23T00:00:00Z'),
    })

  it('emits schema-valid supervisor + worker lines with v2 labels: delivered worker 1, bystander 0', async () => {
    const { lines } = await capture().captureCell(cellArgs())
    expect(lines).toBe(3)
    const ledger = await readRolloutLedger(ledgerPath) // validates every line
    expect(ledger).toHaveLength(3)

    const sup = ledger.find((l) => l.role === 'supervisor')!
    expect(sup.outcome.reward).toBe(1)
    expect(sup.outcome.reward_source).toBe('swe-arena-official-judge')
    expect(sup.generation).toBe(0)
    expect(sup.candidate_index).toBe(1)
    expect(sup.outcome.metrics.split_visibility).toBe('public')
    expect(sup.provenance.capture).toBe('settle-time')

    const workers = ledger.filter((l) => l.role === 'worker')
    expect(workers).toHaveLength(2)
    for (const w of workers) {
      expect(w.parent_rollout_id).toBe(sup.rollout_id)
      expect(w.outcome.reward_source).toBe(WORKER_REWARD_SOURCE_V2)
      // Store absent → labeled gap, never a silent drop.
      expect(w.messages).toEqual([])
      expect(w.provenance.gap).toBeTruthy()
    }
    const delivered = workers.find((w) => w.outcome.metrics.worker_label === 'w1')!
    const bystander = workers.find((w) => w.outcome.metrics.worker_label === 'w2')!
    expect(delivered.outcome.reward).toBe(1)
    expect(delivered.outcome.metrics.bystander).toBe(false)
    expect(delivered.outcome.metrics.delivered_match).toBe('delivered')
    expect(bystander.outcome.reward).toBe(0)
    expect(bystander.outcome.metrics.bystander).toBe(true)
    expect(bystander.outcome.metrics.delivered_match).toBe('bystander')
  })

  it('gives all workers 0 in an unresolved cell', async () => {
    await capture().captureCell(cellArgs({ resolved: false }))
    const workers = (await readRolloutLedger(ledgerPath)).filter((l) => l.role === 'worker')
    expect(workers.map((w) => w.outcome.reward)).toEqual([0, 0])
    expect(workers.every((w) => w.outcome.metrics.bystander === false)).toBe(true)
  })

  it('labels an unmatched delivery as an identity gap: worker rewards null', async () => {
    await capture().captureCell(cellArgs({ deliveredPatch: 'diff --git a/z b/z\n+mystery\n' }))
    const workers = (await readRolloutLedger(ledgerPath)).filter((l) => l.role === 'worker')
    expect(workers.map((w) => w.outcome.reward)).toEqual([null, null])
    expect(workers.every((w) => w.outcome.metrics.delivered_match === 'unknown')).toBe(true)
  })

  it('emits a baseline-relative proposer line (improvement positive, v2 source)', async () => {
    await capture().captureProposer({
      generation: 0,
      candidateIndex: 1,
      proposer: 'glm-author',
      harness: 'opencode',
      commit: 'c'.repeat(40),
      candResolved: 3,
      baselineResolved: 1,
      shotReceiptPaths: [],
      diffPath: null,
    })
    const [line] = await readRolloutLedger(ledgerPath)
    expect(line!.role).toBe('proposer')
    expect(line!.outcome.reward).toBeCloseTo(2 / 6)
    expect(line!.outcome.reward_source).toBe(PROPOSER_REWARD_SOURCE_V2)
    expect(line!.outcome.metrics.baseline_resolved_count).toBe(1)
    expect(line!.task.instance_id).toBe('gen0-cand1-glm-author')
  })

  it('appends across cells (one ledger, many flushes) and keeps every line valid', async () => {
    const c = capture()
    await c.captureCell(cellArgs())
    await c.captureCell(cellArgs({ rep: 1, resolved: false, splitVisibility: 'private' }))
    const ledger = await readRolloutLedger(ledgerPath)
    expect(ledger).toHaveLength(6)
    expect(ledger.filter((l) => l.outcome.metrics.split_visibility === 'private')).toHaveLength(3)
  })
})
