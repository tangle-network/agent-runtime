import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeProposalFinding, type ProposalFinding } from '@tangle-network/agent-eval'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  defaultGen3Config,
  defaultGen4Config,
  defaultGen5Config,
  defaultRound4Config,
  GEN3_IMPROVEMENT_SET,
  GEN3_PARETO_PARENTS,
  GEN3_SPARE_POOL,
  resolveSmokeInstance,
  type OuterLoopConfig,
} from './outer-loop.mts'
import type { EvidenceCell, R4Artifact } from './cell-evidence.mts'
import {
  defaultProposers,
  fanOutLoopsGenerator,
  loadAuthorProfile,
  materializeParetoParents,
  mergeAuthorPrompt,
  parentsPromptSection,
  PROFILES_DIR,
  proposerBuildPrompt,
  resolveAuthorProfile,
  sliceFindings,
  type ParetoParentContext,
  type ProposerSpec,
  type SmokeRunner,
} from './proposer-fanout.mts'
import { runOk } from './proc.ts'

// ---------------------------------------------------------------------------
// Pure pieces.
// ---------------------------------------------------------------------------

const finding = (
  over: Partial<Pick<ProposalFinding, 'analyst_id' | 'area' | 'claim'>>,
): ProposalFinding =>
  makeProposalFinding({
    analyst_id: 'analyst',
    severity: 'high',
    area: 'mechanism',
    claim: 'workers drop build artifacts on clone',
    evidence_refs: [],
    confidence: 0.9,
    ...over,
    proposal_origin: 'search',
    produced_at: new Date(0).toISOString(),
  })

describe('sliceFindings', () => {
  const mech = finding({ claim: 'sandbox clone drops untracked build artifacts' })
  const prompty = finding({ claim: 'the worker instruction wording invents new user-facing message text' })
  const steering = finding({ analyst_id: 'round4-protocol', area: 'constraint', claim: 'change-space' })
  const rawTrace = finding({ analyst_id: 'raw-trace-distiller', area: 'raw-trace-context', claim: 'traces at /x' })

  it("'all' and undefined pass everything through", () => {
    const all = [mech, prompty, steering, rawTrace]
    expect(sliceFindings(all, 'all')).toEqual(all)
    expect(sliceFindings(all, undefined)).toEqual(all)
  })

  it("'prompts' keeps prompt-flavored findings; 'mechanics' keeps the rest — steering + raw-trace always pass", () => {
    const all = [mech, prompty, steering, rawTrace]
    expect(sliceFindings(all, 'prompts')).toEqual([prompty, steering, rawTrace])
    expect(sliceFindings(all, 'mechanics')).toEqual([mech, steering, rawTrace])
  })
})

describe('proposerBuildPrompt', () => {
  it('appends the lens AFTER the shared protocol prompt, leaving the change-space text intact', () => {
    const spec: ProposerSpec = { name: 'x', harness: 'claude-code', lens: 'Prefer code-path fixes.' }
    const prompt = proposerBuildPrompt({ findings: [] }, spec)
    expect(prompt).toContain('DECLARED CHANGE-SPACE')
    expect(prompt.indexOf('DECLARED CHANGE-SPACE')).toBeLessThan(prompt.indexOf('YOUR AUTHORING LENS (x)'))
    expect(prompt).toContain('Prefer code-path fixes.')
  })

  it('is the bare round prompt without a lens', () => {
    const spec: ProposerSpec = { name: 'x', harness: 'claude-code' }
    expect(proposerBuildPrompt({ findings: [] }, spec)).not.toContain('AUTHORING LENS')
  })
})

// ---------------------------------------------------------------------------
// GEN-4: pinned models, Pareto-parent seeding, and the merge seat.
// ---------------------------------------------------------------------------

const PARENTS: ParetoParentContext[] = [
  {
    commit: 'aaaa111122223333aaaa111122223333aaaa1111',
    label: 'parent-a',
    resolvedInstances: ['pydata__xarray-4687', 'sphinx-doc__sphinx-9658'],
    note: 'mechanical risk scan',
    diff: 'diff --git a/src/worker-evidence.ts b/src/worker-evidence.ts\n+scan',
  },
  {
    commit: 'bbbb111122223333bbbb111122223333bbbb1111',
    label: 'parent-b',
    resolvedInstances: ['django__django-11532'],
    diff: 'diff --git a/extensions/pi/prompts/supervisor-system.md b/...\n+hidden suite',
  },
]

