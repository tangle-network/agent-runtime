/**
 * Stage 1 of the SWE-bench frontier push — the STRUCTURAL-SYSTEM mechanics pilot
 * (contract: supervisor-lab/docs/results/PREREG-swe-frontier.md, Stage 1; execution design per the
 * AMENDMENT + CLOSURE: image substrate everywhere, per-instance execution canary asserted at open).
 *
 * ARM=system, per instance:
 *   1. canary — the Stage-0 execution canary on the image substrate (gold applied in-container,
 *      `import <pkg>` must resolve into /testbed). Gold is used strictly script-side, never near a
 *      model message (transport-level leak guard, below).
 *   2. repro — the instance's Stage-0 valid+sound repro script is REUSED (REPRO_MANIFEST; source
 *      recorded per row) and re-verified on THIS substrate with zero model calls: validity (nonzero
 *      exit on the unpatched /testbed) + soundness (exit 0 under gold, in-container). A script that
 *      fails re-verification degrades to repro=none — recorded, never silent. Instances with no
 *      Stage-0 repro run repro=none and measure the no-signal path (selection = blind-first).
 *   3. k=4 independent patch attempts — each the swe-emit-patch protocol verbatim (SWE_SEED_PROMPT,
 *      list/read/edit tools on a fresh host clone, runAgentic refine budget=1, glm-5.2 temp 0.8;
 *      the candidate is the workspace `git diff`, captured from inside score()).
 *   4. selection — each candidate is scored in-image: `git apply` the candidate to the container's
 *      /testbed (writable layer, --rm discards), run the repro. Argmax: repro-pass first, then
 *      crash-lowest (fail < timeout < apply-fail < empty), first index breaks ties. With repro=none
 *      the selection degrades to blind-first (first non-empty candidate).
 *   5. ≤2 guarded repair rounds on the best — the repro failure output (+ the current diff, both
 *      model-visible by construction) steers a fresh emit-patch attempt on a workspace with the
 *      best diff pre-applied; the combined diff must STRICTLY improve the repro outcome to displace
 *      (a repro-pass can never be displaced by a repro-fail — repair only runs while failing).
 *   6. final diff locked → Phase B.
 * ARM=solo: one emit-patch attempt (temp 0.7 — runShot's July-protocol default), same environment,
 *   same 23 instances. The honest single-attempt reference.
 *
 * Phase B (hidden judge): adapter.judge — the OFFICIAL swebench harness — runs serialized
 * (max_workers 1) over the locked final diffs only, strictly AFTER every arm decision. Judge
 * separation is asserted at the transport chokepoint: every outbound request's system/user messages
 * (the strings WE author) are checked against gold-patch + test_patch content marks and refused on
 * contact. Assistant/tool messages are exempt by construction (the model's own text and reads of
 * the base tree — a model that independently authors the gold line is a success, not a leak).
 *
 *   cd ~/company/devops/secrets && dotenvx run -f agent-state.env -- bash -c \
 *     'cd ~/code/agent-runtime-swe && ARM=system REPRO_MANIFEST=/path/manifest.json \
 *      OUT=/path/swe-stage1-system.jsonl node_modules/.bin/tsx bench/src/swe-structural.mts'
 *
 * Env: ARM=system|solo (required), ZAI_API_KEY (required), ZAI_BASE, MODEL=glm-5.2,
 *      MAX_TOKENS=12000, K=4, REPAIRS=2, TEMP=0.8 (system attempts+repairs), SOLO_TEMP=0.7,
 *      INNER_TURNS=40, CONC=2, REPRO_TIMEOUT=120 (s), LLM_TIMEOUT_MS=480000, IDS=comma-list,
 *      OUT=jsonl path, REPRO_MANIFEST=json path (system), SKIP_JUDGE=1 (Phase A only),
 *      PRICE_IN/PRICE_OUT (USD per Mtok for the cost table; defaults are the assumed zai list rate).
 *      Rows are incremental (OUT.phaseA then OUT) and both phases resume by instance id.
 */
