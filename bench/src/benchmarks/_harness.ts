/**
 * Shared code-bench harness. The "stage the artifact → run the benchmark's own
 * evaluator in an external process (mkdtemp / execFile / .venv python / Docker)
 * → read its JSON report → { resolved, score }" spine that swe-bench,
 * terminal-bench, commit0, programbench and aec-bench all need. Factored out so
 * the Docker/venv/report-reading logic lives in ONE place instead of being
 * copy-pasted per adapter.
 *
 * It owns NO benchmark policy: each adapter passes the argv for its evaluator
 * and a `parseReport` that maps that evaluator's report JSON → a BenchScore. The
 * harness owns process spawning, temp-dir lifecycle, large-buffer/timeout config
 * and fail-loud diagnostics.
 *
 * Fail-loud: an absent .venv / harness / Docker daemon THROWS from `preflight`
 * (the adapter passes the import line + the exact fix). A staged run that exits
 * nonzero throws with the captured stderr — never a fabricated score.
 */

import { execFile, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { BenchScore } from './types'

const execFileAsync = promisify(execFile)

/** Repo root for the bench package (…/bench), so `.venv` and `fixtures` resolve. */
export const benchRoot = fileURLToPath(new URL('../..', import.meta.url))

/** Resolve the shared interpreter without requiring an installed package to contain a venv. */
export function resolveBenchPython(
  env: Readonly<{ AGENT_BENCH_PYTHON?: string }> = process.env,
  root: string = benchRoot,
): string {
  const configured = env.AGENT_BENCH_PYTHON
  if (configured === undefined) return join(root, '.venv', 'bin', 'python')
  if (!isAbsolute(configured)) {
    throw new Error('AGENT_BENCH_PYTHON must be an absolute path')
  }
  return configured
}

/** The shared interpreter every Python-backed evaluator runs through. */
export const venvPython = resolveBenchPython()

/** Interpreter for a NAMED isolated venv (e.g. `.venv-commit0`). Benches whose pip
 *  deps conflict with the shared `.venv` (commit0 downgrades pydantic/sqlalchemy)
 *  get their own venv and pass its python explicitly — keeping the shared one clean. */
export const venvPythonAt = (venvDir: string): string => join(benchRoot, venvDir, 'bin', 'python')
/** Report/transcript reads are large; 256 MiB matches the SWE harness budget. */
export const bigBuffer = 1024 * 1024 * 256

/** Path to a named executable inside the bench venv (e.g. `venvBin('tb')`). */
export function venvBin(name: string): string {
  return join(benchRoot, '.venv', 'bin', name)
}

/**
 * Run the bench venv python with an inline script (`-c`); return stdout. Throws
 * (with stderr) on a nonzero exit — the loaders rely on this to fail loud rather
 * than parse a partial dump.
 */
export async function runVenvPython(
  script: string,
  args: string[] = [],
  timeoutMs = 0,
  python: string = venvPython,
): Promise<string> {
  const { stdout } = await execFileAsync(python, ['-c', script, ...args], {
    maxBuffer: bigBuffer,
    timeout: timeoutMs,
  })
  return stdout
}

/**
 * Preflight a python-backed harness: import the module(s) and (optionally) ping
 * Docker, all inside the bench venv. On failure THROWS the captured error joined
 * to the adapter's `fix` guidance — the contract every code-bench preflight wants.
 */
export async function preflightVenvImports(opts: {
  /** Module names to `import` (e.g. ['swebench']); '' entries are ignored. */
  modules: string[]
  /** Also `docker.from_env().ping()` — true for Docker-backed evaluators. */
  requireDocker?: boolean
  /** Actionable remediation appended to the thrown message. */
  fix: string
  /** Override the interpreter (e.g. an isolated `.venv-commit0`). Default: shared `.venv`. */
  python?: string
}): Promise<void> {
  const imports = opts.modules.filter((m) => m.length > 0)
  const lines = [...imports.map((m) => `import ${m}`)]
  if (opts.requireDocker) lines.push('import docker', 'docker.from_env().ping()')
  lines.push("print('ok')")
  try {
    await runVenvPython(lines.join('\n'), [], 0, opts.python ?? venvPython)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`${msg}\n${opts.fix}`)
  }
}