describe('resolveAuthorProfile (pinned models)', () => {
  it('merges the spec model into the loaded profile as model.default', () => {
    const spec: ProposerSpec = {
      name: 'x',
      profile: 'default-author.profile.json',
      harness: 'claude-code',
      model: 'claude-fable-5',
    }
    const profile = resolveAuthorProfile(spec)
    expect(profile?.name).toBe('swe-arena-default-author')
    expect(profile?.model?.default).toBe('claude-fable-5')
  })

  it('synthesizes a minimal named profile for a pinned model without a profile path', () => {
    const profile = resolveAuthorProfile({ name: 'glm-author', harness: 'opencode', model: 'zai-coding-plan/glm-5.2' })
    expect(profile?.name).toBe('glm-author-pinned')
    expect(profile?.model?.default).toBe('zai-coding-plan/glm-5.2')
  })

  it('is byte-identical to loadAuthorProfile without a pin (gen-3 seats unchanged)', () => {
    const spec: ProposerSpec = { name: 'x', profile: 'default-author.profile.json', harness: 'claude-code' }
    expect(resolveAuthorProfile(spec)).toEqual(loadAuthorProfile(spec))
    expect(resolveAuthorProfile({ name: 'bare', harness: 'claude-code' })).toBeUndefined()
  })
})

describe('proposerBuildPrompt with pareto parents', () => {
  it('appends the parents section (evidence + diffs) after the protocol prompt and lens', () => {
    const spec: ProposerSpec = { name: 'x', harness: 'claude-code', lens: 'Prefer code-path fixes.' }
    const prompt = proposerBuildPrompt({ findings: [] }, spec, PARENTS)
    expect(prompt).toContain('DECLARED CHANGE-SPACE')
    expect(prompt).toContain('PARETO PARENTS')
    expect(prompt.indexOf('YOUR AUTHORING LENS')).toBeLessThan(prompt.indexOf('PARETO PARENTS'))
    expect(prompt).toContain('parent-a (aaaa111122) — resolved: pydata__xarray-4687, sphinx-doc__sphinx-9658')
    expect(prompt).toContain('mechanical risk scan')
    expect(prompt).toContain('+scan')
    expect(prompt).toContain('+hidden suite')
  })

  it('leaves the prompt untouched when no parents are seeded (gen-3 behavior)', () => {
    const spec: ProposerSpec = { name: 'x', harness: 'claude-code' }
    expect(proposerBuildPrompt({ findings: [] }, spec)).not.toContain('PARETO PARENTS')
    expect(parentsPromptSection(PARENTS)).toContain('measured evidence')
  })
})

describe('mergeAuthorPrompt', () => {
  const spec: ProposerSpec = { name: 'merge-author', harness: 'claude-code', merge: true }

  it('keeps the change-space contract and presents BOTH parent diffs with the coherent-union task', () => {
    const prompt = proposerBuildPrompt({ findings: [] }, spec, PARENTS)
    expect(prompt).toContain('DECLARED CHANGE-SPACE')
    expect(prompt).toContain('MERGE SEAT')
    expect(prompt).toContain('UNION of the')
    expect(prompt).toContain('KEEPING BOTH BEHAVIORS')
    expect(prompt).toContain('=== parent parent-a (aaaa111122) ===')
    expect(prompt).toContain('=== parent parent-b (bbbb111122) ===')
    expect(prompt).toContain('+scan')
    expect(prompt).toContain('+hidden suite')
    // Per-instance evidence rides along for both parents.
    expect(prompt).toContain('resolved: django__django-11532')
  })

  it('fails loud with fewer than two parents', () => {
    expect(() => mergeAuthorPrompt({ findings: [] }, spec, [PARENTS[0]!])).toThrow(/>=2/)
    expect(() => proposerBuildPrompt({ findings: [] }, spec, [])).toThrow(/>=2/)
  })
})

