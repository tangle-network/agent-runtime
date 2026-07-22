/**
 * Unit gate for the M2 typed execution path (materialize / calibrate /
 * serialized-judge / arms / capacity / run-experiment). Everything here is
 * hermetic: no docker, no network, no model tokens — fake judge children,
 * synthetic journals, throwaway git repos and an in-test sqlite store. The
 * docker-touching parity gate lives in parity.test.mts.
 */

import { createHash } from 'node:crypto'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, describe, expect, it } from 'vitest'
import {
  armProvenance,
  assertSoloProcessCompleted,
  assertSupervisorProcessCompleted,
  loadExcludes,
  dotenvxBash,
  extractPatch,
  parseOcUsage,
  parseSupervisorArtifacts,
  prepareIsolatedCellEnvironment,
  recoverSupSpend,
  supervisorDriverKillGraceMs,
  toArmIdentity,
  SUP_DEFAULT_ENV_KNOBS,
  WORKER_PROMPT_SUFFIX,
  type SoloArmResult,
  type SupervisorArmResult,
} from './arms.ts'
import { containerName, materializeWorkspace } from './materialize.ts'
import { gatesForArmKind, probeBody, probeWindow, waitForCapacity, httpCapacityProbe } from './capacity.ts'
import { run, runOk } from './proc.ts'
import {
  createSerializedJudge,
  instanceShortName,
  JUDGE_TIMEOUT_FLOOR_MS,
  type JudgeVerdict,
  withJudgeLock,
} from './serialized-judge.ts'
import { loadLedger, readFixture } from './fixtures.ts'
import {
  buildLedgerRow,
  diffChangedFiles,
  ledgerIids,
  loadInstanceImages,
  PARITY_CASES,
} from './run-experiment.mts'

const tmpDirs: string[] = []
async function scratch(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tmpDirs.push(dir)
  return dir
}
afterAll(async () => {
  for (const dir of tmpDirs) await rm(dir, { recursive: true, force: true })
})

describe('vendored execution fixtures', () => {
  const sha256 = (name: string): string => createHash('sha256').update(readFixture(name)).digest('hex')

  // Frozen exactly like M1's fixture-integrity block: these bytes ARE the
  // parity contract (excludes drive extraction; the patches drive the verdicts).
  it.each([
    ['excludes.txt', '0e7e3c024389cb0407cf34a2062fd9623dd7124d04b1f6d36d9217e8e128e48a'],
    ['patches/pallets__flask-5014.solo.patch', '9c76eea47eb3631fa0159437e4f7cb12b9cd0f460a148f67d20b7ce60c7266ad'],
    ['patches/pydata__xarray-4687.sup.patch', 'bb2f5c814880e34fb17da1763b8c126480721cf071829799af0973119b882773'],
    ['instances.json', '930b5f64b1dbe5a2cf14ce7b8a6f3ccf389c31a3a768e8c383fda40e489d05ee'],
  ])('%s is byte-identical to the captured artifact', (name, expected) => {
    expect(sha256(name)).toBe(expected)
  })

  it('excludes.txt carries the 8 test-file pathspecs the bash arms used', async () => {
    const excludes = await loadExcludes()
    expect(excludes).toHaveLength(8)
    expect(excludes.every((e) => e.startsWith(':(exclude,glob)'))).toBe(true)
    expect(excludes).toContain(':(exclude,glob)**/tests/**')
    expect(excludes).toContain(':(exclude,glob)**/conftest.py')
  })

  it('instances.json maps every ledger instance + both parity cases to an image', async () => {
    const images = await loadInstanceImages()
    for (const row of loadLedger()) {
      const entry = images[row.iid]
      expect(entry, row.iid).toBeDefined()
      expect(entry.image).toMatch(/^swebench\/sweb\.eval\.x86_64\./)
      expect(entry.base_commit).toMatch(/^[0-9a-f]{7,40}$/)
    }
    for (const c of PARITY_CASES) expect(images[c.iid]).toBeDefined()
  })

  it('solo prompt suffix is byte-identical to solo.sh', () => {
    expect(WORKER_PROMPT_SUFFIX).toBe(
      '\n\nWork only in your current working directory. Implement the change completely and correctly — do not stub, weaken, or special-case anything, and keep the repository\'s existing tests passing. An automated check verifies your work after you finish.',
    )
  })
})