import { execFile } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { AgenticSurface, AgenticTask, ArtifactHandle, SurfaceScore } from '@tangle-network/agent-runtime/kernel'
import { refine, runAgentic } from '@tangle-network/agent-runtime/kernel'
import type { BenchTask } from './benchmarks/types'
import { createSweBenchEnvironment, resolveImageForMetadata, SWE_SEED_PROMPT } from './swe-bench-env'
import {
  APPLY_SENTINEL,
  assertNoHiddenLeak,
  cachedInstanceIds,
  IMPORT_NAME,
  importCanaryScript,
  runPyInJail,
  tail,
  zaiChatRaw,
} from './swe-jail'

const exec = promisify(execFile)

// ---------- config ----------

const ARM = process.env.ARM ?? ''
if (ARM !== 'system' && ARM !== 'solo') throw new Error(`ARM must be system|solo, got "${ARM}"`)
const ZAI_BASE = process.env.ZAI_BASE ?? 'https://api.z.ai/api/coding/paas/v4'
const ZAI_KEY = process.env.ZAI_API_KEY ?? ''
if (!ZAI_KEY) throw new Error('ZAI_API_KEY required (run under dotenvx: agent-state.env)')
const MODEL = process.env.MODEL ?? 'glm-5.2'
// glm-5.2 is a reasoning model: hidden reasoning consumes max_tokens, so <8000 starves content.
const MAX_TOKENS = Number(process.env.MAX_TOKENS ?? 12_000)
const K = Number(process.env.K ?? 4)
const REPAIRS = Number(process.env.REPAIRS ?? 2)
const TEMP = Number(process.env.TEMP ?? 0.8)
const SOLO_TEMP = Number(process.env.SOLO_TEMP ?? 0.7)
const INNER_TURNS = Number(process.env.INNER_TURNS ?? 40)
const CONC = Math.max(1, Math.min(4, Number(process.env.CONC ?? 2)))
const REPRO_TIMEOUT_S = Number(process.env.REPRO_TIMEOUT ?? 120)
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 480_000)
const OUT = process.env.OUT ?? `swe-stage1-${ARM}.jsonl`
const PHASE_A_OUT = `${OUT}.phaseA`
const SKIP_JUDGE = process.env.SKIP_JUDGE === '1'
// Cost-table rates, USD per Mtok. ASSUMED (zai coding-plan tokens have no per-call list price);
// override with PRICE_IN/PRICE_OUT. The summary labels them as assumed.
const PRICE_IN = Number(process.env.PRICE_IN ?? 0.6)
const PRICE_OUT = Number(process.env.PRICE_OUT ?? 2.2)

interface ReproManifestEntry {
  script: string
  source: string
  stage0Class: string
}

const MANIFEST: Record<string, ReproManifestEntry> = (() => {
  if (ARM !== 'system') return {}
  const p = process.env.REPRO_MANIFEST
  if (!p) throw new Error('REPRO_MANIFEST required for ARM=system (Stage-0 valid+sound repro scripts)')
  return JSON.parse(readFileSync(p, 'utf8')) as Record<string, ReproManifestEntry>
})()

// ---------- transport: zai direct, patient ladder, leak guard at the chokepoint ----------

interface Counter {
  calls: number
  httpAttempts: number
  tokensIn: number
  tokensOut: number
  guardedMsgs: number
}

const newCounter = (): Counter => ({ calls: 0, httpAttempts: 0, tokensIn: 0, tokensOut: 0, guardedMsgs: 0 })

/** Distinctive content marks for the leak guard: the first substantive ADDED line of the gold patch
 *  and of the hidden test patch. Never shown to any model; used only to refuse outbound messages. */
function leakMarks(md: Record<string, string>): string[] {
  const marks: string[] = []
  for (const src of [md.patch, md.test_patch]) {
    const m = String(src ?? '')
      .split('\n')
      .find((l) => l.startsWith('+') && !l.startsWith('+++') && l.trim().length > 12)
      ?.slice(0, 80)
    if (m) marks.push(m)
  }
  return marks
}

/** Every model call in this driver flows through here (runAgentic's `complete` seam), so the judge
 *  separation is asserted once, at the single chokepoint, for every arm and every round. */
