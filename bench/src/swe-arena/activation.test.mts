/**
 * Gen-5 activation gate: predicate validation, execution over run artifacts
 * (grep + script, ws/ skip with ws/.loops searched), the prefilter kill for a
 * missing/invalid predicate, and the quarantine verdict path (an improved
 * score with a never-fired mechanism is quarantined, not promoted).
 */

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AnalystFinding } from '@tangle-network/agent-eval'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ACTIVATION_PREDICATE_RELPATH,
  activationPredicateInstruction,
  parseActivationPredicate,
  runActivationPredicate,
} from './activation.mts'
import { decideVerdict } from './cell-evidence.mts'
import { defaultRound4Config, parseStaircaseRow, STAIRCASE_SCHEMA, type OuterLoopConfig, type StaircaseRow } from './outer-loop.mts'
import { fanOutLoopsGenerator, type ProposerSpec } from './proposer-fanout.mts'
import { runOk } from './proc.ts'

describe('parseActivationPredicate', () => {
  it('accepts a valid grep predicate (with optional files filters)', () => {
    const parsed = parseActivationPredicate(
      JSON.stringify({
        version: 'v1',
        description: 'patchRiskWarnings emitted in at least one settle',
        kind: 'grep',
        pattern: 'patchRiskWarnings|patch-risk',
        files: ['journal.jsonl', 'workers/'],
      }),
    )
    expect(parsed.ok).toBe(true)
  })

  it('accepts a valid script predicate', () => {
    const parsed = parseActivationPredicate(
      JSON.stringify({ version: 'v1', description: 'x', kind: 'script', script: 'grep -rq X .' }),
    )
    expect(parsed.ok).toBe(true)
  })

  it.each([
    ['not json', 'not valid JSON'],
    ['[]', 'JSON object'],
    [JSON.stringify({ version: 'v2', description: 'x', kind: 'grep', pattern: 'a' }), 'version'],
    [JSON.stringify({ version: 'v1', description: '', kind: 'grep', pattern: 'a' }), 'description'],
    [JSON.stringify({ version: 'v1', description: 'x', kind: 'grep' }), 'pattern'],
    [JSON.stringify({ version: 'v1', description: 'x', kind: 'grep', pattern: '(' }), 'RegExp'],
    [JSON.stringify({ version: 'v1', description: 'x', kind: 'grep', pattern: 'a', files: [1] }), 'files'],
    [JSON.stringify({ version: 'v1', description: 'x', kind: 'script' }), 'script'],
    [JSON.stringify({ version: 'v1', description: 'x', kind: 'sql' }), 'kind'],
  ])('rejects %s', (raw, want) => {
    const parsed = parseActivationPredicate(raw)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain(want)
  })

  it('the prompt instruction carries the template and the quarantine warning', () => {
    const text = activationPredicateInstruction()
    expect(text).toContain(ACTIVATION_PREDICATE_RELPATH)
    expect(text).toContain('QUARANTINED')
    expect(text).toContain('"kind": "grep"')
  })
})

