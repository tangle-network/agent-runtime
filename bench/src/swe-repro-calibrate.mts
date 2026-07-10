/**
 * Stage 0 of the SWE-bench frontier push — the REPRODUCTION-ORACLE CALIBRATOR
 * (contract: supervisor-lab/docs/results/PREREG-swe-frontier.md, Stage 0 only).
 *
 * Question it answers: can glm-5.2, given ONLY the issue text (+ up to 3 requested file reads),
 * author a self-contained repro script that (a) FAILS on the unpatched tree — "validity" — and
 * (b) PASSES after the GOLD patch — "soundness"? GATE: ≥60% of instances valid+sound (1 retry).
 *
 * No cheating by construction: the GOLD patch is used strictly script-side (applied host-side to a
 * COPY of the tree, then run in the jail); a hard assert refuses to send any model message that
 * contains gold-patch content. The repro runs in the instance's cached swebench Docker image with
 * the tree mounted READ-ONLY — the byte-identical invocation pattern of swe-bench-env's `run` tool
 * (conda testbed, cwd=/testbed, --network none, dual timeout) — so calibration measures the same
 * substrate Stage 1/2 will select patches on.
 *
 *   cd ~/company/devops/secrets && dotenvx run -f agent-state.env -f tangle-router.env -- bash -c \
 *     'cd ~/code/agent-runtime-swe && OUT=/path/swe-stage0.jsonl node_modules/.bin/tsx bench/src/swe-repro-calibrate.mts'
 *
 * Env: ZAI_API_KEY (required), ZAI_BASE, MODEL=glm-5.2, MAX_TOKENS=12000, TEMP=0.2, CONC=3,
 *      REPRO_TIMEOUT=120 (s), LLM_TIMEOUT_MS=480000, IDS=comma-list override, OUT=jsonl path,
 *      REPRO_EXEC=mount|image (execution substrate; see the constant below).
 */
import { execFile } from 'node:child_process'
import { appendFileSync, cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { AgenticTask, ArtifactHandle } from '@tangle-network/agent-runtime/loops'
import type { BenchTask } from './benchmarks/types'
import { createSweBenchEnvironment, resolveImageForMetadata } from './swe-bench-env'

const exec = promisify(execFile)

// ---------- config ----------

const ZAI_BASE = process.env.ZAI_BASE ?? 'https://api.z.ai/api/coding/paas/v4'
const ZAI_KEY = process.env.ZAI_API_KEY ?? ''
const MODEL = process.env.MODEL ?? 'glm-5.2'
// glm-5.2 is a reasoning model: hidden reasoning consumes max_tokens, so <8000 starves content.
const MAX_TOKENS = Number(process.env.MAX_TOKENS ?? 12_000)
const TEMP = Number(process.env.TEMP ?? 0.2)
const CONC = Math.max(1, Math.min(3, Number(process.env.CONC ?? 3)))
const REPRO_TIMEOUT_S = Number(process.env.REPRO_TIMEOUT ?? 120)
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 480_000)
const OUT = process.env.OUT ?? 'swe-stage0.jsonl'
/** Repro EXECUTION substrate. `mount` (the prereg default) mounts the fresh host clone :ro over
 *  /testbed — the run tool's exact pattern. `image` executes against the image's OWN /testbed
 *  (base_commit, BUILT — compiled extensions and generated version files present), applying the
 *  gold patch in-container instead of host-side. Measured on the 23 cached instances: `mount`
 *  kills 6 (astropy×2/matplotlib/sklearn×2/pytest) with import errors a fresh un-built clone
 *  cannot avoid; the SAME scripts were all valid+sound under `image`. */
const EXEC = process.env.REPRO_EXEC ?? 'mount'
if (EXEC !== 'mount' && EXEC !== 'image') throw new Error(`REPRO_EXEC must be mount|image, got ${EXEC}`)

// ---------- model client (plain fetch; retries transient HTTP AND empty content — the glm
// reasoning path starves `content` when reasoning eats max_tokens; supervisor-arena pattern) ----------