const makeTransport =
  (marks: string[], counter: Counter) =>
  async (body: Record<string, unknown>): Promise<unknown> => {
    const msgs = (body.messages ?? []) as Array<{ role?: string; content?: unknown }>
    counter.guardedMsgs += assertNoHiddenLeak(marks, msgs)
    const { json, attempts } = await zaiChatRaw({ base: ZAI_BASE, key: ZAI_KEY, timeoutMs: LLM_TIMEOUT_MS }, body)
    counter.calls += 1
    counter.httpAttempts += attempts
    const u = (json as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage
    counter.tokensIn += u?.prompt_tokens ?? 0
    counter.tokensOut += u?.completion_tokens ?? 0
    return json
  }

// ---------- one emit-patch attempt (the swe-emit-patch protocol, with an optional pre-applied
// base diff for repair rounds) ----------

interface AttemptOut {
  diff: string
  completions: number
  tokensIn: number
  tokensOut: number
  calls: number
  wallMs: number
  error?: string
}

async function emitAttempt(
  environment: AgenticSurface,
  bt: BenchTask,
  cfg: {
    temperature: number
    marks: string[]
    instanceCounter: Counter
    preApply?: string
    promptAppendix?: string
  },
): Promise<AttemptOut> {
  const t0 = Date.now()
  const counter = newCounter()
  // Capture the patch from inside score() (called during the refine loop, BEFORE the surface closes
  // and rms the checkout). Keep the LATEST non-empty diff — the emit-patch pattern.
  const capture = { patch: '' }
  const proxy: AgenticSurface = {
    ...environment,
    async open(t: AgenticTask): Promise<ArtifactHandle> {
      const h = await environment.open(t)
      const pre = cfg.preApply
      if (pre?.trim()) {
        const f = join(h.id, '.swe-preapply.diff')
        writeFileSync(f, pre.endsWith('\n') ? pre : `${pre}\n`)
        try {
          await exec('git', ['-C', h.id, 'apply', '--whitespace=nowarn', f], { timeout: 60_000 })
        } finally {
          rmSync(f, { force: true })
        }
      }
      return h
    },
    async score(_t: AgenticTask, handle: ArtifactHandle): Promise<SurfaceScore> {
      try {
        const d = await exec('git', ['-C', handle.id, 'diff'], { maxBuffer: 40_000_000, timeout: 60_000 })
        if (d.stdout.trim()) capture.patch = d.stdout
      } catch {
        /* workspace gone or git error → keep whatever we already captured */
      }
      return { passes: capture.patch.trim() ? 1 : 0, total: 1, errored: 0 }
    },
  }
  const task: AgenticTask = {
    id: bt.id,
    systemPrompt: SWE_SEED_PROMPT,
    userPrompt: cfg.promptAppendix ? `${bt.prompt}\n\n${cfg.promptAppendix}` : bt.prompt,
    meta: { instanceId: bt.id },
  }
  let error: string | undefined
  try {
    const r = await runAgentic({
      surface: proxy,
      task,
      strategy: refine,
      routerBaseUrl: 'zai-direct', // unused: the `complete` transport short-circuits the router
      routerKey: 'zai-direct',
      model: MODEL,
      maxTokens: MAX_TOKENS,
      temperature: cfg.temperature,
      innerTurns: INNER_TURNS,
      budget: 1,
      complete: makeTransport(cfg.marks, counter),
    })
    cfg.instanceCounter.calls += counter.calls
    cfg.instanceCounter.httpAttempts += counter.httpAttempts
    cfg.instanceCounter.tokensIn += counter.tokensIn
    cfg.instanceCounter.tokensOut += counter.tokensOut
    cfg.instanceCounter.guardedMsgs += counter.guardedMsgs
    return {
      diff: capture.patch,
      completions: r.completions,
      tokensIn: counter.tokensIn,
      tokensOut: counter.tokensOut,
      calls: counter.calls,
      wallMs: Date.now() - t0,
    }
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300)
    cfg.instanceCounter.calls += counter.calls
    cfg.instanceCounter.httpAttempts += counter.httpAttempts
    cfg.instanceCounter.tokensIn += counter.tokensIn
    cfg.instanceCounter.tokensOut += counter.tokensOut
    cfg.instanceCounter.guardedMsgs += counter.guardedMsgs
    return {
      diff: capture.patch,
      completions: 0,
      tokensIn: counter.tokensIn,
      tokensOut: counter.tokensOut,
      calls: counter.calls,
      wallMs: Date.now() - t0,
      error,
    }
  }
}

// ---------- in-image candidate scoring ----------

/** Severity ordering for argmax (lower is better): 0 repro-pass, 1 repro-fail (clean nonzero exit),
 *  2 repro-timeout, 3 candidate failed to apply, 4 empty candidate. "Crash-lowest" is realized as
 *  this exit-class ordering; ties break on first index (deterministic). */