describe('runActivationPredicate', () => {
  let runA: string
  let runB: string

  beforeEach(async () => {
    runA = await mkdtemp(join(tmpdir(), 'act-a-'))
    runB = await mkdtemp(join(tmpdir(), 'act-b-'))
    await writeFile(join(runA, 'driver.log'), 'boot\nno mechanism here\n')
    await writeFile(join(runB, 'driver.log'), 'boot\npatchRiskWarnings: 2 warnings emitted\n')
  })

  afterEach(async () => {
    await rm(runA, { recursive: true, force: true })
    await rm(runB, { recursive: true, force: true })
  })

  const grep = (pattern: string, files?: string[]) => ({
    version: 'v1' as const,
    description: 'd',
    kind: 'grep' as const,
    pattern,
    ...(files ? { files } : {}),
  })

  it('fires with path:line evidence when the pattern appears in ANY run dir', async () => {
    const res = await runActivationPredicate(grep('patchRiskWarnings'), [runA, runB])
    expect(res.fired).toBe(true)
    expect(res.checkedRunDirs).toBe(2)
    expect(res.evidence[0]).toContain(join(runB, 'driver.log'))
    expect(res.evidence[0]).toContain('patchRiskWarnings')
  })

  it('does not fire when the pattern never appears (fail-closed)', async () => {
    const res = await runActivationPredicate(grep('neverEverPresent'), [runA, runB])
    expect(res.fired).toBe(false)
    expect(res.evidence).toEqual([])
  })

  it('honors files filters (relative-path substring)', async () => {
    await writeFile(join(runB, 'other.txt'), 'patchRiskWarnings\n')
    const onlyOther = await runActivationPredicate(grep('patchRiskWarnings', ['other.txt']), [runB])
    expect(onlyOther.fired).toBe(true)
    const onlyMissing = await runActivationPredicate(grep('patchRiskWarnings', ['nope.bin']), [runB])
    expect(onlyMissing.fired).toBe(false)
  })

  it('skips the ws/ workspace subtree EXCEPT ws/.loops (supervisor artifacts)', async () => {
    // Marker only inside ws/ (a checked-out repo) → must NOT count as fired.
    await mkdir(join(runA, 'ws', 'src'), { recursive: true })
    await writeFile(join(runA, 'ws', 'src', 'code.py'), 'patchRiskWarnings in the repo source\n')
    const inWs = await runActivationPredicate(grep('patchRiskWarnings'), [runA])
    expect(inWs.fired).toBe(false)
    // Marker in ws/.loops → the supervisor's own artifacts, searched.
    await mkdir(join(runA, 'ws', '.loops', 'supervisor', 's1'), { recursive: true })
    await writeFile(join(runA, 'ws', '.loops', 'supervisor', 's1', 'journal.jsonl'), '{"k":"patchRiskWarnings"}\n')
    const inLoops = await runActivationPredicate(grep('patchRiskWarnings'), [runA])
    expect(inLoops.fired).toBe(true)
  })

  it('script kind fires on rc=0 in any run dir, not-fired otherwise', async () => {
    const script = (s: string) => ({ version: 'v1' as const, description: 'd', kind: 'script' as const, script: s })
    const hit = await runActivationPredicate(script('grep -q patchRiskWarnings driver.log'), [runA, runB])
    expect(hit.fired).toBe(true)
    expect(hit.evidence[0]).toContain(runB)
    const miss = await runActivationPredicate(script('grep -q neverEverPresent driver.log'), [runA, runB])
    expect(miss.fired).toBe(false)
  })
})

describe('quarantine verdict path', () => {
  const base = {
    violations: [],
    coverageComplete: true,
    resolvedCount: 3,
    parentResolvedCount: 1,
    costRatio: 1.0,
    costGuardRatio: 1.2,
  }

  it('quarantines a candidate whose mechanism never fired EVEN when its score improved', () => {
    expect(decideVerdict({ ...base, activationFired: false })).toBe('quarantined-inactive')
  })

  it('accepts an improved candidate whose mechanism fired; gate-not-applicable behaves as before', () => {
    expect(decideVerdict({ ...base, activationFired: true })).toBe('accepted')
    expect(decideVerdict({ ...base, activationFired: null })).toBe('accepted')
    expect(decideVerdict(base)).toBe('accepted')
  })

  it('out-of-space still wins over quarantine; quarantine wins over no-gain/cost/coverage', () => {
    expect(decideVerdict({ ...base, violations: ['judge.py'], activationFired: false })).toBe('rejected-out-of-space')
    expect(decideVerdict({ ...base, coverageComplete: false, activationFired: false })).toBe('quarantined-inactive')
    expect(decideVerdict({ ...base, resolvedCount: 1, activationFired: false })).toBe('quarantined-inactive')
  })

  it('parseStaircaseRow accepts a quarantined row with gen-5 split + activation fields', () => {
    const row: StaircaseRow = {
      schema: STAIRCASE_SCHEMA,
      round: 4,
      generation: 0,
      runId: 'r4-x',
      at: new Date(0).toISOString(),
      candidate: 'hash',
      candidateCommit: 'c'.repeat(40),
      parent: 'baseline',
      parentResolvedCount: 1,
      changedFiles: [],
      changeSpaceViolations: [],
      perInstance: [],
      resolvedCount: 3,
      coverageComplete: true,
      wallS: 10,
      baselineWallS: 10,
      costRatio: 1,
      costGuardRatio: 1.2,
      internallyPromoted: true,
      verdict: 'quarantined-inactive',
      holdout: 'operator-approval-required',
      armProvenance: null,
      diffPath: null,
      diffSha256: null,
      split: {
        publicInstances: ['a', 'b'],
        privateInstances: ['c'],
        publicResolvedCount: 2,
        privateResolvedCount: 1,
      },
      activation: { present: true, description: 'd', fired: false, evidence: [], warnings: [] },
    }
    expect(parseStaircaseRow(JSON.stringify(row))).toEqual(row)
  })
})

