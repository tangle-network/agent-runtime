/**
 * factory-bench runner tests — all hermetic: a synthetic two-commit "mirror"
 * repo stands in for the real local mirrors, and its judge harness prints
 * vitest-format summary lines, so the full archive → apply → overlay → run →
 * parse pipeline is exercised without pnpm, docker, or network.
 */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  calibrateFactoryInstance,
  goldImplPatch,
} from './calibrate.ts'
import {
  judgeCmdEnv,
  judgeFactoryPatch,
  parseFactoryJudgeResult,
  parseVitestSummary,
} from './factory-judge-child.mts'
import {
  FACTORY_INSTANCES_DIR,
  loadFactoryInstance,
  loadFactoryInstances,
  type LoadedFactoryInstance,
} from './fixtures.ts'
import { run, runOk } from './proc.ts'
import { FACTORY_BASE_REF, factoryLedgerKeys, materializeFactoryWorkspace } from './run-experiment.mts'

// ---------------------------------------------------------------------------
// Synthetic mirror: base commit (README + package.json, no impl), then three
// judge_ref variants layered on top —
//   good:     impl (add+mul) + judge tests that pin both  → calibrates
//   trivial:  judge tests that pass with NO impl          → base passes → reject
//   too-hard: judge tests demanding an un-shipped sub()   → gold fails  → reject
// The judge harness is plain node (no vitest dependency) that PRINTS vitest's
// summary format — the protocol under test is the parse, not vitest itself.
// ---------------------------------------------------------------------------

const JUDGE_HARNESS = `
let passed = 0
let failed = 0
const check = (name, fn) => {
  try {
    if (fn()) passed += 1
    else failed += 1
  } catch {
    failed += 1
  }
}
export async function runChecks(checks) {
  let lib
  try {
    lib = await import('../lib.mjs')
  } catch {
    console.log(' Test Files  1 failed (1)')
    console.log('      Tests  no tests')
    process.exit(1)
  }
  for (const [name, fn] of checks) check(name, () => fn(lib))
  const total = passed + failed
  const parts = []
  if (failed > 0) parts.push(failed + ' failed')
  if (passed > 0) parts.push(passed + ' passed')
  console.log(' Test Files  ' + (failed > 0 ? '1 failed (1)' : '1 passed (1)'))
  console.log('      Tests  ' + parts.join(' | ') + ' (' + total + ')')
  process.exit(failed > 0 ? 1 : 0)
}
`

const GOOD_TESTS = `
import { runChecks } from './harness.mjs'
await runChecks([
  ['add', (lib) => lib.add(1, 2) === 3],
  ['mul', (lib) => lib.mul(2, 3) === 6],
])
`

const TRIVIAL_TESTS = `
console.log(' Test Files  1 passed (1)')
console.log('      Tests  2 passed (2)')
`

const TOO_HARD_TESTS = `
import { runChecks } from './harness.mjs'
await runChecks([
  ['add', (lib) => lib.add(1, 2) === 3],
  ['sub', (lib) => lib.sub(3, 1) === 2],
])
`

const IMPL = `export const add = (a, b) => a + b\nexport const mul = (a, b) => a * b\n`

interface SyntheticMirror {
  mirror: string
  baseCommit: string
  refs: { good: string; trivial: string; tooHard: string }
}

async function git(cwd: string, ...argv: string[]): Promise<string> {
  const res = await runOk('git', ['-C', cwd, ...argv])
  return res.stdout.trim()
}

async function commitAll(cwd: string, msg: string): Promise<string> {
  await git(cwd, 'add', '-A')
  await runOk('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', msg])
  return git(cwd, 'rev-parse', 'HEAD')
}

async function makeSyntheticMirror(root: string): Promise<SyntheticMirror> {
  const mirror = join(root, 'mirror')
  await mkdir(mirror, { recursive: true })
  await runOk('git', ['-C', mirror, 'init', '-q', '-b', 'main'])
  await writeFile(join(mirror, 'README.md'), '# synthetic\n')
  await writeFile(join(mirror, 'package.json'), JSON.stringify({ name: 'synthetic', type: 'module' }))
  await writeFile(join(mirror, '.gitignore'), 'node_modules\n')
  const baseCommit = await commitAll(mirror, 'base')

  const variant = async (branch: string, tests: string, withImpl: boolean): Promise<string> => {
    await git(mirror, 'checkout', '-q', '-b', branch, baseCommit)
    await mkdir(join(mirror, 'tests'), { recursive: true })
    await writeFile(join(mirror, 'tests', 'harness.mjs'), JUDGE_HARNESS)
    await writeFile(join(mirror, 'tests', 'judge.mjs'), tests)
    if (withImpl) await writeFile(join(mirror, 'lib.mjs'), IMPL)
    return commitAll(mirror, `merge ${branch}`)
  }
  const good = await variant('pr-good', GOOD_TESTS, true)
  const trivial = await variant('pr-trivial', TRIVIAL_TESTS, true)
  const tooHard = await variant('pr-too-hard', TOO_HARD_TESTS, true)
  return { mirror, baseCommit, refs: { good, trivial, tooHard } }
}

