/**
 * Factory judge child — the factory-bench equivalent of `judge-child.mts`.
 * One candidate patch, one hidden-test verdict, printed as a single
 * `JUDGE_RESULT {...}` line so serialized-judge.ts (queue, retry, SIGKILL
 * ceiling) carries over unchanged. No docker, no Python venv: the judge
 * workspace is a `git archive` export of the instance's base commit from the
 * local mirror, with the PR's own added test files overlaid from the merge
 * commit — the tests the builder never saw.
 *
 * Steps: export base tree → apply candidate patch → overlay judge tests from
 * `judge_ref` → run `setup_cmds` (shared pnpm store) → run `judge_cmds` →
 * parse vitest's pass/fail counts → JUDGE_RESULT with partial credit.
 *
 * Verdict semantics:
 *  - `resolved` = every calibrated judge test passes (passed === total, 0 failed).
 *  - `score` = passed / judgeTestTotal, where the denominator is the CALIBRATED
 *    total from the manifest's resolved_criterion — never vitest's reported
 *    total, which shrinks when a judge file fails to collect.
 *  - An unappliable patch is the candidate's failure → resolved:false, score 0.
 *  - A setup/parse failure is an INFRA failure → exit 1 with no JUDGE_RESULT
 *    line, so serialized-judge retries and then records `resolved: null`
 *    (inconclusive), never a fabricated verdict.
 *
 * usage: node --import tsx src/swe-arena/factory-judge-child.mts <instanceDir> <patchPath>
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { applyPatchWithFallback } from './calibrate.ts'
import { loadFactoryInstance, type LoadedFactoryInstance } from './fixtures.ts'
import { run, runOk, shq } from './proc.ts'

/** Warm installs across judge/calibration runs (design: `--config.store-dir`). */
export const SHARED_PNPM_STORE = join(tmpdir(), 'factory-bench-pnpm-store')
/** Corepack downloads public package-manager binaries here, never under operator HOME. */
export const SHARED_COREPACK_HOME = join(tmpdir(), 'factory-bench-corepack')

export interface VitestSummary {
  passed: number
  failed: number
  /** vitest's own reported total (collected tests only — informational). */
  reportedTotal: number
}

const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, '')

/**
 * Parse the `Tests  …` summary line of a vitest run (v3 and v4 formats):
 *   "      Tests  30 passed (30)"
 *   "      Tests  17 failed | 13 passed (30)"
 *   "      Tests  no tests"        (collection failure — 0 passed is a verdict)
 * Returns undefined when no summary line exists (infra failure, not a verdict).
 */
export function parseVitestSummary(output: string): VitestSummary | undefined {
  for (const rawLine of stripAnsi(output).split('\n')) {
    const m = /^\s*Tests\s{2,}(.+)$/.exec(rawLine)
    if (!m) continue
    const body = m[1].trim()
    if (body.startsWith('no tests')) return { passed: 0, failed: 0, reportedTotal: 0 }
    const passed = /(\d+) passed/.exec(body)
    const failed = /(\d+) failed/.exec(body)
    const total = /\((\d+)\)/.exec(body)
    if (!passed && !failed) continue
    return {
      passed: passed ? Number(passed[1]) : 0,
      failed: failed ? Number(failed[1]) : 0,
      reportedTotal: total ? Number(total[1]) : 0,
    }
  }
  return undefined
}

/** The JUDGE_RESULT row this child prints (superset of the SWE child's fields). */
export interface FactoryJudgeResult {
  iid: string
  resolved: boolean
  /** passed / judgeTestTotal — partial credit for the staircase. */
  score: number
  passed: number
  total: number
  secs: number
  patch_bytes: number
  error?: string
}

/** Parse one JUDGE_RESULT line back out of child stdout (calibrate + tests). */
export function parseFactoryJudgeResult(stdout: string): FactoryJudgeResult | undefined {
  const line = stdout.split('\n').find((l) => l.includes('JUDGE_RESULT'))
  if (!line) return undefined
  try {
    const parsed = JSON.parse(line.slice(line.indexOf('JUDGE_RESULT') + 'JUDGE_RESULT'.length).trim())
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.resolved !== 'boolean') return undefined
    return parsed as FactoryJudgeResult
  } catch {
    return undefined
  }
}