describe('defaultGen4Config', () => {
  const config = defaultGen4Config()

  it('seats four proposers (one candidate slot each) with the pinned glm model and the merge seat', () => {
    expect(config.proposers).toHaveLength(4)
    expect(config.populationSize).toBe(4)
    const byName = Object.fromEntries(config.proposers!.map((p) => [p.name, p]))
    expect(byName['claude-author']).toMatchObject({ harness: 'claude-code', profile: 'default-author.profile.json' })
    expect(byName['claude-author']!.model).toBeUndefined()
    expect(byName['glm-author']).toMatchObject({ harness: 'opencode', model: 'zai-coding-plan/glm-5.2' })
    expect(byName['codex-author']).toMatchObject({ harness: 'codex' })
    expect(byName['merge-author']).toMatchObject({ harness: 'claude-code', merge: true })
  })

  it('drops the codex seat (and shrinks the population) when includeCodex is false', () => {
    const noCodex = defaultGen4Config(undefined, { includeCodex: false })
    expect(noCodex.proposers!.map((p) => p.name)).toEqual(['claude-author', 'glm-author', 'merge-author'])
    expect(noCodex.populationSize).toBe(3)
  })

  it('seeds the gen-3 frontier as pareto parents and points at a fresh gen4 outDir + baseline artifact', () => {
    expect(config.paretoParents).toEqual(GEN3_PARETO_PARENTS)
    expect(config.paretoParents!.map((p) => p.commit.slice(0, 10))).toEqual(['cc0d95584c', 'a7a2a982e5'])
    expect(config.outDir).toContain('gen4')
    expect(config.premeasuredBaselinePath).toContain('gen4')
    expect(config.premeasuredBaselinePath).not.toBe(defaultGen3Config().premeasuredBaselinePath)
  })

  it('keeps the gen-3 protocol frame: 6-instance set, 2 reps, 1 generation, prefilter, 2-rep holdout', () => {
    expect(config.instances).toEqual([...GEN3_IMPROVEMENT_SET])
    expect(config.repsPerInstance).toBe(2)
    expect(config.generations).toBe(1)
    expect(config.prefilter).toEqual({ enabled: true, smokeInstance: 'cheapest-of-set', requireResolved: false })
    expect(config.holdoutRepsPerInstance).toBe(2)
    expect(config.holdoutBaseline).toBe('measure')
    for (const iid of config.instances) expect(config.holdoutInstances).not.toContain(iid)
  })
})