/**
 * Run a bench-local python driver script (in the bench venv) while piping
 * `input` to its stdin, returning stdout. The driver's verdict JSON is its LAST
 * stdout line; callers parse that and inspect an `error` field (fail loud).
 *
 * Uses spawn + an explicit `stdin.end(input)` rather than promisify(execFile)'s
 * `input` option, because that option is NOT honored by async execFile — stdin
 * is left open and a driver that does `sys.stdin.read()` blocks forever. The
 * artifact-piping judges (commit0, appworld) MUST go through this.
 */
export function runVenvScriptStdin(
  scriptPath: string,
  args: string[],
  input: string,
  opts: { cwd?: string; timeoutMs?: number; python?: string } = {},
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(opts.python ?? venvPython, [scriptPath, ...args], {
      cwd: opts.cwd ?? benchRoot,
      ...(opts.timeoutMs ? { timeout: opts.timeoutMs } : {}),
    })
    let stdout = ''
    let stderr = ''
    let bytes = 0
    child.stdout.on('data', (c: Buffer) => {
      bytes += c.length
      if (bytes <= bigBuffer) stdout += c.toString('utf8')
    })
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString('utf8')
    })
    child.on('error', (err) => reject(err))
    child.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error((stderr || stdout || `exit ${code}`).slice(0, 1500)))
    })
    child.stdin.end(input)
  })
}

export interface StagedRunSpec {
  /** mkdtemp prefix, e.g. 'swebench-' / 'commit0-'. */
  tmpPrefix: string
  /**
   * Write the artifact + any harness inputs into the temp dir. Returns nothing;
   * `argv`/`cwd` consume `dir` to point the evaluator at what was written.
   */
  stage(dir: string): Promise<void>
  /** The external evaluator to spawn. `bin` defaults to the bench venv python. */
  bin?: string
  /** argv for the evaluator, computed from the temp `dir`. */
  argv(dir: string): string[]
  /** Working directory for the evaluator. Defaults to the temp `dir`. */
  cwd?(dir: string): string
  /** Hard timeout for the evaluator (ms); 0 = none. */
  timeoutMs?: number
  /**
   * Read the evaluator's report(s) out of `dir` and map to a BenchScore. Throws
   * if the expected report is absent/malformed (fail loud — no default score).
   */
  parseReport(dir: string): Promise<BenchScore>
  /** Keep the temp dir on disk (debugging). Default false → always cleaned up. */
  keepTmp?: boolean
}

/**
 * The shared judge body: mkdtemp → stage → spawn evaluator → parseReport →
 * cleanup. The evaluator's stdout/stderr is surfaced on failure; the temp dir is
 * always removed in `finally` unless `keepTmp`.
 */
export async function runStagedJudge(spec: StagedRunSpec): Promise<BenchScore> {
  const dir = await mkdtemp(join(tmpdir(), spec.tmpPrefix))
  try {
    await spec.stage(dir)
    const bin = spec.bin ?? venvPython
    try {
      await execFileAsync(bin, spec.argv(dir), {
        cwd: spec.cwd ? spec.cwd(dir) : dir,
        maxBuffer: bigBuffer,
        ...(spec.timeoutMs ? { timeout: spec.timeoutMs } : {}),
      })
    } catch (err) {
      const e = err as { stderr?: string; stdout?: string; message?: string }
      const detail = (e.stderr || e.stdout || e.message || String(err)).slice(0, 2000)
      throw new Error(`${spec.tmpPrefix.replace(/-$/, '')} evaluator failed (${bin} ${spec.argv(dir).join(' ')}):\n${detail}`)
    }
    return await spec.parseReport(dir)
  } finally {
    if (!spec.keepTmp) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Read + JSON.parse a report file from a staged run; throws with the path on failure. */
export async function readJsonReport<T>(path: string): Promise<T> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (err) {
    throw new Error(`expected report not written: ${path} (${err instanceof Error ? err.message : err})`)
  }
  try {
    return JSON.parse(raw) as T
  } catch (err) {
    throw new Error(`report not valid JSON at ${path}: ${err instanceof Error ? err.message : err}`)
  }
}

/** Write a UTF-8 file into a staged dir (artifact / preds.json / attempt.sh / …). */
export async function stageFile(path: string, content: string): Promise<void> {
  await writeFile(path, content)
}

/** Sanitize an instance id into a filesystem/run-id-safe token. */
export function safeRunId(prefix: string, id: string): string {
  return `${prefix}-${id}`.replace(/[^a-zA-Z0-9_.-]/g, '_')
}