/** `git archive <ref> | tar -x` — a bare tree, no .git, no refs, no future history. */
export async function exportBaseTree(mirror: string, ref: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true })
  await runOk('bash', ['-c', `git -C ${shq(mirror)} archive ${shq(ref)} | tar -x -C ${shq(dest)}`])
}

/** Overlay each judge test from the merge commit (`git show <judge_ref>:<path>`). */
export async function overlayJudgeTests(inst: LoadedFactoryInstance, ws: string): Promise<void> {
  for (const testPath of inst.judge_tests) {
    const show = await runOk('git', ['-C', inst.repo_local_mirror, 'show', `${inst.judge_ref}:${testPath}`])
    await mkdir(dirname(join(ws, testPath)), { recursive: true })
    await writeFile(join(ws, testPath), show.stdout)
  }
}

export interface FactoryCommandEnvironment {
  env: NodeJS.ProcessEnv
  rootDir: string
  dispose: () => Promise<void>
}

/**
 * Build a disposable environment for candidate-controlled setup and judge commands.
 * Only PATH crosses from the operator process. Credentials, auth sockets, package
 * manager settings, and user config cannot enter through an unrecognized env name.
 */
export async function prepareJudgeCmdEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
): Promise<FactoryCommandEnvironment> {
  const path = (baseEnv.PATH ?? '')
    .split(delimiter)
    .filter((entry) => entry.length > 0 && isAbsolute(entry))
    .join(delimiter)
  if (!path) throw new Error('factory command environment requires PATH')

  const rootDir = await mkdtemp(join(tmpdir(), 'factory-command-env-'))
  const home = join(rootDir, 'home')
  const xdgConfig = join(rootDir, 'xdg', 'config')
  const xdgData = join(rootDir, 'xdg', 'data')
  const xdgCache = join(rootDir, 'xdg', 'cache')
  const xdgState = join(rootDir, 'xdg', 'state')
  const xdgRuntime = join(rootDir, 'xdg', 'runtime')
  const temp = join(rootDir, 'tmp')
  const npmUserConfig = join(rootDir, 'npm', 'user.npmrc')
  const npmGlobalConfig = join(rootDir, 'npm', 'global.npmrc')
  const gitGlobalConfig = join(rootDir, 'git', 'global.config')
  const gitSystemConfig = join(rootDir, 'git', 'system.config')

  try {
    await Promise.all(
      [
        home,
        xdgConfig,
        xdgData,
        xdgCache,
        xdgState,
        xdgRuntime,
        temp,
        dirname(npmUserConfig),
        dirname(gitGlobalConfig),
      ].map((dir) => mkdir(dir, { recursive: true, mode: 0o700 })),
    )
    await Promise.all(
      [npmUserConfig, npmGlobalConfig, gitGlobalConfig, gitSystemConfig].map((file) =>
        writeFile(file, '', { mode: 0o600 }),
      ),
    )

    let disposal: Promise<void> | undefined
    return {
      rootDir,
      env: {
        PATH: path,
        HOME: home,
        XDG_CONFIG_HOME: xdgConfig,
        XDG_DATA_HOME: xdgData,
        XDG_CACHE_HOME: xdgCache,
        XDG_STATE_HOME: xdgState,
        XDG_RUNTIME_DIR: xdgRuntime,
        TMPDIR: temp,
        TMP: temp,
        TEMP: temp,
        LANG: 'C',
        LC_ALL: 'C',
        TZ: 'UTC',
        // Keep pnpm out of frozen-lockfile mode because a candidate may edit package.json.
        CI: 'false',
        npm_config_store_dir: SHARED_PNPM_STORE,
        COREPACK_HOME: SHARED_COREPACK_HOME,
        COREPACK_DEFAULT_TO_LATEST: '0',
        COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
        NPM_CONFIG_USERCONFIG: npmUserConfig,
        NPM_CONFIG_GLOBALCONFIG: npmGlobalConfig,
        NPM_CONFIG_CACHE: join(xdgCache, 'npm'),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: gitGlobalConfig,
        GIT_CONFIG_SYSTEM: gitSystemConfig,
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'Never',
      },
      dispose: () => (disposal ??= rm(rootDir, { recursive: true, force: true })),
    }
  } catch (error) {
    await rm(rootDir, { recursive: true, force: true })
    throw error
  }
}