interface CandScore {
  applyOk: boolean | null
  exit: number | null
  timedOut: boolean
  severity: number
  out: string
}

const EMPTY_SCORE: CandScore = { applyOk: null, exit: null, timedOut: false, severity: 4, out: '' }
const UNSCORED: CandScore = { applyOk: null, exit: null, timedOut: false, severity: 1, out: '(no repro signal)' }

async function scoreCandidate(imageTag: string, repro: string | null, diff: string): Promise<CandScore> {
  if (!diff.trim()) return EMPTY_SCORE
  if (!repro) return UNSCORED
  const r = await runPyInJail(imageTag, null, repro, diff, { timeoutS: REPRO_TIMEOUT_S })
  if (r.infraError) throw new Error(r.infraError)
  const applyOk = r.out.includes(APPLY_SENTINEL)
  if (!applyOk) return { applyOk, exit: r.code, timedOut: r.timedOut, severity: 3, out: tail(r.out, 800) }
  if (r.timedOut) return { applyOk, exit: r.code, timedOut: true, severity: 2, out: tail(r.out, 800) }
  return { applyOk, exit: r.code, timedOut: false, severity: r.code === 0 ? 0 : 1, out: tail(r.out, 1_500) }
}

// ---------- rows ----------

interface CandidateRow {
  idx: number
  diff: string
  diffBytes: number
  completions: number
  calls: number
  tokensIn: number
  tokensOut: number
  wallMs: number
  attemptError: string | null
  applyOk: boolean | null
  reproExit: number | null
  reproTimedOut: boolean
  severity: number
  reproOutTail: string
}

interface RepairRow {
  round: number
  baseFrom: string
  baseSeverity: number
  diff: string
  diffBytes: number
  completions: number
  calls: number
  tokensIn: number
  tokensOut: number
  wallMs: number
  attemptError: string | null
  applyOk: boolean | null
  reproExit: number | null
  severity: number
  accepted: boolean
}

interface Row {
  instanceId: string
  arm: string
  repo: string
  model: string
  image: string | null
  execMode: 'image'
  temperature: number
  innerTurns: number
  k: number
  // canary + repro provenance (system arm)
  canaryExit: number | null
  canaryPass: boolean | null
  reproSource: string
  reproStatus: string
  reproScript: string | null
  reproPreExit: number | null
  reproGoldExit: number | null
  // candidates + selection + repair receipts (system arm)
  candidates: CandidateRow[]
  selection: { mode: string; selectedIdx: number; movedOffFirst: boolean } | null
  repairs: RepairRow[]
  repairStop: string | null
  finalFrom: string
  finalDiff: string
  // hidden judge (Phase B; locked-after-decisions)
  hiddenResolved: boolean | null
  judgeDetail: string | null
  judgeMs: number | null
  judgeSkipped: string | null
  // cost + guard receipts
  llmCalls: number
  httpAttempts: number
  tokensIn: number
  tokensOut: number
  guardedMsgs: number
  wallMs: number
  error?: string
}

// ---------- phase A: all arm decisions (no judge anywhere) ----------

type Env = Awaited<ReturnType<typeof createSweBenchEnvironment>>

