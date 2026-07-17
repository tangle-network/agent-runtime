/**
 * SWE-bench Verified as an `AgenticSurface` — the PROPER, no-cheating way to run a coding agent on real
 * GitHub bugs through the substrate (`runAgentic`/`runBenchmark`/`runStrategyEvolution` drive the loop;
 * we only provide tools + a deployable score). The agent clones the repo at base_commit, explores +
 * edits SOURCE via tools (never tests — path-jailed), and `score()` grades the resulting `git diff`
 * with the OFFICIAL swebench Docker harness (apply patch → FAIL_TO_PASS + PASS_TO_PASS → resolved).
 *
 * No cheating by construction: the agent never sees the hidden tests or the gold patch (the adapter's
 * prompt is the issue only); `edit_file` refuses test files; the score is a real test run, not a judge.
 *
 * CONTAMINATION CAVEAT: SWE-bench bugs are public GitHub fixes a frontier model may have MEMORIZED.
 * A clean train→holdout split (disjoint instances) rules out adaptive-reuse, but NOT training-data
 * memorization. Always report this; never claim a "clean" frontier number from this arena alone.
 */
import { execFile } from 'node:child_process'
import { cpSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { promisify } from 'node:util'
import type { AgenticSurface, AgenticTask, AgenticTool, ArtifactHandle, SurfaceScore } from '@tangle-network/agent-runtime/loops'
import { runVenvPython } from './benchmarks/_harness'
import { createSweBenchAdapter, type SweBenchAdapterOptions } from './benchmarks/swe-bench'
import type { BenchTask } from './benchmarks/types'
import { absoluteSweTempDir } from './swe-temp'

const exec = promisify(execFile)
export const isTestPath = (p: string) => /(^|\/)(tests?)\//.test(p) || /test_.*\.py$|_test\.py$|conftest\.py$/.test(p)

/** Copy a cached git checkout without rewriting repository-relative symlinks, then prove that the
 *  copy is byte-for-byte clean from git's perspective before a worker can observe it. */
export async function copyPristineGitCheckout(sourceDir: string, destinationDir: string): Promise<void> {
  cpSync(sourceDir, destinationDir, { recursive: true, verbatimSymlinks: true })
  let status: string
  try {
    const result = await exec('git', ['-C', destinationDir, 'status', '--porcelain'], {
      timeout: 60_000,
      maxBuffer: 20_000_000,
    })
    status = result.stdout
  } catch (error) {
    throw new Error(`could not verify cached checkout copy: ${(error as Error).message}`)
  }
  if (status.length > 0) {
    throw new Error(`cached checkout copy is not pristine:\n${status.slice(0, 4_000)}`)
  }
}

/**
 * The read/edit-only SWE agent system prompt — the ESTABLISHED baseline surface (glm-5.2 raw = 7/12,
 * glm-4.6 = 3/12). Exported as the single source of truth so `tasks()` here and the improve() seed in
 * swe-improve.mts stay byte-identical (the baseline denominator depends on this — no drift). Do NOT
 * edit this constant to add run-tool guidance; that lives in SWE_SEED_PROMPT_WITH_RUN so the read/edit
 * baseline arm is reproducible unchanged.
 */
export const SWE_SEED_PROMPT =
  'You are a senior engineer fixing a real bug in the checked-out repository. Work PERSISTENTLY and do not ' +
  'stop early: use list_files + read_file to explore BROADLY (read many candidate files — the bug is rarely in ' +
  'the first file you open), trace the issue to its root cause, then fix it with edit_file. You MUST make at ' +
  'least one edit_file call — never finish with prose alone or without attempting a fix. Make a MINIMAL surgical ' +
  'change (a few lines, like a real PR), source only (test files are rejected). If an edit_file fails (old_string ' +
  'not unique/found), read the file again and retry with exact text. Keep going until you have made your best fix.'

/**
 * The WITH-TOOLS arm: the baseline prompt PLUS the run-tool workflow (write a failing repro, edit, re-run
 * until it passes). Only used when the environment is built with `enableRun`. Kept as a separate constant
 * so enabling the run tool never mutates the read/edit-only baseline. Also reconciles the now-active
 * confusion from loadTasks' userPrompt (which says the repo is "at /work, cd /work" — the container path
 * from the sandbox path; here the run tool's cwd is the repo root and there is nothing to cd into).
 */
// NOTE (WAF): the router sits behind a Cloudflare WAF whose RCE ruleset 403s any request body that
// contains BACKTICK-wrapped command-like text (backticks are shell command-substitution syntax). The
// SAME commands without backticks pass. So this prompt and the run tool description deliberately write
// example commands WITHOUT backticks. Verified: backtick form -> 403, plain form -> 200.
export const SWE_SEED_PROMPT_WITH_RUN =
  `${SWE_SEED_PROMPT} ` +
  'You ALSO have a run tool: execute a shell command in the repo checkout (cwd is already the repo root — do ' +
  'NOT cd, and ignore any instruction that says the repo is at /work). Use run to VERIFY your fix, not to ' +
  'stall. DISCIPLINE: read a few files to locate the bug, then MAKE YOUR EDIT with edit_file EARLY — do not ' +
  'spend many turns running commands before your first edit. After you edit, use run to check the fix: a ' +
  'one-line python -c inline check, or python -m pytest on the nearest existing test file (use -k to select ' +
  'the case, plus -rA and -p no:cacheprovider). If it still fails, read the output, refine the edit, and ' +
  're-run — iterate EDIT then run until it passes, and run the nearest existing tests to catch regressions. ' +
  'The network is DISABLED and the hidden grading tests are NOT present, so verify with local, network-free ' +
  'checks. You MUST make at least one edit_file — a turn budget spent running with no edit is a failure.'

/** Hard wall-clock cap (seconds) for a single `run` command, enforced BOTH in-container (`timeout`) and
 *  on the host (execFile timeout + SIGKILL). Env-overridable for slow suites; default fail-closed at 120s. */
const RUN_TIMEOUT_S = Number(process.env.SWE_RUN_TIMEOUT ?? 120)
/** Combined stdout+stderr budget returned to the model: head + tail so the failure summary (which pytest
 *  prints at the tail) survives truncation. */
const RUN_OUTPUT_LIMIT = Number(process.env.SWE_RUN_OUTPUT_LIMIT ?? 10_000)
/** Exact run-tool settings stamped into structural-experiment receipts. */
export const SWE_RUN_TOOL_CONFIG = Object.freeze({
  timeoutS: RUN_TIMEOUT_S,
  outputLimit: RUN_OUTPUT_LIMIT,
})
/** Monotonic suffix so concurrent `run` calls get distinct container names (for reap-on-timeout). */
let runNameCounter = 0

/** Truncate a long string keeping a head and a (larger) tail, with a marker between — the tail carries the
 *  test-failure summary, so it gets the bigger share. Pure. */
function truncateHeadTail(s: string, limit: number): string {
  if (s.length <= limit) return s
  const head = Math.floor(limit * 0.35)
  const tail = limit - head
  return `${s.slice(0, head)}\n...[truncated ${s.length - limit} chars]...\n${s.slice(s.length - tail)}`
}

/** Inline venv script: given the instance metadata row (argv[1] JSON), print the candidate Docker image
 *  tags swebench itself would use — the remote/namespaced tag (what a `swebench` pull caches, e.g.
 *  `swebench/sweb.eval.x86_64.psf_1776_requests-1142:latest`) FIRST, then the local-build tag
 *  (`sweb.eval.x86_64.psf__requests-1142:latest`). Delegated to `make_test_spec` so the naming stays
 *  correct across swebench versions instead of being hand-built. No network (it reads a dict, not the HF split). */
const IMAGE_KEY_SCRIPT = `
import json, sys
from swebench.harness.test_spec.test_spec import make_test_spec
row = json.loads(sys.argv[1])
candidates = []
for namespace in ("swebench", None):
    try:
        candidates.append({
            "tag": make_test_spec(row, namespace=namespace).instance_image_key,
            "namespace": "swebench" if namespace == "swebench" else "none",
        })
    except Exception:
        pass
print(json.dumps(candidates))
`

const SWEBENCH_VERSION_SCRIPT = `
import importlib.metadata
print(importlib.metadata.version("swebench"))
`

/** Installed official scorer package stamped into experiment execution receipts. */
export async function resolveSweBenchScorerVersion(): Promise<string> {
  const output = await runVenvPython(SWEBENCH_VERSION_SCRIPT, [], 60_000)
  const version = output.trim().split('\n').filter(Boolean).pop() ?? ''
  if (!version) throw new Error('could not resolve installed swebench scorer version')
  return version
}

/**
 * Cheap string pre-filter for an agent-supplied repo-relative path, applied before the path is
 * joined to a workspace root: rejects absolute paths and any `..` segment, strips a leading `./`.
 * Returns the cleaned relative path, or `null` if it must be refused. Pure and side-effect-free —
 * `root` is unused here (the symlink-following boundary is the realpath jail, not this filter) but
 * is taken so call sites read symmetrically with the realpath check.
 */
export const jailPath = (_root: string, p: string): string | null => {
  if (p.startsWith('/') || p.includes('..')) return null
  return p.replace(/^\.\//, '')
}

/**
 * Containment predicate for the realpath jail: true iff `real` (an already-resolved absolute path)
 * is `jailRoot` itself or lies strictly inside it. The `+ sep` guard stops a sibling like
 * `/tmp/swe-x-evil` from matching the root `/tmp/swe-x`. Pure and side-effect-free.
 */
export const isInsideJail = (jailRoot: string, real: string): boolean => real === jailRoot || real.startsWith(jailRoot + sep)

export interface SweImageIdentity {
  id: string
  repoDigests: string[]
}

export interface SweImageCandidate {
  tag: string
  namespace: 'swebench' | 'none'
}

export type SweImageResolution =
  | { ok: true; tag: string; namespace: SweImageCandidate['namespace']; identity: SweImageIdentity }
  | { ok: false; reason: string }

export function parseSweImageCandidates(stdout: string): SweImageCandidate[] {
  const parsed = JSON.parse(stdout) as Array<{ tag?: unknown; namespace?: unknown }>
  return parsed.map((candidate, index) => {
    if (
      typeof candidate.tag !== 'string' ||
      (candidate.namespace !== 'swebench' && candidate.namespace !== 'none')
    ) {
      throw new Error(`invalid SWE image candidate at index ${index}`)
    }
    return { tag: candidate.tag, namespace: candidate.namespace }
  })
}

export function firstAvailableSweImageCandidate(
  candidates: readonly SweImageCandidate[],
  identities: ReadonlyMap<string, SweImageIdentity>,
): { candidate: SweImageCandidate; identity: SweImageIdentity } | null {
  for (const candidate of candidates) {
    const identity = identities.get(candidate.tag)
    if (identity) return { candidate, identity }
  }
  return null
}

/** Parse the immutable image identity returned by `docker image inspect`. */
export function parseSweImageIdentity(stdout: string): SweImageIdentity {
  const rows = JSON.parse(stdout) as Array<{ Id?: unknown; RepoDigests?: unknown }>
  const row = rows[0]
  const id = typeof row?.Id === 'string' ? row.Id : ''
  if (!id) throw new Error('docker image inspect returned no image ID')
  const repoDigests = Array.isArray(row?.RepoDigests)
    ? row.RepoDigests.filter((value): value is string => typeof value === 'string').sort()
    : []
  return { id, repoDigests }
}

interface Ws {
  dir: string
  task: BenchTask
  /** Memoized `run`-tool image resolution: the local Docker tag to exec in, or a fail-closed reason. */
  image?: SweImageResolution
}

/** Resolve the locally-present Docker image for an instance's METADATA row (no workspace needed).
 *  Asks swebench for the candidate tags, then picks the first that `docker image inspect` finds locally.
 *  Fail-closed: docker down / no cached image / resolver error → `{ ok:false }`. Exported so script-side
 *  calibrators (swe-repro-calibrate) hard-assert image presence through the SAME resolution the `run`
 *  tool uses instead of hand-building tags. */
export async function resolveImageForMetadata(
  metadata: Record<string, unknown>,
): Promise<SweImageResolution> {
  let candidates: SweImageCandidate[]
  try {
    const out = await runVenvPython(IMAGE_KEY_SCRIPT, [JSON.stringify(metadata)], 60_000)
    const lastLine = out.trim().split('\n').filter(Boolean).pop() ?? '[]'
    candidates = parseSweImageCandidates(lastLine)
  } catch (e) {
    return { ok: false, reason: `image-key resolution failed: ${(e as Error).message.slice(0, 160)}` }
  }
  if (!candidates.length) return { ok: false, reason: 'swebench produced no image key for this instance' }
  const identities = new Map<string, SweImageIdentity>()
  for (const { tag } of candidates) {
    try {
      const inspected = await exec('docker', ['image', 'inspect', tag], { timeout: 20_000 })
      identities.set(tag, parseSweImageIdentity(inspected.stdout))
    } catch (e) {
      const m = (e as { stderr?: string }).stderr ?? (e as Error).message ?? ''
      if (/Cannot connect to the Docker daemon|Is the docker daemon running/i.test(m)) {
        return { ok: false, reason: 'docker daemon unavailable' }
      }
      // otherwise: this tag is just not cached locally — try the next candidate
    }
  }
  const selected = firstAvailableSweImageCandidate(candidates, identities)
  if (selected) {
    return {
      ok: true,
      tag: selected.candidate.tag,
      namespace: selected.candidate.namespace,
      identity: selected.identity,
    }
  }
  return { ok: false, reason: `no cached image (tried: ${candidates.map(({ tag }) => tag).join(', ')})` }
}

/** Per-workspace memoization of `resolveImageForMetadata` for the `run` tool (degrades to an
 *  `ERROR:` string so the agent falls back to read/edit-only instead of crashing). */
async function resolveInstanceImage(ws: Ws, expected?: SweImageIdentity): Promise<SweImageResolution> {
  if (ws.image) {
    if (ws.image.ok && expected && ws.image.identity.id !== expected.id) {
      return { ok: false, reason: `image identity changed (${expected.id} -> ${ws.image.identity.id})` }
    }
    return ws.image
  }
  const resolved = await resolveImageForMetadata(ws.task.metadata ?? {})
  if (resolved.ok && expected && resolved.identity.id !== expected.id) {
    return (ws.image = {
      ok: false,
      reason: `image identity changed (${expected.id} -> ${resolved.identity.id})`,
    })
  }
  return (ws.image = resolved)
}

/** Build the SWE-bench Environment + a DISJOINT-slice task supplier over the Verified split. The
 *  supplier keys tasks by dataset offset so `runStrategyEvolution`'s train [0,trainN) and holdout
 *  [trainN+off,…) never overlap. Verified is loaded once; instances carry their repo/base_commit. */
export async function createSweBenchEnvironment(
  poolN = 80,
  opts: {
    ids?: readonly string[]
    enableRun?: boolean
    cloneCache?: boolean
    expectedImageIdentities?: ReadonlyMap<string, SweImageIdentity>
    adapterOptions?: SweBenchAdapterOptions
  } = {},
): Promise<{
  environment: AgenticSurface
  tasks: (offset: number, n: number) => Promise<AgenticTask[]>
  adapter: ReturnType<typeof createSweBenchAdapter>
}> {
  const adapter = createSweBenchAdapter(opts.adapterOptions)
  // WITH-TOOLS arm: expose the jailed `run` tool + use the run-aware seed prompt. Default OFF keeps
  // the established read/edit-only baseline byte-identical.
  const enableRun = opts.enableRun ?? false
  const pool = opts.ids?.length
    ? await adapter.loadTasks({ ids: [...opts.ids], split: 'test' })
    : await adapter.loadTasks({ limit: poolN, split: 'test' })
  const byId = new Map(pool.map((t) => [t.id, t]))
  // Each environment owns its workspace registry so concurrent environments don't share state.
  const workspaces = new Map<string, Ws>()
  // Opt-in per-instance clone cache: clone each instance from GitHub once, then copy the pristine
  // checkout for later sessions. This removes a mid-run network dependency without sharing edits.
  const cloneCache = opts.cloneCache ?? false
  const pristine = new Map<string, Promise<string>>()
  const clonedAt = async (md: Record<string, string>, dir: string): Promise<void> => {
    await exec('git', ['clone', '--filter=blob:none', '--no-checkout', '--quiet', `https://github.com/${md.repo}.git`, dir], { timeout: 420_000 })
    await exec('git', ['-C', dir, 'checkout', '--quiet', md.base_commit], { timeout: 300_000 })
  }
  const pristineClone = (id: string, md: Record<string, string>): Promise<string> => {
    let pending = pristine.get(id)
    if (!pending) {
      pending = (async () => {
        const dir = mkdtempSync(join(absoluteSweTempDir(), 'swe-cache-'))
        try {
          await clonedAt(md, dir)
          return dir
        } catch (error) {
          rmSync(dir, { recursive: true, force: true })
          pristine.delete(id)
          throw error
        }
      })()
      pristine.set(id, pending)
    }
    return pending
  }

  const environment: AgenticSurface = {
    name: 'swe-bench-verified',
    async open(task) {
      const bt = byId.get(task.id)
      if (!bt) throw new Error(`swe-bench-env: unknown task ${task.id}`)
      const md = bt.metadata as Record<string, string>
      const dir = mkdtempSync(join(absoluteSweTempDir(), 'swe-'))
      try {
        if (cloneCache) await copyPristineGitCheckout(await pristineClone(task.id, md), dir)
        else await clonedAt(md, dir)
        const handle: ArtifactHandle = { id: dir, surface: 'swe-bench-verified' }
        workspaces.set(dir, { dir, task: bt })
        return handle
      } catch (error) {
        rmSync(dir, { recursive: true, force: true })
        throw error
      }
    },
    async tools() {
      const tools: AgenticTool[] = [
        { type: 'function', function: { name: 'list_files', description: 'List source files under a repo subdirectory (recursive, bounded). "" = repo root.', parameters: { type: 'object', properties: { dir: { type: 'string' } }, required: ['dir'] } } },
        { type: 'function', function: { name: 'read_file', description: 'Read a repo file by path.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
        { type: 'function', function: { name: 'edit_file', description: 'Surgical fix: replace the EXACT old_string (must occur once — copy whitespace precisely) with new_string in a SOURCE file. Minimal changes, never whole-file rewrites. Test files are rejected.', parameters: { type: 'object', properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['path', 'old_string', 'new_string'] } } },
      ]
      if (enableRun) {
        tools.push({
          type: 'function',
          function: {
            name: 'run',
            description:
              'Run a shell command in the repo checkout to REPRODUCE the bug and VERIFY your fix. cwd is the ' +
              'repo root (do NOT cd). Use a one-line python -c inline check for a quick offline reproduction, ' +
              'or python -m pytest on an existing test file (add -k to select a case, plus -rA and ' +
              '-p no:cacheprovider) to run tests near your change. Returns the exit code then the combined ' +
              'stdout+stderr. NETWORK IS DISABLED and hidden grading tests are absent. A non-zero exit is a ' +
              'normal failing-test signal, not a tool error.',
            parameters: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] },
          },
        })
      }
      return tools
    },
    async call(handle, name, args) {
      const ws = workspaces.get(handle.id)
      if (!ws) return 'ERROR: workspace closed'
      // Cheap pre-filter: reject absolute paths and `..` traversal, strip a leading `./`. The real
      // boundary is the realpath jail check below (resolveInJail) — `safe` only normalizes the string
      // form. `ws.dir` is passed for signature symmetry; the filter itself is root-independent.
      const safe = (p: string): string | null => jailPath(ws.dir, p)
      // Resolve `relPath` to an absolute path and assert it stays inside the workspace AFTER following
      // symlinks (a repo symlink targeting /etc/passwd would otherwise escape the string-only jail).
      // The target must exist (both callers read it first); a missing path throws and the caller
      // surfaces the error message, matching the previous read-then-fail behavior.
      const jailRoot = realpathSync(ws.dir)
      const resolveInJail = (relPath: string): string | null => {
        const real = realpathSync(join(ws.dir, relPath))
        return isInsideJail(jailRoot, real) ? real : null
      }
      if (name === 'list_files') {
        const sub = safe(String(args.dir ?? '')) ?? ''
        const root = join(ws.dir, sub)
        if (!existsSync(root)) return `(no such path: ${sub})`
        const out: string[] = []
        const walk = (d: string, depth: number) => {
          if (depth > 2 || out.length > 240) return
          let entries: string[] = []
          try {
            entries = readdirSync(d)
          } catch {
            return
          }
          for (const e of entries) {
            if (e.startsWith('.') || e === 'node_modules' || e === '__pycache__') continue
            const p = join(d, e)
            let isDir = false
            try {
              isDir = lstatSync(p).isDirectory()
            } catch {
              continue
            }
            out.push(p.slice(ws.dir.length + 1) + (isDir ? '/' : ''))
            if (isDir) walk(p, depth + 1)
          }
        }
        walk(root, 0)
        return out.slice(0, 240).join('\n') || '(empty)'
      }
      if (name === 'read_file') {
        const p = safe(String(args.path ?? ''))
        if (!p) return 'ERROR: invalid path'
        let real: string | null
        try {
          real = resolveInJail(p)
        } catch (e) {
          return `(error: ${(e as Error).message})`
        }
        if (!real) return `ERROR: path ${p} escapes the workspace`
        try {
          const c = readFileSync(real, 'utf8')
          return c.length > 24_000 ? `${c.slice(0, 24_000)}\n...[truncated]` : c
        } catch (e) {
          return `(error: ${(e as Error).message})`
        }
      }
      if (name === 'edit_file') {
        const p = safe(String(args.path ?? ''))
        if (!p) return 'ERROR: invalid path'
        if (isTestPath(p)) return 'REJECTED: editing test files is forbidden (the evaluation runs hidden tests).'
        const oldStr = String(args.old_string ?? '')
        const newStr = String(args.new_string ?? '')
        let real: string | null
        try {
          real = resolveInJail(p)
        } catch (e) {
          return `(cannot read ${p}: ${(e as Error).message})`
        }
        if (!real) return `ERROR: path ${p} escapes the workspace`
        let content: string
        try {
          content = readFileSync(real, 'utf8')
        } catch (e) {
          return `(cannot read ${p}: ${(e as Error).message})`
        }
        if (!oldStr) return 'ERROR: old_string is empty.'
        const count = content.split(oldStr).length - 1
        if (count === 0) return `ERROR: old_string not found in ${p}. read_file it and copy EXACT text.`
        if (count > 1) return `ERROR: old_string appears ${count}× in ${p} — add surrounding context to make it unique.`
        writeFileSync(real, content.replace(oldStr, newStr))
        return `edited ${p}: replaced 1 occurrence`
      }
      if (enableRun && name === 'run') {
        const cmd = String(args.cmd ?? '').trim()
        if (!cmd) return 'ERROR: run requires a non-empty cmd'
        const img = await resolveInstanceImage(ws, opts.expectedImageIdentities?.get(ws.task.id))
        if (!img.ok) return `ERROR: run unavailable (${img.reason}) — continue with read_file/edit_file only`
        const T = RUN_TIMEOUT_S
        const containerName = `swe-run-${process.pid}-${Date.now()}-${runNameCounter++}`
        // The whole toolchain is interpreted ONLY by the container's bash — the host never sees a shell
        // (execFile + args array). The agent cmd rides in as $SWE_CMD (an env var, no host-quoting hazard).
        // `{ …; } 2>&1` merges stderr into stdout preserving order; the group's exit = the last command's.
        // conda.sh only DEFINES `conda` (unlike bin/activate, which would consume our positional args).
        const script =
          '{ source /opt/miniconda3/etc/profile.d/conda.sh && conda activate testbed && cd /testbed && ' +
          'timeout -s KILL "$SWE_T"s bash -c "$SWE_CMD"; } 2>&1'
        // READ-ONLY mount ⇒ the container physically cannot mutate the graded checkout (`run` is purely
        // observational; the only writer stays edit_file). `--network none` + `--rm` + the dual timeout.
        const dockerArgs = [
          'run', '--rm', '--name', containerName, '--network', 'none',
          '-v', `${ws.dir}:/testbed:ro`, '-w', '/testbed',
          '-e', 'PYTHONDONTWRITEBYTECODE=1', '-e', `SWE_T=${T}`, '-e', `SWE_CMD=${cmd}`,
          img.identity.id, 'bash', '-lc', script,
        ]
        let code = 0
        let out = ''
        try {
          const r = await exec('docker', dockerArgs, { timeout: (T + 20) * 1000, killSignal: 'SIGKILL', maxBuffer: 20_000_000 })
          out = r.stdout
        } catch (e) {
          const err = e as { code?: number; killed?: boolean; stdout?: string; message?: string }
          if (typeof err.code === 'number') {
            code = err.code
            out = err.stdout ?? ''
          } else {
            // Host-level kill (execFile timeout) or docker failed to spawn: reap any orphaned container.
            exec('docker', ['rm', '-f', containerName], { timeout: 20_000 }).catch(() => {})
            if (err.killed) {
              code = 124
              out = `${err.stdout ?? ''}\n[host timeout: docker run exceeded ${T + 20}s and was killed]`
            } else {
              return `ERROR: run failed to execute (${String(err.message ?? e).slice(0, 200)})`
            }
          }
        }
        // Docker infra failures (container couldn't start / daemon vanished) are tool-misuse, not a test
        // result → keep the ERROR: prefix so they don't pollute the failing-test signal.
        if (code === 125 || /Cannot connect to the Docker daemon/i.test(out)) {
          return `ERROR: run unavailable (docker: ${truncateHeadTail(out, 400)})`
        }
        const note = code === 124 || code === 137 ? `\n[command hit the ${T}s time/kill limit]` : ''
        return `exit=${code}${note}\n${truncateHeadTail(out, RUN_OUTPUT_LIMIT)}`
      }
      return `ERROR: unknown tool ${name}`
    },
    async score(_task, handle): Promise<SurfaceScore> {
      const ws = workspaces.get(handle.id)
      if (!ws) return { passes: 0, total: 1, errored: 1 }
      let patch = ''
      try {
        const r = await exec('git', ['-C', ws.dir, 'diff'], { maxBuffer: 20_000_000, timeout: 60_000 })
        patch = r.stdout
      } catch {
        patch = ''
      }
      if (!patch.trim()) return { passes: 0, total: 1, errored: 0 }
      try {
        const s = await adapter.judge(ws.task, patch)
        return { passes: s.resolved ? 1 : 0, total: 1, errored: 0 }
      } catch {
        return { passes: 0, total: 1, errored: 1 }
      }
    },
    async close(handle) {
      const ws = workspaces.get(handle.id)
      if (!ws) return
      workspaces.delete(handle.id)
      rmSync(ws.dir, { recursive: true, force: true })
    },
  }

  const tasks = async (offset: number, n: number): Promise<AgenticTask[]> => {
    const slice = pool.slice(offset, offset + n)
    if (slice.length < n) throw new Error(`swe-bench-env: pool exhausted at offset ${offset} (need ${n}, have ${slice.length}; raise poolN)`)
    return slice.map((bt) => ({
      id: bt.id,
      systemPrompt: enableRun ? SWE_SEED_PROMPT_WITH_RUN : SWE_SEED_PROMPT,
      userPrompt: bt.prompt,
      meta: { instanceId: bt.id },
    }))
  }

  return { environment, tasks, adapter }
}
