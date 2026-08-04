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
 * Env: ZAI_API_KEY (required unless CANARY_ONLY), ZAI_BASE, MODEL=glm-5.2, MAX_TOKENS=12000, TEMP=0.2,
 *      CONC=3, REPRO_TIMEOUT=120 (s), LLM_TIMEOUT_MS=480000, IDS=comma-list override, OUT=jsonl path,
 *      REPRO_EXEC=mount|image (execution substrate; see the constant below),
 *      CANARY_ONLY=1 (run ONLY the per-instance execution canary — no model calls, no grading —
 *      to decide which substrate is trustworthy per instance before spending on authoring).
 */
import { execFile } from 'node:child_process'
import { appendFileSync, cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { AgenticTask, ArtifactHandle } from '@tangle-network/agent-runtime/kernel'
import type { BenchTask } from './benchmarks/types'
import { createSweBenchEnvironment, resolveImageForMetadata } from './swe-bench-env'
import {
  APPLY_SENTINEL,
  cachedInstanceIds,
  extractReadRequests as extractReads,
  extractReproScript as extractScript,
  IMPORT_NAME,
  importCanaryScript,
  type JailRun,
  reproAuthorSystem,
  runPyInJail,
  tail,
  zaiChatRaw,
} from './swe-jail'

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
/** Canary-only sweep: measure per-instance substrate trustworthiness (gold applied, import resolves
 *  into the patched tree) across all instances with ZERO model calls. */
const CANARY_ONLY = process.env.CANARY_ONLY === '1'

// ---------- model client (swe-jail's zaiChatRaw: patient 429 ladder + empty-content retry —
// the glm reasoning path starves `content` when reasoning eats max_tokens) ----------

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
  const { json, attempts } = await zaiChatRaw(
    { base: ZAI_BASE, key: ZAI_KEY, timeoutMs: LLM_TIMEOUT_MS },
    { model: MODEL, max_tokens: MAX_TOKENS, temperature: TEMP, messages },
    {
      name: 'swe-reproduction-calibrator',
      model: { provider: 'zai', default: MODEL, reasoningEffort: 'high' },
      prompt: { systemPrompt: AUTHOR_SYSTEM },
    },
  )
  const d = json as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  return {
    content: d.choices?.[0]?.message?.content ?? '',
    attempts,
    tokensIn: d.usage?.prompt_tokens ?? 0,
    tokensOut: d.usage?.completion_tokens ?? 0,
  }
}

// ---------- authoring protocol (one optional read round, plain-text READ: lines) ----------
// The protocol constants/parsers now live in swe-jail.ts (shared with the stream driver);
// behavior here is byte-identical to the in-file originals.

const AUTHOR_SYSTEM = reproAuthorSystem(REPRO_TIMEOUT_S)

// ---------- per-instance row ----------

interface Row {
  instanceId: string
  repo: string
  execMode: string
  image: string | null
  imagePresent: boolean
  canaryExit: number | null
  canaryOut: string
  /** true = gold applied AND import resolved into the patched tree; false = this substrate cannot
   *  grade this instance; null = repo not in IMPORT_NAME (canary not applicable). */
  canaryPass: boolean | null
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
    canaryPass: null, readsRequested: [], authorCalls: 0, retryUsed: false, preExitFirst: null, preExitFinal: null,
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
    // tree :ro; the `image` substrate uses it only for list_files/read_file during authoring — so a
    // canary-only image sweep skips the clone (and its network cost) entirely.
    let treeDir: string | null = null
    if (EXEC === 'mount' || !CANARY_ONLY) {
      const h = await env.environment.open({ id, systemPrompt: '', userPrompt: '', meta: {} } as AgenticTask)
      handle = h
      treeDir = h.id
    }
    const execTree = EXEC === 'image' ? null : treeDir

    // Mount substrate: apply the gold patch host-side to a COPY of the tree UP FRONT — the canary
    // must observe the tree exactly as the soundness run will mount it. A failed apply is terminal
    // before any model call is spent.
    if (EXEC === 'mount') {
      patchedDir = mkdtempSync(join(tmpdir(), 'swe-gold-'))
      cpSync(treeDir as string, patchedDir, { recursive: true })
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
    }