describe('loadAuthorProfile', () => {
  it('loads the committed default-author profile (bare: no prompt, no model)', () => {
    const profile = loadAuthorProfile({ name: 'a', profile: 'default-author.profile.json', harness: 'claude-code' })
    expect(profile?.name).toBe('swe-arena-default-author')
    expect(profile?.prompt).toBeUndefined()
    expect(profile?.model).toBeUndefined()
    expect(existsSync(join(PROFILES_DIR, 'default-author.profile.json'))).toBe(true)
  })

  it('returns undefined without a profile path', () => {
    expect(loadAuthorProfile({ name: 'a', harness: 'claude-code' })).toBeUndefined()
  })

  it('fails loud when a non-codex proposer declares profile resources (they would be dropped)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'profile-'))
    try {
      const path = join(dir, 'with-resources.json')
      await writeFile(path, JSON.stringify({ name: 'r', resources: { files: [] } }))
      expect(() => loadAuthorProfile({ name: 'a', profile: path, harness: 'claude-code' })).toThrow(/silently drop/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('resolveSmokeInstance', () => {
  const cell = (iid: string, wallS: number): EvidenceCell => ({
    scenarioId: iid,
    rep: 0,
    artifact: { kind: 'swe-arm', iid, wallS } as R4Artifact,
  })

  it('passes an explicit iid through', () => {
    expect(resolveSmokeInstance('pallets__flask-5014', ['a', 'b'], null)).toBe('pallets__flask-5014')
  })

  it("'cheapest-of-set' picks the instance with the smallest summed baseline wall", () => {
    // Summed across reps: a=1800, b=450, c=500 — b is cheapest.
    const cells = [cell('a', 900), cell('a', 900), cell('b', 200), cell('b', 250), cell('c', 500)]
    expect(resolveSmokeInstance('cheapest-of-set', ['a', 'b', 'c'], cells)).toBe('b')
  })

  it("'cheapest-of-set' falls back to the first instance without baseline cells", () => {
    expect(resolveSmokeInstance('cheapest-of-set', ['a', 'b'], null)).toBe('a')
    expect(resolveSmokeInstance('cheapest-of-set', ['a', 'b'], [])).toBe('a')
  })
})

describe('defaultGen3Config', () => {
  const config = defaultGen3Config()

  it('widens the improvement set to 6 with the three both-fail head-to-head instances', () => {
    expect(config.instances).toEqual([...GEN3_IMPROVEMENT_SET])
    expect(config.instances).toHaveLength(6)
    for (const added of ['pydata__xarray-4687', 'pytest-dev__pytest-6197', 'sphinx-doc__sphinx-9658']) {
      expect(config.instances).toContain(added)
    }
  })

  it('keeps the improvement set disjoint from the pre-registered holdout AND the spare pool', () => {
    for (const iid of config.instances) {
      expect(config.holdoutInstances).not.toContain(iid)
      expect(GEN3_SPARE_POOL).not.toContain(iid)
    }
    expect(config.holdoutInstances).toEqual(defaultRound4Config().holdoutInstances)
  })

  it('assigns one candidate slot per proposer and pins the 2-rep holdout protocol', () => {
    expect(config.proposers).toBeDefined()
    expect(config.populationSize).toBe(config.proposers!.length)
    expect(config.holdoutRepsPerInstance).toBe(2)
    expect(config.holdoutBaseline).toBe('measure')
    expect(config.prefilter).toEqual({ enabled: true, smokeInstance: 'cheapest-of-set', requireResolved: false })
  })

  it('points the premeasured baseline at a NEW gen3 artifact (full-split digest rule)', () => {
    expect(config.premeasuredBaselinePath).toContain('gen3')
    expect(config.premeasuredBaselinePath).not.toBe(defaultRound4Config().premeasuredBaselinePath)
  })

  it('has committed verify fixtures for every improvement-set instance', () => {
    for (const iid of config.instances) {
      expect(existsSync(join(config.verifyDir, `${iid}.sh`))).toBe(true)
    }
  })

  it('defaultProposers codifies the gen-2 author: one bare-profile claude entry', () => {
    expect(defaultProposers()).toEqual([
      { name: 'default-author', profile: 'default-author.profile.json', harness: 'claude-code' },
    ])
  })
})

// ---------------------------------------------------------------------------
// The fan-out generator against a real (temp) git repo — stub authors.
// ---------------------------------------------------------------------------

describe('fanOutLoopsGenerator', () => {
  let loopsRepo: string
  let outDir: string
  let driverWt: string

  const git = async (args: string[], cwd: string): Promise<string> =>
    (await runOk('git', ['-C', cwd, ...args])).stdout.trim()

  beforeEach(async () => {
    loopsRepo = await mkdtemp(join(tmpdir(), 'fanout-repo-'))
    outDir = await mkdtemp(join(tmpdir(), 'fanout-out-'))
    await runOk('git', ['init', '-q', '-b', 'main', loopsRepo])
    await git(['config', 'user.email', 't@t.dev'], loopsRepo)
    await git(['config', 'user.name', 'T'], loopsRepo)
    await writeFile(join(loopsRepo, 'src.ts'), 'base\n')
    await git(['add', '-A'], loopsRepo)
    await git(['commit', '-q', '-m', 'init'], loopsRepo)
    // The driver-owned candidate worktree the generator applies patches onto.
    driverWt = join(outDir, 'driver-wt')
    await runOk('git', ['-C', loopsRepo, 'worktree', 'add', '--detach', driverWt, 'HEAD'])
  })

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true })
    await rm(loopsRepo, { recursive: true, force: true })
  })

  const baseConfig = (proposers: ProposerSpec[]): OuterLoopConfig => ({
    ...defaultRound4Config(),
    loopsRepo,
    outDir,
    populationSize: proposers.length,
    proposers,
  })

  const generatorArgs = (candidateIndex: number) => ({
    worktreePath: driverWt,
    findings: [] as ProposalFinding[],
    maxShots: 1,
    signal: new AbortController().signal,
    generation: 0,
    candidateIndex,
  })

  it('authors ALL proposers concurrently in separate worktrees and applies each patch to its candidate slot', async () => {
    const proposers: ProposerSpec[] = [
      { name: 'alpha', harness: 'claude-code' },
      { name: 'beta', harness: 'claude-code' },
    ]
    let inFlight = 0
    let maxInFlight = 0
    const seenWorktrees: string[] = []
    const gen = fanOutLoopsGenerator(baseConfig(proposers), {
      author: async (proposer, args) => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        seenWorktrees.push(args.worktreePath)
        // Hold the slot across a tick so real parallelism is observable.
        await new Promise((r) => setTimeout(r, 30))
        // Inside the declared change-space (extensions/pi/**) so the always-on
        // change-space pre-filter does not kill the candidate.
        await mkdir(join(args.worktreePath, 'extensions', 'pi'), { recursive: true })
        await writeFile(join(args.worktreePath, 'extensions', 'pi', `${proposer.name}.ts`), `${proposer.name} change\n`)
        inFlight--
        return { applied: true, summary: `${proposer.name} edit` }
      },
    })

    const first = await gen.generate(generatorArgs(0))
    const second = await gen.generate(generatorArgs(1))

    // Parallel authoring: both stub authors were in flight at once, in two
    // DIFFERENT scratch worktrees (never the driver worktree).
    expect(maxInFlight).toBe(2)
    expect(new Set(seenWorktrees).size).toBe(2)
    for (const wt of seenWorktrees) expect(wt).not.toBe(driverWt)

    expect(first).toMatchObject({ applied: true, label: 'alpha' })
    expect(second).toMatchObject({ applied: true, label: 'beta' })
    expect(first.rationale).toContain('proposer alpha (claude-code)')
    // Both patches landed on the SAME driver worktree across the two calls —
    // the driver discards/finalizes between calls in production; here we only
    // assert each call applied its own proposer's file.
    expect(await readFile(join(driverWt, 'extensions', 'pi', 'alpha.ts'), 'utf8')).toBe('alpha change\n')
    expect(await readFile(join(driverWt, 'extensions', 'pi', 'beta.ts'), 'utf8')).toBe('beta change\n')
    expect(gen.drainPrefilterKills()).toEqual([])
  })

  it('kills a candidate at the smoke pre-filter: applied=false, no patch applied, kill recorded with reason', async () => {
    const proposers: ProposerSpec[] = [
      { name: 'good', harness: 'claude-code' },
      { name: 'bad', harness: 'claude-code' },
    ]
    const config = baseConfig(proposers)
    config.prefilter = { enabled: true, smokeInstance: 'cheapest-of-set' }
    const smokeCalls: string[] = []
    const smokeRunner: SmokeRunner = async ({ proposer, scratchPath }) => {
      smokeCalls.push(proposer.name)
      expect(existsSync(scratchPath)).toBe(true)
      const pass = proposer.name === 'good'
      return {
        iid: 'astropy__astropy-13033',
        pass,
        reason: pass ? 'smoke ok' : 'smoke astropy__astropy-13033: resolved=false — below the mechanism bar',
        resolved: pass,
        patchLines: pass ? 3 : 0,
        wallS: 5,
      }
    }
    const gen = fanOutLoopsGenerator(config, {
      author: async (proposer, args) => {
        await mkdir(join(args.worktreePath, 'extensions', 'pi'), { recursive: true })
        await writeFile(join(args.worktreePath, 'extensions', 'pi', `${proposer.name}.ts`), 'x\n')
        return { applied: true, summary: `${proposer.name} edit` }
      },
      smokeRunner,
    })

    const survivor = await gen.generate(generatorArgs(0))
    const killed = await gen.generate(generatorArgs(1))

    expect(smokeCalls.sort()).toEqual(['bad', 'good'])
    expect(survivor.applied).toBe(true)
    expect(killed.applied).toBe(false)
    // The killed proposer's patch never reached the driver worktree.
    expect(existsSync(join(driverWt, 'extensions', 'pi', 'bad.ts'))).toBe(false)
    const kills = gen.drainPrefilterKills()
    expect(kills).toHaveLength(1)
    expect(kills[0]).toMatchObject({
      proposer: 'bad',
      stage: 'smoke',
      generation: 0,
      candidateIndex: 1,
    })
    expect(kills[0]!.reason).toContain('below the mechanism bar')
    // Kill forensics: the killed diff is persisted with a digest.
    expect(kills[0]!.patchPath).not.toBeNull()
    expect(kills[0]!.diffSha256).toMatch(/^sha256:/)
    expect(existsSync(kills[0]!.patchPath!)).toBe(true)
    // Draining clears the buffer.
    expect(gen.drainPrefilterKills()).toEqual([])
  })

  it('kills an out-of-space diff at the change-space pre-filter before any smoke spend', async () => {
    const proposers: ProposerSpec[] = [{ name: 'rogue', harness: 'claude-code' }]
    const config = baseConfig(proposers)
    config.prefilter = { enabled: true, smokeInstance: 'cheapest-of-set' }
    let smokeRan = false
    const gen = fanOutLoopsGenerator(config, {
      author: async (_proposer, args) => {
        // `judge.py` is outside the declared change-space.
        await writeFile(join(args.worktreePath, 'judge.py'), 'tampered\n')
        return { applied: true, summary: 'rogue edit' }
      },
      smokeRunner: async () => {
        smokeRan = true
        return { iid: 'x', pass: true, reason: 'ok', resolved: true, patchLines: 1, wallS: 1 }
      },
    })

    const result = await gen.generate(generatorArgs(0))

    expect(result.applied).toBe(false)
    expect(smokeRan).toBe(false)
    const kills = gen.drainPrefilterKills()
    expect(kills).toHaveLength(1)
    expect(kills[0]).toMatchObject({ proposer: 'rogue', stage: 'change-space' })
    expect(kills[0]!.reason).toContain('judge.py')
  })

  it('returns applied:false without a kill when a proposer authors nothing', async () => {
    const gen = fanOutLoopsGenerator(baseConfig([{ name: 'idle', harness: 'claude-code' }]), {
      author: async () => ({ applied: false, summary: '' }),
    })
    expect((await gen.generate(generatorArgs(0))).applied).toBe(false)
    expect(gen.drainPrefilterKills()).toEqual([])
  })

  it('fails loud when candidateIndex exceeds the proposer list (populationSize drift)', async () => {
    const gen = fanOutLoopsGenerator(baseConfig([{ name: 'only', harness: 'claude-code' }]), {
      author: async () => ({ applied: false, summary: '' }),
    })
    await expect(gen.generate(generatorArgs(1))).rejects.toThrow(/populationSize must equal/)
  })

  it('materializes pareto parents from real commits (full diff, truncation, missing-commit fail-loud)', async () => {
    await writeFile(join(loopsRepo, 'src.ts'), 'base\nchanged\n')
    await git(['add', '-A'], loopsRepo)
    await git(['commit', '-q', '-m', 'parent change'], loopsRepo)
    const commit = await git(['rev-parse', 'HEAD'], loopsRepo)
    const seed = { commit, label: 'p1', resolvedInstances: ['inst-a'] }
    const [parent] = await materializeParetoParents(loopsRepo, [seed])
    expect(parent).toMatchObject(seed)
    expect(parent!.diff).toContain('parent change')
    expect(parent!.diff).toContain('+changed')
    const [truncated] = await materializeParetoParents(loopsRepo, [seed], 40)
    expect(truncated!.diff).toContain('[... diff truncated at 40 chars ...]')
    await expect(
      materializeParetoParents(loopsRepo, [{ commit: 'deadbeef'.repeat(5), label: 'ghost', resolvedInstances: [] }]),
    ).rejects.toThrow(/not found/)
  })

  it('refuses a merge seat without >=2 materialized parents', () => {
    const config = baseConfig([{ name: 'merge-author', harness: 'claude-code', merge: true }])
    expect(() => fanOutLoopsGenerator(config, { author: async () => ({ applied: false, summary: '' }) })).toThrow(
      /merge proposer/,
    )
    expect(() =>
      fanOutLoopsGenerator(config, {
        author: async () => ({ applied: false, summary: '' }),
        parents: [PARENTS[0]!],
      }),
    ).toThrow(/needs >=2|merge proposer/)
    // With two parents the generator constructs.
    expect(() =>
      fanOutLoopsGenerator(config, { author: async () => ({ applied: false, summary: '' }), parents: PARENTS }),
    ).not.toThrow()
  })

  it('rejects duplicate proposer names and empty proposer lists', () => {
    expect(() =>
      fanOutLoopsGenerator(baseConfig([
        { name: 'dup', harness: 'claude-code' },
        { name: 'dup', harness: 'claude-code' },
      ])),
    ).toThrow(/duplicate/)
    expect(() => fanOutLoopsGenerator({ ...defaultRound4Config(), loopsRepo, outDir })).toThrow(/empty/)
  })
})

