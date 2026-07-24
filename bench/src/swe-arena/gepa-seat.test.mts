import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  DispatchContext,
  OptimizationMethodProvenance,
} from '@tangle-network/agent-eval/campaign'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ACTIVATION_PREDICATE_RELPATH, parseActivationPredicate } from './activation.mts'
import {
  DEFAULT_GEPA_PYTHON,
  DEFAULT_MAX_METRIC_CALLS,
  GEPA_INNER_RUNS_DIRNAME,
  gepaBridgeScenarios,
  innerSmokeComposite,
  innerSmokeJudge,
  isGepaSeat,
  mechanicalActivationPredicate,
  probeGepaRuntime,
  recipeEvaluationBudget,
  recipeForSeat,
  recordGepaSeatInnerRun,
  validateGepaSeat,
  type GepaMethodFactory,
  type GepaSeatInnerRun,
  type GepaSeatSpec,
  type ProbeExec,
} from './gepa-seat.mts'
import { defaultRound4Config, type OuterLoopConfig } from './outer-loop.mts'
import { fanOutLoopsGenerator, type ProposerSpec, type SmokeRunner, type SmokeVerdict } from './proposer-fanout.mts'
import { captureProposerProvenance } from './proposer-provenance.mts'
import { runOk } from './proc.ts'

const SURFACE = 'extensions/pi/prompts/worker-coding-system.md'

const seat = (over: Partial<ProposerSpec> = {}): ProposerSpec => ({
  name: 'gepa-author',
  engine: 'gepa',
  surface: SURFACE,
  ...over,
})

// ---------------------------------------------------------------------------
// Spec validation.
// ---------------------------------------------------------------------------

describe('validateGepaSeat', () => {
  it('accepts an engine seat and isGepaSeat discriminates on engine', () => {
    expect(() => validateGepaSeat(seat())).not.toThrow()
    expect(() => validateGepaSeat(seat({ engine: 'omni', maxMetricCalls: 8 }))).not.toThrow()
    expect(isGepaSeat(seat())).toBe(true)
    expect(isGepaSeat({ name: 'x', harness: 'claude' })).toBe(false)
  })

  it('requires a surface inside the declared change-space', () => {
    expect(() => validateGepaSeat(seat({ surface: undefined }))).toThrow(/surface is required/)
    expect(() => validateGepaSeat(seat({ surface: 'judge.py' }))).toThrow(/outside the declared change-space/)
    expect(() => validateGepaSeat(seat({ surface: '../escape.md' }))).toThrow(/outside the declared change-space/)
  })

  it('rejects harness-seat fields on an engine seat instead of silently ignoring them', () => {
    expect(() => validateGepaSeat(seat({ harness: 'claude' }))).toThrow(/'harness' belongs to harness-authored/)
    expect(() => validateGepaSeat(seat({ merge: true }))).toThrow(/'merge'/)
    expect(() => validateGepaSeat(seat({ model: 'x' }))).toThrow(/'model'/)
    expect(() => validateGepaSeat(seat({ profile: 'p.json' }))).toThrow(/'profile'/)
  })

  it('bounds the budget: positive integer calls, omni needs >= 4, positive cost cap', () => {
    expect(() => validateGepaSeat(seat({ maxMetricCalls: 0 }))).toThrow(/maxMetricCalls/)
    expect(() => validateGepaSeat(seat({ maxMetricCalls: 2.5 }))).toThrow(/maxMetricCalls/)
    expect(() => validateGepaSeat(seat({ engine: 'omni', maxMetricCalls: 3 }))).toThrow(/omni.*needs maxMetricCalls >= 4/)
    expect(() => validateGepaSeat(seat({ maxProposerCostUsd: 0 }))).toThrow(/maxProposerCostUsd/)
    expect(() => validateGepaSeat(seat({ engine: 'nope' as never }))).toThrow(/engine must be one of/)
  })
})

// ---------------------------------------------------------------------------
// Recipe / budget cap.
// ---------------------------------------------------------------------------

describe('recipeForSeat', () => {
  it("'gepa' is one bounded engine run carrying the full budget (default 10)", () => {
    const recipe = recipeForSeat(seat() as GepaSeatSpec)
    expect(recipe).toMatchObject({ kind: 'engine', run: { engine: 'gepa', maxEvaluations: DEFAULT_MAX_METRIC_CALLS } })
    expect(recipeEvaluationBudget(recipe)).toBe(DEFAULT_MAX_METRIC_CALLS)
  })

  it("'omni' uses the official recipe and its four bounded runs preserve the budget", () => {
    const recipe = recipeForSeat(seat({ engine: 'omni', maxMetricCalls: 10 }) as GepaSeatSpec)
    expect(recipe.kind).toBe('omni')
    if (recipe.kind !== 'omni') throw new Error('unreachable')
    expect(recipe.explore.map((r) => r.engine)).toEqual(['gepa', 'autoresearch', 'meta_harness'])
    expect(recipe.continueWith.engine).toBe('gepa')
    expect(recipeEvaluationBudget(recipe)).toBe(10)
    for (const run of [...recipe.explore, recipe.continueWith]) {
      expect(run.maxEvaluations).toBeGreaterThan(0)
      expect(run.maxProposerCostUsd).toBeGreaterThan(0)
    }
  })

  it('every budget from 4 upward is preserved exactly by the omni split', () => {
    for (const calls of [4, 5, 8, 12, 24]) {
      const recipe = recipeForSeat(seat({ engine: 'omni', maxMetricCalls: calls }) as GepaSeatSpec)
      expect(recipeEvaluationBudget(recipe)).toBe(calls)
    }
  })
})

