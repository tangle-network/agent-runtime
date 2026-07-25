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
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type {
  BenchScore,
  JudgeArtifactFileReceipt,
  JudgeArtifactReceipt,
} from './types'

const execFileAsync = promisify(execFile)

/** Locate the package by identity because source files and compiled chunks have different depths. */
function resolveBenchRoot(moduleUrl: string): string {
  let current = dirname(fileURLToPath(moduleUrl))
  while (true) {
    const manifestPath = join(current, 'package.json')
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown }
      if (manifest.name === '@tangle-network/agent-bench') return current
    }
    const parent = dirname(current)
    if (parent === current) {
      throw new Error(`Unable to locate @tangle-network/agent-bench from ${moduleUrl}`)
    }
    current = parent
  }
}

/** Package root for agent-bench, so `.venv`, scripts, and fixtures resolve. */
export const benchRoot = resolveBenchRoot(import.meta.url)

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
export const venvPythonAt = (venvDir: string): string => venvBinAt(venvDir, 'python')

/** Resolve an executable in an isolated venv. Relative venv paths are package-owned;
 * absolute paths allow installed consumers to keep large environments elsewhere. */
export function venvBinAt(venvDir: string, name: string): string {
  return join(resolve(benchRoot, venvDir), 'bin', name)
}

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
  /**
   * Copy the complete evaluator directory plus raw process stdout/stderr to this
   * caller-owned directory before cleanup. The destination must not exist.
   */
  capture?: StagedRunCaptureSpec
  /** Keep the temp dir on disk (debugging). Default false → always cleaned up. */
  keepTmp?: boolean
}

export interface StagedRunCaptureSpec {
  /** Destination for `evaluator/`, `process/`, and the hashed `receipt.json`. */
  destination: string
}

/** A staged run failed after any requested evidence was durably retained. */
export class StagedJudgeError extends Error {
  readonly judgeArtifacts?: JudgeArtifactReceipt

  constructor(message: string, judgeArtifacts?: JudgeArtifactReceipt, options?: ErrorOptions) {
    super(message, options)
    this.name = 'StagedJudgeError'
    this.judgeArtifacts = judgeArtifacts
  }
}

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function portablePath(path: string): string {
  return path.split(sep).join('/')
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

async function collectArtifactFiles(
  root: string,
  current: string,
): Promise<JudgeArtifactFileReceipt[]> {
  const absolute = join(root, current)
  const entries = await readdir(absolute, { withFileTypes: true })
  const files: JudgeArtifactFileReceipt[] = []
  for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
    const relativePath = join(current, entry.name)
    const path = join(root, relativePath)
    if (entry.isDirectory()) {
      files.push(...await collectArtifactFiles(root, relativePath))
      continue
    }
    if (entry.isFile()) {
      const bytes = await readFile(path)
      files.push({
        path: portablePath(relativePath),
        byteLength: bytes.byteLength,
        sha256: sha256(bytes),
        kind: 'file',
      })
      continue
    }
    if (entry.isSymbolicLink()) {
      const targetBytes = await readlink(path, { encoding: 'buffer' })
      files.push({
        path: portablePath(relativePath),
        byteLength: targetBytes.byteLength,
        sha256: sha256(targetBytes),
        kind: 'symlink',
      })
      continue
    }
    throw new Error(`staged judge capture does not support ${relativePath}`)
  }
  return files
}