describe('materialize: container naming', () => {
  it('sanitizes iid like setup-ws.sh (tr _/ --) and is collision-resistant', () => {
    const a = containerName('pallets__flask-5014')
    expect(a).toMatch(/^ext-pallets--flask-5014-\d+-[a-f0-9-]{36}$/)
    expect(containerName('a_b/c')).toMatch(/^ext-a-b-c-/)
    expect(containerName('x')).not.toBe(containerName('x'))
  })

  it('honors a pre-aborted cell before deleting or invoking Docker', async () => {
    const dest = await scratch('swe-arena-materialize-abort-')
    const canary = join(dest, 'keep.txt')
    await writeFile(canary, 'keep\n')
    const controller = new AbortController()
    const reason = new Error('cell deadline')
    controller.abort(reason)

    await expect(materializeWorkspace({
      instanceId: 'example__repo-1',
      image: 'unused:latest',
      baseCommit: 'deadbeef',
      dest,
      signal: controller.signal,
    })).rejects.toBe(reason)
    expect(await readFile(canary, 'utf8')).toBe('keep\n')
  })

  it('fails when Docker cannot remove a successfully-created container', async () => {
    const root = await scratch('swe-arena-materialize-cleanup-')
    const binDir = join(root, 'bin')
    const docker = join(binDir, 'docker')
    const dest = join(root, 'workspace')
    await mkdir(binDir, { recursive: true })
    await writeFile(
      docker,
      [
        '#!/usr/bin/env bash',
        'case "$1" in',
        '  create) exit 0 ;;',
        '  cp) mkdir -p "$3/.git"; exit 0 ;;',
        '  rm) echo "simulated container leak" >&2; exit 9 ;;',
        'esac',
      ].join('\n'),
    )
    await chmod(docker, 0o755)
    const originalPath = process.env.PATH
    process.env.PATH = `${binDir}:${originalPath ?? ''}`
    try {
      await expect(materializeWorkspace({
        instanceId: 'example__repo-1',
        image: 'fake:latest',
        baseCommit: 'deadbeef',
        dest,
      })).rejects.toThrow(/cleanup-fail.*exit=9.*simulated container leak/)
    } finally {
      if (originalPath === undefined) delete process.env.PATH
      else process.env.PATH = originalPath
    }
  })

  it('preserves both copy and cleanup failures', async () => {
    const root = await scratch('swe-arena-materialize-double-failure-')
    const binDir = join(root, 'bin')
    const docker = join(binDir, 'docker')
    await mkdir(binDir, { recursive: true })
    await writeFile(
      docker,
      [
        '#!/usr/bin/env bash',
        'case "$1" in',
        '  create) exit 0 ;;',
        '  cp) echo "simulated copy failure" >&2; exit 7 ;;',
        '  rm) echo "simulated cleanup failure" >&2; exit 9 ;;',
        'esac',
      ].join('\n'),
    )
    await chmod(docker, 0o755)
    const originalPath = process.env.PATH
    process.env.PATH = `${binDir}:${originalPath ?? ''}`
    try {
      let error: unknown
      try {
        await materializeWorkspace({
          instanceId: 'example__repo-2',
          image: 'fake:latest',
          baseCommit: 'deadbeef',
          dest: join(root, 'workspace'),
        })
      } catch (caught) {
        error = caught
      }
      expect(error).toBeInstanceOf(AggregateError)
      const errors = (error as AggregateError).errors as Error[]
      expect(errors[0]?.message).toMatch(/cp-fail.*simulated copy failure/)
      expect(errors[1]?.message).toMatch(/cleanup-fail.*simulated cleanup failure/)
    } finally {
      if (originalPath === undefined) delete process.env.PATH
      else process.env.PATH = originalPath
    }
  })

  it('attempts idempotent cleanup after an uncertain create result', async () => {
    const root = await scratch('swe-arena-materialize-create-failure-')
    const binDir = join(root, 'bin')
    const docker = join(binDir, 'docker')
    const calls = join(root, 'docker-calls.log')
    await mkdir(binDir, { recursive: true })
    await writeFile(
      docker,
      [
        '#!/usr/bin/env bash',
        `echo "$1" >> ${JSON.stringify(calls)}`,
        'case "$1" in',
        '  create) echo "uncertain create failure" >&2; exit 7 ;;',
        '  rm) echo "Error response from daemon: No such container: expected" >&2; exit 1 ;;',
        'esac',
      ].join('\n'),
    )
    await chmod(docker, 0o755)
    const originalPath = process.env.PATH
    process.env.PATH = `${binDir}:${originalPath ?? ''}`
    try {
      await expect(materializeWorkspace({
        instanceId: 'example__repo-3',
        image: 'fake:latest',
        baseCommit: 'deadbeef',
        dest: join(root, 'workspace'),
      })).rejects.toThrow(/create-fail.*uncertain create failure/)
      expect((await readFile(calls, 'utf8')).trim().split('\n')).toEqual(['create', 'rm'])
    } finally {
      if (originalPath === undefined) delete process.env.PATH
      else process.env.PATH = originalPath
    }
  })
})

