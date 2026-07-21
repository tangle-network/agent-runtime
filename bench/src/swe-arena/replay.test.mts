/**
 * Proof-of-faithfulness gate for the swe-arena replay module.
 *
 * Every expected value below was produced by running the reference
 * implementation (`fixtures/analyze.py`) against the committed fixtures on
 * 2026-07-15 and captured verbatim — the typed port must reproduce it exactly
 * before any typed execution path is built on top.
 *
 * KNOWN, DELIBERATE DIVERGENCE (flagged, both sides pinned): analyze.py's
 * printed "SUP total tokens: 560,554 / 0.83x" counts the supervisor BRAIN
 * only (journal metered events). The true SUP-arm spend adds worker-session
 * tokens (worker-tokens.json): 560,554 + 1,161,836 = 1,722,390 → 2.55x
 * SOLO. Both rollups are pinned; neither replaces the other.
 */

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  costRollup,
  ledgerOutcomes,
  pairedSignTest,
  reconciledOutcomes,
  roundsProgression,
  splitPairs,
} from './analyze.ts'
import {
  loadHoldout,
  loadLedger,
  loadPreregisterLog,
  loadRejudge,
  loadRematchRounds,
  loadSupJournalTrue,
  loadWorkerTokens,
  readFixture,
} from './fixtures.ts'
import { applyRejudge, reconcile } from './reconcile.ts'
import { buildReplay, renderReplay } from './replay.mts'

const DISCORDANT = [
  'astropy__astropy-13033',
  'django__django-11532',
  'matplotlib__matplotlib-20826',
]

describe('fixture integrity', () => {
  // The fixtures ARE the experiment record. Any byte drift invalidates every
  // pinned number below, so drift must fail loudly here first.
  const sha256 = (name: string): string =>
    createHash('sha256').update(readFixture(name)).digest('hex')

  it.each([
    ['ledger.jsonl', '0014a1a2e7432a6551edbaf6668357cdbee8adb15b92e4f48ff530daf6ab8529'],
    ['rejudge.jsonl', '71ecadde0925d573573a7bb0fe171d26da386149f693035d3ca47c983a5f1700'],
    ['rematch.jsonl', 'aac48fdaa3c80f08367c220e406e1bb28b09c4f7d74fd17e4b76f50b5caaa5e4'],
    ['rematch2.jsonl', 'fe8347eae3e3f48c838cca0aa37e835730520482b705038c19450c98edd54d54'],
    ['rematch3.jsonl', '4eaeb9916634f3ffea7f66cb3bf747040a346524602a74a537efcdbc828ff020'],
    ['holdout.json', '56938f7c509621bcadbd50b1d6dacbee0f63b350506795e45d785c9de37d93f2'],
    ['worker-tokens.json', 'aa2f394120984a1c21ea7b70ed830a990477c08a1b38b6db743024660b43b129'],
    ['sup-journal-true.json', 'a95b48bdd7ab46011355c6a2b2844d67aa5811235ed3b8a5c9a4c9342eff9784'],
    ['analyze.py', '5512f4e1732ae4f0f92d7cb92840e5e99e54073c27f2b8ebd293b75346d9ebfc'],
    ['holdout-preregister.log', 'e11fbf34840765d8cd452c870905acec67e5a6b9dc05c2f76c64f71c2ad70884'],
  ])('%s is byte-identical to the captured artifact', (name, expected) => {
    expect(sha256(name)).toBe(expected)
  })

  it('loads the expected row counts', () => {
    expect(loadLedger()).toHaveLength(12)
    expect(loadRejudge()).toHaveLength(15)
    expect(loadRematchRounds().map((r) => r.length)).toEqual([3, 3, 3])
  })

  it('psf__requests-1766 carries the corrected-sup-verdict note', () => {
    const row = loadLedger().find((r) => r.iid === 'psf__requests-1766')
    expect(row?.sup_resolved).toBe(true)
    expect(row?._note).toMatch(/re-judged 2x stable resolved=true/)
  })
})