function isWithin(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

async function assertDestinationAbsent(destination: string): Promise<void> {
  try {
    await lstat(destination)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  throw new Error(`staged judge capture destination already exists: ${destination}`)
}

async function captureStagedRun(
  sourceDirectory: string,
  spec: StagedRunCaptureSpec,
  processOutput: Readonly<{ stdout: Buffer; stderr: Buffer }>,
  evaluatorSucceeded: boolean,
): Promise<JudgeArtifactReceipt> {
  const source = resolve(sourceDirectory)
  const destination = resolve(spec.destination)
  if (isWithin(source, destination)) {
    throw new Error('staged judge capture destination must be outside the evaluator directory')
  }
  await mkdir(dirname(destination), { recursive: true })
  await assertDestinationAbsent(destination)
  const staging = await mkdtemp(join(dirname(destination), `.${basename(destination)}-capture-`))
  try {
    await cp(source, join(staging, 'evaluator'), {
      recursive: true,
      errorOnExist: true,
      force: false,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    })
    await mkdir(join(staging, 'process'))
    await writeFile(join(staging, 'process', 'stdout.bin'), processOutput.stdout)
    await writeFile(join(staging, 'process', 'stderr.bin'), processOutput.stderr)

    const files = [
      ...await collectArtifactFiles(staging, 'evaluator'),
      ...await collectArtifactFiles(staging, 'process'),
    ].sort((left, right) => compareText(left.path, right.path))
    const byteLength = files.reduce((total, file) => total + file.byteLength, 0)
    const treeBytes = Buffer.from(
      files
        .map((file) => `${file.path}\0${file.kind}\0${file.byteLength}\0${file.sha256}\n`)
        .join(''),
      'utf8',
    )
    const receipt: JudgeArtifactReceipt = {
      schema: 'agent-bench/judge-artifacts/v1',
      directory: destination,
      evaluatorDirectory: join(destination, 'evaluator'),
      manifestPath: join(destination, 'receipt.json'),
      evaluatorSucceeded,
      files,
      fileCount: files.length,
      byteLength,
      treeSha256: sha256(treeBytes),
    }
    await writeFile(join(staging, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`)
    await rename(staging, destination)
    return receipt
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

function processBytes(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value
  if (value === undefined || value === null) return Buffer.alloc(0)
  return Buffer.from(String(value), 'utf8')
}

/**
 * The shared judge body: mkdtemp → stage → spawn evaluator → parseReport →
 * cleanup. The evaluator's stdout/stderr is surfaced on failure; the temp dir is
 * always removed in `finally` unless `keepTmp`.
 */
export async function runStagedJudge(spec: StagedRunSpec): Promise<BenchScore> {
  const dir = await mkdtemp(join(tmpdir(), spec.tmpPrefix))
  let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  let evaluatorSucceeded = false
  let score: BenchScore | undefined
  let failure: unknown
  try {
    try {
      await spec.stage(dir)
      const bin = spec.bin ?? venvPython
      const argv = spec.argv(dir)
      try {
        const output = await execFileAsync(bin, argv, {
          cwd: spec.cwd ? spec.cwd(dir) : dir,
          encoding: 'buffer',
          maxBuffer: bigBuffer,
          ...(spec.timeoutMs ? { timeout: spec.timeoutMs } : {}),
        })
        stdout = processBytes(output.stdout)
        stderr = processBytes(output.stderr)
        evaluatorSucceeded = true
      } catch (err) {
        const e = err as { stderr?: unknown; stdout?: unknown; message?: string }
        stdout = processBytes(e.stdout)
        stderr = processBytes(e.stderr)
        const detail = processBytes(e.stderr ?? e.stdout ?? e.message ?? String(err))
          .toString('utf8')
          .slice(0, 2000)
        throw new Error(`${spec.tmpPrefix.replace(/-$/, '')} evaluator failed (${bin} ${argv.join(' ')}):\n${detail}`)
      }
      score = await spec.parseReport(dir)
    } catch (err) {
      failure = err
    }
  } finally {
    let judgeArtifacts: JudgeArtifactReceipt | undefined
    if (spec.capture) {
      try {
        judgeArtifacts = await captureStagedRun(
          dir,
          spec.capture,
          { stdout, stderr },
          evaluatorSucceeded,
        )
      } catch (captureError) {
        failure = new Error(
          `staged judge failed to capture evaluator artifacts: ${captureError instanceof Error ? captureError.message : captureError}`,
          { cause: failure ?? captureError },
        )
      }
    }
    if (!spec.keepTmp) await rm(dir, { recursive: true, force: true }).catch(() => {})
    if (failure) {
      throw new StagedJudgeError(
        failure instanceof Error ? failure.message : String(failure),
        judgeArtifacts,
        { cause: failure },
      )
    }
    if (!score) throw new StagedJudgeError('staged judge completed without a score', judgeArtifacts)
    return judgeArtifacts ? { ...score, judgeArtifacts } : score
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