// ---------------------------------------------------------------------------
// GEN-5: config bundle + prompt sections (MAP+TOOLBOX briefing, activation
// contract) on every seat, merge included.
// ---------------------------------------------------------------------------

describe('defaultGen5Config', () => {
  const config = defaultGen5Config()

  it('keeps the full gen-4 shape (seats, parents, 2 reps, deferred holdout) under a fresh gen5 outDir', () => {
    expect(config.proposers!.map((p) => p.name)).toEqual(
      defaultGen4Config().proposers!.map((p) => p.name),
    )
    expect(config.populationSize).toBe(config.proposers!.length)
    expect(config.paretoParents).toEqual(GEN3_PARETO_PARENTS)
    expect(config.repsPerInstance).toBe(2)
    expect(config.generations).toBe(1)
    expect(config.holdoutRepsPerInstance).toBe(2)
    expect(config.outDir).toContain('gen5')
    expect(config.premeasuredBaselinePath).toContain('gen5')
  })

  it('turns on the five gen-5 mechanisms as a unit', () => {
    expect(config.scoreSplit).toEqual({ publicCount: 4 })
    expect(config.briefing).toBe('map-toolbox-v1')
    expect(config.activationGate).toBe(true)
    expect(config.rolloutLedger).toEqual({ enabled: true })
    expect(config.priorEvidenceDirs!.some((d) => d.includes('gen4'))).toBe(true)
  })

  it('drops the codex seat when includeCodex is false (population follows)', () => {
    const noCodex = defaultGen5Config(undefined, { includeCodex: false })
    expect(noCodex.proposers!.map((p) => p.name)).toEqual(['claude-author', 'glm-author', 'merge-author'])
    expect(noCodex.populationSize).toBe(3)
  })
})