async function makeInstanceDir(
  root: string,
  name: string,
  m: SyntheticMirror,
  judgeRef: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'manifest.json'),
    JSON.stringify({
      id: `factory.synthetic.${name}`,
      repo: 'synthetic/repo',
      repo_local_mirror: m.mirror,
      base_commit: m.baseCommit,
      judge_ref: judgeRef,
      spec_md: 'spec.md',
      judge_tests: ['tests/judge.mjs', 'tests/harness.mjs'],
      excluded_tests: [],
      setup_cmds: [],
      judge_cmds: ['node tests/judge.mjs'],
      resolved_criterion: 'all 2 judge tests pass; partial score = passed/2',
      timeout_s: 60,
      ...overrides,
    }),
  )
  await writeFile(join(dir, 'spec.md'), '# Implement lib.mjs\n\nExport `add(a,b)` and `mul(a,b)` from `lib.mjs`.\n')
  return dir
}

let root: string
let mirror: SyntheticMirror
let goodInst: LoadedFactoryInstance

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'factory-test-'))
  mirror = await makeSyntheticMirror(root)
  goodInst = loadFactoryInstance(await makeInstanceDir(root, 'good', mirror, mirror.refs.good))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// parseVitestSummary — partial-credit arithmetic feeds off these counts.
// ---------------------------------------------------------------------------

describe('parseVitestSummary', () => {
  it('parses an all-pass summary', () => {
    expect(parseVitestSummary(' Test Files  2 passed (2)\n      Tests  30 passed (30)\n')).toEqual({
      passed: 30,
      failed: 0,
      reportedTotal: 30,
    })
  })

  it('parses a mixed summary', () => {
    expect(parseVitestSummary('      Tests  17 failed | 13 passed (30)\n')).toEqual({
      passed: 13,
      failed: 17,
      reportedTotal: 30,
    })
  })

  it('treats a collection failure ("no tests") as a zero-pass verdict', () => {
    expect(parseVitestSummary(' Test Files  2 failed (2)\n      Tests  no tests\n')).toEqual({
      passed: 0,
      failed: 0,
      reportedTotal: 0,
    })
  })

  it('parses through ANSI color codes', () => {
    const colored = '\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m21 passed\u001b[39m\u001b[22m\u001b[90m (21)\u001b[39m\n'
    expect(parseVitestSummary(colored)).toEqual({ passed: 21, failed: 0, reportedTotal: 21 })
  })

  it('never mistakes the Test Files line for the Tests line, and returns undefined without a summary', () => {
    expect(parseVitestSummary(' Test Files  2 failed (2)\n')).toBeUndefined()
    expect(parseVitestSummary('some crash output\n')).toBeUndefined()
  })
})

