/**
 * Offline coverage for the E3 certified memory (no creds, no gym):
 *   - admission: the store rejects rows naming no gate certificate; admitFromEvolution
 *     refuses non-promoted reports under strict, refuses failed reproducer certificates
 *     under --seed-displacers, and admits exactly the certified cases.
 *   - retrieval: task-class match beats a higher-scoring other-class row; best-overall
 *     fallback; empty store ⇒ null (the runner records the miss).
 *   - retrieval-is-execution: load() lints (assertStrategyContract) before importing; a
 *     program with a foreign import throws; a valid program runs through runCertifiedArm
 *     against a stub surface + stub router and carries the harness-verified score.
 *
 * Run: tsx src/certified-store.test.mts   (or node --test --import tsx …)
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AgenticSurface,
  EvolutionReport,
  Strategy,
} from '@tangle-network/agent-runtime/loops'
import {
  admitFromEvolution,
  type CertifiedRow,
  CertifiedStore,
} from './certified-store.mts'
import { runCertifiedArm } from './e3-memory-ab.mts'

// Temp dirs live UNDER bench/ so a program module's bare import of
// '@tangle-network/agent-runtime/loops' resolves through bench/node_modules.
const tmp = mkdtempSync(join(import.meta.dirname, '..', '.tmp-e3-'))

const row = (over: Partial<CertifiedRow>): CertifiedRow => ({
  name: 'fixtureStrategy',
  taskClass: 'eops:gym-itsm-mcp',
  file: 'programs/fixture.mts',
  summary: 'one shot, keep the harness score',
  verdictReason: 'promoted:significant',
  score: 0.5,
  usd: 0.01,
  addedAt: '2026-06-11T00:00:00.000Z',
  ...over,
})

/** A minimal certifying report; tests override the decision-bearing fields. */
const report = (over: {
  promoted: boolean
  reason: string
  championSource?: 'authored' | 'baseline'
  championName?: string
  gen0ChampionName?: string
  reproduction?: { summary: string; reproducible: boolean; gap: number }
}): EvolutionReport => {
  const champion = over.championName ?? 'authoredChamp'
  const holdoutCell = { score: 0.42, resolved: 0.25, usd: 0.02, ms: 1000 }
  return {
    gen0: { n: 1, excluded: 0, perStrategy: {}, perTask: [], pareto: [] },
    gen0Champion: { name: over.gen0ChampionName ?? 'refine', score: 0.4, usd: 0.03 },
    generations: [],
    archive: [
      { name: 'refine', source: 'baseline', generation: 0, score: 0.4, usd: 0.03 },
      {
        name: champion,
        source: over.championSource ?? 'authored',
        generation: 1,
        score: 0.6,
        usd: 0.02,
        ...(over.championSource === 'baseline' ? {} : { file: join(tmp, 'champion-source.mts') }),
      },
    ],
    finalChampion: { name: champion, score: 0.6, usd: 0.02 },
    holdout: { n: 1, excluded: 0, perStrategy: { [champion]: holdoutCell }, perTask: [], pareto: [] },
    verdict: {
      promoted: over.promoted,
      reason: over.reason as EvolutionReport['verdict']['reason'],
      mode: 'superiority',
      n: 8,
      lift: { mean: 0.1, median: 0.1, low: 0.01, high: 0.2 },
    },
    trajectory: [],
    ...(over.reproduction
      ? {
          reproduction: {
            summary: over.reproduction.summary,
            reproducedName: `${champion}-reproduced`,
            championHoldoutScore: 0.42,
            reproducedHoldoutScore: 0.42 - over.reproduction.gap,
            gap: over.reproduction.gap,
            reproducible: over.reproduction.reproducible,
          },
        }
      : {}),
  }
}

const certifiedProgram = `import { defineStrategy } from '@tangle-network/agent-runtime/loops'
export default defineStrategy('certified-fixture', async ({ shot }) => {
  const out = await shot()
  const score = out ? out.score : 0
  return { score, resolved: score >= 1, completions: out ? out.completions : 0, progression: out ? [out.score] : [], shots: out ? 1 : 0 }
})
`

