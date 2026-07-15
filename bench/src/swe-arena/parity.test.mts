/**
 * PARITY GATE for M2: the typed execution path (materialize → patch apply →
 * extractPatch → serialized-judge → official swebench verdict) must reproduce
 * the pinned M1 fixture verdicts for two committed arm patches — one resolved
 * (pallets__flask-5014 SOLO), one unresolved (pydata__xarray-4687 SUP) —
 * WITHOUT executing any arm. Zero model tokens; docker time only (it pulls the
 * two instance images if absent and runs the official judge, ~5-25 min each).
 *
 * Opt-in because of that docker cost:
 *
 *   SWE_ARENA_PARITY=1 ../node_modules/.bin/vitest run src/swe-arena/parity.test.mts
 *
 * Expected verdicts are DERIVED from the pinned fixtures (ledger + rejudge
 * reconciliation), not hardcoded — parity means agreeing with the record.
 *
 * TODO(operator approval): the full 12-instance ARM parity re-run (typed path
 * vs the bash harness on the same 12 ids, both arms) costs ~$1 model spend +
 * ~4h wall. Do not run without an explicit operator go — this 2-patch gate is
 * the milestone check.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadLedger, loadRejudge } from './fixtures.ts'
import { reconcile } from './reconcile.ts'
import { createSerializedJudge } from './serialized-judge.ts'
import { PARITY_CASES, replayPatchParity, type ParityCaseResult } from './run-experiment.mts'

const RUN_PARITY = process.env.SWE_ARENA_PARITY === '1'
// materialize + image pull + official judge, twice; generous but finite.
const PARITY_BUDGET_MS = 5_400_000

describe.runIf(RUN_PARITY)('dry-run parity vs pinned M1 verdicts (docker, no tokens)', () => {
  let results: ParityCaseResult[] = []
  let workDir = ''

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'swe-arena-parity-'))
    const judge = createSerializedJudge() // real judge child, 1800s ceiling, serialized
    results = await replayPatchParity(PARITY_CASES, { workDir, judge })
    for (const r of results) {
      console.log(`PARITY ${r.iid} [${r.arm}] verdict=${JSON.stringify(r.verdict)}`)
    }
  }, PARITY_BUDGET_MS)

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true })
  })

  it('re-extraction preserves each committed patch’s changed-file set', () => {
    expect(results).toHaveLength(2)
    for (const r of results) {
      expect(r.applyRc).toBe(0)
      expect(r.extractedFiles, `${r.iid} [${r.arm}]`).toEqual(r.fixtureFiles)
      expect(r.extractedPatchLines).toBeGreaterThan(0)
    }
  })

  it('pallets__flask-5014 SOLO: typed judge verdict == pinned ledger verdict (resolved)', () => {
    const pinned = loadLedger().find((r) => r.iid === 'pallets__flask-5014')
    expect(pinned?.solo_resolved).toBe(true) // sanity: the fixture side of the parity claim
    const r = results.find((x) => x.iid === 'pallets__flask-5014')
    expect(r?.verdict.attempts).toBeGreaterThan(0)
    expect(r?.verdict.resolved).toBe(pinned?.solo_resolved)
  })

  it('pydata__xarray-4687 SUP: typed judge verdict == reconciled verdict (unresolved)', () => {
    // The authoritative record for this arm is the personal re-judge
    // (sup-final), which M1's reconciliation applies over the ledger.
    const reconciled = reconcile(loadLedger(), loadRejudge()).valid.find(
      (r) => r.iid === 'pydata__xarray-4687',
    )
    expect(reconciled?.sup.source).toBe('sup-final')
    expect(reconciled?.sup.resolved).toBe(false)
    const r = results.find((x) => x.iid === 'pydata__xarray-4687')
    expect(r?.verdict.attempts).toBeGreaterThan(0)
    expect(r?.verdict.resolved).toBe(reconciled?.sup.resolved)
  })
})

describe.runIf(!RUN_PARITY)('dry-run parity (skipped)', () => {
  it('is opt-in: set SWE_ARENA_PARITY=1 to run the docker-backed parity gate', () => {
    expect(RUN_PARITY).toBe(false)
  })
})