// The judge/setup subprocess env must be hermetic: it runs the repo's OWN tests, so a
// dotenvx-injected TANGLE_API_KEY must not reach them. Otherwise a base test that asserts
// "throws without an api key" passes on the leaked key and the gate becomes unpassable.
describe('judgeCmdEnv — hermetic w.r.t. injected inference secrets', () => {
  it('does not carry ambient TANGLE_API_KEY / INTELLIGENCE_BASE / provider keys, but keeps the store + CI knobs', () => {
    const saved = {
      TANGLE_API_KEY: process.env.TANGLE_API_KEY,
      INTELLIGENCE_BASE: process.env.INTELLIGENCE_BASE,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    }
    try {
      process.env.TANGLE_API_KEY = 'sk-tan-injected'
      process.env.INTELLIGENCE_BASE = 'https://intel.example'
      process.env.ANTHROPIC_API_KEY = 'sk-ant-injected'
      process.env.OPENAI_API_KEY = 'sk-oai-injected'
      const env = judgeCmdEnv()
      expect(env.TANGLE_API_KEY).toBeUndefined()
      expect(env.INTELLIGENCE_BASE).toBeUndefined()
      expect(env.ANTHROPIC_API_KEY).toBeUndefined()
      expect(env.OPENAI_API_KEY).toBeUndefined()
      // The non-secret gate knobs still ride through.
      expect(env.CI).toBe('false')
      expect(env.npm_config_store_dir).toContain('factory-bench-pnpm-store')
      expect(env.PATH).toBe(process.env.PATH)
      // Falsification: the ambient parent still has the injected key — the strip is the gate's,
      // not the process's. A pre-fix judgeCmdEnv (spread of raw process.env) would expose it.
      expect(process.env.TANGLE_API_KEY).toBe('sk-tan-injected')
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Manifest loader — fail-loud shape validation.
// ---------------------------------------------------------------------------

describe('loadFactoryInstance', () => {
  it('loads a valid manifest and derives the calibrated denominator', () => {
    expect(goodInst.id).toBe('factory.synthetic.good')
    expect(goodInst.judgeTestTotal).toBe(2)
    expect(goodInst.spec).toContain('lib.mjs')
  })

  it('rejects a manifest missing a required field, naming it', async () => {
    const dir = await makeInstanceDir(root, 'bad-missing', mirror, mirror.refs.good, { base_commit: undefined })
    expect(() => loadFactoryInstance(dir)).toThrow(/base_commit/)
  })

  it('rejects a resolved_criterion without a passed/<N> denominator', async () => {
    const dir = await makeInstanceDir(root, 'bad-criterion', mirror, mirror.refs.good, {
      resolved_criterion: 'all judge tests pass',
    })
    expect(() => loadFactoryInstance(dir)).toThrow(/passed\/<N>/)
  })

  it('loads the 3 shipped pilot instances with their calibrated totals', () => {
    const pilots = loadFactoryInstances(FACTORY_INSTANCES_DIR)
    expect(pilots.map((p) => [p.id, p.judgeTestTotal])).toEqual([
      ['factory.agent-eval.309', 30],
      ['factory.agent-runtime.232', 21],
      ['factory.loops.28', 20],
    ])
  })
})

// ---------------------------------------------------------------------------
// Judge child pipeline on the synthetic fixture.
// ---------------------------------------------------------------------------

describe('judgeFactoryPatch', () => {
  it('gold (impl-only PR diff) resolves with full score', async () => {
    const { result } = await judgeFactoryPatch(goodInst, await goldImplPatch(goodInst))
    expect(result).toMatchObject({ resolved: true, score: 1, passed: 2, total: 2 })
  })

  it('empty patch (bare base) fails: judge tests cannot even collect', async () => {
    const { result } = await judgeFactoryPatch(goodInst, '')
    expect(result).toMatchObject({ resolved: false, score: 0, passed: 0, total: 2 })
  })

  it('partial impl earns partial credit, never resolved', async () => {
    // add correct, mul wrong → 1/2.
    const patch = await makePatch(goodInst, 'export const add = (a, b) => a + b\nexport const mul = (a, b) => a + b\n')
    const { result } = await judgeFactoryPatch(goodInst, patch)
    expect(result).toMatchObject({ resolved: false, score: 0.5, passed: 1, total: 2 })
  })

  it('an unappliable patch is the candidate\'s failure (resolved false), not infra', async () => {
    const garbage = 'diff --git a/nope.txt b/nope.txt\n--- a/nope.txt\n+++ b/nope.txt\n@@ -1 +1 @@\n-x\n+y\n'
    const { result } = await judgeFactoryPatch(goodInst, garbage)
    expect(result.resolved).toBe(false)
    expect(result.error).toMatch(/apply-failed/)
  })

  it('the child CLI prints one JUDGE_RESULT line the serialized-judge protocol parses', async () => {
    const patchFile = join(root, 'gold.patch')
    await writeFile(patchFile, await goldImplPatch(goodInst))
    const here = fileURLToPath(new URL('.', import.meta.url))
    const childPath = join(here, 'factory-judge-child.mts')
    const res = await runOk('node', ['--import', 'tsx', childPath, goodInst.dir, patchFile], {
      cwd: join(here, '..', '..'),
    })
    const parsed = parseFactoryJudgeResult(res.stdout)
    expect(parsed).toMatchObject({ iid: 'factory.synthetic.good', resolved: true, passed: 2, total: 2 })
  }, 60_000)
})

/** A worker-style patch: apply content in a scratch clone of base, git-diff it. */
async function makePatch(inst: LoadedFactoryInstance, libSource: string): Promise<string> {
  const ws = await mkdtemp(join(tmpdir(), 'factory-patch-'))
  try {
    const { syntheticBase } = await materializeFactoryWorkspace(inst, join(ws, 'w'))
    await writeFile(join(ws, 'w', 'lib.mjs'), libSource)
    await git(join(ws, 'w'), 'add', '-A')
    return (await runOk('git', ['-C', join(ws, 'w'), 'diff', '--cached', syntheticBase])).stdout
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// Worker workspace: synthetic history, no future refs leakable.
// ---------------------------------------------------------------------------

describe('materializeFactoryWorkspace', () => {
  it('produces a fresh-history repo with SPEC.md and no trace of the real repo', async () => {
    const dest = join(root, 'worker-ws')
    const { syntheticBase } = await materializeFactoryWorkspace(goodInst, dest)

    // SPEC.md present; judge tests absent (they only exist at judge_ref).
    expect(existsSync(join(dest, 'SPEC.md'))).toBe(true)
    expect(existsSync(join(dest, 'tests', 'judge.mjs'))).toBe(false)

    // Exactly one synthetic commit; not the real base sha; base ref pinned.
    const log = await git(dest, 'log', '--oneline')
    expect(log.split('\n')).toHaveLength(1)
    expect(syntheticBase).not.toBe(goodInst.base_commit)
    expect(await git(dest, 'rev-parse', FACTORY_BASE_REF)).toBe(syntheticBase)

    // No remotes, and the real repo's objects are unreachable.
    expect(await git(dest, 'remote')).toBe('')
    const baseObj = await run('git', ['-C', dest, 'cat-file', '-e', goodInst.base_commit])
    expect(baseObj.code).not.toBe(0)
    const judgeObj = await run('git', ['-C', dest, 'cat-file', '-e', goodInst.judge_ref])
    expect(judgeObj.code).not.toBe(0)

    // Leak grep: neither the real shas nor the mirror path appear anywhere in
    // the workspace (including .git internals).
    for (const needle of [goodInst.base_commit, goodInst.judge_ref, goodInst.repo_local_mirror]) {
      const grep = await run('bash', ['-c', `grep -rF ${JSON.stringify(needle)} ${JSON.stringify(dest)}`])
      expect(grep.stdout).toBe('')
      expect(grep.code).not.toBe(0)
    }
  })
})

// ---------------------------------------------------------------------------
// Calibration admission gate — both rejection directions.
// ---------------------------------------------------------------------------

describe('calibrateFactoryInstance', () => {
  it('admits a well-formed instance (gold passes, base fails)', async () => {
    const r = await calibrateFactoryInstance(goodInst)
    expect(r).toMatchObject({
      goldResolved: true,
      goldPassed: 2,
      baseResolved: false,
      basePassed: 0,
      total: 2,
      admitted: true,
    })
  })

  it('rejects when the base already passes (judge has no signal)', async () => {
    const inst = loadFactoryInstance(await makeInstanceDir(root, 'trivial', mirror, mirror.refs.trivial))
    const r = await calibrateFactoryInstance(inst)
    expect(r.baseResolved).toBe(true)
    expect(r.admitted).toBe(false)
  })

  it('rejects when gold cannot pass its own judge', async () => {
    const inst = loadFactoryInstance(await makeInstanceDir(root, 'too-hard', mirror, mirror.refs.tooHard))
    const r = await calibrateFactoryInstance(inst)
    expect(r.goldResolved).toBe(false)
    expect(r.admitted).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Ledger resume keys.
// ---------------------------------------------------------------------------

describe('factoryLedgerKeys', () => {
  it('keys rows by iid and rep, and fails loud on corrupt lines', async () => {
    const ledger = join(root, 'ledger.jsonl')
    await writeFile(
      ledger,
      JSON.stringify({ iid: 'factory.x.1', rep: 0 }) + '\n' + JSON.stringify({ iid: 'factory.x.1', rep: 1 }) + '\n',
    )
    expect(await factoryLedgerKeys(ledger)).toEqual(new Set(['factory.x.1#r0', 'factory.x.1#r1']))
    await writeFile(ledger, '{corrupt\n')
    await expect(factoryLedgerKeys(ledger)).rejects.toThrow(/corrupt/)
  })
})
