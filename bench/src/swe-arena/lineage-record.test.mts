/**
 * Gen-5 lineage DAG wiring: baseline root + pareto-parent nodes + candidate
 * nodes (multi-parent merge), append-only idempotence at the
 * .evolve-compatible store, and the recorded governor decision.
 */

import { readFile, rm } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Lineage } from '@tangle-network/agent-eval/campaign'
import { LINEAGE_STORE_RELPATH, recordLineageGeneration, type LineageRecordArgs } from './lineage-record.mts'

const SIX = ['a-1', 'b-2', 'c-3', 'd-4', 'e-5', 'f-6']

describe('recordLineageGeneration', () => {
  let outDir: string

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'lineage-rec-'))
  })

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true })
  })

  const args = (): LineageRecordArgs => ({
    outDir,
    runId: 'r4-test',
    instances: SIX,
    baseline: { commit: 'base'.repeat(10), resolvedCount: 1, verdicts: { 'a-1': true } },
    paretoParents: [
      { label: 'default-author', commit: 'p1p1'.repeat(10), resolvedInstances: ['d-4', 'f-6'] },
      { label: 'prompts-author', commit: 'p2p2'.repeat(10), resolvedInstances: ['b-2', 'd-4'] },
    ],
    candidates: [
      {
        label: 'claude-author',
        commit: 'c1c1'.repeat(10),
        resolvedCount: 2,
        verdicts: { 'a-1': true, 'd-4': true },
        merge: false,
        verdict: 'accepted',
      },
      {
        label: 'merge-author',
        commit: 'c2c2'.repeat(10),
        resolvedCount: 3,
        verdicts: { 'a-1': true, 'b-2': true, 'd-4': true },
        merge: true,
        verdict: 'accepted',
      },
      {
        label: 'killed-author',
        commit: null,
        resolvedCount: 0,
        verdicts: {},
        merge: false,
        verdict: 'rejected-prefilter',
      },
    ],
  })

  it('records root + parents + candidates at the .evolve-compatible store; merge is MULTI-PARENT', async () => {
    const result = await recordLineageGeneration(args())
    expect(result.path).toBe(join(outDir, LINEAGE_STORE_RELPATH))
    expect(result.path).toContain('.evolve')
    // root + 2 parents + 2 committed candidates (killed-author skipped).
    expect(result.nodesTotal).toBe(5)
    expect(result.appended).toHaveLength(5)
    expect(result.skipped).toEqual(['killed-author'])

    const raw = await readFile(result.path, 'utf8')
    const lineage = Lineage.fromJSONL(raw)
    const root = lineage.roots()
    expect(root).toHaveLength(1)
    expect(root[0]!.track).toBe('baseline')
    expect(root[0]!.score).toBeCloseTo(1 / 6)

    const merge = lineage.all().find((n) => n.track === 'merge-author')!
    expect(merge.parentIds).toHaveLength(2)
    const parentTracks = merge.parentIds.map((id) => lineage.all().find((n) => n.id === id)!.track).sort()
    expect(parentTracks).toEqual(['default-author', 'prompts-author'])
    expect(merge.proposer).toBe('merge')
    expect(merge.score).toBeCloseTo(3 / 6)

    const single = lineage.all().find((n) => n.track === 'claude-author')!
    expect(single.parentIds).toEqual([root[0]!.id])
    expect(single.rationale).toContain('accepted')
    // scoreVector: sorted instance order, fail-closed 0 for missing verdicts.
    expect(single.scoreVector).toEqual([1, 0, 0, 1, 0, 0])
  })

  it('is idempotent: re-recording the identical generation appends ZERO nodes', async () => {
    const first = await recordLineageGeneration(args())
    const second = await recordLineageGeneration(args())
    expect(first.appended).toHaveLength(5)
    expect(second.appended).toHaveLength(0)
    expect(second.nodesTotal).toBe(5)
    const raw = await readFile(second.path, 'utf8')
    expect(raw.trim().split('\n')).toHaveLength(5)
  })

  it('returns a governor continuation decision (recorded, never acted on here)', async () => {
    const result = await recordLineageGeneration(args())
    expect(['extend', 'branch', 'merge', 'prune', 'stop']).toContain(result.governor.op)
  })

  it('fails loud when a merge candidate has fewer than 2 parent nodes', async () => {
    const bad = args()
    bad.paretoParents = bad.paretoParents.slice(0, 1)
    await expect(recordLineageGeneration(bad)).rejects.toThrow(/needs >=2/)
  })
})
