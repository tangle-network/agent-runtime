/**
 * Gen-5 public/private score split: determinism (seeded by runId), persisted
 * resume stability, and the never-surfaced invariant's checkable pieces.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  leaksPrivateInstance,
  loadOrCreateScoreSplit,
  publicOnly,
  SCORE_SPLIT_FILENAME,
  splitInstances,
  subScores,
} from './score-split.mts'

const SIX = [
  'astropy__astropy-13033',
  'django__django-11532',
  'matplotlib__matplotlib-20826',
  'pydata__xarray-4687',
  'pytest-dev__pytest-6197',
  'sphinx-doc__sphinx-9658',
]

describe('splitInstances', () => {
  it('is deterministic: same (runId, instances, publicCount) → identical split', () => {
    const a = splitInstances('r4-abc123', SIX, 4)
    const b = splitInstances('r4-abc123', SIX, 4)
    expect(a).toEqual(b)
  })

  it('is instance-ORDER-insensitive (ranking is content-derived)', () => {
    const a = splitInstances('r4-abc123', SIX, 4)
    const b = splitInstances('r4-abc123', [...SIX].reverse(), 4)
    expect(a).toEqual(b)
  })

  it('respects publicCount and partitions exactly (4 public / 2 private of 6)', () => {
    const split = splitInstances('r4-abc123', SIX, 4)
    expect(split.publicInstances).toHaveLength(4)
    expect(split.privateInstances).toHaveLength(2)
    expect([...split.publicInstances, ...split.privateInstances].sort()).toEqual([...SIX].sort())
    expect(split.publicInstances.filter((i) => split.privateInstances.includes(i))).toEqual([])
  })

  it('is SEEDED by runId: different runIds produce different splits', () => {
    const splits = new Set(
      Array.from({ length: 10 }, (_, i) => splitInstances(`r4-run${i}`, SIX, 4).privateInstances.join('|')),
    )
    expect(splits.size).toBeGreaterThan(1)
  })

  it('rejects publicCount outside (0, n) and duplicate instance ids', () => {
    expect(() => splitInstances('r', SIX, 0)).toThrow(/publicCount/)
    expect(() => splitInstances('r', SIX, 6)).toThrow(/publicCount/)
    expect(() => splitInstances('r', SIX, 2.5)).toThrow(/publicCount/)
    expect(() => splitInstances('r', ['a', 'a', 'b'], 1)).toThrow(/duplicate/)
  })
})

describe('loadOrCreateScoreSplit (resume stability)', () => {
  let outDir: string
  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'split-'))
  })
  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true })
  })

  it('persists on first computation and RELOADS verbatim under a NEW runId (a resume cannot rotate private into view)', async () => {
    const first = await loadOrCreateScoreSplit({ outDir, runId: 'r4-first', instances: SIX, publicCount: 4 })
    expect(JSON.parse(await readFile(join(outDir, SCORE_SPLIT_FILENAME), 'utf8'))).toEqual(first)
    const resumed = await loadOrCreateScoreSplit({ outDir, runId: 'r4-DIFFERENT', instances: SIX, publicCount: 4 })
    expect(resumed).toEqual(first)
    expect(resumed.seededBy).toBe('r4-first')
  })

  it('fails loud when the persisted split covers different instances or a different publicCount', async () => {
    await loadOrCreateScoreSplit({ outDir, runId: 'r4-first', instances: SIX, publicCount: 4 })
    await expect(
      loadOrCreateScoreSplit({ outDir, runId: 'r4-x', instances: [...SIX.slice(0, 5), 'other__iid-1'], publicCount: 4 }),
    ).rejects.toThrow(/refusing to silently re-split/)
    await expect(
      loadOrCreateScoreSplit({ outDir, runId: 'r4-x', instances: SIX, publicCount: 3 }),
    ).rejects.toThrow(/refusing to silently re-split/)
  })

  it('fails loud on an unknown schema in the persisted file', async () => {
    await writeFile(join(outDir, SCORE_SPLIT_FILENAME), JSON.stringify({ schema: 'nope' }))
    await expect(
      loadOrCreateScoreSplit({ outDir, runId: 'r', instances: SIX, publicCount: 4 }),
    ).rejects.toThrow(/unknown schema/)
  })
})

describe('never-surfaced invariant helpers', () => {
  const split = splitInstances('r4-abc123', SIX, 4)

  it('leaksPrivateInstance names every private id present in a text', () => {
    expect(leaksPrivateInstance('nothing to see', split)).toEqual([])
    const leakText = `evidence for ${split.privateInstances[0]} here`
    expect(leaksPrivateInstance(leakText, split)).toEqual([split.privateInstances[0]])
  })

  it('publicOnly drops private-instance records and is identity without a split', () => {
    const records = SIX.map((iid) => ({ iid, x: 1 }))
    const filtered = publicOnly(records, (r) => r.iid, split)
    expect(filtered.map((r) => r.iid).sort()).toEqual(split.publicInstances)
    expect(publicOnly(records, (r) => r.iid, null)).toEqual(records)
  })

  it('subScores counts fail-closed AND-verdicts per half (missing verdict = 0)', () => {
    const verdicts: Record<string, boolean> = {}
    verdicts[split.publicInstances[0]!] = true
    verdicts[split.publicInstances[1]!] = false
    verdicts[split.privateInstances[0]!] = true
    // privateInstances[1] has NO verdict — counts 0.
    expect(subScores(verdicts, split)).toEqual({ publicResolvedCount: 1, privateResolvedCount: 1 })
  })
})