async function phaseA(env: Env, bt: BenchTask): Promise<Row> {
  const t0 = Date.now()
  const md = bt.metadata as Record<string, string>
  const counter = newCounter()
  const row: Row = {
    instanceId: bt.id, arm: ARM, repo: md.repo, model: MODEL, image: null, execMode: 'image',
    temperature: ARM === 'system' ? TEMP : SOLO_TEMP, innerTurns: INNER_TURNS, k: ARM === 'system' ? K : 1,
    canaryExit: null, canaryPass: null, reproSource: 'none', reproStatus: 'none', reproScript: null,
    reproPreExit: null, reproGoldExit: null, candidates: [], selection: null, repairs: [],
    repairStop: null, finalFrom: 'none', finalDiff: '', hiddenResolved: null, judgeDetail: null,
    judgeMs: null, judgeSkipped: null, llmCalls: 0, httpAttempts: 0, tokensIn: 0, tokensOut: 0,
    guardedMsgs: 0, wallMs: 0,
  }
  const marks = leakMarks(md)
  try {
    const img = await resolveImageForMetadata(bt.metadata ?? {})
    if (!img.ok) throw new Error(`image missing: ${img.reason}`)
    row.image = img.tag

    if (ARM === 'solo') {
      const a = await emitAttempt(env.environment, bt, { temperature: SOLO_TEMP, marks, instanceCounter: counter })
      row.candidates.push({
        idx: 0, diff: a.diff, diffBytes: a.diff.length, completions: a.completions, calls: a.calls,
        tokensIn: a.tokensIn, tokensOut: a.tokensOut, wallMs: a.wallMs, attemptError: a.error ?? null,
        applyOk: null, reproExit: null, reproTimedOut: false, severity: a.diff.trim() ? 1 : 4, reproOutTail: '',
      })
      row.finalDiff = a.diff
      row.finalFrom = 'candidate:0'
      return row
    }

    // 1. EXECUTION CANARY (image substrate, gold in-container — script-side only, zero model calls).
    const pkg = IMPORT_NAME[md.repo]
    if (!pkg) throw new Error(`no IMPORT_NAME for ${md.repo} — canary not expressible`)
    const gold = String(md.patch ?? '')
    if (!gold.trim()) throw new Error('gold patch missing from metadata')
    const c = await runPyInJail(img.tag, null, importCanaryScript(pkg), gold, { timeoutS: REPRO_TIMEOUT_S })
    if (c.infraError) throw new Error(c.infraError)
    row.canaryExit = c.code
    row.canaryPass = c.code === 0 && c.out.includes(APPLY_SENTINEL)
    if (!row.canaryPass) throw new Error(`canary failed (exit ${c.code}): this substrate cannot grade this instance`)

    // 2. Repro reuse + re-verification on THIS substrate (validity without gold, soundness with).
    const manifest = MANIFEST[bt.id]
    let repro: string | null = null
    if (manifest) {
      row.reproSource = manifest.source
      row.reproScript = manifest.script
      const pre = await runPyInJail(img.tag, null, manifest.script, undefined, { timeoutS: REPRO_TIMEOUT_S })
      if (pre.infraError) throw new Error(pre.infraError)
      row.reproPreExit = pre.code
      if (pre.timedOut) row.reproStatus = 'degraded-timeout'
      else if (pre.code === 0) row.reproStatus = 'degraded-invalid'
      else {
        const post = await runPyInJail(img.tag, null, manifest.script, gold, { timeoutS: REPRO_TIMEOUT_S })
        if (post.infraError) throw new Error(post.infraError)
        row.reproGoldExit = post.code
        if (post.code === 0 && post.out.includes(APPLY_SENTINEL)) {
          row.reproStatus = 'ok'
          repro = manifest.script
        } else {
          row.reproStatus = 'degraded-unsound'
        }
      }
    }

    // 3. k independent candidates (serial within the instance — CONC instances bound zai concurrency).
    const diffs: string[] = []
    for (let i = 0; i < K; i += 1) {
      const a = await emitAttempt(env.environment, bt, { temperature: TEMP, marks, instanceCounter: counter })
      diffs.push(a.diff)
      row.candidates.push({
        idx: i, diff: a.diff, diffBytes: a.diff.length, completions: a.completions, calls: a.calls,
        tokensIn: a.tokensIn, tokensOut: a.tokensOut, wallMs: a.wallMs, attemptError: a.error ?? null,
        applyOk: null, reproExit: null, reproTimedOut: false, severity: -1, reproOutTail: '',
      })
    }

    // 4. In-image scoring + argmax.
    const scores: CandScore[] = []
    for (let i = 0; i < K; i += 1) {
      const s = await scoreCandidate(img.tag, repro, diffs[i] as string)
      scores.push(s)
      const cand = row.candidates[i] as CandidateRow
      cand.applyOk = s.applyOk
      cand.reproExit = s.exit
      cand.reproTimedOut = s.timedOut
      cand.severity = s.severity
      cand.reproOutTail = s.out
    }
    let selectedIdx: number
    let mode: string
    if (repro) {
      mode = 'repro-argmax'
      selectedIdx = 0
      for (let i = 1; i < K; i += 1) {
        if ((scores[i] as CandScore).severity < (scores[selectedIdx] as CandScore).severity) selectedIdx = i
      }
    } else {
      mode = 'blind-first'
      const firstNonEmpty = diffs.findIndex((d) => d.trim().length > 0)
      selectedIdx = firstNonEmpty === -1 ? 0 : firstNonEmpty
    }
    row.selection = { mode, selectedIdx, movedOffFirst: mode === 'repro-argmax' && selectedIdx !== 0 }

    // 5. Guarded repair (repro-armed instances only — no signal, no repair).
    let best = { diff: diffs[selectedIdx] as string, score: scores[selectedIdx] as CandScore, from: `candidate:${selectedIdx}` }
    if (!repro) {
      row.repairStop = 'no-signal'
    } else if (best.score.severity === 0) {
      row.repairStop = 'already-passing'
    } else {
      for (let round = 1; round <= REPAIRS && best.score.severity > 0; round += 1) {
        const appendix =
          (best.diff.trim()
            ? `--- PREVIOUS FIX (already applied to this checkout) ---\n${tail(best.diff, 8_000)}\n\n`
            : '--- NO FIX APPLIED YET (every prior attempt produced no change) ---\n\n') +
          `--- REPRODUCTION SCRIPT (written from the issue; exit 0 = fixed) ---\n${tail(repro, 6_000)}\n\n` +
          `--- REPRODUCTION OUTPUT on the current state (exit ${best.score.exit ?? 'n/a'}) ---\n${best.score.out}\n\n` +
          '--- REPAIR INSTRUCTIONS ---\n' +
          'The reproduction above STILL FAILS. Diagnose why the current state does not resolve the issue, ' +
          'then correct the SOURCE with minimal edit_file changes (you may revise or revert parts of the ' +
          'previous fix — it is already in the files). Do not modify tests.'
        const a = await emitAttempt(env.environment, bt, {
          temperature: TEMP, marks, instanceCounter: counter, preApply: best.diff, promptAppendix: appendix,
        })
        const ns = await scoreCandidate(img.tag, repro, a.diff)
        const accepted = ns.severity < best.score.severity
        row.repairs.push({
          round, baseFrom: best.from, baseSeverity: best.score.severity, diff: a.diff, diffBytes: a.diff.length,
          completions: a.completions, calls: a.calls, tokensIn: a.tokensIn, tokensOut: a.tokensOut,
          wallMs: a.wallMs, attemptError: a.error ?? null, applyOk: ns.applyOk, reproExit: ns.exit,
          severity: ns.severity, accepted,
        })
        if (accepted) best = { diff: a.diff, score: ns, from: `repair:${round}` }
      }
      row.repairStop = best.score.severity === 0 ? 'repaired-pass' : 'rounds-exhausted'
    }
    row.finalDiff = best.diff
    row.finalFrom = best.from
    return row
  } catch (e) {
    row.error = e instanceof Error ? e.message.slice(0, 400) : String(e).slice(0, 400)
    return row
  } finally {
    row.llmCalls = counter.calls
    row.httpAttempts = counter.httpAttempts
    row.tokensIn = counter.tokensIn
    row.tokensOut = counter.tokensOut
    row.guardedMsgs = counter.guardedMsgs
    row.wallMs = Date.now() - t0
  }
}