// ---------------------------------------------------------------------------
// Public-only bridge examples.
// ---------------------------------------------------------------------------

describe('gepaBridgeScenarios (public-only invariant)', () => {
  const split = { privateInstances: ['django__django-11532', 'sphinx-doc__sphinx-9658'] }

  it('serializes ONLY the public smoke instance (train + a distinct-id selection alias)', () => {
    const { train, selection } = gepaBridgeScenarios('astropy__astropy-13033', split)
    expect(train).toEqual([{ id: 'astropy__astropy-13033', kind: 'swe-smoke', smokeIid: 'astropy__astropy-13033' }])
    expect(selection[0]!.id).toBe('astropy__astropy-13033::selection')
    expect(selection[0]!.smokeIid).toBe('astropy__astropy-13033')
    // Disjoint ids — the adapter's scenario map requires uniqueness.
    expect(train[0]!.id).not.toBe(selection[0]!.id)
    const serialized = JSON.stringify([...train, ...selection])
    for (const iid of split.privateInstances) expect(serialized).not.toContain(iid)
  })

  it('fails loud when the smoke instance is private — private ids never cross the bridge', () => {
    expect(() => gepaBridgeScenarios('django__django-11532', split)).toThrow(/PRIVATE under the score split/)
  })

  it('passes through with no split configured (pre-gen-5 behavior)', () => {
    expect(gepaBridgeScenarios('astropy__astropy-13033', null).train).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Inner score.
// ---------------------------------------------------------------------------

describe('inner smoke score', () => {
  const verdict = (over: Partial<SmokeVerdict>): SmokeVerdict => ({
    iid: 'astropy__astropy-13033',
    pass: true,
    reason: 'ok',
    resolved: false,
    patchLines: 3,
    wallS: 60,
    ...over,
  })

  it('resolve dominates; verify-pass is a bounded tiebreak that can never beat a resolve', () => {
    expect(innerSmokeComposite(verdict({ resolved: false, verifyPass: false }))).toBe(0)
    expect(innerSmokeComposite(verdict({ resolved: false, verifyPass: true }))).toBe(0.25)
    expect(innerSmokeComposite(verdict({ resolved: true, verifyPass: false }))).toBe(1)
    expect(innerSmokeComposite(verdict({ resolved: true, verifyPass: true }))).toBe(1.25)
    // Older verdicts without the field score as no verify signal.
    expect(innerSmokeComposite(verdict({ resolved: true }))).toBe(1)
  })

  it('the judge reports both dimensions and the composite', async () => {
    const judge = innerSmokeJudge()
    const score = await judge.score({
      artifact: verdict({ resolved: true, verifyPass: true, reason: 'smoke line' }),
      scenario: { id: 'x', kind: 'swe-smoke', smokeIid: 'x' },
      signal: new AbortController().signal,
    })
    expect(score).toMatchObject({ dimensions: { resolved: 1, verifyPass: 1 }, composite: 1.25, notes: 'smoke line' })
  })
})

// ---------------------------------------------------------------------------
// Optional Python runtime: loud failures with exact instructions.
// ---------------------------------------------------------------------------

describe('probeGepaRuntime', () => {
  const execFailingOn =
    (failFragment: string, stderr: string): ProbeExec =>
    async (_cmd, args) => {
      const line = args.join(' ')
      if (line.includes(failFragment)) return { code: 1, stdout: '', stderr }
      if (line === '--version') return { code: 0, stdout: 'Python 3.12.3', stderr: '' }
      return { code: 0, stdout: '0.2.0', stderr: '' }
    }

  it('fails loud with pip install instructions when the bridge module is missing', async () => {
    const exec = execFailingOn('agent_eval_rpc.gepa_bridge', "ModuleNotFoundError: No module named 'agent_eval_rpc'")
    await expect(probeGepaRuntime('python3', exec, 'gepa-author')).rejects.toThrow(
      /pip install agent-eval-rpc/,
    )
    await expect(probeGepaRuntime('python3', exec, 'gepa-author')).rejects.toThrow(/not installed/)
  })

  it('fails loud when the installed gepa lacks the multi-engine optimize_anything API', async () => {
    const exec = execFailingOn('OptimizeAnythingConfig', "ImportError: cannot import name 'OptimizeAnythingConfig'")
    await expect(probeGepaRuntime('python3', exec, 'gepa-author')).rejects.toThrow(/optimize_anything API/)
  })

  it('fails loud when python itself is missing', async () => {
    const exec: ProbeExec = async () => ({ code: 127, stdout: '', stderr: 'not found' })
    await expect(probeGepaRuntime('python3', exec, 'gepa-author')).rejects.toThrow(/--version' failed/)
  })

  it('returns python + gepa versions on a complete runtime', async () => {
    const exec: ProbeExec = async (_cmd, args) =>
      args.join(' ') === '--version'
        ? { code: 0, stdout: 'Python 3.12.3\n', stderr: '' }
        : { code: 0, stdout: 'source\n', stderr: '' }
    await expect(probeGepaRuntime('python3', exec, 'gepa-author')).resolves.toEqual({
      pythonVersion: 'Python 3.12.3',
      gepaVersion: 'source',
    })
  })
})

// ---------------------------------------------------------------------------
// Provenance capture at t=0.
// ---------------------------------------------------------------------------

describe('captureProposerProvenance with a gepa seat', () => {
  const okExec: ProbeExec = async (cmd, args) => {
    const line = args.join(' ')
    if (line === '--version') {
      return { code: 0, stdout: cmd === 'python3' ? 'Python 3.12.3' : `${cmd} 1.0.0`, stderr: '' }
    }
    return { code: 0, stdout: 'source', stderr: '' }
  }
  it('records engine, surface, gepa version, bridge module, and the python runtime as harnessVersion', async () => {
    const record = await captureProposerProvenance([{ name: 'claude-author', harness: 'claude' }, seat()], {
      exec: okExec,
      readSettingsModel: () => 'settings-model',
    })
    const gepa = record.proposers.find((p) => p.name === 'gepa-author')!
    expect(gepa).toMatchObject({
      engine: 'gepa',
      surface: SURFACE,
      gepaVersion: 'source',
      bridge: 'agent_eval_rpc.gepa_bridge',
      harnessVersion: 'Python 3.12.3',
      pinnedModel: null,
      merge: false,
    })
    expect(gepa.harness).toBeUndefined()
    // The claude seat is untouched by the gepa capture path.
    expect(record.proposers.find((p) => p.name === 'claude-author')).toMatchObject({
      harness: 'claude',
      settingsModel: 'settings-model',
    })
  })

  it('fails LOUD at t=0 when the python runtime is missing — with install instructions', async () => {
    const exec: ProbeExec = async (_cmd, args) =>
      args.join(' ').includes('gepa_bridge')
        ? { code: 1, stdout: '', stderr: 'ModuleNotFoundError' }
        : { code: 0, stdout: 'Python 3.12.3', stderr: '' }
    await expect(captureProposerProvenance([seat()], { exec })).rejects.toThrow(
      /pip install agent-eval-rpc/,
    )
  })
})

// ---------------------------------------------------------------------------
// Mechanical activation predicate.
// ---------------------------------------------------------------------------

describe('mechanicalActivationPredicate', () => {
  it('targets the longest added line and produces a parseable grep predicate', () => {
    const seed = 'alpha\nshared line stays here\n'
    const winner = 'alpha\nshared line stays here\nAlways run the neighboring test file before finalizing.\nshort\n'
    const predicate = mechanicalActivationPredicate(seed, winner, SURFACE)!
    expect(predicate.kind).toBe('grep')
    expect(predicate.pattern).toContain('Always run the neighboring test file')
    const parsed = parseActivationPredicate(JSON.stringify(predicate))
    expect(parsed.ok).toBe(true)
    // The pattern is regex-escaped: it must match its own source line.
    expect(new RegExp(predicate.pattern!).test('Always run the neighboring test file before finalizing.')).toBe(true)
  })

  it('escapes regex metacharacters in the added line', () => {
    const predicate = mechanicalActivationPredicate('', 'Use pattern (a|b).* with $VAR [strictly].\n', SURFACE)!
    expect(new RegExp(predicate.pattern!).test('Use pattern (a|b).* with $VAR [strictly].')).toBe(true)
    expect(new RegExp(predicate.pattern!).test('Use pattern axb1* with 2VAR strictly.')).toBe(false)
  })

  it('returns null when no added line is distinctive enough', () => {
    expect(mechanicalActivationPredicate('a\nb\n', 'a\nb\nshort\n', SURFACE)).toBeNull()
    expect(mechanicalActivationPredicate('same\n', 'same\n', SURFACE)).toBeNull()
  })
})

describe('recordGepaSeatInnerRun', () => {
  const sourceHash = 'a'.repeat(64)
  const bridgeHash = 'b'.repeat(64)
  const moduleHash = 'c'.repeat(64)
  const provenance = (runId: string): OptimizationMethodProvenance => ({
    source: {
      kind: 'package',
      evidence: 'observed',
      package: 'gepa',
      version: '0.1.4',
      sourceUrl: 'https://github.com/gepa-ai/gepa.git',
      revision: 'f919db0a622e2e9f9204779b81fe00cc1b2d808f',
      sourceSha256: sourceHash,
    },
    bridge: {
      kind: 'package',
      evidence: 'observed',
      package: 'agent-eval-rpc',
      version: '0.126.1',
      sourceSha256: bridgeHash,
    },
    modules: [{ module: 'example.engine', sourceSha256: moduleHash }],
    python: { implementation: 'CPython', version: '3.12.3' },
    runId,
    compatibleRunId: 'compatible-run',
    resumed: false,
    evaluationCount: 3,
    tokenUsage: {
      inputTokens: 120,
      cachedInputTokens: 20,
      outputTokens: 30,
      reasoningTokens: 10,
      totalTokens: 150,
      calls: 2,
    },
    artifactDir: `/tmp/${runId}`,
  })
  const run = (runId: string, over: Partial<GepaSeatInnerRun> = {}): GepaSeatInnerRun => {
    const result = provenance(runId)
    if (
      result.source.revision === undefined ||
      result.source.sourceSha256 === undefined ||
      result.bridge?.sourceSha256 === undefined ||
      result.modules === undefined ||
      result.python === undefined ||
      result.compatibleRunId === undefined ||
      result.tokenUsage === undefined
    ) {
      throw new Error('invalid test provenance')
    }
    return {
      seat: 'gepa-author',
      engine: 'gepa',
      surface: SURFACE,
      generation: 0,
      budget: 10,
      innerCallCount: 2,
      innerScores: [],
      bestComposite: 1,
      source: {
        ...result.source,
        revision: result.source.revision,
        sourceSha256: result.source.sourceSha256,
      },
      bridge: { ...result.bridge, sourceSha256: result.bridge.sourceSha256 },
      modules: result.modules,
      python: result.python,
      runId: result.runId,
      compatibleRunId: result.compatibleRunId,
      resumed: result.resumed,
      evaluationCount: result.evaluationCount,
      tokenUsage: result.tokenUsage,
      artifactDir: result.artifactDir,
      totalCostUsd: 0.25,
      accountingComplete: true,
      incompleteReasons: [],
      durationMs: 5,
      ...over,
    }
  }

  it('writes collision-free immutable records in parallel and preserves the launch record', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gepa-prov-'))
    try {
      const launchRecord = JSON.stringify({ capturedAt: '2026-07-24T00:00:00.000Z', proposers: [] }, null, 2)
      await writeFile(join(dir, 'proposer-provenance.json'), launchRecord)
      const paths = await Promise.all(
        Array.from({ length: 24 }, (_, index) =>
          recordGepaSeatInnerRun(dir, run(`run-${index}`, { generation: index })),
        ),
      )
      expect(new Set(paths).size).toBe(24)
      expect(await readFile(join(dir, 'proposer-provenance.json'), 'utf8')).toBe(launchRecord)

      const names = (await readdir(join(dir, GEPA_INNER_RUNS_DIRNAME))).filter((name) => name.endsWith('.json'))
      expect(names).toHaveLength(24)
      const records = await Promise.all(
        names.map(async (name) => JSON.parse(await readFile(join(dir, GEPA_INNER_RUNS_DIRNAME, name), 'utf8'))),
      )
      expect(new Set(records.map((record) => record.runId))).toEqual(
        new Set(Array.from({ length: 24 }, (_, index) => `run-${index}`)),
      )
      expect(records.every((record) => record.source.sourceSha256 === sourceHash)).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('fails on malformed existing launch or run data', async () => {
    const launchDir = await mkdtemp(join(tmpdir(), 'gepa-prov-bad-launch-'))
    const runDir = await mkdtemp(join(tmpdir(), 'gepa-prov-bad-run-'))
    try {
      await writeFile(join(launchDir, 'proposer-provenance.json'), '{not json')
      await expect(recordGepaSeatInnerRun(launchDir, run('new-run'))).rejects.toThrow(/malformed JSON/)

      await mkdir(join(runDir, GEPA_INNER_RUNS_DIRNAME), { recursive: true })
      await writeFile(join(runDir, GEPA_INNER_RUNS_DIRNAME, 'broken.json'), '[]')
      await expect(recordGepaSeatInnerRun(runDir, run('new-run'))).rejects.toThrow(/must contain a JSON object/)
    } finally {
      await rm(launchDir, { recursive: true, force: true })
      await rm(runDir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// The seat inside the fan-out generator, against a real temp git repo.
// ---------------------------------------------------------------------------

const fakeCtx = {} as unknown as DispatchContext
const testOptimizer = {
  model: 'optimizer-model',
  baseUrl: 'http://127.0.0.1:1/v1',
  apiKey: 'optimizer-key',
  budget: {
    maxCostUsd: 1,
    maxRequests: 10,
    maxRequestBytes: 100_000,
    maxResponseBytes: 100_000,
    maxOutputTokensPerRequest: 2_000,
    pricing: {
      inputUsdPerMillion: 1,
      cachedInputUsdPerMillion: 0.1,
      cacheWriteUsdPerMillion: 1.25,
      outputUsdPerMillion: 5,
    },
  },
}

const fullProvenance = (
  runId = 'gepa-run',
  over: Partial<OptimizationMethodProvenance> = {},
): OptimizationMethodProvenance => ({
  source: {
    kind: 'package',
    evidence: 'observed',
    package: 'gepa',
    version: '0.1.4',
    sourceUrl: 'https://github.com/gepa-ai/gepa.git',
    revision: 'f919db0a622e2e9f9204779b81fe00cc1b2d808f',
    sourceSha256: '1'.repeat(64),
  },
  bridge: {
    kind: 'package',
    evidence: 'observed',
    package: 'agent-eval-rpc',
    version: '0.126.1',
    sourceSha256: '2'.repeat(64),
  },
  modules: [{ module: 'custom_gepa_engines', sourceSha256: '3'.repeat(64) }],
  python: { implementation: 'CPython', version: '3.12.3' },
  runId,
  compatibleRunId: 'compatible-gepa-run',
  resumed: false,
  evaluationCount: 3,
  tokenUsage: {
    inputTokens: 100,
    cachedInputTokens: 10,
    cacheWriteInputTokens: 5,
    outputTokens: 25,
    reasoningTokens: 8,
    totalTokens: 125,
    calls: 2,
  },
  artifactDir: `/tmp/${runId}`,
  ...over,
})

/** Mimics the adapter's loop: score the seed and each provided candidate via
 *  the seat's dispatch + judge, return the best-scoring candidate — exactly
 *  the contract gepaOptimizationMethod fulfills through the Python bridge. */
const fakeGepaFactory =
  (candidates: string[], observed?: { config?: unknown }): GepaMethodFactory =>
  (config) => {
    if (observed) observed.config = config
    return {
      name: config.name ?? 'fake-gepa',
      async optimize(input) {
        const judge = input.judges[0]!
        const scenario = input.trainScenarios[0]!
        let best = { surface: input.baselineSurface as string, composite: -Infinity }
        for (const candidate of [input.baselineSurface as string, ...candidates]) {
          const artifact = await input.dispatchWithSurface(candidate, scenario, fakeCtx)
          const score = await judge.score({ artifact, scenario, signal: new AbortController().signal })
          if (score.composite > best.composite) best = { surface: candidate, composite: score.composite }
        }
        return {
          winnerSurface: best.surface,
          cost: { totalCostUsd: 0.125, accountingComplete: true, incompleteReasons: [] },
          durationMs: 1,
          provenance: fullProvenance(),
        }
      },
    }
  }

describe('fanOutLoopsGenerator with the gepa seat', () => {
  let loopsRepo: string
  let outDir: string
  let driverWt: string

  const git = async (args: string[], cwd: string): Promise<string> =>
    (await runOk('git', ['-C', cwd, ...args])).stdout.trim()

  const SEED = '# worker coding system\nkeep tests green\n'

  beforeEach(async () => {
    loopsRepo = await mkdtemp(join(tmpdir(), 'gepa-repo-'))
    outDir = await mkdtemp(join(tmpdir(), 'gepa-out-'))
    await runOk('git', ['init', '-q', '-b', 'main', loopsRepo])
    await git(['config', 'user.email', 't@t.dev'], loopsRepo)
    await git(['config', 'user.name', 'T'], loopsRepo)
    await mkdir(join(loopsRepo, 'extensions', 'pi', 'prompts'), { recursive: true })
    await writeFile(join(loopsRepo, SURFACE), SEED)
    await git(['add', '-A'], loopsRepo)
    await git(['commit', '-q', '-m', 'init'], loopsRepo)
    driverWt = join(outDir, 'driver-wt')
    await runOk('git', ['-C', loopsRepo, 'worktree', 'add', '--detach', driverWt, 'HEAD'])
  })

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true })
    await rm(loopsRepo, { recursive: true, force: true })
  })

  const baseConfig = (proposers: ProposerSpec[], over: Partial<OuterLoopConfig> = {}): OuterLoopConfig => ({
    ...defaultRound4Config(),
    loopsRepo,
    outDir,
    populationSize: proposers.length,
    proposers,
    prefilter: { enabled: true, smokeInstance: 'cheapest-of-set', requireResolved: false },
    ...over,
  })

  const generatorArgs = (candidateIndex: number) => ({
    worktreePath: driverWt,
    report: undefined,
    findings: [],
    maxShots: 1,
    signal: new AbortController().signal,
    generation: 0,
    candidateIndex,
  })

  const smokeVerdict = (over: Partial<SmokeVerdict> = {}): SmokeVerdict => ({
    iid: 'astropy__astropy-13033',
    pass: true,
    reason: 'smoke ok',
    resolved: false,
    patchLines: 3,
    wallS: 5,
    verifyPass: false,
    ...over,
  })

  it('construction fails loud without the smoke runner (the inner evaluator)', () => {
    expect(() => fanOutLoopsGenerator(baseConfig([seat()]))).toThrow(/inner evaluator/)
    expect(() => fanOutLoopsGenerator(baseConfig([{ name: 'no-seat-kind' }]))).toThrow(/neither a harness nor an engine/)
  })

  it('materializes each candidate into the scratch surface, applies the winner through the normal prefilter path, and records provenance', async () => {
    const WINNER = `${SEED}Always run the neighboring test file before finalizing.\n`
    const LOSER = `${SEED}delete all tests\n`
    const seen: Array<{ content: string; scratch: string; hasCostLedger: boolean }> = []
    const smokeRunner: SmokeRunner = async ({ scratchPath, costLedger }) => {
      const content = await readFile(join(scratchPath, SURFACE), 'utf8')
      seen.push({ content, scratch: scratchPath, hasCostLedger: costLedger !== undefined })
      // The winner candidate resolves; the seed gets verify-pass only; the
      // loser gets nothing — exercising resolve-dominates + tiebreak.
      if (content === WINNER) return smokeVerdict({ resolved: true, verifyPass: true })
      if (content === SEED) return smokeVerdict({ verifyPass: true })
      return smokeVerdict()
    }
    const observed: { config?: unknown } = {}
    const config = baseConfig([seat({ maxMetricCalls: 5 })], { activationGate: true })
    const gen = fanOutLoopsGenerator(config, {
      smokeRunner,
      smokeInstanceId: 'astropy__astropy-13033',
      scoreSplit: { privateInstances: ['django__django-11532'] },
      gepaMethodFactory: fakeGepaFactory([LOSER, WINNER], observed),
      gepaOptimizer: testOptimizer,
    })

    const result = await gen.generate(generatorArgs(0))

    expect(result).toMatchObject({ applied: true, label: 'gepa-author' })
    expect(result.rationale).toContain('engine gepa')
    // 3 inner calls (seed, loser, winner) + 1 stage-B prefilter smoke on the
    // final candidate — all in the seat's scratch worktree, never the driver.
    expect(seen).toHaveLength(4)
    for (const call of seen) expect(call.scratch).not.toBe(driverWt)
    expect(seen.map((c) => c.content)).toEqual([SEED, LOSER, WINNER, WINNER])
    expect(seen.slice(0, 3).every((call) => call.hasCostLedger)).toBe(true)
    // The winner landed on the driver worktree with the mechanical predicate.
    expect(await readFile(join(driverWt, SURFACE), 'utf8')).toBe(WINNER)
    const predicate = parseActivationPredicate(await readFile(join(driverWt, ACTIVATION_PREDICATE_RELPATH), 'utf8'))
    expect(predicate.ok).toBe(true)
    // Only the surface + predicate changed.
    const changed = (await runOk('git', ['-C', driverWt, 'status', '--porcelain', '--untracked-files=all'])).stdout
      .split('\n')
      .map((l) => l.slice(3).trim())
      .filter(Boolean)
    expect(changed.sort()).toEqual([ACTIVATION_PREDICATE_RELPATH, SURFACE].sort())
    // Budget threaded into the adapter recipe.
    expect(observed.config).toMatchObject({
      evaluationId:
        `swe-arena-gepa-seat|smoke=astropy__astropy-13033|judge=gepa-inner-smoke|dispatchTimeoutMs=${config.dispatchTimeoutMs}`,
      recipe: { kind: 'engine', run: { engine: 'gepa', maxEvaluations: 5 } },
      optimizer: testOptimizer,
      resume: 'if-compatible',
      trustResumeState: true,
    })
    // Inner-run provenance: the seat-local file plus one immutable shared record.
    const inner = JSON.parse(await readFile(join(outDir, 'gepa-seat', 'gen0-gepa-author', 'inner-provenance.json'), 'utf8'))
    expect(inner).toMatchObject({
      seat: 'gepa-author',
      engine: 'gepa',
      budget: 5,
      innerCallCount: 3,
      bestComposite: 1.25,
      source: {
        package: 'gepa',
        version: '0.1.4',
        revision: 'f919db0a622e2e9f9204779b81fe00cc1b2d808f',
        sourceSha256: '1'.repeat(64),
      },
      bridge: {
        package: 'agent-eval-rpc',
        version: '0.126.1',
        sourceSha256: '2'.repeat(64),
      },
      modules: [{ module: 'custom_gepa_engines', sourceSha256: '3'.repeat(64) }],
      python: { implementation: 'CPython', version: '3.12.3' },
      runId: 'gepa-run',
      compatibleRunId: 'compatible-gepa-run',
      resumed: false,
      evaluationCount: 3,
      tokenUsage: {
        inputTokens: 100,
        cachedInputTokens: 10,
        cacheWriteInputTokens: 5,
        outputTokens: 25,
        reasoningTokens: 8,
        totalTokens: 125,
        calls: 2,
      },
      artifactDir: '/tmp/gepa-run',
      totalCostUsd: 0.125,
      accountingComplete: true,
      incompleteReasons: [],
    })
    expect(inner.innerScores.map((s: { composite: number }) => s.composite)).toEqual([0.25, 0, 1.25])
    const records = await readdir(join(outDir, GEPA_INNER_RUNS_DIRNAME))
    expect(records.filter((name) => name.endsWith('.json'))).toHaveLength(1)
    expect(JSON.parse(await readFile(join(outDir, GEPA_INNER_RUNS_DIRNAME, records[0]!), 'utf8'))).toEqual(inner)
    expect(gen.drainPrefilterKills()).toEqual([])
  })

  it('records but rejects a winner when cost accounting is incomplete', async () => {
    const WINNER = `${SEED}Always run the neighboring test file before finalizing.\n`
    const incomplete: GepaMethodFactory = () => ({
      name: 'incomplete-cost',
      async optimize(input) {
        await input.dispatchWithSurface(WINNER, input.trainScenarios[0]!, fakeCtx)
        return {
          winnerSurface: WINNER,
          cost: {
            totalCostUsd: 0.25,
            accountingComplete: false,
            incompleteReasons: ['optimizer model receipt missing'],
          },
          durationMs: 1,
          provenance: fullProvenance('incomplete-run', { evaluationCount: 1 }),
        }
      },
    })
    const gen = fanOutLoopsGenerator(baseConfig([seat()]), {
      smokeRunner: async () => smokeVerdict({ resolved: true }),
      smokeInstanceId: 'astropy__astropy-13033',
      scoreSplit: null,
      gepaMethodFactory: incomplete,
    })

    await expect(gen.generate(generatorArgs(0))).rejects.toThrow(
      /cost accounting is incomplete: optimizer model receipt missing/,
    )
    expect(await readFile(join(driverWt, SURFACE), 'utf8')).toBe(SEED)
    const inner = JSON.parse(
      await readFile(join(outDir, 'gepa-seat', 'gen0-gepa-author', 'inner-provenance.json'), 'utf8'),
    )
    expect(inner).toMatchObject({
      runId: 'incomplete-run',
      totalCostUsd: 0.25,
      accountingComplete: false,
      incompleteReasons: ['optimizer model receipt missing'],
    })
  })

  it('enforces the inner-call budget cap fail-closed', async () => {
    const runaway: GepaMethodFactory = () => ({
      name: 'runaway',
      async optimize(input) {
        for (let i = 0; i < 4; i++) {
          await input.dispatchWithSurface(`${SEED}candidate ${i}\n`, input.trainScenarios[0]!, fakeCtx)
        }
        return {
          winnerSurface: SEED,
          cost: { totalCostUsd: 0, accountingComplete: false, incompleteReasons: [] },
          durationMs: 1,
          provenance: fullProvenance('runaway'),
        }
      },
    })
    const gen = fanOutLoopsGenerator(baseConfig([seat({ maxMetricCalls: 3 })]), {
      smokeRunner: async () => smokeVerdict(),
      smokeInstanceId: 'astropy__astropy-13033',
      scoreSplit: null,
      gepaMethodFactory: runaway,
    })
    await expect(gen.generate(generatorArgs(0))).rejects.toThrow(/inner-call budget 3 exhausted/)
  })

  it('refuses to feed a PRIVATE smoke verdict to the bridge', async () => {
    const gen = fanOutLoopsGenerator(baseConfig([seat()]), {
      smokeRunner: async () => smokeVerdict({ iid: 'django__django-11532' }),
      smokeInstanceId: 'astropy__astropy-13033',
      scoreSplit: { privateInstances: ['django__django-11532'] },
      gepaMethodFactory: fakeGepaFactory([`${SEED}x line long enough\n`]),
    })
    await expect(gen.generate(generatorArgs(0))).rejects.toThrow(/PRIVATE instance django__django-11532/)
  })

  it('declines the slot without a kill when GEPA returns the seed unchanged', async () => {
    const gen = fanOutLoopsGenerator(baseConfig([seat()]), {
      smokeRunner: async () => smokeVerdict(),
      smokeInstanceId: 'astropy__astropy-13033',
      scoreSplit: null,
      gepaMethodFactory: fakeGepaFactory([]),
    })
    const result = await gen.generate(generatorArgs(0))
    expect(result.applied).toBe(false)
    expect(result.summary).toContain('equals the seed')
    expect(gen.drainPrefilterKills()).toEqual([])
    expect((await runOk('git', ['-C', driverWt, 'status', '--porcelain'])).stdout.trim()).toBe('')
  })
})

// ---------------------------------------------------------------------------
// Integration: one real Node-to-Python-to-score roundtrip through the installed
// bridge. The TypeScript adapter is a compile-time package dependency.
// ---------------------------------------------------------------------------

const pythonBridgeReady = (python: string): { ok: boolean; reason: string } => {
  const probe = spawnSync(python, [
    '-c',
    'import agent_eval_rpc.gepa_bridge; from gepa.optimize_anything import optimize_anything, OptimizeAnythingConfig',
  ])
  if (probe.status !== 0) {
    return { ok: false, reason: `python bridge unavailable: ${String(probe.stderr).trim().split('\n').pop()}` }
  }
  return { ok: true, reason: '' }
}

describe('integration: real adapter roundtrip', () => {
  it('runs a metered optimizer through the real bridge and applies its winner', async (ctx) => {
    const python = process.env.AGENT_EVAL_TEST_PYTHON ?? DEFAULT_GEPA_PYTHON
    const pythonRuntime = pythonBridgeReady(python)
    if (!pythonRuntime.ok) {
      ctx.skip(`skip-with-reason: ${pythonRuntime.reason}`)
      return
    }

    const winner = 'tiny synthetic surface\nAlways run the neighboring test before finalizing.'
    const modelServer = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: `\`\`\`\n${winner}\`\`\``,
              },
            },
          ],
          usage: {
            prompt_tokens: 20,
            completion_tokens: 20,
            total_tokens: 40,
          },
        }),
      )
    })
    await new Promise<void>((resolve, reject) => {
      modelServer.once('error', reject)
      modelServer.listen(0, '127.0.0.1', resolve)
    })
    const address = modelServer.address()
    if (!address || typeof address === 'string') {
      throw new Error('test optimizer server did not bind')
    }

    const loopsRepo = await mkdtemp(join(tmpdir(), 'gepa-int-repo-'))
    const outDir = await mkdtemp(join(tmpdir(), 'gepa-int-out-'))
    try {
      await runOk('git', ['init', '-q', '-b', 'main', loopsRepo])
      await runOk('git', ['-C', loopsRepo, 'config', 'user.email', 't@t.dev'])
      await runOk('git', ['-C', loopsRepo, 'config', 'user.name', 'T'])
      await mkdir(join(loopsRepo, 'extensions', 'pi', 'prompts'), { recursive: true })
      await writeFile(join(loopsRepo, SURFACE), 'tiny synthetic surface\n')
      await runOk('git', ['-C', loopsRepo, 'add', '-A'])
      await runOk('git', ['-C', loopsRepo, 'commit', '-q', '-m', 'init'])
      const driverWt = join(outDir, 'driver-wt')
      await runOk('git', ['-C', loopsRepo, 'worktree', 'add', '--detach', driverWt, 'HEAD'])

      const gen = fanOutLoopsGenerator(
        {
          ...defaultRound4Config(),
          loopsRepo,
          outDir,
          populationSize: 1,
          proposers: [seat({ maxMetricCalls: 10, python })],
          prefilter: { enabled: true, smokeInstance: 'cheapest-of-set', requireResolved: false },
        },
        {
          smokeRunner: async ({ scratchPath }) => {
            const candidate = await readFile(join(scratchPath, SURFACE), 'utf8')
            return {
              iid: 'astropy__astropy-13033',
              pass: true,
              reason: 'stub smoke (integration)',
              resolved: candidate === winner,
              patchLines: 1,
              wallS: 0,
              verifyPass: true,
            }
          },
          smokeInstanceId: 'astropy__astropy-13033',
          scoreSplit: null,
          gepaOptimizer: {
            model: 'test-optimizer',
            baseUrl: `http://127.0.0.1:${address.port}/v1`,
            apiKey: 'local-test-key',
            budget: {
              maxCostUsd: 1,
              maxRequests: 10,
              maxRequestBytes: 100_000,
              maxResponseBytes: 100_000,
              maxOutputTokensPerRequest: 2_000,
              pricing: {
                inputUsdPerMillion: 1,
                cachedInputUsdPerMillion: 0.1,
                cacheWriteUsdPerMillion: 1.25,
                outputUsdPerMillion: 5,
              },
            },
          },
        },
      )
      const result = await gen.generate({
        worktreePath: driverWt,
        report: undefined,
        findings: [],
        maxShots: 1,
        signal: new AbortController().signal,
        generation: 0,
        candidateIndex: 0,
      })
      const inner = JSON.parse(
        await readFile(join(outDir, 'gepa-seat', 'gen0-gepa-author', 'inner-provenance.json'), 'utf8'),
      )
      expect(result.applied, `${result.summary}\n${JSON.stringify(inner.innerScores, null, 2)}`).toBe(true)
      expect(await readFile(join(driverWt, SURFACE), 'utf8')).toBe(winner)
      expect(inner.innerCallCount).toBeGreaterThanOrEqual(1)
      expect(inner.accountingComplete).toBe(true)
      expect(inner.incompleteReasons).toEqual([])
      expect(inner.tokenUsage.calls).toBeGreaterThan(0)
    } finally {
      await new Promise<void>((resolve, reject) =>
        modelServer.close((error) => (error ? reject(error) : resolve())),
      )
      await rm(outDir, { recursive: true, force: true })
      await rm(loopsRepo, { recursive: true, force: true })
    }
  }, 300_000)
})