interface ChatMsg {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface Completion {
  content: string
  attempts: number
  tokensIn: number
  tokensOut: number
}

async function complete(messages: ChatMsg[]): Promise<Completion> {
  let lastErr = ''
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt))
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), LLM_TIMEOUT_MS)
    try {
      const res = await fetch(`${ZAI_BASE}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ZAI_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, temperature: TEMP, messages }),
        signal: ctl.signal,
      })
      if (!res.ok) {
        lastErr = `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`
        continue
      }
      const d = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      const content = d.choices?.[0]?.message?.content ?? ''
      if (content.trim() === '') {
        lastErr = 'empty content'
        continue
      }
      return { content, attempts: attempt, tokensIn: d.usage?.prompt_tokens ?? 0, tokensOut: d.usage?.completion_tokens ?? 0 }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`completion failed after retries: ${lastErr}`)
}

// ---------- jailed repro execution (byte-copies the swe-bench-env `run` tool invocation:
// conda testbed, cwd=/testbed, tree mounted :ro, --network none, dual timeout) ----------

interface JailRun {
  code: number
  out: string
  timedOut: boolean
  infraError?: string
}

let runSeq = 0

/** `treeDir === null` ⇒ run against the image's OWN built /testbed (the `image` substrate); a string
 *  ⇒ mount that host tree :ro over /testbed (the `mount` substrate — the run tool's exact pattern).
 *  `applyPatch` (image-substrate soundness) applies a patch to the container's writable layer before
 *  running; --rm discards it, so every run still starts from the pristine image. */
async function runPyInJail(imageTag: string, treeDir: string | null, pyScript: string, applyPatch?: string): Promise<JailRun> {
  const scriptDir = mkdtempSync(join(tmpdir(), 'swe-repro-'))
  writeFileSync(join(scriptDir, 'repro.py'), pyScript)
  if (applyPatch) writeFileSync(join(scriptDir, 'gold.patch'), applyPatch.endsWith('\n') ? applyPatch : `${applyPatch}\n`)
  const T = REPRO_TIMEOUT_S
  const containerName = `swe-repro-${process.pid}-${Date.now()}-${runSeq++}`
  // Identical shape to swe-bench-env's run tool; the command is the fixed `python /repro/repro.py`,
  // so no SWE_CMD env ride-along is needed. The script rides in on a SECOND :ro mount.
  // PYTHONPATH=/testbed is LOAD-BEARING: `python /repro/repro.py` puts /repro (the script's dir), not
  // the cwd, at sys.path[0], so without it `import <pkg>` resolves to the image's baked-in install —
  // the UNPATCHED code — and the gold-patched mount is never exercised (verified on psf__requests-1142:
  // post-gold run kept failing until PYTHONPATH pinned the mounted tree). The run tool never hits this
  // because `python -c`/`python -m` put the cwd on sys.path.
  // The __GOLD_APPLIED__ sentinel unambiguously separates "patch failed to apply" (no sentinel, git's
  // error in the output) from "patched code still fails" (sentinel present, script's own nonzero exit).
  const shell =
    '{ source /opt/miniconda3/etc/profile.d/conda.sh && conda activate testbed && cd /testbed && ' +
    (applyPatch ? 'git apply --whitespace=nowarn /repro/gold.patch && echo __GOLD_APPLIED__ && ' : '') +
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
  try {
    const r = await exec('docker', dockerArgs, { timeout: (T + 20) * 1000, killSignal: 'SIGKILL', maxBuffer: 20_000_000 })
    out = r.stdout
  } catch (e) {
    const err = e as { code?: number; killed?: boolean; stdout?: string; message?: string }
    if (typeof err.code === 'number') {
      code = err.code
      out = err.stdout ?? ''
    } else {
      exec('docker', ['rm', '-f', containerName], { timeout: 20_000 }).catch(() => {})
      if (err.killed) {
        code = 124
        out = `${err.stdout ?? ''}\n[host timeout: docker run exceeded ${T + 20}s and was killed]`
      } else {
        return { code: -1, out: '', timedOut: false, infraError: `run failed to execute (${String(err.message ?? e).slice(0, 200)})` }
      }
    }
  } finally {
    rmSync(scriptDir, { recursive: true, force: true })
  }
  if (code === 125 || /Cannot connect to the Docker daemon/i.test(out)) {
    return { code, out, timedOut: false, infraError: `docker: ${out.slice(0, 300)}` }
  }
  return { code, out, timedOut: code === 124 || code === 137 }
}

// ---------- authoring protocol (one optional read round, plain-text READ: lines) ----------

const AUTHOR_SYSTEM =
  'You are an expert Python engineer writing a REPRODUCTION script for a reported bug in an open-source repository.\n\n' +
  'Contract for the script you produce:\n' +
  '- A single self-contained Python file, executed as: python /repro/repro.py with cwd=/testbed, where /testbed is the ' +
  "repository checkout. The project's own environment is active, so the repository package and its dependencies are importable.\n" +
  '- Exit code 0 means the bug is FIXED. A nonzero exit (sys.exit(1), a failing assert, or an uncaught exception) means the ' +
  'bug is PRESENT. The script must exercise the EXACT behavior described in the issue.\n' +
  '- The repository tree is READ-ONLY: never modify, create, or delete files inside it. If you genuinely need a scratch ' +
  'file, use the tempfile module (system tmp is writable).\n' +
  `- No network access. Deterministic. Must finish well under ${REPRO_TIMEOUT_S} seconds.\n` +
  "- Prefer plain Python with assert statements. Do not invoke the repository's test-suite runner and do not depend on " +
  'pytest fixtures; importing the repository package directly is the way.\n' +
  '- Print one short line describing what was checked before exiting.\n\n' +
  'Be precise: the script must FAIL on the current buggy code and PASS once the underlying bug is properly fixed. Test the ' +
  'observable behavior the issue describes, not incidental implementation details that a legitimate fix might change.'

/** All-READ-lines detector: models sometimes wrap their read requests in a python fence, which must
 *  NOT be mistaken for a script (observed live: a "script" of `READ: astropy/timeseries/core.py`
 *  reached the jail and crashed with NameError — measuring the parser, not the model). */
function asReadRequests(block: string): string[] | null {
  const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length > 0 && lines.length <= 3 && lines.every((l) => /^READ:\s*\S+$/.test(l))) {
    return lines.map((l) => l.replace(/^READ:\s*/, ''))
  }
  return null
}

function extractScript(text: string): string | null {
  const fences = [...text.matchAll(/```(?:python|py)?\s*\n([\s\S]*?)```/g)]
  const last = fences.at(-1)?.[1]?.trim()
  if (!last || asReadRequests(last)) return null
  return last
}

function extractReads(text: string): string[] {
  return [...text.matchAll(/^READ:\s*(\S+)\s*$/gm)].map((m) => m[1]).slice(0, 3)
}

const tail = (s: string, n: number): string => (s.length > n ? `…${s.slice(s.length - n)}` : s)

/** Import name of the repo's primary package — a pure DIAGNOSTIC canary that separates "model wrote
 *  a bad script" from "this substrate cannot import the package from the RO clone mount" (compiled
 *  extensions live in the image's own /testbed, which the mount shadows). Never shown to the model. */
const IMPORT_NAME: Record<string, string> = {
  'astropy/astropy': 'astropy',
  'django/django': 'django',
  'matplotlib/matplotlib': 'matplotlib',
  'pallets/flask': 'flask',
  'psf/requests': 'requests',
  'pylint-dev/pylint': 'pylint',
  'pytest-dev/pytest': 'pytest',
  'scikit-learn/scikit-learn': 'sklearn',
  'sphinx-doc/sphinx': 'sphinx',
  'sympy/sympy': 'sympy',
}

// ---------- per-instance row ----------

interface Row {
  instanceId: string
  repo: string
  execMode: string
  image: string | null
  imagePresent: boolean
  canaryExit: number | null
  canaryOut: string
  readsRequested: string[]
  authorCalls: number
  retryUsed: boolean
  preExitFirst: number | null
  preExitFinal: number | null
  preOut: string
  valid: boolean
  goldApplyOk: boolean | null
  postExit: number | null
  postOut: string
  sound: boolean
  validAndSound: boolean
  autoClass: string
  script: string | null
  scriptFirst: string | null
  tokensIn: number
  tokensOut: number
  wallMs: number
  error?: string
}

async function calibrateInstance(
  env: Awaited<ReturnType<typeof createSweBenchEnvironment>>,
  bt: BenchTask,
): Promise<Row> {
  const t0 = Date.now()
  const id = bt.id
  const row: Row = {
    instanceId: id, repo: '', execMode: EXEC, image: null, imagePresent: false, canaryExit: null, canaryOut: '',
    readsRequested: [], authorCalls: 0, retryUsed: false, preExitFirst: null, preExitFinal: null,
    preOut: '', valid: false, goldApplyOk: null, postExit: null, postOut: '', sound: false,
    validAndSound: false, autoClass: 'infra-error', script: null, scriptFirst: null,
    tokensIn: 0, tokensOut: 0, wallMs: 0,
  }
  let handle: ArtifactHandle | null = null
  let patchedDir: string | null = null
  try {
    // Metadata (issue + gold) comes from the adapter's task row, never the model path.
    const md = bt.metadata as Record<string, string>
    row.repo = md.repo
    const gold = String(md.patch ?? '')
    if (!gold.trim()) throw new Error('gold patch missing from metadata')

    // 1. Hard-assert the cached docker image BEFORE paying for a clone or a model call.
    const img = await resolveImageForMetadata(bt.metadata ?? {})
    if (!img.ok) {
      row.autoClass = 'image-missing'
      row.error = img.reason
      return row
    }
    row.image = img.tag
    row.imagePresent = true

    // 2. Open the environment: host clone at base_commit. The `mount` substrate jails against this
    // tree :ro; the `image` substrate uses it only for list_files/read_file during authoring.
    const h = await env.environment.open({ id, systemPrompt: '', userPrompt: '', meta: {} } as AgenticTask)
    handle = h
    const treeDir = h.id
    const execTree = EXEC === 'image' ? null : treeDir

    // Diagnostic canary: can the package be imported on the execution substrate, and does the import
    // actually resolve INTO /testbed (vs the image's baked-in site-packages install)?
    const pkg = IMPORT_NAME[md.repo]
    if (pkg) {
      const c = await runPyInJail(img.tag, execTree, `import ${pkg}\nprint(getattr(${pkg}, '__file__', '?'))`)
      row.canaryExit = c.infraError ? -1 : c.code
      row.canaryOut = tail(c.out, 200)
    }

    // 3. Author the repro: issue text + top-level listing; ONE optional read round (≤3 files).
    const listing = String(await env.environment.call(h, 'list_files', { dir: '' })).slice(0, 5_000)
    const issue = String(md.problem_statement ?? '').slice(0, 20_000)
    const messages: ChatMsg[] = [
      { role: 'system', content: AUTHOR_SYSTEM },
      {
        role: 'user',
        content:
          `Repository: ${md.repo} (checked out at the commit where the bug is PRESENT).\n\n` +
          `Repository file listing (top levels):\n${listing}\n\n--- Issue ---\n${issue}\n\n--- Instructions ---\n` +
          'If you need to see specific source files before writing the script, reply with ONLY read requests, ' +
          'one per line, at most 3, in the form:\nREAD: path/relative/to/repo/root\n' +
          'Otherwise reply now with the final script in a single ```python fenced block.',
      },
    ]
    // Leak guard: no model message may carry gold-patch content. A distinctive added line is the sentinel.
    const goldMark = gold.split('\n').find((l) => l.startsWith('+') && !l.startsWith('+++') && l.trim().length > 12)?.slice(0, 80)
    const guardedComplete = async (msgs: ChatMsg[]): Promise<Completion> => {
      if (goldMark && msgs.some((m) => m.content.includes(goldMark))) {
        throw new Error('REFUSED: gold patch content leaked into model messages')
      }
      const c = await complete(msgs)
      row.authorCalls += 1
      row.tokensIn += c.tokensIn
      row.tokensOut += c.tokensOut
      return c
    }

    let resp = await guardedComplete(messages)
    let script = extractScript(resp.content)
    if (!script) {
      const reads = extractReads(resp.content)
      row.readsRequested = reads
      messages.push({ role: 'assistant', content: resp.content })
      if (reads.length) {
        const bodies: string[] = []
        for (const p of reads) {
          const c = String(await env.environment.call(h, 'read_file', { path: p }))
          bodies.push(`----- ${p} -----\n${c.slice(0, 12_000)}${c.length > 12_000 ? '\n…[truncated]' : ''}`)
        }
        messages.push({
          role: 'user',
          content: `${bodies.join('\n\n')}\n\nNow reply with the final script in a single \`\`\`python fenced block.`,
        })
      } else {
        messages.push({ role: 'user', content: 'Reply with ONLY the final Python script in a single ```python fenced block.' })
      }
      resp = await guardedComplete(messages)
      script = extractScript(resp.content)
    }
    if (!script) {
      row.autoClass = 'authoring-failed'
      row.error = `no script in response: ${resp.content.slice(0, 200)}`
      return row
    }
    row.script = script

    // 4. VALIDITY: the script must indicate bug-present (nonzero, non-timeout) on the UNPATCHED tree.
    let pre = await runPyInJail(img.tag, execTree, script)
    if (pre.infraError) throw new Error(pre.infraError)
    row.preExitFirst = pre.code
    let detected = pre.code !== 0 && !pre.timedOut
    if (!detected) {
      // One retry with feedback, per the prereg.
      row.retryUsed = true
      row.scriptFirst = script
      const feedback = pre.timedOut
        ? `your script timed out after ${REPRO_TIMEOUT_S}s on the known-buggy code. Write a faster, simpler script that still detects the bug.`
        : 'your script did not detect the bug on the known-buggy code: it exited 0 on the UNPATCHED repository. ' +
          `Its output was:\n${tail(pre.out, 1_500)}\nWrite a corrected script that FAILS (nonzero exit) on the buggy code.`
      messages.push({ role: 'assistant', content: `\`\`\`python\n${script}\n\`\`\`` }, { role: 'user', content: feedback })
      const retry = await guardedComplete(messages)
      const script2 = extractScript(retry.content)
      if (script2) {
        script = script2
        row.script = script2
        pre = await runPyInJail(img.tag, execTree, script2)
        if (pre.infraError) throw new Error(pre.infraError)
        detected = pre.code !== 0 && !pre.timedOut
      }
    }
    row.preExitFinal = pre.code
    row.preOut = tail(pre.out, 1_500)
    row.valid = detected
    if (!row.valid) {
      row.autoClass = pre.timedOut ? 'invalid-timeout' : 'invalid-exit0'
      return row
    }

    // 5. SOUNDNESS (script-side only): gold patch applied, same jail, must exit 0.
    let post: JailRun
    if (EXEC === 'image') {
      // Gold applied in-container to the image's built /testbed; a failed apply surfaces as exit≠0
      // with git's message in the output.
      post = await runPyInJail(img.tag, null, script, gold)
      if (post.infraError) throw new Error(post.infraError)
      row.goldApplyOk = post.out.includes('__GOLD_APPLIED__')
      if (!row.goldApplyOk) {
        row.autoClass = 'gold-apply-failed'
        row.error = `gold patch failed to apply in-container: ${tail(post.out, 200)}`
        return row
      }
    } else {
      // Host-side apply onto a COPY of the tree, mounted the same way the env mounts the original.
      patchedDir = mkdtempSync(join(tmpdir(), 'swe-gold-'))
      cpSync(treeDir, patchedDir, { recursive: true })
      const goldFile = join(patchedDir, '.swe-gold.patch')
      writeFileSync(goldFile, gold.endsWith('\n') ? gold : `${gold}\n`)
      try {
        await exec('git', ['-C', patchedDir, 'apply', '--whitespace=nowarn', goldFile], { timeout: 60_000 })
        row.goldApplyOk = true
      } catch {
        // Official-harness fallback: GNU patch with fuzz.
        try {
          await exec('patch', ['-p1', '--fuzz=5', '-i', goldFile], { cwd: patchedDir, timeout: 60_000 })
          row.goldApplyOk = true
        } catch (e2) {
          row.goldApplyOk = false
          row.autoClass = 'gold-apply-failed'
          row.error = `gold patch failed to apply: ${(e2 as Error).message.slice(0, 200)}`
          return row
        }
      }
      rmSync(goldFile, { force: true })
      post = await runPyInJail(img.tag, patchedDir, script)
      if (post.infraError) throw new Error(post.infraError)
    }
    row.postExit = post.code
    row.postOut = tail(post.out, 1_500)
    row.sound = post.code === 0
    row.validAndSound = row.valid && row.sound
    if (row.validAndSound) row.autoClass = 'ok'
    else if (post.timedOut) row.autoClass = 'unsound-timeout'
    else if (/ModuleNotFoundError|ImportError/.test(post.out)) row.autoClass = 'unsound-import-error'
    else row.autoClass = 'unsound-still-failing'
    return row
  } catch (e) {
    row.autoClass = row.autoClass === 'ok' ? 'infra-error' : row.autoClass
    row.error = e instanceof Error ? e.message.slice(0, 400) : String(e).slice(0, 400)
    return row
  } finally {
    row.wallMs = Date.now() - t0
    if (patchedDir) rmSync(patchedDir, { recursive: true, force: true })
    if (handle) await env.environment.close(handle).catch(() => {})
  }
}