describe('arms: per-cell host isolation', () => {
  it('separates OpenCode state, auth injection, temp files, and Python imports', async () => {
    const ambient = await scratch('swe-arena-ambient-')
    const ambientConfigDir = join(ambient, '.config', 'opencode')
    const ambientDataDir = join(ambient, '.local', 'share', 'opencode')
    await mkdir(ambientConfigDir, { recursive: true })
    await mkdir(ambientDataDir, { recursive: true })
    await writeFile(join(ambientConfigDir, 'opencode.json'), '{"small_model":"opencode/gpt-5-nano"}\n')
    await writeFile(join(ambientDataDir, 'auth.json'), '{"fake":"credential"}\n')

    const ambientEnv: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: ambient,
      XDG_CONFIG_HOME: undefined,
      XDG_DATA_HOME: undefined,
      OPENCODE_CONFIG: undefined,
      OPENCODE_CONFIG_CONTENT: undefined,
      SWE_ARENA_OPENCODE_AUTH_FILE: undefined,
    }

    const cellA = await prepareIsolatedCellEnvironment(join(await scratch('swe-arena-cell-a-'), 'run'), {
      ...ambientEnv,
      PYTHONHOME: '/tmp/ambient-python-home',
      PYTHONPATH: '/tmp/ambient-python-path',
    })
    const cellB = await prepareIsolatedCellEnvironment(join(await scratch('swe-arena-cell-b-'), 'run'), ambientEnv)

    expect(cellA.env.HOME).not.toBe(ambient)
    expect(cellA.env.XDG_DATA_HOME).not.toBe(cellB.env.XDG_DATA_HOME)
    expect(cellA.env.OPENCODE_DB).toBe(cellA.opencodeDb)
    expect(cellA.env.PYTHONHOME).toBeUndefined()
    expect(cellA.env.PYTHONPATH).toBeUndefined()
    expect(await readFile(cellA.env.OPENCODE_CONFIG!, 'utf8')).toBe('{"small_model":"opencode/gpt-5-nano"}\n')

    const authCheck = await dotenvxBash(
      { secretsDir: ambient, envFiles: [] },
      `test "$OPENCODE_AUTH_CONTENT" = '{"fake":"credential"}'`,
      { env: cellA.env, timeoutMs: 5_000 },
    )
    expect(authCheck.code, authCheck.stderr).toBe(0)

    const dbPath = await runOk('opencode', ['db', 'path'], { env: cellA.env, timeoutMs: 10_000 })
    expect(dbPath.stdout.trim()).toBe(cellA.opencodeDb)

    const siteProbe = await runOk('python3', [
      '-c',
      'import json,site,sys; print(json.dumps({"enabled":site.ENABLE_USER_SITE,"user":site.getusersitepackages(),"path":sys.path}))',
    ], { env: cellA.env })
    const site = JSON.parse(siteProbe.stdout) as { enabled: boolean; user: string; path: string[] }
    expect(site.enabled).toBe(true)
    expect(site.user).toContain(cellA.env.PYTHONUSERBASE!)
    await mkdir(join(site.user, 'cell_a_canary'), { recursive: true })
    await writeFile(join(site.user, 'cell_a_canary', '__init__.py'), 'VALUE = 1\n')

    const ownCellImport = await runOk('python3', [
      '-c',
      'import cell_a_canary; assert cell_a_canary.VALUE == 1',
    ], { env: cellA.env })
    expect(ownCellImport.code).toBe(0)

    const crossCellImport = await run('python3', ['-c', 'import cell_a_canary'], { env: cellB.env })
    expect(crossCellImport.code).not.toBe(0)
    expect(crossCellImport.stderr).toContain('ModuleNotFoundError')
  })

  it('clears every managed directory before retrying the same cell', async () => {
    const runDir = join(await scratch('swe-arena-cell-retry-'), 'run')
    const first = await prepareIsolatedCellEnvironment(runDir, { ...process.env })
    const canaries = [
      join(first.env.HOME!, 'old-home'),
      join(first.env.XDG_DATA_HOME!, 'old-data'),
      join(first.env.XDG_CACHE_HOME!, 'old-cache'),
      join(first.env.XDG_STATE_HOME!, 'old-state'),
      join(first.env.XDG_RUNTIME_DIR!, 'old-runtime'),
      join(first.env.TMPDIR!, 'old-tmp'),
      join(first.env.PYTHONUSERBASE!, 'old-python'),
    ]
    await Promise.all(canaries.map((path) => writeFile(path, 'stale\n')))

    const second = await prepareIsolatedCellEnvironment(runDir, { ...process.env })
    expect(second.env.HOME).toBe(first.env.HOME)
    expect(second.opencodeDb).toBe(first.opencodeDb)
    for (const path of canaries) {
      await expect(readFile(path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })
})

describe('arms: patch extraction (real git, no docker)', () => {
  it('stages everything and excludes test files + .loops state, like solo.sh/sup4.sh', async () => {
    const ws = await scratch('swe-arena-git-')
    const git = (...argv: string[]) => runOk('git', ['-C', ws, ...argv])
    await runOk('git', ['init', '-q', ws])
    await git('config', 'user.email', 't@t')
    await git('config', 'user.name', 't')
    await writeFile(join(ws, 'lib.py'), 'x = 1\n')
    await mkdir(join(ws, 'tests'), { recursive: true })
    await writeFile(join(ws, 'tests', 'test_lib.py'), 'assert True\n')
    await git('add', '-A')
    await git('commit', '-qm', 'base')
    const base = (await git('rev-parse', 'HEAD')).stdout.trim()

    // Arm-style edits: source fix + test edit + supervisor state + conftest.
    await writeFile(join(ws, 'lib.py'), 'x = 2\n')
    await writeFile(join(ws, 'tests', 'test_lib.py'), 'assert False\n')
    await writeFile(join(ws, 'conftest.py'), 'pass\n')
    await mkdir(join(ws, '.loops', 'supervisor'), { recursive: true })
    await writeFile(join(ws, '.loops', 'supervisor', 'state.json'), '{}')

    const patch = await extractPatch(ws, base, await loadExcludes())
    expect(patch).toContain('diff --git a/lib.py b/lib.py')
    expect(patch).toContain('+x = 2')
    expect(patch).not.toContain('test_lib.py')
    expect(patch).not.toContain('conftest.py')
    expect(patch).not.toContain('.loops')
  })

  it('honors a pre-aborted cell before spawning git', async () => {
    const controller = new AbortController()
    const reason = new Error('cell deadline')
    controller.abort(reason)
    await expect(extractPatch('/unused', 'deadbeef', [], controller.signal)).rejects.toBe(reason)
  })
})

describe('arms: opencode usage parse (oc_usage.py port)', () => {
  it('sums token parts, tracks max ctx, rounds cost to 6dp, skips noise', () => {
    const lines = [
      'not json',
      '{"part":{"tokens":{"input":100,"output":20,"reasoning":5,"cache":{"write":7,"read":11},"total":150},"cost":0.001}}',
      '{"part":{"no_tokens_here":true}}',
      '{"part":{"tokens":{"input":200,"output":40,"total":400},"cost":0.0002345678}}',
      '{"other":"shape"}',
      '{broken json',
    ].join('\n')
    expect(parseOcUsage(lines)).toEqual({
      steps: 2,
      in: 300,
      out: 60,
      reasoning: 5,
      cache_w: 7,
      cache_r: 11,
      max_ctx: 400,
      oc_cost: 0.001235, // 0.0012345678 → 6dp (python round() parity)
      total_io: 365,
    })
  })

  it('empty stream = zero usage (the SOLO 0-token crash rows)', () => {
    expect(parseOcUsage('').total_io).toBe(0)
    expect(parseOcUsage('').steps).toBe(0)
  })
})

describe('arms: supervisor artifacts parse (sup4.sh port)', () => {
  it('reads state.json + journal spawned/settled/workers/goals', async () => {
    const ws = await scratch('swe-arena-sup-')
    const runDir = join(ws, '.loops', 'supervisor', 'sup-1-abc123')
    await mkdir(join(runDir, 'workers'), { recursive: true })
    await writeFile(
      join(runDir, 'state.json'),
      JSON.stringify({
        status: 'completed',
        verdict: 'delivered',
        result: { delivered: true, spentTokens: 15731, spentUsd: 0.0124 },
      }),
    )
    await writeFile(
      join(runDir, 'journal.jsonl'),
      [
        '{"kind":"spawned","label":"root"}',
        `{"kind":"spawned","label":"${'g'.repeat(150)}"}`,
        '{"kind":"spawned","label":"fix the blueprint name check"}',
        '{"kind":"settled","label":"w-0"}',
        '{"kind":"metered","spend":{"tokens":{"input":1,"output":2}}}',
        'garbage line',
      ].join('\n'),
    )
    const a = await parseSupervisorArtifacts(ws)
    expect(a.status).toBe('completed')
    expect(a.verdict).toBe('delivered')
    expect(a.delivered).toBe(true)
    expect(a.spentTokens).toBe(15731)
    expect(a.spentUsd).toBe(0.0124)
    expect(a.spawned).toBe(3)
    expect(a.workers).toBe(2)
    expect(a.settled).toBe(1)
    expect(a.subtasks).toEqual(['g'.repeat(100), 'fix the blueprint name check'])
    expect(a.supRunDir).toBe(runDir)
  })

  it('no supervisor dir at all = null/zero summary (driver died pre-spawn)', async () => {
    const ws = await scratch('swe-arena-sup-empty-')
    const a = await parseSupervisorArtifacts(ws)
    expect(a.status).toBeNull()
    expect(a.spawned).toBe(0)
    expect(a.supRunDir).toBeNull()
  })
})

describe('arms: cost recovery (true_sup_spend.py + opencode sqlite join)', () => {
  it('brain from journal metered, workers from ndjson settled + sqlite by cwd', async () => {
    const dir = await scratch('swe-arena-spend-')
    const supRunDir = join(dir, 'sup-1-x')
    await mkdir(join(supRunDir, 'workers'), { recursive: true })
    await writeFile(
      join(supRunDir, 'journal.jsonl'),
      [
        '{"kind":"metered","spend":{"tokens":{"input":1000,"output":200},"usd":0.011}}',
        '{"kind":"metered","spend":{"tokens":{"input":500,"output":100},"usd":0.004}}',
        '{"kind":"spawned","label":"w-0"}',
      ].join('\n'),
    )
    await writeFile(
      join(supRunDir, 'workers', 'w-0.ndjson'),
      [
        '{"kind":"started","label":"w-0","cwd":"/tmp/loops-w-0-TESTAA"}',
        '{"kind":"settled","spend":{"tokens":{"input":30,"output":12}}}',
      ].join('\n'),
    )
    // The opencode store, reduced to the columns the join reads.
    const dbPath = join(dir, 'opencode.db')
    const db = new DatabaseSync(dbPath)
    db.exec(
      'CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, tokens_input INT, tokens_output INT, tokens_reasoning INT)',
    )
    db.prepare('INSERT INTO session VALUES (?,?,?,?,?)').run('s1', '/tmp/loops-w-0-TESTAA', 40000, 6000, 737)
    db.prepare('INSERT INTO session VALUES (?,?,?,?,?)').run('s2', '/somewhere/else', 999, 999, 0)
    db.close()

    const spend = await recoverSupSpend(supRunDir, { opencodeDb: dbPath })
    // Brain/driver spend is NOT re-parsed from journal metered events anymore:
    // the supervise runtime's spend tree reaches state.json on both result
    // arms (parseSupervisorArtifacts carries it). Worker recovery only here.
    expect(spend.workerTokJournal).toBe(42)
    expect(spend.workerCwds).toEqual(['/tmp/loops-w-0-TESTAA'])
    expect(spend.workerSessions).toBe(1)
    expect(spend.workerTokIn).toBe(40000)
    expect(spend.workerTokOut).toBe(6737)
    expect(spend.workerTokSqlite).toBe(46737) // flask-5014's real worker number, by construction
  })

  it('missing sqlite store = null (telemetry gap), never a silent zero', async () => {
    const dir = await scratch('swe-arena-spend-gap-')
    const supRunDir = join(dir, 'sup-1-y')
    await mkdir(join(supRunDir, 'workers'), { recursive: true })
    await writeFile(join(supRunDir, 'journal.jsonl'), '')
    await writeFile(join(supRunDir, 'workers', 'w-0.ndjson'), '{"kind":"started","cwd":"/tmp/loops-w-0-GONE"}')
    const spend = await recoverSupSpend(supRunDir, { opencodeDb: join(dir, 'no-such.db') })
    expect(spend.workerSessions).toBeNull()
    expect(spend.workerTokSqlite).toBeNull()
  })

  it('no workers spawned = hard zero (a real measurement, not a gap)', async () => {
    const dir = await scratch('swe-arena-spend-zero-')
    const supRunDir = join(dir, 'sup-1-z')
    await mkdir(supRunDir, { recursive: true })
    await writeFile(join(supRunDir, 'journal.jsonl'), '')
    const spend = await recoverSupSpend(supRunDir)
    expect(spend.workerSessions).toBe(0)
    expect(spend.workerTokSqlite).toBe(0)
  })
})

describe('arms: provenance + identity', () => {
  it('supervisor identity records the live loops commit + env knobs', async () => {
    // The bench repo itself stands in for the loops checkout — provenance only
    // needs a git HEAD to pin.
    const here = new URL('../..', import.meta.url).pathname
    const identity = await toArmIdentity({
      kind: 'supervisor',
      name: 'SUP4',
      workerModel: 'zai-coding-plan/glm-5.2',
      driverModel: 'glm-5.2',
      loopsRepo: here,
    })
    expect(identity.kind).toBe('supervisor')
    expect(identity.provenance.repo).toBe(here)
    expect(identity.provenance.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(identity.env).toEqual(SUP_DEFAULT_ENV_KNOBS)
    expect(identity.env.LOOPS_BRAIN_RETRIES).toBe('30')
    expect(identity.env.DRIVER_DEADLINE_MS).toBe('2600000')
  })

  it('honors a pre-aborted cell before reading the loops commit', async () => {
    const controller = new AbortController()
    const reason = new Error('cell deadline')
    controller.abort(reason)
    await expect(armProvenance('/unused', {}, controller.signal)).rejects.toBe(reason)
  })
})

describe('arms: failed process outcomes are never scored', () => {
  it('accepts only a zero-exit, non-cancelled solo process', () => {
    expect(() => assertSoloProcessCompleted({ code: 0, timedOut: false, aborted: false })).not.toThrow()
    expect(() => assertSoloProcessCompleted({ code: 124, timedOut: true, aborted: false })).toThrow(/timed out/)
    expect(() => assertSoloProcessCompleted({ code: 130, timedOut: false, aborted: true })).toThrow(/cancelled/)
    expect(() => assertSoloProcessCompleted({ code: 2, timedOut: false, aborted: false })).toThrow(/exited 2/)
  })

  it('requires both a successful driver and completed supervisor state', () => {
    expect(() => assertSupervisorProcessCompleted(
      { code: 0, timedOut: false, aborted: false },
      'completed',
    )).not.toThrow()
    expect(() => assertSupervisorProcessCompleted(
      { code: 124, timedOut: true, aborted: false },
      'running',
    )).toThrow(/timed out.*state running/)
    expect(() => assertSupervisorProcessCompleted(
      { code: 130, timedOut: false, aborted: true },
      'cancelled',
    )).toThrow(/cancelled.*state cancelled/)
    expect(() => assertSupervisorProcessCompleted(
      { code: 3, timedOut: false, aborted: false },
      'completed',
    )).toThrow(/exited 3.*state completed/)
    for (const status of [null, 'running', 'failed', 'cancelled']) {
      expect(() => assertSupervisorProcessCompleted(
        { code: 0, timedOut: false, aborted: false },
        status,
      )).toThrow(/expected completed/)
    }
  })

  it('gives outer termination more time than the driver cancellation deadline', () => {
    expect(supervisorDriverKillGraceMs({})).toBeGreaterThan(30_000)
    expect(supervisorDriverKillGraceMs({ DRIVER_CANCEL_TIMEOUT_MS: '45000' })).toBeGreaterThan(45_000)
    expect(() => supervisorDriverKillGraceMs({ DRIVER_CANCEL_TIMEOUT_MS: '0' })).toThrow(/positive number/)
  })
})

describe('serialized-judge', () => {
  const fakeCommand = (script: string) => (iid: string, patchPath: string) => ({
    bin: 'bash',
    argv: ['-c', script, 'judge', iid, patchPath],
    cwd: tmpdir(),
  })

  async function patchFile(content: string): Promise<string> {
    const dir = await scratch('swe-arena-judge-')
    const p = join(dir, 'x.patch')
    await writeFile(p, content)
    return p
  }

  async function waitForFile(path: string, timeoutMs = 3_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (await readFile(path, 'utf8').then(() => true, () => false)) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${path}`)
  }

  async function startExternalFlock(lockFile: string, readyFile: string) {
    const controller = new AbortController()
    const done = run(
      'flock',
      [
        '--exclusive',
        lockFile,
        'bash',
        '-c',
        'touch "$1"; trap "exit 0" TERM; sleep 30',
        'holder',
        readyFile,
      ],
      { timeoutMs: 10_000, signal: controller.signal },
    )
    await waitForFile(readyFile)
    return {
      stop: async () => {
        controller.abort(new Error('release external flock'))
        await done
      },
    }
  }

  it('enforces the 1800s ceiling floor on the real judge', () => {
    expect(() => createSerializedJudge({ timeoutMs: 700_000 })).toThrow(/floor/)
    expect(JUDGE_TIMEOUT_FLOOR_MS).toBe(1_800_000)
  })

  it('short-circuits empty patches without ever invoking the child', async () => {
    const dir = await scratch('swe-arena-judge-empty-')
    const marker = join(dir, 'invoked')
    const judge = createSerializedJudge({
      command: fakeCommand(`touch ${marker}; echo JUDGE_RESULT '{"iid":"x","resolved":true}'`),
      timeoutMs: 5_000,
      unsafeAllowShortTimeout: true,
      lockFile: join(dir, 'lock'),
    })
    const verdict = await judge.judge('pallets__flask-5014', await patchFile('   \n'))
    expect(verdict).toEqual({ iid: 'pallets__flask-5014', resolved: false, score: 0, note: 'empty-patch', attempts: 0 })
    await expect(readFile(marker, 'utf8')).rejects.toThrow()
  })

  it('rejects a missing patch instead of scoring it as empty', async () => {
    const dir = await scratch('swe-arena-judge-missing-')
    const marker = join(dir, 'invoked')
    const judge = createSerializedJudge({
      command: fakeCommand(`touch ${marker}; echo JUDGE_RESULT '{"iid":"x","resolved":true}'`),
      timeoutMs: 5_000,
      unsafeAllowShortTimeout: true,
      lockFile: join(dir, 'lock'),
    })

    await expect(judge.judge('pallets__flask-5014', join(dir, 'missing.patch'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    await expect(readFile(marker, 'utf8')).rejects.toThrow()
  })

  it('rejects an unreadable patch instead of scoring it as empty', async () => {
    const dir = await scratch('swe-arena-judge-unreadable-')
    const marker = join(dir, 'invoked')
    const patch = await patchFile('diff --git a/x b/x\n')
    const judge = createSerializedJudge({
      command: fakeCommand(`touch ${marker}; echo JUDGE_RESULT '{"iid":"x","resolved":true}'`),
      timeoutMs: 5_000,
      unsafeAllowShortTimeout: true,
      lockFile: join(dir, 'lock'),
    })
    await chmod(patch, 0)
    try {
      await expect(judge.judge('pallets__flask-5014', patch)).rejects.toMatchObject({ code: 'EACCES' })
    } finally {
      await chmod(patch, 0o600)
    }
    await expect(readFile(marker, 'utf8')).rejects.toThrow()
  })

  it('parses a JUDGE_RESULT line on the first attempt', async () => {
    const dir = await scratch('swe-arena-judge-ok-')
    const judge = createSerializedJudge({
      command: fakeCommand(
        `echo noise; echo 'JUDGE_RESULT {"iid":"i","resolved":true,"score":1,"secs":3,"patch_bytes":9}'`,
      ),
      timeoutMs: 5_000,
      unsafeAllowShortTimeout: true,
      lockFile: join(dir, 'lock'),
    })
    const verdict = await judge.judge('i', await patchFile('diff --git a/x b/x\n'))
    expect(verdict).toEqual({ iid: 'i', resolved: true, score: 1, secs: 3, patch_bytes: 9, attempts: 1 })
  })

  it('retries ONCE on unparseable output, then succeeds (observed judge flake)', async () => {
    const dir = await scratch('swe-arena-judge-retry-')
    const flag = join(dir, 'first-attempt-done')
    const judge = createSerializedJudge({
      command: fakeCommand(
        `if [ ! -f ${flag} ]; then touch ${flag}; echo garbled; else echo 'JUDGE_RESULT {"iid":"i","resolved":false,"score":0}'; fi`,
      ),
      timeoutMs: 5_000,
      unsafeAllowShortTimeout: true,
      lockFile: join(dir, 'lock'),
    })
    const verdict = await judge.judge('i', await patchFile('diff --git a/x b/x\n'))
    expect(verdict.resolved).toBe(false)
    expect(verdict.attempts).toBe(2)
  })

  it('two failures = resolved null (inconclusive), never a fabricated verdict', async () => {
    const dir = await scratch('swe-arena-judge-fail-')
    const judge = createSerializedJudge({
      command: fakeCommand('echo not-a-result'),
      timeoutMs: 5_000,
      unsafeAllowShortTimeout: true,
      lockFile: join(dir, 'lock'),
    })
    const verdict = await judge.judge('i', await patchFile('diff --git a/x b/x\n'))
    expect(verdict.resolved).toBeNull()
    expect(verdict.error).toBe('parse-or-timeout')
    expect(verdict.attempts).toBe(2)
  })

  it('a timed-out child is inconclusive, not resolved:false', async () => {
    const dir = await scratch('swe-arena-judge-timeout-')
    const judge = createSerializedJudge({
      command: fakeCommand('sleep 30'),
      timeoutMs: 300,
      unsafeAllowShortTimeout: true,
      lockFile: join(dir, 'lock'),
    })
    const verdict = await judge.judge('i', await patchFile('diff --git a/x b/x\n'))
    expect(verdict.resolved).toBeNull()
    expect(verdict.raw).toMatch(/timeout/)
  }, 15_000)

  it('rejects a success marker printed before the child times out', async () => {
    const dir = await scratch('swe-arena-judge-marker-timeout-')
    const judge = createSerializedJudge({
      command: fakeCommand(`echo 'JUDGE_RESULT {"iid":"i","resolved":true,"score":1}'; sleep 30`),
      timeoutMs: 100,
      unsafeAllowShortTimeout: true,
      lockFile: join(dir, 'lock'),
    })
    const verdict = await judge.judge('i', await patchFile('diff --git a/x b/x\n'))
    expect(verdict.resolved).toBeNull()
    expect(verdict.attempts).toBe(2)
    expect(verdict.raw).toMatch(/timeout/)
  }, 15_000)

  it('rejects a success marker from a child that exits nonzero', async () => {
    const dir = await scratch('swe-arena-judge-marker-nonzero-')
    const judge = createSerializedJudge({
      command: fakeCommand(`echo 'JUDGE_RESULT {"iid":"i","resolved":true,"score":1}'; exit 7`),
      timeoutMs: 5_000,
      unsafeAllowShortTimeout: true,
      lockFile: join(dir, 'lock'),
    })
    const verdict = await judge.judge('i', await patchFile('diff --git a/x b/x\n'))
    expect(verdict.resolved).toBeNull()
    expect(verdict.attempts).toBe(2)
    expect(verdict.raw).toMatch(/exit 7/)
  })

  it('serializes concurrent judges — the flock-race regression test', async () => {
    const dir = await scratch('swe-arena-judge-mutex-')
    const logPath = join(dir, 'order.log')
    const judge = createSerializedJudge({
      command: fakeCommand(
        `echo "start $$" >> ${logPath}; sleep 0.3; echo "end $$" >> ${logPath}; echo 'JUDGE_RESULT {"iid":"i","resolved":true}'`,
      ),
      timeoutMs: 5_000,
      unsafeAllowShortTimeout: true,
      lockFile: join(dir, 'lock'),
    })
    const p = await patchFile('diff --git a/x b/x\n')
    const [a, b] = await Promise.all([judge.judge('i', p), judge.judge('i', p)])
    expect(a.resolved).toBe(true)
    expect(b.resolved).toBe(true)
    const events = (await readFile(logPath, 'utf8')).trim().split('\n')
    // Strict alternation: start,end,start,end — overlap would interleave starts.
    expect(events).toHaveLength(4)
    expect(events[0]).toMatch(/^start /)
    expect(events[1]).toMatch(/^end /)
    expect(events[2]).toMatch(/^start /)
    expect(events[3]).toMatch(/^end /)
  }, 15_000)

  it('aborts an in-process waiter without abandoning or bypassing the live holder', async () => {
    const dir = await scratch('swe-arena-judge-chain-abort-')
    const lockFile = join(dir, 'lock')
    let releaseHolder!: () => void
    let announceHolder!: () => void
    const holderRelease = new Promise<void>((resolve) => {
      releaseHolder = resolve
    })
    const holderStarted = new Promise<void>((resolve) => {
      announceHolder = resolve
    })
    const holder = withJudgeLock(lockFile, async () => {
      announceHolder()
      await holderRelease
      return 'holder-finished'
    })
    await holderStarted

    let cancelledWaiterRan = false
    const controller = new AbortController()
    const waiter = withJudgeLock(
      lockFile,
      async () => {
        cancelledWaiterRan = true
      },
      { timeoutMs: 2_000, signal: controller.signal },
    )
    controller.abort(new Error('cancelled queued judge'))
    await expect(waiter).rejects.toThrow('cancelled queued judge')
    expect(cancelledWaiterRan).toBe(false)
    const blockedProbe = await run('flock', ['--exclusive', '--nonblock', lockFile, 'true'])
    expect(blockedProbe.code).toBe(1)

    let successorRan = false
    const successor = withJudgeLock(
      lockFile,
      async () => {
        successorRan = true
      },
      { timeoutMs: 2_000 },
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(successorRan).toBe(false)

    releaseHolder()
    await expect(holder).resolves.toBe('holder-finished')
    await expect(successor).resolves.toBeUndefined()
    expect(successorRan).toBe(true)
    const releasedProbe = await run('flock', ['--exclusive', '--nonblock', lockFile, 'true'])
    expect(releasedProbe.code).toBe(0)
  })

  it('bounds and cancels cross-process flock acquisition before the callback runs', async () => {
    const dir = await scratch('swe-arena-judge-flock-wait-')
    const timeoutLock = join(dir, 'timeout.lock')
    const timeoutHolder = await startExternalFlock(timeoutLock, join(dir, 'timeout-ready'))
    let timedOutCallbackRan = false
    await expect(
      withJudgeLock(
        timeoutLock,
        async () => {
          timedOutCallbackRan = true
        },
        { timeoutMs: 40 },
      ),
    ).rejects.toThrow('lock wait exceeded 40ms')
    expect(timedOutCallbackRan).toBe(false)
    await timeoutHolder.stop()

    // A waiter that observed the old holder cannot delete or bypass a newer
    // holder: kernel ownership follows the open fd, never the lock-file bytes.
    let releaseSuccessor!: () => void
    let announceSuccessor!: () => void
    const successorRelease = new Promise<void>((resolve) => {
      releaseSuccessor = resolve
    })
    const successorStarted = new Promise<void>((resolve) => {
      announceSuccessor = resolve
    })
    const successor = withJudgeLock(timeoutLock, async () => {
      announceSuccessor()
      await successorRelease
    }, { timeoutMs: 2_000 })
    await successorStarted
    const successorProbe = await run('flock', ['--exclusive', '--nonblock', timeoutLock, 'true'])
    expect(successorProbe.code).toBe(1)
    releaseSuccessor()
    await successor

    const abortLock = join(dir, 'abort.lock')
    const abortHolder = await startExternalFlock(abortLock, join(dir, 'abort-ready'))
    let abortedCallbackRan = false
    const controller = new AbortController()
    const waiter = withJudgeLock(
      abortLock,
      async () => {
        abortedCallbackRan = true
      },
      { timeoutMs: 2_000, signal: controller.signal },
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    controller.abort(new Error('cancelled flock wait'))
    await expect(waiter).rejects.toThrow('cancelled flock wait')
    expect(abortedCallbackRan).toBe(false)
    await abortHolder.stop()
  })

  it('ignores stale lock-file bytes because ownership is kernel-backed', async () => {
    const dir = await scratch('swe-arena-judge-flock-stale-bytes-')
    const lockFile = join(dir, 'lock')
    await writeFile(lockFile, 'half-written-or-dead-owner\n')
    await expect(withJudgeLock(lockFile, async () => 'acquired', { timeoutMs: 1_000 })).resolves.toBe('acquired')
    expect(await readFile(lockFile, 'utf8')).toBe('half-written-or-dead-owner\n')
  })

  it('cancels the active judge process and never starts its retry', async () => {
    const dir = await scratch('swe-arena-judge-active-abort-')
    const attempts = join(dir, 'attempts.log')
    const lockFile = join(dir, 'lock')
    const judge = createSerializedJudge({
      command: fakeCommand(`echo attempt >> ${attempts}; trap 'exit 0' TERM; sleep 30; echo garbled`),
      timeoutMs: 5_000,
      lockWaitTimeoutMs: 5_000,
      unsafeAllowShortTimeout: true,
      lockFile,
    })
    const controller = new AbortController()
    const result = judge.judge('i', await patchFile('diff --git a/x b/x\n'), 'abort-test', controller.signal)
    await waitForFile(attempts)
    controller.abort(new Error('cancelled active judge'))

    await expect(result).rejects.toThrow('cancelled active judge')
    expect((await readFile(attempts, 'utf8')).trim().split('\n')).toEqual(['attempt'])
    await expect(withJudgeLock(lockFile, async () => 'released', { timeoutMs: 1_000 })).resolves.toBe('released')
  }, 15_000)

  it('bounds stale-container cleanup before starting the judge child', async () => {
    const dir = await scratch('swe-arena-judge-clean-timeout-')
    const binDir = join(dir, 'bin')
    const docker = join(binDir, 'docker')
    const judgeStarted = join(dir, 'judge-started')
    await mkdir(binDir, { recursive: true })
    await writeFile(docker, '#!/usr/bin/env bash\nsleep 30\n')
    await chmod(docker, 0o755)
    const originalPath = process.env.PATH
    process.env.PATH = `${binDir}:${originalPath ?? ''}`
    try {
      const judge = createSerializedJudge({
        command: fakeCommand(`touch ${judgeStarted}; echo 'JUDGE_RESULT {"iid":"i","resolved":true}'`),
        timeoutMs: 5_000,
        preCleanTimeoutMs: 100,
        unsafeAllowShortTimeout: true,
        lockFile: join(dir, 'lock'),
      })
      const startedAt = Date.now()
      await expect(judge.judge('i', await patchFile('diff --git a/x b/x\n'))).rejects.toThrow(
        'docker ps pre-clean timed out after 100ms',
      )
      expect(Date.now() - startedAt).toBeLessThan(2_000)
      await expect(readFile(judgeStarted, 'utf8')).rejects.toThrow()
    } finally {
      if (originalPath === undefined) delete process.env.PATH
      else process.env.PATH = originalPath
    }
  }, 15_000)

  it('fails closed on nonzero stale-container cleanup before starting the judge child', async () => {
    const dir = await scratch('swe-arena-judge-clean-nonzero-')
    const binDir = join(dir, 'bin')
    const docker = join(binDir, 'docker')
    const judgeStarted = join(dir, 'judge-started')
    await mkdir(binDir, { recursive: true })
    await writeFile(docker, '#!/usr/bin/env bash\necho daemon-unavailable >&2\nexit 7\n')
    await chmod(docker, 0o755)
    const originalPath = process.env.PATH
    process.env.PATH = `${binDir}:${originalPath ?? ''}`
    try {
      const judge = createSerializedJudge({
        command: fakeCommand(`touch ${judgeStarted}; echo 'JUDGE_RESULT {"iid":"i","resolved":true}'`),
        timeoutMs: 5_000,
        preCleanTimeoutMs: 1_000,
        unsafeAllowShortTimeout: true,
        lockFile: join(dir, 'lock'),
      })
      await expect(judge.judge('i', await patchFile('diff --git a/x b/x\n'))).rejects.toThrow(
        'docker ps pre-clean exited 7: daemon-unavailable',
      )
      await expect(readFile(judgeStarted, 'utf8')).rejects.toThrow()
    } finally {
      if (originalPath === undefined) delete process.env.PATH
      else process.env.PATH = originalPath
    }
  })

  it('cancels stale-container cleanup without starting the judge child', async () => {
    const dir = await scratch('swe-arena-judge-clean-abort-')
    const binDir = join(dir, 'bin')
    const docker = join(binDir, 'docker')
    const cleanStarted = join(dir, 'clean-started')
    const judgeStarted = join(dir, 'judge-started')
    await mkdir(binDir, { recursive: true })
    await writeFile(docker, `#!/usr/bin/env bash\ntouch ${cleanStarted}\ntrap 'exit 0' TERM\nsleep 30\n`)
    await chmod(docker, 0o755)
    const originalPath = process.env.PATH
    process.env.PATH = `${binDir}:${originalPath ?? ''}`
    try {
      const judge = createSerializedJudge({
        command: fakeCommand(`touch ${judgeStarted}; echo 'JUDGE_RESULT {"iid":"i","resolved":true}'`),
        timeoutMs: 5_000,
        preCleanTimeoutMs: 5_000,
        unsafeAllowShortTimeout: true,
        lockFile: join(dir, 'lock'),
      })
      const controller = new AbortController()
      const result = judge.judge('i', await patchFile('diff --git a/x b/x\n'), 'clean-abort', controller.signal)
      await waitForFile(cleanStarted)
      controller.abort(new Error('cancelled pre-clean'))
      await expect(result).rejects.toThrow('cancelled pre-clean')
      await expect(readFile(judgeStarted, 'utf8')).rejects.toThrow()
    } finally {
      if (originalPath === undefined) delete process.env.PATH
      else process.env.PATH = originalPath
    }
  }, 15_000)

  it('instanceShortName mirrors judge.sh (strip through __)', () => {
    expect(instanceShortName('psf__requests-1766')).toBe('requests-1766')
    expect(instanceShortName('pallets__flask-5014')).toBe('flask-5014')
  })
})

describe('capacity gate', () => {
  const scripted = (outcomes: boolean[]) => {
    let i = 0
    return async () => outcomes[Math.min(i++, outcomes.length - 1)]
  }

  it('probeWindow counts k of n (probe-capacity.sh: 3/4)', async () => {
    const gate = {
      name: 't',
      probe: scripted([true, false, true, true]),
      kOfN: { k: 3, n: 4 },
      waitCeilingMs: 1000,
      probeIntervalMs: 0,
    }
    expect(await probeWindow(gate)).toEqual({ ok: 3, passed: true })
  })

  it('waitForCapacity demands steadyM consecutive passing windows', async () => {
    // Window outcomes: pass, fail, pass, pass → steadyM=2 opens on window 4.
    const perWindow = [true, false, true, true]
    let w = 0
    const gate = {
      name: 't',
      probe: async () => perWindow[Math.min(w++, perWindow.length - 1)],
      kOfN: { k: 1, n: 1 },
      steadyM: 2,
      waitCeilingMs: 10_000,
      probeIntervalMs: 0,
      retryDelayMs: 1,
    }
    expect(await waitForCapacity(gate)).toBe(true)
    expect(w).toBe(4)
  })

  it('gives up (false) at the wait ceiling instead of blocking forever', async () => {
    const gate = {
      name: 't',
      probe: async () => false,
      kOfN: { k: 1, n: 1 },
      waitCeilingMs: 30,
      probeIntervalMs: 0,
      retryDelayMs: 5,
    }
    expect(await waitForCapacity(gate)).toBe(false)
  })

  it('probe body defaults to max_tokens 8000 (glm-5.2 starves below it)', () => {
    expect(JSON.parse(probeBody('glm-5.2', 8000))).toEqual({
      model: 'glm-5.2',
      messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
      max_tokens: 8000,
      temperature: 0,
    })
  })

  it('supervisor arms gate on BOTH worker and router paths; solo on worker only', () => {
    const secrets = { secretsDir: '/dev/null', envFiles: ['agent-state.env'] }
    expect(gatesForArmKind('solo', secrets).map((g) => g.name)).toEqual(['z.ai-coding'])
    expect(gatesForArmKind('supervisor', secrets).map((g) => g.name)).toEqual(['z.ai-coding', 'router'])
  })

  it('rejects a non-env-shaped key name (no value smuggling)', () => {
    const secrets = { secretsDir: '/dev/null', envFiles: [] }
    expect(() =>
      httpCapacityProbe({ url: 'https://x', apiKeyEnv: 'k; cat /etc/passwd', model: 'm', secrets }),
    ).toThrow(/apiKeyEnv/)
  })
})

describe('run-experiment: ledger assembly + resume', () => {
  const solo: SoloArmResult = {
    arm: 'SOLO',
    iid: 'pallets__flask-5014',
    oc_rc: 0,
    wall_s: 116,
    patch_lines: 35,
    verify_rc: 0,
    verify_pass: true,
    usage: { steps: 1, in: 30000, out: 738, reasoning: 0, cache_w: 0, cache_r: 0, max_ctx: 30738, oc_cost: 0, total_io: 30738 },
    patchPath: '/tmp/p.solo.patch',
    ws: '/tmp/ws',
  }
  const sup: SupervisorArmResult = {
    arm: 'SUP4',
    iid: 'pallets__flask-5014',
    driver_rc: 0,
    wall_s: 261,
    patch_lines: 12,
    verify_rc: 0,
    verify_pass: true,
    sup_status: 'completed',
    sup_verdict: 'delivered',
    delivered: true,
    spentTokens: 15731,
    spentUsd: 0.0124,
    spawned: 2,
    workers: 1,
    settled: 2,
    subtasks: ['fix it'],
    patchPath: '/tmp/p.sup.patch',
    ws: '/tmp/ws2',
    provenance: { repo: '/home/drew/code/loops', commit: 'deadbeef', envKnobs: {} },
    recoveredSpend: null,
  }
  const yes: JudgeVerdict = { iid: 'pallets__flask-5014', resolved: true, score: 1 }
  const no: JudgeVerdict = { iid: 'pallets__flask-5014', resolved: false, score: 0 }

  it('produces exactly the M1 LedgerRow field set (schema compatibility)', () => {
    const row = buildLedgerRow(solo, yes, sup, no)
    const fixtureKeys = Object.keys(
      JSON.parse(readFixture('ledger.jsonl').split('\n').filter(Boolean)[1]) as object, // row 1 has sup_workers
    ).filter((k) => k !== '_note')
    expect(new Set(Object.keys(row))).toEqual(new Set(fixtureKeys))
    expect(row.solo_resolved).toBe(true)
    expect(row.sup_resolved).toBe(false)
    expect(row.solo_tokens).toBe(30738)
    expect(row.sup_workers).toBe(1)
  })

  it('refuses to write an inconclusive verdict into a boolean column', () => {
    const inconclusive: JudgeVerdict = { iid: 'pallets__flask-5014', resolved: null, error: 'parse-or-timeout' }
    expect(() => buildLedgerRow(solo, inconclusive, sup, no)).toThrow(/inconclusive/)
  })

  it('refuses an unknown sup verdict/status instead of silently typing it', () => {
    expect(() => buildLedgerRow(solo, yes, { ...sup, sup_verdict: 'triumph' }, no)).toThrow(/sup_verdict/)
    expect(() => buildLedgerRow(solo, yes, { ...sup, sup_status: 'exploded' }, no)).toThrow(/sup_status/)
  })

  it('ledgerIids resumes on existing rows and fails loud on corrupt ones', async () => {
    const dir = await scratch('swe-arena-ledger-')
    const ledger = join(dir, 'ledger.jsonl')
    await writeFile(ledger, '{"iid":"a"}\n{"iid":"b"}\n')
    expect(await ledgerIids(ledger)).toEqual(new Set(['a', 'b']))
    expect(await ledgerIids(join(dir, 'missing.jsonl'))).toEqual(new Set())
    await writeFile(ledger, '{"iid":"a"}\n{broken\n')
    await expect(ledgerIids(ledger)).rejects.toThrow(/corrupt ledger line/)
  })

  it('diffChangedFiles reads the b/ side of the committed parity patches', () => {
    expect(diffChangedFiles(readFixture('patches/pallets__flask-5014.solo.patch'))).toEqual([
      'CHANGES.rst',
      'src/flask/blueprints.py',
    ])
    expect(diffChangedFiles(readFixture('patches/pydata__xarray-4687.sup.patch'))).toEqual([
      'xarray/core/computation.py',
    ])
  })
})