// ---------------------------------------------------------------------------
// Prefilter enforcement — a candidate without a parseable predicate is killed
// before any evaluation spend.
// ---------------------------------------------------------------------------

describe('activation-predicate prefilter', () => {
  let loopsRepo: string
  let outDir: string
  let driverWt: string

  beforeEach(async () => {
    loopsRepo = await mkdtemp(join(tmpdir(), 'act-repo-'))
    outDir = await mkdtemp(join(tmpdir(), 'act-out-'))
    await runOk('git', ['init', '-q', '-b', 'main', loopsRepo])
    await runOk('git', ['-C', loopsRepo, 'config', 'user.email', 't@t.dev'])
    await runOk('git', ['-C', loopsRepo, 'config', 'user.name', 'T'])
    await writeFile(join(loopsRepo, 'src.ts'), 'base\n')
    await runOk('git', ['-C', loopsRepo, 'add', '-A'])
    await runOk('git', ['-C', loopsRepo, 'commit', '-q', '-m', 'init'])
    driverWt = join(outDir, 'driver-wt')
    await runOk('git', ['-C', loopsRepo, 'worktree', 'add', '--detach', driverWt, 'HEAD'])
  })

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true })
    await rm(loopsRepo, { recursive: true, force: true })
  })

  const config = (proposers: ProposerSpec[]): OuterLoopConfig => ({
    ...defaultRound4Config(),
    loopsRepo,
    outDir,
    populationSize: proposers.length,
    proposers,
    activationGate: true,
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

  it('kills a candidate without .improve/activation.json (stage activation-predicate) and passes one WITH it', async () => {
    const proposers: ProposerSpec[] = [
      { name: 'with-predicate', harness: 'claude' },
      { name: 'without-predicate', harness: 'claude' },
      { name: 'invalid-predicate', harness: 'claude' },
    ]
    const gen = fanOutLoopsGenerator(config(proposers), {
      author: async (proposer, args) => {
        await mkdir(join(args.worktreePath, 'extensions', 'pi'), { recursive: true })
        await writeFile(join(args.worktreePath, 'extensions', 'pi', `${proposer.name}.ts`), 'x\n')
        if (proposer.name === 'with-predicate') {
          await mkdir(join(args.worktreePath, '.improve'), { recursive: true })
          await writeFile(
            join(args.worktreePath, ACTIVATION_PREDICATE_RELPATH),
            JSON.stringify({ version: 'v1', description: 'd', kind: 'grep', pattern: 'x' }),
          )
        } else if (proposer.name === 'invalid-predicate') {
          await mkdir(join(args.worktreePath, '.improve'), { recursive: true })
          await writeFile(join(args.worktreePath, ACTIVATION_PREDICATE_RELPATH), '{"version":"v1"}')
        }
        return { applied: true, summary: `${proposer.name} edit` }
      },
    })

    const survivor = await gen.generate(generatorArgs(0))
    const missing = await gen.generate(generatorArgs(1))
    const invalid = await gen.generate(generatorArgs(2))

    expect(survivor.applied).toBe(true)
    expect(missing.applied).toBe(false)
    expect(invalid.applied).toBe(false)
    const kills = gen.drainPrefilterKills()
    expect(kills).toHaveLength(2)
    expect(kills.find((k) => k.proposer === 'without-predicate')).toMatchObject({ stage: 'activation-predicate' })
    expect(kills.find((k) => k.proposer === 'without-predicate')!.reason).toContain('missing')
    expect(kills.find((k) => k.proposer === 'invalid-predicate')!.reason).toContain('invalid')
    // The survivor's predicate landed on the driver worktree with the patch.
    expect(existsSync(join(driverWt, ACTIVATION_PREDICATE_RELPATH))).toBe(true)
  })

  it('does not require a predicate when the gate is off (gen-4 behavior unchanged)', async () => {
    const cfg = config([{ name: 'legacy', harness: 'claude' }])
    cfg.activationGate = false
    const gen = fanOutLoopsGenerator(cfg, {
      author: async (_p, args) => {
        await mkdir(join(args.worktreePath, 'extensions', 'pi'), { recursive: true })
        await writeFile(join(args.worktreePath, 'extensions', 'pi', 'l.ts'), 'x\n')
        return { applied: true, summary: 'edit' }
      },
    })
    expect((await gen.generate(generatorArgs(0))).applied).toBe(true)
    expect(gen.drainPrefilterKills()).toEqual([])
  })
})