    // EXECUTION CANARY (mode-deciding, zero model calls): with the gold patch applied to the tree
    // under test, `import <pkg>` must succeed AND resolve INTO that tree. PYTHONPATH=/testbed is
    // already pinned by runPyInJail, so a site-packages resolution here (exit 3) means this substrate
    // would grade code the patch never reaches — the instance is env-unresolvable in this mode.
    const pkg = IMPORT_NAME[md.repo]
    if (pkg) {
      const canaryScript = importCanaryScript(pkg)
      const c = EXEC === 'image'
        ? await runPyInJail(img.tag, null, canaryScript, gold, { timeoutS: REPRO_TIMEOUT_S })
        : await runPyInJail(img.tag, patchedDir, canaryScript, undefined, { timeoutS: REPRO_TIMEOUT_S })
      if (c.infraError) throw new Error(c.infraError)
      row.canaryExit = c.code
      row.canaryOut = tail(c.out, 200)
      if (EXEC === 'image') {
        row.goldApplyOk = c.out.includes(APPLY_SENTINEL)
        if (!row.goldApplyOk) {
          row.autoClass = 'gold-apply-failed'
          row.error = `gold patch failed to apply in-container: ${tail(c.out, 200)}`
          return row
        }
      }
      row.canaryPass = c.code === 0
      if (!row.canaryPass) {
        row.autoClass = 'env-unresolvable'
        row.error = `canary: import ${pkg} did not resolve into the patched tree (exit ${c.code})`
        return row
      }
    }
    if (CANARY_ONLY) {
      row.autoClass = row.canaryPass === true ? 'canary-pass' : 'canary-unknown'
      return row
    }
    const h = handle as ArtifactHandle

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
    let pre = await runPyInJail(img.tag, execTree, script, undefined, { timeoutS: REPRO_TIMEOUT_S })
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
        pre = await runPyInJail(img.tag, execTree, script2, undefined, { timeoutS: REPRO_TIMEOUT_S })
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
      post = await runPyInJail(img.tag, null, script, gold, { timeoutS: REPRO_TIMEOUT_S })
      if (post.infraError) throw new Error(post.infraError)
      row.goldApplyOk = post.out.includes(APPLY_SENTINEL)
      if (!row.goldApplyOk) {
        row.autoClass = 'gold-apply-failed'
        row.error = `gold patch failed to apply in-container: ${tail(post.out, 200)}`
        return row
      }
    } else {
      // Mount substrate: gold was already applied host-side to the canary-verified copy up front.
      post = await runPyInJail(img.tag, patchedDir as string, script, undefined, { timeoutS: REPRO_TIMEOUT_S })
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

async function main(): Promise<void> {
  if (!ZAI_KEY && !CANARY_ONLY) throw new Error('ZAI_API_KEY required (run under dotenvx: agent-state.env)')
  const ids = process.env.IDS
    ? process.env.IDS.split(',').map((s) => s.trim()).filter(Boolean)
    : await cachedInstanceIds()
  if (!ids.length) throw new Error('no cached sweb.eval images found and no IDS given')

  console.log(`═══ SWE-bench Stage 0 — ${CANARY_ONLY ? 'execution-canary sweep (no model calls)' : 'reproduction-oracle calibration'} ═══`)
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
    const canary = r.canaryPass === null ? `?(${r.canaryExit ?? '-'})` : r.canaryPass ? 'pass' : `FAIL(${r.canaryExit})`
    console.log(
      `${r.instanceId} | ${r.autoClass} | ${canary} | ${r.preExitFirst ?? '-'} | ${r.preExitFinal ?? '-'} | ` +
        `${r.valid ? 1 : 0} | ${r.goldApplyOk === null ? '-' : r.goldApplyOk ? 1 : 0} | ${r.postExit ?? '-'} | ${r.sound ? 1 : 0} | ` +
        `${r.retryUsed ? 1 : 0} | ${r.authorCalls} | ${r.tokensIn}/${r.tokensOut} | ${Math.round(r.wallMs / 1000)}`,
    )
  }
  console.log('\n══ summary ══')
  console.log(`n=${n} imagePresent=${present} canaryPass=${rows.filter((r) => r.canaryPass === true).length} valid(bug detected pre-patch)=${valid} valid+sound=${sound} retryUsed=${retried}`)
  console.log(`failure modes: ${[...classes.entries()].map(([k, v]) => `${k}=${v}`).join('  ')}`)
  if (!CANARY_ONLY) {
    const rate = n ? sound / n : 0
    const pct = (100 * rate).toFixed(1)
    console.log(`\nSTAGE-0 GATE (>=60% valid+sound): ${rate >= 0.6 ? 'PASS' : 'FAIL'} — ${sound}/${n} = ${pct}%`)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