describe('reconcile: rejudge overrides + gold gate', () => {
  const table = reconcile(loadLedger(), loadRejudge())

  it('excludes exactly the gold-ungradeable instances 2317 + 2931', () => {
    expect(table.excluded.map((e) => e.iid)).toEqual(['psf__requests-2317', 'psf__requests-2931'])
    expect(table.excluded.map((e) => e.excludeReason)).toEqual([
      'gold patch unresolved by judge (gold2) — instance ungradeable',
      'gold patch unresolved by judge (gold) — instance ungradeable',
    ])
    expect(table.valid).toHaveLength(10)
  })

  it('gold-control (flask) grades true and stays in the denominator', () => {
    const flask = table.valid.find((r) => r.iid === 'pallets__flask-5014')
    expect(flask?.goldStatus).toBe('gradeable')
    expect(flask?.excluded).toBe(false)
  })

  it('parse-error rejudge rows (resolved=null) never override; final2 retries do', () => {
    const r2317 = applyRejudge(loadLedger(), loadRejudge()).find(
      (r) => r.iid === 'psf__requests-2317',
    )
    // solo-final and sup-final on 2317 both failed to parse; the *-final2
    // retries are the authoritative rows.
    expect(r2317?.solo).toEqual({ resolved: false, source: 'solo-final2' })
    expect(r2317?.sup).toEqual({ resolved: false, source: 'sup-final2' })
    // gold parse error superseded by the conclusive gold2 retry → ungradeable.
    expect(r2317?.goldStatus).toBe('ungradeable')
  })

  it('personal re-judges override the automated verdict for their arm only', () => {
    const byIid = new Map(applyRejudge(loadLedger(), loadRejudge()).map((r) => [r.iid, r]))
    for (const iid of DISCORDANT) {
      expect(byIid.get(iid)?.solo).toEqual({ resolved: true, source: 'solo-final' })
      expect(byIid.get(iid)?.sup.source).toBe('ledger')
    }
    expect(byIid.get('pydata__xarray-4687')?.solo).toEqual({
      resolved: false,
      source: 'solo-final',
    })
    expect(byIid.get('pydata__xarray-4687')?.sup).toEqual({ resolved: false, source: 'sup-final' })
  })
})

describe('analyze: raw ledger reproduction of analyze.py', () => {
  const outcomes = ledgerOutcomes(loadLedger())
  const split = splitPairs(outcomes)
  const sign = pairedSignTest(outcomes)

  it('SOLO 7/12, SUP 4/12', () => {
    expect(outcomes.filter((o) => o.solo)).toHaveLength(7)
    expect(outcomes.filter((o) => o.sup)).toHaveLength(4)
  })

  it('discordant pairs: 3 SOLO-only, 0 SUP-only', () => {
    expect(split.soloOnly).toEqual(DISCORDANT)
    expect(split.supOnly).toEqual([])
    expect(split.both).toHaveLength(4)
    expect(split.neither).toEqual([
      'psf__requests-2317',
      'psf__requests-2931',
      'pydata__xarray-4687',
      'pytest-dev__pytest-6197',
      'sphinx-doc__sphinx-9658',
    ])
  })

  it('exact two-sided sign test p = 0.25 (agent-eval mcnemar)', () => {
    expect(sign.b).toBe(0)
    expect(sign.c).toBe(3)
    expect(sign.nDiscordant).toBe(3)
    expect(sign.pValue).toBeCloseTo(0.25, 10)
    expect(sign.pValue.toFixed(4)).toBe('0.2500')
  })
})

