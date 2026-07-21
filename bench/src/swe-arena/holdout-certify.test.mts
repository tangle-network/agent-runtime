import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ReplicateRun } from './cell-evidence.mts'
import {
  assertHoldoutBaselineMap,
  decideHoldoutCertification,
  DEFAULT_HOLDOUT_REPS,
  holdoutReps,
  loadHoldoutCells,
  type HoldoutCellRow,
} from './holdout-certify.mts'

const IIDS = ['a', 'b', 'c']

const runs = (spec: Record<string, Array<boolean | null>>): ReplicateRun[] =>
  Object.entries(spec).flatMap(([iid, reps]) => reps.map((resolved) => ({ iid, resolved })))

describe('holdoutReps', () => {
  it('defaults to 2 — the gen-2 postmortem protocol', () => {
    expect(DEFAULT_HOLDOUT_REPS).toBe(2)
    expect(holdoutReps({})).toBe(2)
    expect(holdoutReps({ holdoutRepsPerInstance: 3 })).toBe(3)
  })

  it('rejects non-positive/non-integer reps', () => {
    expect(() => holdoutReps({ holdoutRepsPerInstance: 0 })).toThrow(/positive integer/)
    expect(() => holdoutReps({ holdoutRepsPerInstance: 1.5 })).toThrow(/positive integer/)
  })
})

describe('assertHoldoutBaselineMap', () => {
  it('requires a same-protocol verdict for EVERY holdout instance', () => {
    expect(() => assertHoldoutBaselineMap({ a: true }, IIDS)).toThrow(/missing same-protocol verdicts.*b, c/)
  })

  it('rejects verdicts for non-holdout instances', () => {
    expect(() => assertHoldoutBaselineMap({ a: true, b: false, c: true, z: true }, IIDS)).toThrow(/non-holdout/)
  })

  it('accepts a complete map', () => {
    expect(() => assertHoldoutBaselineMap({ a: true, b: false, c: true }, IIDS)).not.toThrow()
  })
})

describe('decideHoldoutCertification — 2-rep fail-closed aggregation', () => {
  const parent = { a: true, b: false, c: true } // parent 2/3 same-protocol

  it('an instance resolves only when BOTH reps resolve (T/F counts as unresolved)', () => {
    const d = decideHoldoutCertification({
      candidateRuns: runs({ a: [true, true], b: [true, false], c: [true, true] }),
      parentVerdicts: parent,
      iids: IIDS,
      reps: 2,
    })
    expect(d.candResolved).toBe(2) // a + c; b's discordant pair is fail-closed
    expect(d.parentResolved).toBe(2)
    expect(d.coverageComplete).toBe(true)
    expect(d.certified).toBe(true) // non-regression: 2 >= 2
    expect(d.perInstance.find((p) => p.iid === 'b')).toMatchObject({ candidate: false, parent: false, discordant: false })
  })

  it('regression fails certification even with complete coverage', () => {
    const d = decideHoldoutCertification({
      candidateRuns: runs({ a: [true, true], b: [false, false], c: [false, true] }),
      parentVerdicts: parent,
      iids: IIDS,
      reps: 2,
    })
    expect(d.candResolved).toBe(1)
    expect(d.certified).toBe(false)
    expect(d.reasons.join(' ')).toMatch(/regression: candidate 1 < parent 2/)
    expect(d.perInstance.find((p) => p.iid === 'c')).toMatchObject({ candidate: false, parent: true, discordant: true })
  })

  it('an inconclusive replicate (errored cell) blocks coverage and certification — fail-closed', () => {
    const d = decideHoldoutCertification({
      candidateRuns: runs({ a: [true, true], b: [false, false], c: [true, null] }),
      parentVerdicts: parent,
      iids: IIDS,
      reps: 2,
    })
    expect(d.coverageComplete).toBe(false)
    expect(d.certified).toBe(false)
    expect(d.reasons.join(' ')).toMatch(/coverage incomplete/)
    expect(d.perInstance.find((p) => p.iid === 'c')).toMatchObject({ candidate: null, discordant: false })
  })

  it('a missing replicate (only 1 of 2 reps ran) blocks coverage', () => {
    const d = decideHoldoutCertification({
      candidateRuns: runs({ a: [true, true], b: [true, true], c: [true] }),
      parentVerdicts: parent,
      iids: IIDS,
      reps: 2,
    })
    expect(d.coverageComplete).toBe(false)
    expect(d.certified).toBe(false)
  })

  it('gen-2 shape: one discordant instance under 1-rep would have failed; the same data at 2 reps needs both reps', () => {
    // At 1 rep a single flipped cell decided the gen-2 verdict. The 2-rep
    // protocol requires the flip to REPLICATE before it counts either way.
    const oneRep = decideHoldoutCertification({
      candidateRuns: runs({ a: [true], b: [false], c: [false] }),
      parentVerdicts: parent,
      iids: IIDS,
      reps: 1,
    })
    expect(oneRep.certified).toBe(false) // 1 < 2 — the gen-2 outcome
    const twoRep = decideHoldoutCertification({
      candidateRuns: runs({ a: [true, true], b: [false, false], c: [true, true] }),
      parentVerdicts: parent,
      iids: IIDS,
      reps: 2,
    })
    expect(twoRep.certified).toBe(true) // c held up under replication
  })

  it('validates the parent map before deciding', () => {
    expect(() =>
      decideHoldoutCertification({
        candidateRuns: runs({ a: [true, true] }),
        parentVerdicts: { a: true },
        iids: IIDS,
        reps: 2,
      }),
    ).toThrow(/missing same-protocol verdicts/)
  })
})

describe('loadHoldoutCells', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'holdout-cells-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('returns [] for a missing file and round-trips schema-valid rows', async () => {
    const path = join(dir, 'cells.jsonl')
    expect(await loadHoldoutCells(path)).toEqual([])
    const row: HoldoutCellRow = {
      schema: 'swe-arena.holdout-cell.v1',
      at: new Date(0).toISOString(),
      commit: 'abc123',
      side: 'candidate',
      iid: 'a',
      rep: 0,
      resolved: true,
      verifyPass: true,
      wallS: 100,
      runDir: '/tmp/x',
    }
    await writeFile(path, `${JSON.stringify(row)}\n${JSON.stringify({ schema: 'other' })}\n`)
    const rows = await loadHoldoutCells(path)
    expect(rows).toEqual([row]) // foreign schemas are dropped
  })
})
