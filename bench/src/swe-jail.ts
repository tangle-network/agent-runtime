/**
 * Shared SWE execution-jail + zai-client primitives — extracted from swe-repro-calibrate.mts
 * (the Stage-0 calibrator, commit 5102c43b) so Stage 1/2 drivers (swe-structural.mts) run on the
 * SAME canary-verified jail instead of forking one. Behavior is byte-identical to the calibrator's
 * in-file originals; the calibrator now imports these.
 *
 * The jail is the byte-identical invocation pattern of swe-bench-env's `run` tool: the instance's
 * cached swebench Docker image, conda testbed, cwd=/testbed, --network none, dual timeout.
 */
import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { absoluteSweTempDir } from './swe-temp'

const exec = promisify(execFile)

export const tail = (s: string, n: number): string => (s.length > n ? `…${s.slice(s.length - n)}` : s)

// ---------- zai chat client (plain fetch; patient 429 ladder) ----------

export interface ZaiCfg {
  base: string
  key: string
  timeoutMs: number
  /** Optional hard wall-clock stop (epoch ms). No HTTP attempt starts — and no retry-ladder sleep
   *  runs — past this instant, so a per-instance deadline reaches INTO the 429 ladder instead of
   *  letting a doomed retry sleep for another 240s after the instance was already written off. */
  deadlineAt?: number
}

export interface ZaiRaw {
  /** The parsed /chat/completions JSON, verbatim. */
  json: Record<string, unknown>
  /** HTTP attempts spent (retries included). */
  attempts: number
}

/**
 * One OpenAI-shape chat completion against the zai coding endpoint, with the calibrator's retry
 * discipline: zai 429s arrive in sustained bursts (measured: an overnight code-1305 storm zeroed
 * 6/23 instances even on a 30s ladder), so rate-limit retries climb a long ladder (60s → 120s →
 * 240s cap) while transient errors retry on a 2s base. An "empty" completion — no content AND no
 * tool_calls — is the glm reasoning path starving `content` when reasoning eats max_tokens, and is
 * retried too (a tool_calls turn with empty content is a NORMAL tool-loop turn, not starvation).
 */