describe('analyze: valid-denominator verdict', () => {
  const outcomes = reconciledOutcomes(reconcile(loadLedger(), loadRejudge()).valid)

  it('SOLO 7/10, SUP 4/10 after excluding 2931 + 2317', () => {
    expect(outcomes).toHaveLength(10)
    expect(outcomes.filter((o) => o.solo)).toHaveLength(7)
    expect(outcomes.filter((o) => o.sup)).toHaveLength(4)
  })

  it('same discordant set and p=0.25 (excluded pairs were concordant-neither)', () => {
    const split = splitPairs(outcomes)
    expect(split.soloOnly).toEqual(DISCORDANT)
    expect(split.supOnly).toEqual([])
    expect(pairedSignTest(outcomes).pValue).toBeCloseTo(0.25, 10)
  })
})

describe('analyze: cost rollups', () => {
  const cost = costRollup(loadLedger(), loadSupJournalTrue(), loadWorkerTokens())

  it('SOLO total 675,412 tokens (analyze.py oracle)', () => {
    expect(cost.soloTokens).toBe(675412)
  })

  it('SUP brain total 560,554 tokens — what analyze.py prints as "SUP total"', () => {
    expect(cost.supBrainTokens).toBe(560554)
    expect(cost.brainTokenRatio.toFixed(2)).toBe('0.83')
  })

  it('TRUE SUP total 1,722,390 = brain 560,554 + workers 1,161,836 → 2.55x SOLO', () => {
    // The loudly-flagged divergence: analyze.py never printed worker tokens,
    // so its 0.83x understates the SUP arm's true spend by the worker share.
    expect(cost.supWorkerTokens).toBe(1161836)
    expect(cost.supTotalTokens).toBe(1722390)
    expect(cost.totalTokenRatio).toBeCloseTo(2.5501, 4)
    expect(cost.totalTokenRatio.toFixed(2)).toBe('2.55')
  })

  it('USD via blended SUP rate (analyze.py oracle strings)', () => {
    expect(cost.supUsd.toFixed(4)).toBe('0.1754')
    expect((cost.blendedRatePerTok * 1e6).toFixed(3)).toBe('0.313')
    expect(cost.soloUsdDerived.toFixed(4)).toBe('0.2114')
  })

  it('wall time: SOLO 3769s vs SUP 9124s → 2.42x', () => {
    expect(cost.soloWallS).toBe(3769)
    expect(cost.supWallS).toBe(9124)
    expect(cost.wallRatio.toFixed(2)).toBe('2.42')
  })

  it('telemetry gaps: runtime zeroed spentTokens on the 4 no-winner/crashed runs', () => {
    expect(cost.telemetryGaps).toEqual([
      'astropy__astropy-13033',
      'django__django-11532',
      'matplotlib__matplotlib-20826',
      'pytest-dev__pytest-6197',
    ])
  })
})

describe('analyze: supervisor evolution rounds', () => {
  const rounds = roundsProgression(loadLedger(), loadRematchRounds())

  it('matplotlib: 0-line unresolved at SUP round 0 → RESOLVED at SUP4', () => {
    const states = rounds.get('matplotlib__matplotlib-20826')
    expect(states?.map((s) => ({ round: s.round, resolved: s.resolved, patchLines: s.patchLines }))).toEqual([
      { round: 'SUP', resolved: false, patchLines: 0 },
      { round: 'SUP2', resolved: false, patchLines: 0 },
      { round: 'SUP3', resolved: false, patchLines: 0 },
      { round: 'SUP4', resolved: true, patchLines: 23 },
    ])
  })

  it('astropy + django: never resolved across SUP..SUP4', () => {
    for (const iid of ['astropy__astropy-13033', 'django__django-11532']) {
      const states = rounds.get(iid)
      expect(states).toHaveLength(4)
      expect(states?.every((s) => !s.resolved)).toBe(true)
    }
  })
})