// ---------- driver ----------

function loadRows(path: string): Map<string, Row> {
  const m = new Map<string, Row>()
  if (!existsSync(path)) return m
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue
    const r = JSON.parse(line) as Row
    m.set(r.instanceId, r)
  }
  return m
}

async function main(): Promise<void> {
  const ids = process.env.IDS
    ? process.env.IDS.split(',').map((s) => s.trim()).filter(Boolean)
    : await cachedInstanceIds()
  if (!ids.length) throw new Error('no cached sweb.eval images found and no IDS given')

  console.log(`═══ SWE-bench Stage 1 — structural pilot, ARM=${ARM} ═══`)
  console.log(
    `model=${MODEL} base=${ZAI_BASE} maxTokens=${MAX_TOKENS} innerTurns=${INNER_TURNS} ` +
      (ARM === 'system' ? `k=${K} temp=${TEMP} repairs<=${REPAIRS} ` : `temp=${SOLO_TEMP} `) +
      `conc=${CONC} reproTimeout=${REPRO_TIMEOUT_S}s exec=image judge=${SKIP_JUDGE ? 'SKIPPED' : 'phase-B serialized'}`,
  )
  console.log(`instances (${ids.length}): ${ids.join(', ')}`)
  if (ARM === 'system') {
    const withRepro = ids.filter((id) => MANIFEST[id]).length
    console.log(`repro manifest: ${withRepro}/${ids.length} instances with a Stage-0 valid+sound repro (rest run repro=none)`)
  }
  console.log(`out=${OUT} (phase A receipts: ${PHASE_A_OUT})`)

  const env = await createSweBenchEnvironment(ids.length, { ids, cloneCache: true })
  await env.adapter.preflight?.()
  const taskById = new Map((await env.adapter.loadTasks({ ids, split: 'test' })).map((t) => [t.id, t]))
  const missing = ids.filter((id) => !taskById.has(id))
  if (missing.length) throw new Error(`instances not found in SWE-bench_Verified: ${missing.join(', ')}`)

  // ── Phase A (resumable): every arm decision, no judge anywhere ──
  const done = loadRows(PHASE_A_OUT)
  const todo = ids.filter((id) => !done.has(id))
  if (done.size) console.log(`phase A resume: ${done.size} rows already present, ${todo.length} to run`)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < todo.length) {
      const i = next++
      const id = todo[i] as string
      console.log(`[A ${i + 1}/${todo.length}] ${id} …`)
      const row = await phaseA(env, taskById.get(id) as BenchTask)
      done.set(id, row)
      appendFileSync(PHASE_A_OUT, `${JSON.stringify(row)}\n`)
      const sel = row.selection ? `${row.selection.mode}@${row.selection.selectedIdx}${row.selection.movedOffFirst ? ' MOVED' : ''}` : '-'
      console.log(
        `[A ${i + 1}/${todo.length}] ${id} → repro=${row.reproStatus} sel=${sel} ` +
          `sev=[${row.candidates.map((c) => c.severity).join(',')}] repairs=${row.repairs.length}(${row.repairStop ?? '-'}) ` +
          `final=${row.finalFrom} diff=${row.finalDiff.length}b calls=${row.llmCalls} tok=${row.tokensIn}/${row.tokensOut} ` +
          `wall=${Math.round(row.wallMs / 1000)}s${row.error ? ` ERR=${row.error.slice(0, 120)}` : ''}`,
      )
    }
  }
  await Promise.all(Array.from({ length: CONC }, () => worker()))

  // ── Phase B: hidden judge, serialized, strictly after every arm decision locked ──
  console.log(`\nphase A complete — all arm decisions locked (${new Date().toISOString()}).`)
  const judged = loadRows(OUT)
  if (SKIP_JUDGE) {
    console.log('SKIP_JUDGE=1 — phase B not run; rows remain in the phase-A file only.')
  } else {
    console.log('phase B: official swebench judge, serialized (max_workers 1)…')
    for (const id of ids) {
      if (judged.has(id)) continue
      const row = done.get(id) as Row
      const t0 = Date.now()
      if (!row.finalDiff.trim()) {
        row.hiddenResolved = false
        row.judgeSkipped = row.error ? 'error-no-patch' : 'empty-patch'
      } else {
        try {
          const s = await env.adapter.judge(taskById.get(id) as BenchTask, row.finalDiff)
          row.hiddenResolved = s.resolved ?? false
          row.judgeDetail = String(s.detail ?? '').slice(0, 1_000)
        } catch (e) {
          row.hiddenResolved = false
          row.judgeSkipped = `judge-error: ${e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200)}`
        }
      }
      row.judgeMs = Date.now() - t0
      judged.set(id, row)
      appendFileSync(OUT, `${JSON.stringify(row)}\n`)
      console.log(`[B] ${id} → resolved=${row.hiddenResolved} (${Math.round((row.judgeMs ?? 0) / 1000)}s)${row.judgeSkipped ? ` [${row.judgeSkipped}]` : ''}`)
    }
  }

  // ── summary ──
  const rows = [...(SKIP_JUDGE ? done : judged).values()].filter((r) => ids.includes(r.instanceId))
  const n = rows.length
  const resolved = rows.filter((r) => r.hiddenResolved === true).length
  const errors = rows.filter((r) => r.error).length
  const totIn = rows.reduce((s, r) => s + r.tokensIn, 0)
  const totOut = rows.reduce((s, r) => s + r.tokensOut, 0)
  const totCalls = rows.reduce((s, r) => s + r.llmCalls, 0)
  const totHttp = rows.reduce((s, r) => s + r.httpAttempts, 0)
  const totGuard = rows.reduce((s, r) => s + r.guardedMsgs, 0)
  const walls = rows.map((r) => r.wallMs / 1000).sort((a, b) => a - b)
  const q = (p: number): number => walls.length ? (walls[Math.min(walls.length - 1, Math.floor(p * (walls.length - 1)))] as number) : 0
  const usd = (totIn / 1e6) * PRICE_IN + (totOut / 1e6) * PRICE_OUT

  console.log(`\n══ per-instance (${ARM}) ══`)
  console.log('instance | repro(src) | cand sev | sel | moved | repairs | stop | final | resolved | calls | tokIn/out | wall_s | err')
  for (const r of [...rows].sort((a, b) => a.instanceId.localeCompare(b.instanceId))) {
    const sel = r.selection ? `${r.selection.mode === 'repro-argmax' ? 'argmax' : 'blind'}@${r.selection.selectedIdx}` : '-'
    console.log(
      `${r.instanceId} | ${r.reproStatus}${r.reproSource !== 'none' ? `(${r.reproSource.replace('stage0-', '')})` : ''} | ` +
        `[${r.candidates.map((c) => c.severity).join(',')}] | ${sel} | ${r.selection?.movedOffFirst ? 1 : 0} | ` +
        `${r.repairs.length}${r.repairs.some((x) => x.accepted) ? '+acc' : ''} | ${r.repairStop ?? '-'} | ${r.finalFrom} | ` +
        `${r.hiddenResolved === null ? '?' : r.hiddenResolved ? 1 : 0} | ${r.llmCalls} | ${r.tokensIn}/${r.tokensOut} | ` +
        `${Math.round(r.wallMs / 1000)} | ${r.error ? r.error.slice(0, 60) : '-'}`,
    )
  }

  console.log(`\n══ summary (${ARM}) ══`)
  console.log(`n=${n} resolved(hidden)=${resolved}/${n} errorRows=${errors}`)
  if (ARM === 'system') {
    const armed = rows.filter((r) => r.reproStatus === 'ok')
    const blind = rows.filter((r) => r.selection?.mode === 'blind-first')
    const moved = rows.filter((r) => r.selection?.movedOffFirst)
    const scored = armed.flatMap((r) => r.candidates)
    const passCands = scored.filter((c) => c.severity === 0)
    const fired = rows.filter((r) => r.repairs.length > 0)
    const accepted = rows.filter((r) => r.repairs.some((x) => x.accepted))
    const failToPass = rows.filter((r) => r.repairStop === 'repaired-pass')
    console.log(`repro: ok=${armed.length} degraded=${rows.filter((r) => r.reproStatus.startsWith('degraded')).length} none=${rows.filter((r) => r.reproStatus === 'none').length}`)
    console.log(`selection: repro-argmax=${armed.length} blind-first=${blind.length} | argmax moved off idx0 on ${moved.length} instance(s)`)
    console.log(`candidates (repro-armed): ${scored.length} scored, ${passCands.length} repro-pass (${scored.length ? ((100 * passCands.length) / scored.length).toFixed(1) : 0}%)`)
    console.log(`repair: fired on ${fired.length} instance(s), accepted(improved) on ${accepted.length}, repro fail→pass on ${failToPass.length}`)
    const stops = new Map<string, number>()
    for (const r of rows) if (r.repairStop) stops.set(r.repairStop, (stops.get(r.repairStop) ?? 0) + 1)
    console.log(`repair stops: ${[...stops.entries()].map(([k, v]) => `${k}=${v}`).join('  ')}`)
  }
  console.log(`leak guard: ${totGuard} system/user messages checked across ${totCalls} completions — 0 trips (a trip throws)`)
  console.log(`cost: tokens in=${totIn} out=${totOut} | llmCalls=${totCalls} httpAttempts=${totHttp} | ` +
      `$${usd.toFixed(2)} @ $${PRICE_IN}/M in + $${PRICE_OUT}/M out (ASSUMED rate — override PRICE_IN/PRICE_OUT)`)
  console.log(`wall per instance: min/med/p90/max = ${Math.round(q(0))}/${Math.round(q(0.5))}/${Math.round(q(0.9))}/${Math.round(q(1))}s  sum=${Math.round(walls.reduce((a, b) => a + b, 0))}s`)
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