export async function zaiChatRaw(cfg: ZaiCfg, body: Record<string, unknown>): Promise<ZaiRaw> {
  let lastErr = ''
  let delayBase = 2_000
  for (let attempt = 1; attempt <= 7; attempt += 1) {
    if (attempt > 1) {
      const delay = Math.min(delayBase * 2 ** (attempt - 2), 240_000)
      if (cfg.deadlineAt !== undefined && Date.now() + delay >= cfg.deadlineAt) {
        throw new Error(`completion abandoned at deadline (attempt ${attempt}): ${lastErr}`)
      }
      await new Promise((r) => setTimeout(r, delay))
    }
    if (cfg.deadlineAt !== undefined && Date.now() >= cfg.deadlineAt) {
      throw new Error(`completion abandoned at deadline (attempt ${attempt}): ${lastErr || 'no attempt made'}`)
    }
    const perCallTimeout =
      cfg.deadlineAt !== undefined ? Math.max(1, Math.min(cfg.timeoutMs, cfg.deadlineAt - Date.now())) : cfg.timeoutMs
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), perCallTimeout)
    try {
      const res = await fetch(`${cfg.base}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctl.signal,
      })
      if (!res.ok) {
        lastErr = `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`
        delayBase = res.status === 429 ? 60_000 : 2_000
        continue
      }
      const json = (await res.json()) as Record<string, unknown>
      const msg = ((json.choices as Array<{ message?: Record<string, unknown> }> | undefined)?.[0]?.message ?? {}) as {
        content?: string
        tool_calls?: unknown[]
      }
      const hasToolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0
      if (!hasToolCalls && String(msg.content ?? '').trim() === '') {
        lastErr = 'empty content'
        continue
      }
      return { json, attempts: attempt }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`completion failed after retries: ${lastErr}`)
}

// ---------- judge-separation guard ----------

/** Refuse any outbound request whose SYSTEM/USER messages (the strings the harness authors) carry
 *  hidden-judge content marks (gold patch / test patch lines). Assistant and tool messages are
 *  exempt by construction: they are the model's own text and reads of the visible base tree — a
 *  model that independently authors the gold line is a success, not a leak. Returns the number of
 *  messages checked; throws on contact. */
export function assertNoHiddenLeak(marks: readonly string[], msgs: ReadonlyArray<{ role?: string; content?: unknown }>): number {
  let checked = 0
  for (const m of msgs) {
    if (m.role !== 'system' && m.role !== 'user') continue
    const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')
    for (const mark of marks) {
      if (mark && c.includes(mark)) {
        throw new Error('REFUSED: hidden judge content (gold/test patch) leaked into a model message')
      }
    }
    checked += 1
  }
  return checked
}

// ---------- jailed python execution ----------

export interface JailRun {
  code: number
  out: string
  timedOut: boolean
  infraError?: string
}

/** Echoed by the in-container shell after a successful `git apply` of the ride-along patch —
 *  unambiguously separates "patch failed to apply" (no sentinel, git's error in the output) from
 *  "patched code still fails" (sentinel present, the script's own nonzero exit). */
export const APPLY_SENTINEL = '__PATCH_APPLIED__'

let runSeq = 0

/** `treeDir === null` ⇒ run against the image's OWN built /testbed (the `image` substrate); a string
 *  ⇒ mount that host tree :ro over /testbed (the `mount` substrate — the run tool's exact pattern).
 *  `applyPatch` (image-substrate patch runs) applies a patch to the container's writable layer before
 *  running; --rm discards it, so every run still starts from the pristine image. */
export async function runPyInJail(
  imageTag: string,
  treeDir: string | null,
  pyScript: string,
  applyPatch?: string,
  opts: { timeoutS?: number } = {},
): Promise<JailRun> {
  const scriptDir = mkdtempSync(join(absoluteSweTempDir(), 'swe-repro-'))
  writeFileSync(join(scriptDir, 'repro.py'), pyScript)
  if (applyPatch) writeFileSync(join(scriptDir, 'ride.patch'), applyPatch.endsWith('\n') ? applyPatch : `${applyPatch}\n`)
  const T = opts.timeoutS ?? 120
  const containerName = `swe-repro-${process.pid}-${Date.now()}-${runSeq++}`
  // Identical shape to swe-bench-env's run tool; the command is the fixed `python /repro/repro.py`,
  // so no SWE_CMD env ride-along is needed. The script rides in on a SECOND :ro mount.
  // PYTHONPATH=/testbed is LOAD-BEARING: `python /repro/repro.py` puts /repro (the script's dir), not
  // the cwd, at sys.path[0], so without it `import <pkg>` resolves to the image's baked-in install —
  // the UNPATCHED code — and the patched tree is never exercised (verified on psf__requests-1142:
  // post-gold run kept failing until PYTHONPATH pinned the mounted tree). The run tool never hits this
  // because `python -c`/`python -m` put the cwd on sys.path.
  const shell =
    '{ source /opt/miniconda3/etc/profile.d/conda.sh && conda activate testbed && cd /testbed && ' +
    (applyPatch ? `git apply --whitespace=nowarn /repro/ride.patch && echo ${APPLY_SENTINEL} && ` : '') +
    'timeout -s KILL "$SWE_T"s env PYTHONPATH=/testbed python /repro/repro.py; } 2>&1'
  const dockerArgs = [
    'run', '--rm', '--name', containerName, '--network', 'none',
    ...(treeDir ? ['-v', `${treeDir}:/testbed:ro`] : []),
    '-v', `${scriptDir}:/repro:ro`, '-w', '/testbed',
    '-e', 'PYTHONDONTWRITEBYTECODE=1', '-e', `SWE_T=${T}`,
    imageTag, 'bash', '-lc', shell,
  ]
  let code = 0
  let out = ''
  // docker exit 125 (the daemon refused to start the container — transient resource pressure,
  // a momentary daemon hiccup) is NOT a test result. Retry a few times with backoff before
  // surfacing it as an infra error, so one bad daemon window can't nuke an instance (or, when it
  // hits the canary of every instance in a fast error-loop, the whole stream).
  for (let attempt = 0; ; attempt += 1) {
    code = 0
    out = ''
    try {
      const r = await exec('docker', dockerArgs, { timeout: (T + 20) * 1000, killSignal: 'SIGKILL', maxBuffer: 20_000_000 })
      out = r.stdout
    } catch (e) {
      const err = e as { code?: number; killed?: boolean; stdout?: string; stderr?: string; message?: string }
      if (typeof err.code === 'number') {
        code = err.code
        out = `${err.stdout ?? ''}${err.stderr ?? ''}`
      } else if (err.killed) {
        code = 124
        out = `${err.stdout ?? ''}\n[host timeout: docker run exceeded ${T + 20}s and was killed]`
      } else {
        rmSync(scriptDir, { recursive: true, force: true })
        return { code: -1, out: '', timedOut: false, infraError: `run failed to execute (${String(err.message ?? e).slice(0, 200)})` }
      }
    }
    const transient = code === 125 || /Cannot connect to the Docker daemon|error creating overlay mount|no space left/i.test(out)
    if (!transient || attempt >= 4) break
    await exec('docker', ['rm', '-f', containerName], { timeout: 20_000 }).catch(() => {})
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt))
  }
  rmSync(scriptDir, { recursive: true, force: true })
  if (code === 125 || /Cannot connect to the Docker daemon/i.test(out)) {
    return { code, out, timedOut: false, infraError: `docker: ${out.slice(0, 300)} (persisted through 5 attempts)` }
  }
  return { code, out, timedOut: code === 124 || code === 137 }
}

// ---------- execution canary ----------

/** Import name of the repo's primary package, used by the per-instance EXECUTION CANARY. The canary
 *  decides whether this substrate can grade this instance AT ALL: with the gold patch applied to the
 *  tree under test, `import <pkg>` must succeed AND resolve INTO that tree (/testbed — not the image's
 *  site-packages install, which never receives the patch). A canary failure means any grade produced
 *  here measures the harness, not the model, so the instance is marked env-unresolvable before a
 *  single model call is spent. Never shown to the model. */
export const IMPORT_NAME: Record<string, string> = {
  'astropy/astropy': 'astropy',
  'django/django': 'django',
  'matplotlib/matplotlib': 'matplotlib',
  'mwaskom/seaborn': 'seaborn',
  'pallets/flask': 'flask',
  'pydata/xarray': 'xarray',
  'psf/requests': 'requests',
  'pylint-dev/pylint': 'pylint',
  'pytest-dev/pytest': 'pytest',
  'scikit-learn/scikit-learn': 'sklearn',
  'sphinx-doc/sphinx': 'sphinx',
  'sympy/sympy': 'sympy',
}

/** The canary script: exit 0 iff `import <pkg>` succeeds AND resolves into /testbed. */
export const importCanaryScript = (pkg: string): string =>
  `import sys\nimport ${pkg}\nf = getattr(${pkg}, '__file__', '') or ''\nprint(f)\n` +
  "sys.exit(0 if f.startswith('/testbed') else 3)\n"

// ---------- repro-authoring protocol (extracted from swe-repro-calibrate.mts, byte-identical
// behavior, so the stream driver authors fresh repros with the SAME calibrated protocol instead
// of forking one) ----------

/** The authoring system prompt, parameterized only on the jail's script timeout. */
export const reproAuthorSystem = (reproTimeoutS: number): string =>
  'You are an expert Python engineer writing a REPRODUCTION script for a reported bug in an open-source repository.\n\n' +
  'Contract for the script you produce:\n' +
  '- A single self-contained Python file, executed as: python /repro/repro.py with cwd=/testbed, where /testbed is the ' +
  "repository checkout. The project's own environment is active, so the repository package and its dependencies are importable.\n" +
  '- Exit code 0 means the bug is FIXED. A nonzero exit (sys.exit(1), a failing assert, or an uncaught exception) means the ' +
  'bug is PRESENT. The script must exercise the EXACT behavior described in the issue.\n' +
  '- The repository tree is READ-ONLY: never modify, create, or delete files inside it. If you genuinely need a scratch ' +
  'file, use the tempfile module (system tmp is writable).\n' +
  `- No network access. Deterministic. Must finish well under ${reproTimeoutS} seconds.\n` +
  "- Prefer plain Python with assert statements. Do not invoke the repository's test-suite runner and do not depend on " +
  'pytest fixtures; importing the repository package directly is the way.\n' +
  '- Print one short line describing what was checked before exiting.\n\n' +
  'Be precise: the script must FAIL on the current buggy code and PASS once the underlying bug is properly fixed. Test the ' +
  'observable behavior the issue describes, not incidental implementation details that a legitimate fix might change.'

/** All-READ-lines detector: models sometimes wrap their read requests in a python fence, which must
 *  NOT be mistaken for a script (observed live: a "script" of `READ: astropy/timeseries/core.py`
 *  reached the jail and crashed with NameError — measuring the parser, not the model). */
export function asReadRequests(block: string): string[] | null {
  const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length > 0 && lines.length <= 3 && lines.every((l) => /^READ:\s*\S+$/.test(l))) {
    return lines.map((l) => l.replace(/^READ:\s*/, ''))
  }
  return null
}

export function extractReproScript(text: string): string | null {
  // Collapse a doubled fence OPENER (observed live: "```python\n```python\nimport os…" — the
  // non-greedy fence match otherwise captures the empty span between the two openers and a
  // complete script is thrown away as authoring-failed).
  const cleaned = text.replace(/```(?:python|py)?[ \t]*\n(?=```(?:python|py)?[ \t]*\n)/g, '')
  const fences = [...cleaned.matchAll(/```(?:python|py)?\s*\n([\s\S]*?)```/g)]
  const last = fences.at(-1)?.[1]?.trim()
  if (!last || asReadRequests(last)) return null
  return last
}

export function extractReadRequests(text: string): string[] {
  return [...text.matchAll(/^READ:\s*(\S+)\s*$/gm)].map((m) => m[1]).slice(0, 3)
}

// ---------- backbone enumeration ----------

/** The cached-instance backbone: every instance whose swebench eval image is cached locally.
 *  Tag → id mapping inverts make_test_spec's `__` → `_1776_` name mangling. */
export async function cachedInstanceIds(): Promise<string[]> {
  const { stdout } = await exec('docker', ['images', '--format', '{{.Repository}}'], { timeout: 30_000 })
  const ids = new Set<string>()
  for (const line of stdout.split('\n')) {
    const m = /(?:^|\/)sweb\.eval\.x86_64\.(.+)$/.exec(line.trim())
    if (m) ids.add(m[1].replace('_1776_', '__'))
  }
  return [...ids].sort()
}