export interface FactoryJudgeOutcome {
  result: FactoryJudgeResult
  /** Raw judge_cmds output, for post-mortem. */
  output: string
}

/**
 * Build the judge workspace and run the judge over one patch. Throws on infra
 * failure (export/overlay/setup/parse); returns a verdict otherwise.
 */
export async function judgeFactoryPatch(
  inst: LoadedFactoryInstance,
  patch: string,
  opts: { workDir?: string; keepWorkspace?: boolean } = {},
): Promise<FactoryJudgeOutcome> {
  const t0 = Date.now()
  const ws = opts.workDir ?? (await mkdtemp(join(tmpdir(), `factory-judge-${inst.id.replace(/[^a-zA-Z0-9.-]/g, '-')}-`)))
  const cmdTimeoutMs = inst.timeout_s * 1000
  let commandEnvironment: FactoryCommandEnvironment | undefined
  try {
    await exportBaseTree(inst.repo_local_mirror, inst.base_commit, ws)
    // A git repo (fresh, historyless) so `git apply` and repo tooling behave;
    // judge-side only, so its refs are irrelevant to leak prevention.
    await runOk('git', ['-C', ws, 'init', '-q'])

    if (patch.trim().length > 0) {
      const patchFile = join(ws, '.factory-candidate.patch')
      await writeFile(patchFile, patch)
      const applyRc = await applyPatchWithFallback(ws, patchFile)
      await rm(patchFile, { force: true })
      if (applyRc !== 0) {
        return {
          result: {
            iid: inst.id,
            resolved: false,
            score: 0,
            passed: 0,
            total: inst.judgeTestTotal,
            secs: Math.round((Date.now() - t0) / 1000),
            patch_bytes: patch.length,
            error: `apply-failed rc=${applyRc}`,
          },
          output: '',
        }
      }
    }

    await overlayJudgeTests(inst, ws)

    commandEnvironment = await prepareJudgeCmdEnv()
    const env = commandEnvironment.env
    for (const cmd of inst.setup_cmds) {
      const res = await run('bash', ['-c', cmd], { cwd: ws, timeoutMs: cmdTimeoutMs, env })
      if (res.code !== 0) {
        throw new Error(
          `setup_cmd failed (rc=${res.code}${res.timedOut ? ', timeout' : ''}): ${cmd}\n${(res.stderr || res.stdout).slice(-2000)}`,
        )
      }
    }

    let passed = 0
    let failed = 0
    let output = ''
    for (const cmd of inst.judge_cmds) {
      const res = await run('bash', ['-c', cmd], { cwd: ws, timeoutMs: cmdTimeoutMs, env })
      const combined = res.stdout + res.stderr
      output += combined
      if (res.timedOut) throw new Error(`judge_cmd timed out after ${cmdTimeoutMs}ms: ${cmd}`)
      const summary = parseVitestSummary(combined)
      if (!summary) {
        throw new Error(`judge_cmd produced no parseable test summary (rc=${res.code}): ${cmd}\n${combined.slice(-2000)}`)
      }
      passed += summary.passed
      failed += summary.failed
    }

    const total = inst.judgeTestTotal
    return {
      result: {
        iid: inst.id,
        resolved: failed === 0 && passed === total,
        score: total > 0 ? Number((passed / total).toFixed(4)) : 0,
        passed,
        total,
        secs: Math.round((Date.now() - t0) / 1000),
        patch_bytes: patch.length,
      },
      output,
    }
  } finally {
    await Promise.all([
      commandEnvironment?.dispose() ?? Promise.resolve(),
      opts.keepWorkspace ? Promise.resolve() : rm(ws, { recursive: true, force: true }),
    ])
  }
}

// ---------------------------------------------------------------------------
// CLI (guarded so calibrate/tests can import the helpers above).
// ---------------------------------------------------------------------------

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const [, , instanceDir, patchPath] = process.argv
  if (!instanceDir || !patchPath) {
    console.error('usage: node --import tsx factory-judge-child.mts <instanceDir> <patchPath>')
    process.exit(2)
  }
  const inst = loadFactoryInstance(instanceDir)
  const patch = await readFile(patchPath, 'utf8')
  const { result } = await judgeFactoryPatch(inst, patch)
  console.log('JUDGE_RESULT ' + JSON.stringify(result))
}