const fixtureSurface = (passes: number, total: number): AgenticSurface => {
  let seq = 0
  return {
    name: 'fixture',
    async open() {
      seq += 1
      return { id: `h-${seq}`, surface: 'fixture' }
    },
    async tools() {
      return []
    },
    async call() {
      return 'ok'
    },
    async score() {
      return { passes, total, errored: 0 }
    },
    async close() {},
  }
}

/** Stub the router endpoint runShot fetches: one assistant turn, no tool calls. */
function stubFetch(): () => void {
  const orig = globalThis.fetch
  const body = {
    choices: [{ message: { content: 'DONE' } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  }
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch
  return () => {
    globalThis.fetch = orig
  }
}

const worker = { routerBaseUrl: 'http://router.test/v1', routerKey: 'test-key', model: 'test-model' }

try {
  // ── store admission: the certificate vocabulary is the gate ───────────────────────
  {
    const store = new CertifiedStore(join(tmp, 'admit', 'store.jsonl'))
    assert.throws(
      () => store.admit(row({ verdictReason: 'train-winner' })),
      /names no certificate/,
      'a row without a gate certificate is rejected',
    )
    assert.throws(
      () => store.admit(row({ name: '' })),
      /missing required fields/,
      'an empty name is rejected',
    )
    store.admit(row({}))
    store.admit(row({ name: 'second', verdictReason: 'displacer-reproducible:gate=no-margin,repro-gap=-0.9pp' }))
    assert.equal(store.rows().length, 2, 'certified rows round-trip')
  }

  // an unreadable store throws — never an empty-memory fallback
  assert.throws(() => new CertifiedStore(join(tmp, 'absent.jsonl')).rows(), /does not exist/)
  {
    const bad = join(tmp, 'bad.jsonl')
    writeFileSync(bad, 'not json\n')
    assert.throws(() => new CertifiedStore(bad).rows(), /not JSON/)
  }

  // ── admitFromEvolution: strict vs --seed-displacers ───────────────────────────────
  const taskClass = 'eops:gym-itsm-mcp'
  {
    const d = admitFromEvolution(
      report({ promoted: false, reason: 'no-margin', reproduction: { summary: 's', reproducible: true, gap: -0.01 } }),
      { taskClass, policy: 'promoted' },
    )
    assert.equal(d.admitted, false, 'strict refuses a non-promoted report')
    assert.match(d.reason, /promoted=false/)
  }
  {
    const d = admitFromEvolution(
      report({ promoted: true, reason: 'significant', reproduction: { summary: 's', reproducible: true, gap: 0 } }),
      { taskClass, policy: 'promoted' },
    )
    assert.equal(d.admitted, true, 'strict admits a promoted authored champion')
    assert.equal(d.candidate?.verdictReason, 'promoted:significant')
    assert.equal(d.candidate?.score, 0.42, 'row carries the HOLDOUT score, not train')
  }
  {
    const d = admitFromEvolution(
      report({ promoted: true, reason: 'significant', championSource: 'baseline', championName: 'sample' }),
      { taskClass, policy: 'promoted' },
    )
    assert.equal(d.admitted, false, 'a baseline champion is nothing to remember')
  }
  {
    const d = admitFromEvolution(report({ promoted: true, reason: 'significant' }), {
      taskClass,
      policy: 'promoted',
    })
    assert.equal(d.admitted, false, 'no reproducer summary and no --summary ⇒ refused, not blank')
    assert.match(d.reason, /no reproducer summary/)
  }
  {
    const d = admitFromEvolution(
      report({ promoted: false, reason: 'no-margin', reproduction: { summary: 's', reproducible: true, gap: -0.009 } }),
      { taskClass, policy: 'displacer-reproducible' },
    )
    assert.equal(d.admitted, true, 'displacer policy admits train-displacer + REPRODUCIBLE')
    assert.match(d.candidate?.verdictReason ?? '', /^displacer-reproducible:/)
  }
  {
    const d = admitFromEvolution(
      report({ promoted: false, reason: 'non-inferiority-unproven', reproduction: { summary: 's', reproducible: false, gap: 0.218 } }),
      { taskClass, policy: 'displacer-reproducible' },
    )
    assert.equal(d.admitted, false, 'a failed reproducer certificate blocks displacer admission')
    assert.match(d.reason, /overfitting signal/)
  }
  {
    const d = admitFromEvolution(
      report({ promoted: false, reason: 'no-margin', championName: 'refine', gen0ChampionName: 'refine', championSource: 'authored', reproduction: { summary: 's', reproducible: true, gap: 0 } }),
      { taskClass, policy: 'displacer-reproducible' },
    )
    assert.equal(d.admitted, false, 'no train displacement ⇒ nothing certified')
  }

  // ── retrieval: class match > fallback-by-score > miss ─────────────────────────────
  {
    const store = new CertifiedStore(join(tmp, 'retrieve', 'store.jsonl'))
    store.admit(row({ name: 'classMatch', taskClass: 'eops:gym-itsm-mcp', score: 0.4 }))
    store.admit(row({ name: 'otherClassHigher', taskClass: 'eops:gym-csm-mcp', score: 0.9 }))
    const hit = store.retrieve('eops:gym-itsm-mcp')
    assert.equal(hit?.row.name, 'classMatch', 'class match wins over a higher-scoring other-class row')
    assert.equal(hit?.match, 'class')
    const fb = store.retrieve('eops:gym-hr-mcp')
    assert.equal(fb?.row.name, 'otherClassHigher', 'no class match ⇒ best overall by score')
    assert.equal(fb?.match, 'fallback')
  }
  {
    const empty = new CertifiedStore(join(tmp, 'empty', 'store.jsonl'))
    mkdirSync(join(tmp, 'empty'), { recursive: true })
    writeFileSync(join(tmp, 'empty', 'store.jsonl'), '')
    assert.equal(empty.retrieve('eops:gym-itsm-mcp'), null, 'empty store ⇒ null (caller records the miss)')
  }

  // ── load(): the contract lint guards retrieval-is-execution ───────────────────────
  {
    const dir = join(tmp, 'lint')
    mkdirSync(join(dir, 'programs'), { recursive: true })
    writeFileSync(join(dir, 'programs', 'evil.mts'), `import { readFileSync } from 'node:fs'\nexport default {}\n`)
    const store = new CertifiedStore(join(dir, 'store.jsonl'))
    writeFileSync(join(dir, 'store.jsonl'), `${JSON.stringify(row({ file: 'programs/evil.mts' }))}\n`)
    await assert.rejects(
      () => store.load(row({ file: 'programs/evil.mts' })),
      /foreign import/,
      'a program with out-of-band capability never runs',
    )
    await assert.rejects(() => store.load(row({ file: 'programs/missing.mts' })), 'a missing program file throws')
  }

  // ── runCertifiedArm: retrieve → import → run, harness-verified score ──────────────
  {
    const dir = join(tmp, 'arm')
    mkdirSync(join(dir, 'programs'), { recursive: true })
    writeFileSync(join(dir, 'programs', 'fixture.mts'), certifiedProgram)
    const store = new CertifiedStore(join(dir, 'store.jsonl'))
    store.admit(row({ name: 'certified-fixture', file: 'programs/fixture.mts' }))
    const restore = stubFetch()
    try {
      const cache = new Map<string, Strategy>()
      const task = { id: 't1', systemPrompt: 'sys', userPrompt: 'do the work' }
      const hit = await runCertifiedArm({
        store,
        surface: fixtureSurface(1, 1),
        task,
        taskClass: 'eops:gym-itsm-mcp',
        opts: worker,
        budget: 2,
        cache,
      })
      assert.equal(hit.match, 'class')
      assert.equal(hit.retrieved, 'certified-fixture')
      assert.equal(hit.cell.score, 1, 'the harness-verified surface score, not a self-report')
      assert.equal(cache.size, 1, 'program import is cached')

      // miss path: empty store ⇒ refine fallback, RECORDED as a miss
      const emptyDir = join(tmp, 'arm-empty')
      mkdirSync(emptyDir, { recursive: true })
      writeFileSync(join(emptyDir, 'store.jsonl'), '')
      const miss = await runCertifiedArm({
        store: new CertifiedStore(join(emptyDir, 'store.jsonl')),
        surface: fixtureSurface(1, 2),
        task,
        taskClass: 'eops:gym-itsm-mcp',
        opts: worker,
        budget: 1,
        cache: new Map(),
      })
      assert.equal(miss.match, 'miss')
      assert.equal(miss.retrieved, null)
      assert.equal(miss.cell.score, 0.5, 'the miss still runs (refine) and scores honestly')
    } finally {
      restore()
    }
  }

  console.error('certified-store tests: OK')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
