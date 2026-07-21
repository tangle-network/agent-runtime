import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AnalystFinding } from '@tangle-network/agent-eval'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  defaultGen3Config,
  defaultRound4Config,
  GEN3_IMPROVEMENT_SET,
  GEN3_SPARE_POOL,
  resolveSmokeInstance,
  type OuterLoopConfig,
} from './outer-loop.mts'
import type { EvidenceCell, R4Artifact } from './cell-evidence.mts'
import {
  defaultProposers,
  fanOutLoopsGenerator,
  loadAuthorProfile,
  PROFILES_DIR,
  proposerBuildPrompt,
  sliceFindings,
  type ProposerSpec,
  type SmokeRunner,
} from './proposer-fanout.mts'
import { runOk } from './proc.ts'

// ---------------------------------------------------------------------------
// Pure pieces.
// ---------------------------------------------------------------------------

const finding = (over: Record<string, unknown>): AnalystFinding =>
  ({
    schema_version: '1.0.0',
    finding_id: `f-${Math.random().toString(36).slice(2)}`,
    analyst_id: 'analyst',
    produced_at: new Date(0).toISOString(),
    severity: 'high',
    area: 'mechanism',
    claim: 'workers drop build artifacts on clone',
    evidence_refs: [],
    confidence: 0.9,
    ...over,
  }) as unknown as AnalystFinding

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
    const spec: ProposerSpec = { name: 'x', harness: 'claude', lens: 'Prefer code-path fixes.' }
    const prompt = proposerBuildPrompt({ report: undefined, findings: [] }, spec)
    expect(prompt).toContain('DECLARED CHANGE-SPACE')
    expect(prompt.indexOf('DECLARED CHANGE-SPACE')).toBeLessThan(prompt.indexOf('YOUR AUTHORING LENS (x)'))
    expect(prompt).toContain('Prefer code-path fixes.')
  })

  it('is the bare round prompt without a lens', () => {
    const spec: ProposerSpec = { name: 'x', harness: 'claude' }
    expect(proposerBuildPrompt({ report: undefined, findings: [] }, spec)).not.toContain('AUTHORING LENS')
  })
})

describe('loadAuthorProfile', () => {
  it('loads the committed default-author profile (bare: no prompt, no model)', () => {
    const profile = loadAuthorProfile({ name: 'a', profile: 'default-author.profile.json', harness: 'claude' })
    expect(profile?.name).toBe('swe-arena-default-author')
    expect(profile?.prompt).toBeUndefined()
    expect(profile?.model).toBeUndefined()
    expect(existsSync(join(PROFILES_DIR, 'default-author.profile.json'))).toBe(true)
  })

  it('returns undefined without a profile path', () => {
    expect(loadAuthorProfile({ name: 'a', harness: 'claude' })).toBeUndefined()
  })

  it('fails loud when a non-codex proposer declares profile resources (they would be dropped)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'profile-'))
    try {
      const path = join(dir, 'with-resources.json')
      await writeFile(path, JSON.stringify({ name: 'r', resources: { files: [] } }))
      expect(() => loadAuthorProfile({ name: 'a', profile: path, harness: 'claude' })).toThrow(/silently drop/)
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
      { name: 'default-author', profile: 'default-author.profile.json', harness: 'claude' },
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
    report: undefined,
    findings: [] as AnalystFinding[],
    maxShots: 1,
    signal: new AbortController().signal,
    generation: 0,
    candidateIndex,
  })

  it('authors ALL proposers concurrently in separate worktrees and applies each patch to its candidate slot', async () => {
    const proposers: ProposerSpec[] = [
      { name: 'alpha', harness: 'claude' },
      { name: 'beta', harness: 'claude' },
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
    expect(first.rationale).toContain('proposer alpha (claude)')
    // Both patches landed on the SAME driver worktree across the two calls —
    // the driver discards/finalizes between calls in production; here we only
    // assert each call applied its own proposer's file.
    expect(await readFile(join(driverWt, 'extensions', 'pi', 'alpha.ts'), 'utf8')).toBe('alpha change\n')
    expect(await readFile(join(driverWt, 'extensions', 'pi', 'beta.ts'), 'utf8')).toBe('beta change\n')
    expect(gen.drainPrefilterKills()).toEqual([])
  })

  it('kills a candidate at the smoke pre-filter: applied=false, no patch applied, kill recorded with reason', async () => {
    const proposers: ProposerSpec[] = [
      { name: 'good', harness: 'claude' },
      { name: 'bad', harness: 'claude' },
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
    const proposers: ProposerSpec[] = [{ name: 'rogue', harness: 'claude' }]
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
    const gen = fanOutLoopsGenerator(baseConfig([{ name: 'idle', harness: 'claude' }]), {
      author: async () => ({ applied: false, summary: '' }),
    })
    expect((await gen.generate(generatorArgs(0))).applied).toBe(false)
    expect(gen.drainPrefilterKills()).toEqual([])
  })

  it('fails loud when candidateIndex exceeds the proposer list (populationSize drift)', async () => {
    const gen = fanOutLoopsGenerator(baseConfig([{ name: 'only', harness: 'claude' }]), {
      author: async () => ({ applied: false, summary: '' }),
    })
    await expect(gen.generate(generatorArgs(1))).rejects.toThrow(/populationSize must equal/)
  })

  it('rejects duplicate proposer names and empty proposer lists', () => {
    expect(() =>
      fanOutLoopsGenerator(baseConfig([
        { name: 'dup', harness: 'claude' },
        { name: 'dup', harness: 'claude' },
      ])),
    ).toThrow(/duplicate/)
    expect(() => fanOutLoopsGenerator({ ...defaultRound4Config(), loopsRepo, outDir })).toThrow(/empty/)
  })
})