describe('gen-5 prompt sections', () => {
  const briefing = {
    indexPath: '/tmp/out/evidence-index.md',
    briefingText: 'TOOLBOX: traces CLI, analysts, AxLLM. PERMISSION: subagents.',
    briefingSource: 'default' as const,
  }

  it('appends EVIDENCE MAP + briefing + activation contract after the protocol prompt', () => {
    const spec: ProposerSpec = { name: 'x', harness: 'claude-code' }
    const prompt = proposerBuildPrompt({ findings: [] }, spec, [], {
      briefing,
      activationGate: true,
    })
    expect(prompt).toContain('DECLARED CHANGE-SPACE')
    expect(prompt).toContain('EVIDENCE MAP: /tmp/out/evidence-index.md')
    expect(prompt).toContain('TOOLBOX')
    expect(prompt).toContain('ACTIVATION PREDICATE')
    expect(prompt.indexOf('DECLARED CHANGE-SPACE')).toBeLessThan(prompt.indexOf('EVIDENCE MAP'))
  })

  it('the merge seat gets the gen-5 sections too', () => {
    const spec: ProposerSpec = { name: 'merge-author', harness: 'claude-code', merge: true }
    const prompt = proposerBuildPrompt({ findings: [] }, spec, PARENTS, {
      briefing,
      activationGate: true,
    })
    expect(prompt).toContain('MERGE SEAT')
    expect(prompt).toContain('EVIDENCE MAP')
    expect(prompt).toContain('ACTIVATION PREDICATE')
  })

  it('leaves gen-3/gen-4 prompts byte-identical when no extras are passed', () => {
    const spec: ProposerSpec = { name: 'x', harness: 'claude-code' }
    const legacy = proposerBuildPrompt({ findings: [] }, spec, PARENTS)
    expect(legacy).not.toContain('EVIDENCE MAP')
    expect(legacy).not.toContain('ACTIVATION PREDICATE')
    expect(proposerBuildPrompt({ findings: [] }, spec, PARENTS, {})).toBe(legacy)
  })
})