describe('holdout registry', () => {
  const holdout = loadHoldout()
  const log = loadPreregisterLog()

  it('6 instances, all gold-verified and judge-calibrated, single selection commit', () => {
    expect(holdout.entries).toHaveLength(6)
    expect(holdout.selectedAtCommit).toBe('4a06fc54bd180789d1402c843a63ed245df9f8eb')
    expect(holdout.entries.every((e) => e.gold_official_resolved && e.verify_calibrated)).toBe(true)
  })

  it('every entry was preregistered before any arm ran, then registered', () => {
    const iids = holdout.entries.map((e) => e.iid)
    for (const iid of iids) {
      const pre = log.findIndex((l) => l.includes('PREREGISTER') && l.includes(iid))
      const reg = log.findIndex((l) => l.includes('REGISTERED') && l.includes(iid))
      expect(pre).toBeGreaterThanOrEqual(0)
      expect(reg).toBeGreaterThan(pre)
      expect(log[pre]).toContain('status=selected-before-any-arm-run')
    }
  })
})

describe('replay CLI output', () => {
  // Lines below are verbatim from running fixtures/analyze.py on 2026-07-15
  // (trailing whitespace trimmed — the per-instance table pads columns).
  const lines = renderReplay(buildReplay())
    .split('\n')
    .map((l) => l.trimEnd())

  it.each([
    ['SOLO resolved: 7/12 = 58.3%'],
    ['SUP  resolved: 4/12 = 33.3%'],
    ['delta (SUP-SOLO): -3 instances (-25.0 pts)'],
    ["  SOLO-only wins (SOLO✓ SUP✗): 3  ['astropy__astropy-13033', 'django__django-11532', 'matplotlib__matplotlib-20826']"],
    ['  SUP-only wins (SUP✓ SOLO✗): 0  []'],
    ['  exact two-sided sign test on discordant pairs: p=0.2500'],
    ['COST (measured tokens; USD via shared blended rate $0.313/1M from SUP accounting):'],
    ['  SOLO total tokens: 675,412  -> derived $0.2114'],
    ['  SUP  total tokens: 560,554  -> runtime $0.1754'],
    ['  SUP/SOLO token ratio: 0.83x'],
    ['  SUP/SOLO cost ratio (token-derived): 0.83x'],
    ["  [telemetry] instances where runtime spentTokens != journal-true (no-winner zeroing): ['astropy__astropy-13033', 'django__django-11532', 'matplotlib__matplotlib-20826', 'pytest-dev__pytest-6197']"],
    ['  WALL: SOLO 3769s total vs SUP 9124s total -> SUP 2.42x wall'],
    ['pallets__flask-5014              True  True  T   T   ?   30738    15731    0.0124 116   261'],
    ['astropy__astropy-13033           True  False T   F   3   59496    0        0.0000 350   1550'],
    ['pytest-dev__pytest-6197          False False F   F   0   133032   0        0.0000 755   248'],
  ])('reproduces analyze.py line: %s', (expected) => {
    expect(lines).toContain(expected)
  })

  it.each([
    ['SOLO resolved: 7/10'],
    ['SUP  resolved: 4/10'],
    ['  EXCLUDED psf__requests-2317: gold patch unresolved by judge (gold2) — instance ungradeable'],
    ['  EXCLUDED psf__requests-2931: gold patch unresolved by judge (gold) — instance ungradeable'],
    ['exact two-sided sign test: p=0.2500'],
    ['  brain 560,554 + workers 1,161,836 = 1,722,390 tokens'],
    ['  SUP/SOLO true token ratio: 2.55x  (brain-only ratio: 0.83x)'],
    ['  matplotlib__matplotlib-20826     SUP:unresolved(0L,null) -> SUP2:unresolved(0L,no-winner) -> SUP3:unresolved(0L,null) -> SUP4:RESOLVED(23L,delivered)'],
    ['HOLDOUT REGISTRY (pre-registered at loops@4a06fc54bd, untouched):'],
  ])('prints reconciled line: %s', (expected) => {
    expect(lines).toContain(expected)
  })
})