// ---------- driver ----------

/** The 23-instance backbone: every instance whose swebench eval image is cached locally.
 *  Tag → id mapping inverts make_test_spec's `__` → `_1776_` name mangling. */
async function cachedInstanceIds(): Promise<string[]> {
  const { stdout } = await exec('docker', ['images', '--format', '{{.Repository}}'], { timeout: 30_000 })
  const ids = new Set<string>()
  for (const line of stdout.split('\n')) {
    const m = /(?:^|\/)sweb\.eval\.x86_64\.(.+)$/.exec(line.trim())
    if (m) ids.add(m[1].replace('_1776_', '__'))
  }
  return [...ids].sort()
}

async function main(): Promise<void> {
  if (!ZAI_KEY) throw new Error('ZAI_API_KEY required (run under dotenvx: agent-state.env)')
  const ids = process.env.IDS
    ? process.env.IDS.split(',').map((s) => s.trim()).filter(Boolean)
    : await cachedInstanceIds()
  if (!ids.length) throw new Error('no cached sweb.eval images found and no IDS given')

  console.log('═══ SWE-bench Stage 0 — reproduction-oracle calibration ═══')
  console.log(`model=${MODEL} base=${ZAI_BASE} maxTokens=${MAX_TOKENS} temp=${TEMP} conc=${CONC} reproTimeout=${REPRO_TIMEOUT_S}s exec=${EXEC}`)
  console.log(`instances (${ids.length}): ${ids.join(', ')}`)
  console.log(`out=${OUT}`)

  const env = await createSweBenchEnvironment(ids.length, { ids })
  // One dataset scan for all instances; per-instance metadata (issue + gold) rides the BenchTask.
  const taskById = new Map((await env.adapter.loadTasks({ ids, split: 'test' })).map((t) => [t.id, t]))
  const missing = ids.filter((id) => !taskById.has(id))
  if (missing.length) throw new Error(`instances not found in SWE-bench_Verified: ${missing.join(', ')}`)
  const rows: Row[] = []
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < ids.length) {
      const i = next++
      const id = ids[i]
      console.log(`[${i + 1}/${ids.length}] ${id} …`)
      const row = await calibrateInstance(env, taskById.get(id) as BenchTask)
      rows.push(row)
      appendFileSync(OUT, `${JSON.stringify(row)}\n`)
      console.log(
        `[${i + 1}/${ids.length}] ${id} → ${row.autoClass}` +
          ` (pre=${row.preExitFinal ?? '-'} post=${row.postExit ?? '-'} retry=${row.retryUsed ? 'y' : 'n'}` +
          ` calls=${row.authorCalls} tok=${row.tokensIn}/${row.tokensOut} wall=${Math.round(row.wallMs / 1000)}s)` +
          (row.error ? ` err=${row.error.slice(0, 120)}` : ''),
      )
    }
  }
  await Promise.all(Array.from({ length: CONC }, () => worker()))

  // ---------- summary ----------
  const n = rows.length
  const present = rows.filter((r) => r.imagePresent).length
  const valid = rows.filter((r) => r.valid).length
  const sound = rows.filter((r) => r.validAndSound).length
  const retried = rows.filter((r) => r.retryUsed).length
  const classes = new Map<string, number>()
  for (const r of rows) classes.set(r.autoClass, (classes.get(r.autoClass) ?? 0) + 1)

  console.log('\n══ per-instance ══')
  console.log('instance | class | canary | pre1 | preF | valid | goldApply | post | sound | retry | calls | tokIn/out | wall_s')
  for (const r of [...rows].sort((a, b) => a.instanceId.localeCompare(b.instanceId))) {
    console.log(
      `${r.instanceId} | ${r.autoClass} | ${r.canaryExit ?? '-'} | ${r.preExitFirst ?? '-'} | ${r.preExitFinal ?? '-'} | ` +
        `${r.valid ? 1 : 0} | ${r.goldApplyOk === null ? '-' : r.goldApplyOk ? 1 : 0} | ${r.postExit ?? '-'} | ${r.sound ? 1 : 0} | ` +
        `${r.retryUsed ? 1 : 0} | ${r.authorCalls} | ${r.tokensIn}/${r.tokensOut} | ${Math.round(r.wallMs / 1000)}`,
    )
  }
  console.log('\n══ summary ══')
  console.log(`n=${n} imagePresent=${present} valid(bug detected pre-patch)=${valid} valid+sound=${sound} retryUsed=${retried}`)
  console.log(`failure modes: ${[...classes.entries()].map(([k, v]) => `${k}=${v}`).join('  ')}`)
  const rate = n ? sound / n : 0
  const pct = (100 * rate).toFixed(1)
  console.log(`\nSTAGE-0 GATE (>=60% valid+sound): ${rate >= 0.6 ? 'PASS' : 'FAIL'} — ${sound}/${n} = ${pct}%`)
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
