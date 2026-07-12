/**
 * DAY 1 of the STREAM LOOP — the running two-arm stream over SWE-bench Verified
 * (contract: supervisor-lab/docs/design/stream-loop.md; base: swe-structural.mts @ 393ee50b).
 *
 * Two arms, interleaved per instance (same slot, F then L):
 *   F (frozen-v0)  — the swe-structural system config exactly: canary at open, Stage-0 repro reuse
 *                    (REPRO_MANIFEST) re-verified on this substrate — else authored fresh with the
 *                    calibrator's protocol — k=4 candidates, repro-argmax selection, ≤2 guarded
 *                    repairs. No memory.
 *   L (learning)   — byte-identical config PLUS (a) memory recall at open: searchKnowledge over a
 *                    stream-local store (starts EMPTY) with repo+issue tokens, top-3 provenance-
 *                    labeled notes injected via the promptAppendix seam; (b) after settle: a
 *                    templated outcome-anchored note (fields from the Row only — NEVER judge text,
 *                    NEVER FAIL_TO_PASS names) written via applyKnowledgeWriteBlocks; (c) a
 *                    failure-class tally persisted in the ledger.
 *
 * Phase separation per instance: both arms' decisions LOCK, then the official judge
 * (adapter.judge, serialized) grades that instance for both arms; judge outputs never reach any
 * model context (the L note carries the resolved BOOLEAN only — a tier-2 anchor).
 *
 * HARD DRIVER REQUIREMENTS (each traces to a measured failure):
 *   1. Per-instance wall-clock deadline (DEADLINE_MS, default 30min — Stage-1 hung 29h on one
 *      instance): a promise race around the per-instance arm pipeline; breach → error rows with
 *      partial receipts → next instance. The deadline reaches into the zai retry ladder
 *      (zaiChatRaw deadlineAt) so a written-off instance stops spending within one call.
 *      The judge runs OUTSIDE this race (first-judge env-image builds legitimately exceed 30min)
 *      under its own JUDGE_TIMEOUT_MS race, so no instance holds the stream either way.
 *   2. Per-candidate turn cap (TURN_CAP, default 12 — Stage-1 spent 160 calls / 8.7M input tokens
 *      on ONE instance): enforced at the transport chokepoint; on breach the loop is ended with a
 *      synthetic no-tool-call completion and the candidate is scored AS-IS from whatever diff
 *      exists (capBreached in receipts).
 *   3. zai discipline: conc ≤2 TOTAL (instance workers are the only callers; attempts are serial
 *      within an instance), 429 ladder 60/120/240s, client timeout 480s (swe-jail's zaiChatRaw).
 *   4. Image pull→run→delete rotation: the fail-closed resolveImageForMetadata never pulls — this
 *      driver pulls explicitly, hard-asserts presence, and deletes after both arms + judge finish,
 *      EXCEPT images already cached at stream start (the keep-set). SWEBENCH_CACHE_LEVEL=instance
 *      stops the judge from deleting images behind the rotation's back.
 *
 * Ledger: STREAM_DIR/ledger.jsonl — one row per (instance × arm): streamIndex, arm,
 * profileVersion, all swe-structural receipts, recall/write receipts, tally snapshot, cumulative
 * resolved counts + $ per arm. events.jsonl records stream events incl. the day-1 STUB batch
 * trigger: streamIndex % 25 === 0 → 'batch-look (stub)'. The divergence curve is a pure fold over
 * the ledger, printed at the end.
 *
 *   cd ~/company/devops/secrets && dotenvx run -f agent-state.env -- bash -c \
 *     'cd ~/code/agent-runtime-swe && REPRO_MANIFEST=/path/manifest.json \
 *      STREAM_DIR=~/.swe-stream/day1 bench/node_modules/.bin/tsx bench/src/swe-stream.mts'
 *
 * Env: ZAI_API_KEY (required), ZAI_BASE, MODEL=glm-5.2, MAX_TOKENS=12000, K=4, REPAIRS=2,
 *      TEMP=0.8, INNER_TURNS=40, TURN_CAP=12, DEADLINE_MS=1800000, JUDGE_TIMEOUT_MS=2400000,
 *      CONC=2 (hard max 2 — zai discipline), REPRO_TIMEOUT=120 (s), LLM_TIMEOUT_MS=480000,
 *      SEED=0x5eed, IDS=comma-list (default: the 23-instance Stage-0 fingerprint set),
 *      STREAM_N=max instances this run, STREAM_DIR=state dir (ledger/events/kb),
 *      REPRO_MANIFEST=Stage-0 valid+sound repro scripts (optional — absent entries author fresh),
 *      PRICE_IN/PRICE_OUT (USD per Mtok, assumed zai list rate). Resume: by instance id from the
 *      ledger (an instance re-runs unless BOTH arm rows settled).
 */
import { execFile } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { applyKnowledgeWriteBlocks, buildKnowledgeIndex, initKnowledgeBase, searchKnowledge } from '@tangle-network/agent-knowledge'
import type { AgenticSurface, AgenticTask, ArtifactHandle, SurfaceScore } from '@tangle-network/agent-runtime/loops'
import { refine, runAgentic } from '@tangle-network/agent-runtime/loops'
import type { BenchTask } from './benchmarks/types'
import { createSweBenchEnvironment, resolveImageForMetadata, SWE_SEED_PROMPT } from './swe-bench-env'
import {
  APPLY_SENTINEL,
  assertNoHiddenLeak,
  cachedInstanceIds,
  extractReadRequests,
  extractReproScript,
  IMPORT_NAME,
  importCanaryScript,
  reproAuthorSystem,
  runPyInJail,
  tail,
  zaiChatRaw,
} from './swe-jail'

const exec = promisify(execFile)

// The judge must not delete instance images behind the rotation's back (its default 'env' cache
// level removes them after every run — measured: it pruned the 23-image fingerprint cache).
process.env.SWEBENCH_CACHE_LEVEL ??= 'instance'

// ---------- config ----------

const ZAI_BASE = process.env.ZAI_BASE ?? 'https://api.z.ai/api/coding/paas/v4'
const ZAI_KEY = process.env.ZAI_API_KEY ?? ''
if (!ZAI_KEY) throw new Error('ZAI_API_KEY required (run under dotenvx: agent-state.env)')
const MODEL = process.env.MODEL ?? 'glm-5.2'
// glm-5.2 is a reasoning model: hidden reasoning consumes max_tokens, so <8000 starves content.
const MAX_TOKENS = Number(process.env.MAX_TOKENS ?? 12_000)
const K = Number(process.env.K ?? 4)
const REPAIRS = Number(process.env.REPAIRS ?? 2)
// NOT `TEMP`: Node's os.tmpdir() honors the TEMP env var as the temp DIRECTORY, so setting
// TEMP=0.8 made mkdtemp build a relative path "0.8/swe-repro-…" and every docker -v mount was
// rejected as an invalid volume name. Sampling temperature reads SAMPLE_TEMP (TEMP still accepted
// only if it parses as a number < 2, so a stray TEMP=/some/dir never leaks in as a temperature).
const TEMP = (() => {
  const s = process.env.SAMPLE_TEMP ?? (process.env.TEMP && Number(process.env.TEMP) < 2 ? process.env.TEMP : undefined)
  return Number(s ?? 0.8)
})()
const INNER_TURNS = Number(process.env.INNER_TURNS ?? 40)
const TURN_CAP = Number(process.env.TURN_CAP ?? 12)
const DEADLINE_MS = Number(process.env.DEADLINE_MS ?? 1_800_000)
const JUDGE_TIMEOUT_MS = Number(process.env.JUDGE_TIMEOUT_MS ?? 2_400_000)
const CONC = Math.max(1, Math.min(2, Number(process.env.CONC ?? 2)))
const REPRO_TIMEOUT_S = Number(process.env.REPRO_TIMEOUT ?? 120)
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 480_000)
const SEED = Number(process.env.SEED ?? 0x5eed)
const STREAM_N = Number(process.env.STREAM_N ?? Number.POSITIVE_INFINITY)
const STREAM_DIR = process.env.STREAM_DIR ?? join(homedir(), '.swe-stream', 'day1')
const LEDGER = join(STREAM_DIR, 'ledger.jsonl')
const EVENTS = join(STREAM_DIR, 'events.jsonl')
const STORE = join(STREAM_DIR, 'kb')
const PROFILE_VERSION = 'v0'
// Cost-table rates, USD per Mtok. ASSUMED (zai coding-plan tokens have no per-call list price).
const PRICE_IN = Number(process.env.PRICE_IN ?? 0.6)
const PRICE_OUT = Number(process.env.PRICE_OUT ?? 2.2)

/**
 * The Stage-0 fingerprint set: the 23 instances whose swebench eval images were cached locally at
 * the PREREG-swe-frontier commit (enumerated then via `docker images`, recorded in the Stage-0
 * canary sweep). The cache has since been pruned by the judge's old 'env' cache level, so the list
 * is pinned HERE as the durable source — day-1 streams these first, re-pulling as needed.
 */
const FINGERPRINT_23 = [
  'astropy__astropy-12907', 'astropy__astropy-13033', 'django__django-12419', 'django__django-13406',
  'django__django-14089', 'django__django-14534', 'django__django-16082', 'django__django-16429',
  'matplotlib__matplotlib-23314', 'pallets__flask-5014', 'psf__requests-1142', 'psf__requests-1921',
  'psf__requests-2931', 'pylint-dev__pylint-7080', 'pytest-dev__pytest-6202',
  'scikit-learn__scikit-learn-14053', 'scikit-learn__scikit-learn-14141', 'sphinx-doc__sphinx-8595',
  'sphinx-doc__sphinx-8721', 'sympy__sympy-13757', 'sympy__sympy-22914', 'sympy__sympy-23534',
  'sympy__sympy-23950',
] as const

interface ReproManifestEntry {
  script: string
  source: string
  stage0Class: string
}

const MANIFEST: Record<string, ReproManifestEntry> = (() => {
  const p = process.env.REPRO_MANIFEST
  if (!p) return {}
  return JSON.parse(readFileSync(p, 'utf8')) as Record<string, ReproManifestEntry>
})()

// ---------- seeded shuffle (mulberry32 — deterministic stream order) ----------

function seededShuffle<T>(arr: readonly T[], seed: number): T[] {
  const a = [...arr]
  let s = seed >>> 0
  const rnd = (): number => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j] as T, a[i] as T]
  }
  return a
}

// ---------- transport: leak guard + turn cap + deadline at the single chokepoint ----------

interface Counter {
  calls: number
  httpAttempts: number
  tokensIn: number
  tokensOut: number
  guardedMsgs: number
}

const newCounter = (): Counter => ({ calls: 0, httpAttempts: 0, tokensIn: 0, tokensOut: 0, guardedMsgs: 0 })

const addInto = (into: Counter, from: Counter): void => {
  into.calls += from.calls
  into.httpAttempts += from.httpAttempts
  into.tokensIn += from.tokensIn
  into.tokensOut += from.tokensOut
  into.guardedMsgs += from.guardedMsgs
}

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

/** FAIL_TO_PASS test node ids for an instance — the hidden-grading vocabulary the L arm's memory
 *  must never carry forward. Full pytest node ids (file::class::test) are distinctive enough to
 *  serve as leak-guard marks without false positives. */
function failToPassNames(md: Record<string, unknown>): string[] {
  const raw = md.FAIL_TO_PASS
  try {
    const list = Array.isArray(raw) ? raw : (JSON.parse(String(raw ?? '[]')) as unknown[])
    return list.map((x) => String(x)).filter((s) => s.length >= 8)
  } catch {
    return []
  }
}

/** Per-attempt enforcement state threaded into the transport. */
interface AttemptGuard {
  deadlineAt: number
  turnCap: number
  capBreached: boolean
}

/** Synthetic no-tool-call completion: ends the tool loop cleanly on a turn-cap breach so the
 *  candidate is scored AS-IS from whatever diff exists (requirement 2). Zero usage — no real call. */
const CAP_COMPLETION = {
  choices: [{ message: { role: 'assistant', content: 'TURN CAP REACHED — finalize with the current state.' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 0, completion_tokens: 0 },
}

/** Every model call flows through here (runAgentic's `complete` seam): judge separation asserted,
 *  turn cap + per-instance deadline enforced, usage counted — once, at the single chokepoint. */
const makeTransport =
  (marks: readonly string[], counter: Counter, guard: AttemptGuard) =>
  async (body: Record<string, unknown>): Promise<unknown> => {
    if (Date.now() >= guard.deadlineAt) throw new Error('DEADLINE: per-instance wall clock exhausted')
    if (counter.calls >= guard.turnCap) {
      guard.capBreached = true
      return CAP_COMPLETION
    }
    const msgs = (body.messages ?? []) as Array<{ role?: string; content?: unknown }>
    counter.guardedMsgs += assertNoHiddenLeak(marks, msgs)
    const { json, attempts } = await zaiChatRaw(
      { base: ZAI_BASE, key: ZAI_KEY, timeoutMs: LLM_TIMEOUT_MS, deadlineAt: guard.deadlineAt },
      body,
    )
    counter.calls += 1
    counter.httpAttempts += attempts
    const u = (json as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage
    counter.tokensIn += u?.prompt_tokens ?? 0
    counter.tokensOut += u?.completion_tokens ?? 0
    return json
  }

// ---------- one emit-patch attempt (swe-structural's protocol + cap/deadline receipts) ----------

interface AttemptOut {
  diff: string
  completions: number
  tokensIn: number
  tokensOut: number
  calls: number
  wallMs: number
  capBreached: boolean
  error?: string
}

async function emitAttempt(
  environment: AgenticSurface,
  bt: BenchTask,
  cfg: {
    temperature: number
    marks: readonly string[]
    instanceCounter: Counter
    deadlineAt: number
    preApply?: string
    promptAppendix?: string
  },
): Promise<AttemptOut> {
  const t0 = Date.now()
  const counter = newCounter()
  const guard: AttemptGuard = { deadlineAt: cfg.deadlineAt, turnCap: TURN_CAP, capBreached: false }
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
      complete: makeTransport(cfg.marks, counter, guard),
    })
    addInto(cfg.instanceCounter, counter)
    return {
      diff: capture.patch, completions: r.completions, tokensIn: counter.tokensIn,
      tokensOut: counter.tokensOut, calls: counter.calls, wallMs: Date.now() - t0,
      capBreached: guard.capBreached,
    }
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300)
    addInto(cfg.instanceCounter, counter)
    return {
      diff: capture.patch, completions: 0, tokensIn: counter.tokensIn, tokensOut: counter.tokensOut,
      calls: counter.calls, wallMs: Date.now() - t0, capBreached: guard.capBreached, error,
    }
  }
}

// ---------- in-image candidate scoring (swe-structural verbatim) ----------

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
  capBreached: boolean
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
  capBreached: boolean
  attemptError: string | null
  applyOk: boolean | null
  reproExit: number | null
  severity: number
  accepted: boolean
}

interface RecallReceipt {
  query: string
  storePages: number
  hits: Array<{ path: string; rrfScore: number; streamIndex: number | null }>
  injectedChars: number
}

interface WriteReceipt {
  path: string
  bytes: number
  lintMarksChecked: number
  written: boolean
  error: string | null
}

interface Row {
  streamIndex: number
  arm: 'F' | 'L'
  profileVersion: string
  instanceId: string
  repo: string
  model: string
  image: string | null
  imagePulled: boolean
  imagePullMs: number
  execMode: 'image'
  temperature: number
  innerTurns: number
  turnCap: number
  deadlineMs: number
  k: number
  issueTitle: string
  // canary + repro provenance (shared per instance, recorded on both arms)
  canaryExit: number | null
  canaryPass: boolean | null
  reproSource: string
  reproStatus: string
  reproScript: string | null
  reproPreExit: number | null
  reproGoldExit: number | null
  reproAuthorCalls: number
  reproAuthorTokensIn: number
  reproAuthorTokensOut: number
  // candidates + selection + repair receipts
  candidates: CandidateRow[]
  selection: { mode: string; selectedIdx: number; movedOffFirst: boolean } | null
  repairs: RepairRow[]
  repairStop: string | null
  finalFrom: string
  finalDiff: string
  capBreaches: number
  deadlineHit: boolean
  // memory receipts (L arm only; null on F)
  recall: RecallReceipt | null
  noteWrite: WriteReceipt | null
  failureClass: string | null
  tallySnapshot: Record<string, number> | null
  marksDroppedDatasetText: number
  // hidden judge (per-instance phase B; locked-after-decisions)
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
  usd: number
  wallMs: number
  // cumulative (this arm, at append time — completion order; the curve refolds in stream order)
  cumN: number
  cumResolved: number
  cumUsd: number
  error?: string
}

function newRow(streamIndex: number, arm: 'F' | 'L', bt: BenchTask): Row {
  const md = bt.metadata as Record<string, string>
  const issueTitle = String(md.problem_statement ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  return {
    streamIndex, arm, profileVersion: PROFILE_VERSION, instanceId: bt.id, repo: md.repo, model: MODEL,
    image: null, imagePulled: false, imagePullMs: 0, execMode: 'image', temperature: TEMP,
    innerTurns: INNER_TURNS, turnCap: TURN_CAP, deadlineMs: DEADLINE_MS, k: K,
    issueTitle: issueTitle.slice(0, 200),
    canaryExit: null, canaryPass: null, reproSource: 'none', reproStatus: 'none', reproScript: null,
    reproPreExit: null, reproGoldExit: null, reproAuthorCalls: 0, reproAuthorTokensIn: 0,
    reproAuthorTokensOut: 0, candidates: [], selection: null, repairs: [], repairStop: null,
    finalFrom: 'none', finalDiff: '', capBreaches: 0, deadlineHit: false, recall: null,
    noteWrite: null, failureClass: null, tallySnapshot: null, marksDroppedDatasetText: 0,
    hiddenResolved: null, judgeDetail: null, judgeMs: null, judgeSkipped: null,
    llmCalls: 0, httpAttempts: 0, tokensIn: 0, tokensOut: 0, guardedMsgs: 0, usd: 0, wallMs: 0,
    cumN: 0, cumResolved: 0, cumUsd: 0,
  }
}

const usdOf = (tokensIn: number, tokensOut: number): number =>
  (tokensIn / 1e6) * PRICE_IN + (tokensOut / 1e6) * PRICE_OUT

// ---------- repro acquisition (manifest reuse re-verified — swe-structural verbatim — else fresh
// authoring with the calibrator's protocol; ONCE per instance, shared by both arms so the pairing
// stays tight; authoring usd is split 50/50 into each arm's cost track) ----------

interface ReproOut {
  script: string | null
  source: string
  status: string
  preExit: number | null
  goldExit: number | null
  authorCalls: number
  authorTokensIn: number
  authorTokensOut: number
}

async function acquireRepro(
  env: Env,
  bt: BenchTask,
  imageTag: string,
  marks: readonly string[],
  deadlineAt: number,
): Promise<ReproOut> {
  const md = bt.metadata as Record<string, string>
  const gold = String(md.patch ?? '')
  const out: ReproOut = {
    script: null, source: 'none', status: 'none', preExit: null, goldExit: null,
    authorCalls: 0, authorTokensIn: 0, authorTokensOut: 0,
  }

  const verify = async (script: string): Promise<'ok' | 'degraded-timeout' | 'degraded-invalid' | 'degraded-unsound'> => {
    const pre = await runPyInJail(imageTag, null, script, undefined, { timeoutS: REPRO_TIMEOUT_S })
    if (pre.infraError) throw new Error(pre.infraError)
    out.preExit = pre.code
    if (pre.timedOut) return 'degraded-timeout'
    if (pre.code === 0) return 'degraded-invalid'
    const post = await runPyInJail(imageTag, null, script, gold, { timeoutS: REPRO_TIMEOUT_S })
    if (post.infraError) throw new Error(post.infraError)
    out.goldExit = post.code
    return post.code === 0 && post.out.includes(APPLY_SENTINEL) ? 'ok' : 'degraded-unsound'
  }

  const manifest = MANIFEST[bt.id]
  if (manifest) {
    out.source = manifest.source
    out.status = await verify(manifest.script)
    if (out.status === 'ok') out.script = manifest.script
    return out
  }

  // Fresh authoring — the calibrator's protocol (issue + listing, one optional read round, one
  // validity retry), guarded by the same marks and the instance deadline. Model-visible inputs
  // only; gold is used strictly script-side in verify().
  out.source = 'stream-authored'
  const handle = await env.environment.open({ id: bt.id, systemPrompt: '', userPrompt: '', meta: {} } as AgenticTask)
  try {
    const listing = String(await env.environment.call(handle, 'list_files', { dir: '' })).slice(0, 5_000)
    const issue = String(md.problem_statement ?? '').slice(0, 20_000)
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: reproAuthorSystem(REPRO_TIMEOUT_S) },
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
    const guardedComplete = async (): Promise<string> => {
      if (Date.now() >= deadlineAt) throw new Error('DEADLINE: repro authoring abandoned')
      assertNoHiddenLeak(marks, messages)
      const { json } = await zaiChatRaw(
        { base: ZAI_BASE, key: ZAI_KEY, timeoutMs: LLM_TIMEOUT_MS, deadlineAt },
        { model: MODEL, max_tokens: MAX_TOKENS, temperature: 0.2, messages },
      )
      const d = json as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } }
      out.authorCalls += 1
      out.authorTokensIn += d.usage?.prompt_tokens ?? 0
      out.authorTokensOut += d.usage?.completion_tokens ?? 0
      return d.choices?.[0]?.message?.content ?? ''
    }

    let resp = await guardedComplete()
    let script = extractReproScript(resp)
    if (!script) {
      const reads = extractReadRequests(resp)
      messages.push({ role: 'assistant', content: resp })
      if (reads.length) {
        const bodies: string[] = []
        for (const p of reads) {
          const c = String(await env.environment.call(handle, 'read_file', { path: p }))
          bodies.push(`----- ${p} -----\n${c.slice(0, 12_000)}${c.length > 12_000 ? '\n…[truncated]' : ''}`)
        }
        messages.push({ role: 'user', content: `${bodies.join('\n\n')}\n\nNow reply with the final script in a single \`\`\`python fenced block.` })
      } else {
        messages.push({ role: 'user', content: 'Reply with ONLY the final Python script in a single ```python fenced block.' })
      }
      resp = await guardedComplete()
      script = extractReproScript(resp)
    }
    if (!script) {
      out.status = 'authoring-failed'
      return out
    }
    out.status = await verify(script)
    if (out.status === 'degraded-invalid' || out.status === 'degraded-timeout') {
      // One retry with feedback, per the Stage-0 protocol.
      const pre = await runPyInJail(imageTag, null, script, undefined, { timeoutS: REPRO_TIMEOUT_S })
      const feedback = out.status === 'degraded-timeout'
        ? `your script timed out after ${REPRO_TIMEOUT_S}s on the known-buggy code. Write a faster, simpler script that still detects the bug.`
        : 'your script did not detect the bug on the known-buggy code: it exited 0 on the UNPATCHED repository. ' +
          `Its output was:\n${tail(pre.out, 1_500)}\nWrite a corrected script that FAILS (nonzero exit) on the buggy code.`
      messages.push({ role: 'assistant', content: `\`\`\`python\n${script}\n\`\`\`` }, { role: 'user', content: feedback })
      const retry = await guardedComplete()
      const script2 = extractReproScript(retry)
      if (script2) {
        script = script2
        out.status = await verify(script2)
      }
    }
    if (out.status === 'ok') out.script = script
    return out
  } finally {
    await env.environment.close(handle).catch(() => {})
  }
}

// ---------- one arm: k candidates → argmax → guarded repair (swe-structural steps 3-5) ----------

type Env = Awaited<ReturnType<typeof createSweBenchEnvironment>>

async function runArm(
  env: Env,
  bt: BenchTask,
  row: Row,
  repro: string | null,
  marks: readonly string[],
  deadlineAt: number,
  promptAppendix: string | undefined,
  counter: Counter,
): Promise<void> {
  const imageTag = row.image as string
  const diffs: string[] = []
  for (let i = 0; i < K; i += 1) {
    const a = await emitAttempt(env.environment, bt, {
      temperature: TEMP, marks, instanceCounter: counter, deadlineAt,
      ...(promptAppendix ? { promptAppendix } : {}),
    })
    diffs.push(a.diff)
    if (a.capBreached) row.capBreaches += 1
    row.candidates.push({
      idx: i, diff: a.diff, diffBytes: a.diff.length, completions: a.completions, calls: a.calls,
      tokensIn: a.tokensIn, tokensOut: a.tokensOut, wallMs: a.wallMs, capBreached: a.capBreached,
      attemptError: a.error ?? null, applyOk: null, reproExit: null, reproTimedOut: false,
      severity: -1, reproOutTail: '',
    })
  }

  const scores: CandScore[] = []
  for (let i = 0; i < K; i += 1) {
    const s = await scoreCandidate(imageTag, repro, diffs[i] as string)
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

  let best = { diff: diffs[selectedIdx] as string, score: scores[selectedIdx] as CandScore, from: `candidate:${selectedIdx}` }
  if (!repro) {
    row.repairStop = 'no-signal'
  } else if (best.score.severity === 0) {
    row.repairStop = 'already-passing'
  } else {
    for (let round = 1; round <= REPAIRS && best.score.severity > 0; round += 1) {
      if (Date.now() >= deadlineAt) throw new Error('DEADLINE: per-instance wall clock exhausted (repair)')
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
        temperature: TEMP, marks, instanceCounter: counter, deadlineAt, preApply: best.diff, promptAppendix: appendix,
      })
      if (a.capBreached) row.capBreaches += 1
      const ns = await scoreCandidate(imageTag, repro, a.diff)
      const accepted = ns.severity < best.score.severity
      row.repairs.push({
        round, baseFrom: best.from, baseSeverity: best.score.severity, diff: a.diff, diffBytes: a.diff.length,
        completions: a.completions, calls: a.calls, tokensIn: a.tokensIn, tokensOut: a.tokensOut,
        wallMs: a.wallMs, capBreached: a.capBreached, attemptError: a.error ?? null, applyOk: ns.applyOk,
        reproExit: ns.exit, severity: ns.severity, accepted,
      })
      if (accepted) best = { diff: a.diff, score: ns, from: `repair:${round}` }
    }
    row.repairStop = best.score.severity === 0 ? 'repaired-pass' : 'rounds-exhausted'
  }
  row.finalDiff = best.diff
  row.finalFrom = best.from
}

// ---------- memory: recall at open, templated note after settle (L arm only) ----------

async function recallForInstance(bt: BenchTask): Promise<{ appendix?: string; receipt: RecallReceipt }> {
  const md = bt.metadata as Record<string, string>
  const issue = String(md.problem_statement ?? '')
  const title = issue.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  const query = `${md.repo} ${md.repo.split('/').join(' ')} ${title} ${issue.slice(0, 400)}`
  const index = await buildKnowledgeIndex(STORE)
  const receipt: RecallReceipt = { query: query.slice(0, 300), storePages: index.pages.length, hits: [], injectedChars: 0 }
  if (index.pages.length === 0) return { receipt }
  const hits = searchKnowledge(index, query, 3)
  if (!hits.length) return { receipt }
  const parts: string[] = [
    '--- PRIOR EXPERIENCE (notes recalled from this stream\'s own earlier tasks; provenance-labeled; ' +
      'they may or may not apply — weigh them against the issue) ---',
  ]
  for (const h of hits) {
    const si = Number((h.page.frontmatter as Record<string, unknown>).streamIndex ?? Number.NaN)
    receipt.hits.push({ path: h.page.path, rrfScore: h.rrfScore, streamIndex: Number.isNaN(si) ? null : si })
    parts.push(`\n[note ${h.rank}] source=${h.page.path} rrf=${h.rrfScore.toFixed(4)}\n${h.page.text.trim().slice(0, 1_200)}`)
  }
  parts.push('--- END PRIOR EXPERIENCE ---')
  const appendix = parts.join('\n')
  receipt.injectedChars = appendix.length
  return { appendix, receipt }
}

/** Fixed per-class lesson lines — templated (class → string), so the note stays "fields from the
 *  Row only": no judge text, no free-form model text, no hidden-test vocabulary. */
const CLASS_LESSON: Record<string, string> = {
  'repro-pass-resolved': 'repro-verified fix confirmed by the official grade — the repro was a faithful check here.',
  'repro-pass-but-unresolved': 'the repro passed but the official grade failed — the reproduction under-covered the hidden requirement; prefer root-cause edits and re-check adjacent behaviors, not just the literal symptom.',
  'resolved-despite-repro-fail': 'the official grade passed although the repro still failed — the repro was measuring something stricter or adjacent; treat repro failures as advisory, not fatal.',
  'repro-fail-unresolved': 'no candidate made the repro pass and the official grade failed — candidates likely missed the root cause; explore more files before editing.',
  'no-repro-resolved': 'resolved with no repro signal (blind-first selection) — the first non-empty candidate was good.',
  'no-repro-unresolved': 'no repro signal and the official grade failed — without a visible check, selection was blind; invest in a better reproduction next time.',
  error: 'the instance errored before settling — receipts are partial.',
}

function classifyOutcome(row: Row): string {
  if (row.error) return 'error'
  const reproArmed = row.reproStatus === 'ok'
  const finalPass = row.repairStop === 'already-passing' || row.repairStop === 'repaired-pass'
  if (row.hiddenResolved === true) {
    if (!reproArmed) return 'no-repro-resolved'
    return finalPass ? 'repro-pass-resolved' : 'resolved-despite-repro-fail'
  }
  if (!reproArmed) return 'no-repro-unresolved'
  return finalPass ? 'repro-pass-but-unresolved' : 'repro-fail-unresolved'
}

/** Files touched by the final diff — the model's OWN output (model-visible by construction). */
function filesTouched(diff: string): string[] {
  return [...new Set([...diff.matchAll(/^\+\+\+ b\/(\S+)/gm)].map((m) => m[1] as string))].slice(0, 8)
}

async function writeNote(row: Row, allFtpMarks: readonly string[], instanceMarks: readonly string[]): Promise<WriteReceipt> {
  const cls = row.failureClass ?? 'error'
  const notePath = `knowledge/notes/${String(row.streamIndex).padStart(4, '0')}-${row.instanceId}.md`
  const repoSlug = row.repo.replace('/', '-')
  const sev = row.candidates.map((c) => c.severity).join(',')
  const sel = row.selection ? `${row.selection.mode}@${row.selection.selectedIdx}${row.selection.movedOffFirst ? ' (moved off first)' : ''}` : 'none'
  const body = [
    '---',
    `title: 'stream note: ${row.instanceId}'`,
    `tags: [swe-stream, ${repoSlug}, ${cls}]`,
    `streamIndex: ${row.streamIndex}`,
    `profileVersion: ${row.profileVersion}`,
    '---',
    `# ${row.instanceId} — ${row.repo}`,
    '',
    `- provenance: streamIndex ${row.streamIndex}, arm L, ${row.profileVersion} (this stream's own run receipts)`,
    `- issue: ${row.issueTitle}`,
    `- repro: ${row.reproStatus} (source ${row.reproSource}); candidate severities [${sev}]; selection ${sel}`,
    `- repairs: ${row.repairs.length} round(s), accepted=${row.repairs.some((r) => r.accepted)}, stop=${row.repairStop ?? 'n/a'}`,
    `- final: from ${row.finalFrom}, ${row.finalDiff.length} diff bytes, files: ${filesTouched(row.finalDiff).join(', ') || '(none)'}`,
    `- outcome: resolved=${row.hiddenResolved === true} (official grade, boolean anchor only)`,
    `- failureClass: ${cls}`,
    `- lesson: ${CLASS_LESSON[cls] ?? CLASS_LESSON.error}`,
  ].join('\n')

  // LEAK LINT (fails loud): the note must carry NO hidden-grading vocabulary — not this instance's
  // FAIL_TO_PASS names, not any accumulated FTP name from the stream, not gold/test-patch marks,
  // and no judge-report vocabulary. A violation throws: a leaking note is never written.
  const lintMarks = [...new Set([...allFtpMarks, ...instanceMarks])]
  for (const mark of lintMarks) {
    if (mark && body.includes(mark)) {
      throw new Error(`NOTE LINT REFUSED: hidden-grading mark would leak into the memory store (${mark.slice(0, 40)}…)`)
    }
  }
  if (row.judgeDetail && row.judgeDetail.length > 20 && body.includes(row.judgeDetail.slice(0, 60))) {
    throw new Error('NOTE LINT REFUSED: judge text would leak into the memory store')
  }
  const proposal = `--- FILE: ${notePath} ---\n${body}\n--- END FILE ---\n`
  const applied = await applyKnowledgeWriteBlocks(STORE, proposal)
  if (!applied.written.includes(notePath)) {
    throw new Error(`note write failed: ${applied.warnings.join('; ') || 'no block written'}`)
  }
  return { path: notePath, bytes: body.length, lintMarksChecked: lintMarks.length, written: true, error: null }
}

// ---------- image rotation ----------

async function ensureImage(bt: BenchTask): Promise<{ tag: string; pulled: boolean; pullMs: number }> {
  let r = await resolveImageForMetadata(bt.metadata ?? {})
  if (r.ok) return { tag: r.tag, pulled: false, pullMs: 0 }
  const remote = `swebench/sweb.eval.x86_64.${bt.id.replace('__', '_1776_')}:latest`
  const t0 = Date.now()
  await exec('docker', ['pull', remote], { timeout: 1_500_000, maxBuffer: 8_000_000 })
  r = await resolveImageForMetadata(bt.metadata ?? {})
  // Hard assert (requirement 4): a missing image after an explicit pull is an error row, never
  // silent signal loss.
  if (!r.ok) throw new Error(`image missing after explicit pull of ${remote}: ${r.reason}`)
  return { tag: r.tag, pulled: true, pullMs: Date.now() - t0 }
}

// ---------- ledger + events ----------

function appendRow(row: Row): void {
  appendFileSync(LEDGER, `${JSON.stringify(row)}\n`)
}

function logEvent(type: string, data: Record<string, unknown>): void {
  appendFileSync(EVENTS, `${JSON.stringify({ at: new Date().toISOString(), type, ...data })}\n`)
}

function loadLedger(): Row[] {
  if (!existsSync(LEDGER)) return []
  const rows: Row[] = []
  for (const line of readFileSync(LEDGER, 'utf8').split('\n')) {
    if (!line.trim()) continue
    rows.push(JSON.parse(line) as Row)
  }
  return rows
}

// ---------- per-instance pipeline ----------

interface StreamState {
  keepImages: Set<string>
  ftpMarks: Set<string>
  tally: Record<string, number>
  cum: { F: { n: number; resolved: number; usd: number }; L: { n: number; resolved: number; usd: number } }
  judgeChain: Promise<void>
}

/** Serialized official judge with its own timeout race — the chain never blocks past the timeout
 *  (a zombie evaluator can linger; max_workers=1 keeps it single). Judge output goes to the ROW
 *  only, never near a model message. */
function serializedJudge(
  state: StreamState,
  env: Env,
  bt: BenchTask,
  diff: string,
): Promise<{ resolved: boolean; detail: string | null; skipped: string | null; ms: number }> {
  const run = async (): Promise<{ resolved: boolean; detail: string | null; skipped: string | null; ms: number }> => {
    const t0 = Date.now()
    if (!diff.trim()) return { resolved: false, detail: null, skipped: 'empty-patch', ms: 0 }
    let timer: NodeJS.Timeout | undefined
    try {
      const timeout = new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error('judge-timeout')), JUDGE_TIMEOUT_MS)
      })
      const s = await Promise.race([env.adapter.judge(bt, diff), timeout])
      return { resolved: s.resolved ?? false, detail: String(s.detail ?? '').slice(0, 1_000), skipped: null, ms: Date.now() - t0 }
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200)
      return { resolved: false, detail: null, skipped: `judge-error: ${msg}`, ms: Date.now() - t0 }
    } finally {
      clearTimeout(timer)
    }
  }
  const p = state.judgeChain.then(run)
  state.judgeChain = p.then(
    () => undefined,
    () => undefined,
  )
  return p
}

async function processInstance(state: StreamState, env: Env, bt: BenchTask, streamIndex: number): Promise<void> {
  const t0 = Date.now()
  const md = bt.metadata as Record<string, string>
  const rowF = newRow(streamIndex, 'F', bt)
  const rowL = newRow(streamIndex, 'L', bt)
  const deadlineAt = t0 + DEADLINE_MS
  const counterF = newCounter()
  const counterL = newCounter()

  // Leak-guard marks: this instance's gold/test marks + EVERY FAIL_TO_PASS name accumulated over
  // the stream so far (the memory channel is the only path that could carry one forward — a trip
  // means the note lint failed and MUST fail loud). Marks that already occur in the dataset's own
  // issue text are dropped (dataset-authored, not memory-authored) and receipted.
  const ftpThis = failToPassNames(bt.metadata ?? {})
  for (const m of ftpThis) state.ftpMarks.add(m)
  const issueText = String(md.problem_statement ?? '')
  const promptText = bt.prompt
  const allMarks = [...leakMarks(md), ...state.ftpMarks]
  const marks = allMarks.filter((m) => !issueText.includes(m) && !promptText.includes(m))
  rowF.marksDroppedDatasetText = rowL.marksDroppedDatasetText = allMarks.length - marks.length

  let repro: ReproOut | null = null
  const checkDeadline = (where: string): void => {
    if (Date.now() >= deadlineAt) throw new Error(`DEADLINE: per-instance wall clock exhausted (${where})`)
  }

  const pipeline = async (): Promise<void> => {
    // Image: hard-asserted per instance; pulled explicitly when the cache lacks it (requirement 4).
    const img = await ensureImage(bt)
    rowF.image = rowL.image = img.tag
    rowF.imagePulled = rowL.imagePulled = img.pulled
    rowF.imagePullMs = rowL.imagePullMs = img.pullMs
    if (img.pulled) logEvent('image-pulled', { streamIndex, instanceId: bt.id, tag: img.tag, pullMs: img.pullMs })

    // Execution canary (zero model calls) — this substrate must be able to grade this instance.
    const pkg = IMPORT_NAME[md.repo]
    if (!pkg) throw new Error(`no IMPORT_NAME for ${md.repo} — canary not expressible`)
    const gold = String(md.patch ?? '')
    if (!gold.trim()) throw new Error('gold patch missing from metadata')
    const c = await runPyInJail(img.tag, null, importCanaryScript(pkg), gold, { timeoutS: REPRO_TIMEOUT_S })
    if (c.infraError) throw new Error(c.infraError)
    rowF.canaryExit = rowL.canaryExit = c.code
    const canaryPass = c.code === 0 && c.out.includes(APPLY_SENTINEL)
    rowF.canaryPass = rowL.canaryPass = canaryPass
    if (!canaryPass) throw new Error(`canary failed (exit ${c.code}): this substrate cannot grade this instance`)

    // Repro: manifest reuse re-verified, else authored fresh — ONCE, shared by both arms.
    repro = await acquireRepro(env, bt, img.tag, marks, deadlineAt)
    for (const row of [rowF, rowL]) {
      row.reproSource = repro.source
      row.reproStatus = repro.status
      row.reproScript = repro.script
      row.reproPreExit = repro.preExit
      row.reproGoldExit = repro.goldExit
      row.reproAuthorCalls = repro.authorCalls
      row.reproAuthorTokensIn = repro.authorTokensIn
      row.reproAuthorTokensOut = repro.authorTokensOut
    }

    // Arm F (frozen): no memory.
    checkDeadline('before arm F')
    await runArm(env, bt, rowF, repro.script, marks, deadlineAt, undefined, counterF)

    // Arm L (learning): recall at open via the promptAppendix seam; byte-identical otherwise.
    checkDeadline('before arm L')
    const recall = await recallForInstance(bt)
    rowL.recall = recall.receipt
    await runArm(env, bt, rowL, repro.script, marks, deadlineAt, recall.appendix, counterL)
  }

  let deadlineErr: string | null = null
  try {
    let timer: NodeJS.Timeout | undefined
    const breach = new Promise<never>((_, rej) => {
      timer = setTimeout(
        () => rej(new Error(`DEADLINE: instance exceeded ${DEADLINE_MS}ms — error row, stream continues`)),
        DEADLINE_MS,
      )
    })
    try {
      await Promise.race([pipeline(), breach])
    } finally {
      clearTimeout(timer)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 400) : String(e).slice(0, 400)
    deadlineErr = msg
    const hit = msg.startsWith('DEADLINE')
    for (const row of [rowF, rowL]) {
      if (!row.error) row.error = msg
      row.deadlineHit = row.deadlineHit || hit
    }
    if (hit) logEvent('deadline-breach', { streamIndex, instanceId: bt.id, afterMs: Date.now() - t0 })
  }

  // ── Per-instance phase B: decisions are locked; the official judge grades both arms,
  // serialized. Judge outputs live in rows only — never in any model context. ──
  for (const row of [rowF, rowL]) {
    if (row.error && !row.finalDiff.trim()) {
      row.hiddenResolved = false
      row.judgeSkipped = deadlineErr ? 'error-no-patch' : 'empty-patch'
      continue
    }
    const j = await serializedJudge(state, env, bt, row.finalDiff)
    row.hiddenResolved = j.resolved
    row.judgeDetail = j.detail
    row.judgeMs = j.ms
    row.judgeSkipped = j.skipped
  }

  // ── L settle: failure-class tally + templated outcome-anchored note (Row fields only). ──
  rowL.failureClass = classifyOutcome(rowL)
  rowF.failureClass = classifyOutcome(rowF)
  state.tally[rowL.failureClass] = (state.tally[rowL.failureClass] ?? 0) + 1
  rowL.tallySnapshot = { ...state.tally }
  try {
    rowL.noteWrite = await writeNote(rowL, [...state.ftpMarks], leakMarks(md))
    logEvent('note-written', { streamIndex, instanceId: bt.id, path: rowL.noteWrite.path })
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300)
    rowL.noteWrite = { path: '', bytes: 0, lintMarksChecked: 0, written: false, error: msg }
    logEvent('note-lint-violation', { streamIndex, instanceId: bt.id, error: msg })
  }

  // ── Finalize receipts + cumulative tracks; append both rows. Authoring usd splits 50/50 so the
  // arm-vs-arm $ comparison stays unbiased (the repro is a shared instrument). ──
  const authorUsd = usdOf(rowF.reproAuthorTokensIn, rowF.reproAuthorTokensOut)
  for (const [row, counter] of [
    [rowF, counterF],
    [rowL, counterL],
  ] as Array<[Row, Counter]>) {
    row.llmCalls = counter.calls
    row.httpAttempts = counter.httpAttempts
    row.tokensIn = counter.tokensIn
    row.tokensOut = counter.tokensOut
    row.guardedMsgs = counter.guardedMsgs
    row.usd = usdOf(counter.tokensIn, counter.tokensOut) + authorUsd / 2
    row.wallMs = Date.now() - t0
    const cum = state.cum[row.arm]
    cum.n += 1
    if (row.hiddenResolved === true) cum.resolved += 1
    cum.usd += row.usd
    row.cumN = cum.n
    row.cumResolved = cum.resolved
    row.cumUsd = cum.usd
    appendRow(row)
  }

  // ── Rotation: delete the instance image AFTER both arms + judge, unless it was cached at
  // stream start (the keep-set). ──
  const tag = rowF.image
  if (tag && !state.keepImages.has(tag)) {
    try {
      await exec('docker', ['rmi', tag], { timeout: 120_000 })
      logEvent('image-deleted', { streamIndex, instanceId: bt.id, tag })
    } catch (e) {
      logEvent('image-delete-failed', { streamIndex, instanceId: bt.id, tag, error: String(e).slice(0, 200) })
    }
  }

  const fmt = (r: Row): string =>
    `${r.arm}: repro=${r.reproStatus} sel=${r.selection ? `${r.selection.mode}@${r.selection.selectedIdx}` : '-'} ` +
    `sev=[${r.candidates.map((x) => x.severity).join(',')}] repairs=${r.repairs.length} caps=${r.capBreaches} ` +
    `resolved=${r.hiddenResolved === null ? '?' : r.hiddenResolved ? 1 : 0} calls=${r.llmCalls} $${r.usd.toFixed(3)}` +
    `${r.error ? ` ERR=${r.error.slice(0, 80)}` : ''}`
  console.log(`[#${streamIndex}] ${bt.id} settle (${Math.round((Date.now() - t0) / 1000)}s)\n  ${fmt(rowF)}\n  ${fmt(rowL)}`)
}

// ---------- curve (a pure fold over the ledger, in stream order) ----------

function printCurve(rows: Row[]): void {
  const byKey = new Map<string, Row>()
  for (const r of rows) byKey.set(`${r.streamIndex}:${r.arm}`, r) // last write wins (resume reruns)
  const indices = [...new Set([...byKey.values()].map((r) => r.streamIndex))].sort((a, b) => a - b)
  let fN = 0
  let fRes = 0
  let fUsd = 0
  let lRes = 0
  let lUsd = 0
  console.log('\n══ cumulative divergence curve (fold over the ledger, stream order) ══')
  console.log('idx | instance | F | L | F-cum% | L-cum% | delta(pp) | F-cum$ | L-cum$')
  for (const i of indices) {
    const f = byKey.get(`${i}:F`)
    const l = byKey.get(`${i}:L`)
    if (!f || !l) continue
    fN += 1
    if (f.hiddenResolved === true) fRes += 1
    if (l.hiddenResolved === true) lRes += 1
    fUsd += f.usd
    lUsd += l.usd
    const fPct = (100 * fRes) / fN
    const lPct = (100 * lRes) / fN
    console.log(
      `${String(i).padStart(3)} | ${f.instanceId.padEnd(38)} | ${f.hiddenResolved ? 1 : 0} | ${l.hiddenResolved ? 1 : 0} | ` +
        `${fPct.toFixed(1).padStart(5)} | ${lPct.toFixed(1).padStart(5)} | ${(lPct - fPct).toFixed(1).padStart(6)} | ` +
        `${fUsd.toFixed(2).padStart(6)} | ${lUsd.toFixed(2).padStart(6)}`,
    )
  }
  console.log(`n=${fN} paired | F resolved ${fRes}/${fN} | L resolved ${lRes}/${fN} | final delta ${((100 * (lRes - fRes)) / Math.max(1, fN)).toFixed(1)}pp`)
}

// ---------- driver ----------

async function main(): Promise<void> {
  mkdirSync(STREAM_DIR, { recursive: true })
  await initKnowledgeBase(STORE)

  const pool = process.env.IDS
    ? process.env.IDS.split(',').map((s) => s.trim()).filter(Boolean)
    : [...FINGERPRINT_23]
  // Stream order is an APPEND-ONLY pre-registered plan persisted in STREAM_DIR/plan.json: the
  // saved order is immutable (streamIndex must stay stable across continuations); ids new to the
  // pool are seeded-shuffled, cached-images-first, and APPENDED. Day-1 starts the plan; later days
  // extend it by passing a larger IDS pool to the same STREAM_DIR.
  const planPath = join(STREAM_DIR, 'plan.json')
  const prefix: string[] = existsSync(planPath) ? (JSON.parse(readFileSync(planPath, 'utf8')) as string[]) : []
  const known = new Set(prefix)
  const shuffled = seededShuffle(pool.filter((id) => !known.has(id)), SEED)
  const cached = new Set(await cachedInstanceIds())
  const fullPlan = [...prefix, ...shuffled.filter((id) => cached.has(id)), ...shuffled.filter((id) => !cached.has(id))]
  writeFileSync(planPath, `${JSON.stringify(fullPlan, null, 1)}\n`)
  const plan = fullPlan.slice(0, Math.min(fullPlan.length, STREAM_N))

  console.log('═══ SWE-bench STREAM — day 1 (two-arm, F=frozen-v0 vs L=learning) ═══')
  console.log(
    `model=${MODEL} base=${ZAI_BASE} maxTokens=${MAX_TOKENS} k=${K} temp=${TEMP} repairs<=${REPAIRS} ` +
      `innerTurns=${INNER_TURNS} TURN_CAP=${TURN_CAP} DEADLINE_MS=${DEADLINE_MS} conc=${CONC} seed=0x${SEED.toString(16)} ` +
      `judge=serialized(cache_level=${process.env.SWEBENCH_CACHE_LEVEL}) profile=${PROFILE_VERSION}`,
  )
  console.log(`stream dir=${STREAM_DIR}\nplan (${plan.length}): ${plan.join(', ')}`)
  const manifestN = plan.filter((id) => MANIFEST[id]).length
  console.log(`repro manifest: ${manifestN}/${plan.length} reused (re-verified); the rest author fresh`)

  const env = await createSweBenchEnvironment(plan.length, { ids: plan, cloneCache: true })
  await env.adapter.preflight?.()
  const taskById = new Map((await env.adapter.loadTasks({ ids: plan, split: 'test' })).map((t) => [t.id, t]))
  const missing = plan.filter((id) => !taskById.has(id))
  if (missing.length) throw new Error(`instances not found in SWE-bench_Verified: ${missing.join(', ')}`)

  // Resume: an instance is DONE iff both arm rows settled. Cumulative tracks, the failure tally,
  // and the FTP mark set refold from the ledger.
  const prior = loadLedger()
  const doneIds = new Set<string>()
  const seen = new Map<string, Set<string>>()
  for (const r of prior) {
    const arms = seen.get(r.instanceId) ?? new Set<string>()
    arms.add(r.arm)
    seen.set(r.instanceId, arms)
    if (arms.has('F') && arms.has('L')) doneIds.add(r.instanceId)
  }
  const state: StreamState = {
    keepImages: new Set<string>(),
    ftpMarks: new Set<string>(),
    tally: {},
    cum: { F: { n: 0, resolved: 0, usd: 0 }, L: { n: 0, resolved: 0, usd: 0 } },
    judgeChain: Promise.resolve(),
  }
  for (const r of prior) {
    const cum = state.cum[r.arm]
    cum.n = Math.max(cum.n, r.cumN)
    cum.resolved = Math.max(cum.resolved, r.cumResolved)
    cum.usd = Math.max(cum.usd, r.cumUsd)
    if (r.arm === 'L' && r.tallySnapshot) state.tally = { ...r.tallySnapshot }
  }
  for (const id of doneIds) {
    const t = taskById.get(id)
    if (t) for (const m of failToPassNames(t.metadata ?? {})) state.ftpMarks.add(m)
  }
  // The keep-set: every instance image cached at stream start survives rotation.
  const { stdout } = await exec('docker', ['images', '--format', '{{.Repository}}:{{.Tag}}'], { timeout: 30_000 })
  for (const line of stdout.split('\n')) {
    if (/sweb\.eval\.x86_64\./.test(line.trim())) state.keepImages.add(line.trim())
  }
  // Fresh stream ⇒ the memory store must start EMPTY (the doc's divergence-only-from-learning
  // invariant). A resumed stream carries its own notes forward.
  if (prior.length === 0) {
    const idx = await buildKnowledgeIndex(STORE)
    if (idx.pages.length > 0) {
      throw new Error(`stream is fresh (empty ledger) but the memory store has ${idx.pages.length} page(s) — stale STORE at ${STORE}`)
    }
  }
  if (prior.length === 0) {
    logEvent('stream-start', {
      seed: SEED, plan, deadlineMs: DEADLINE_MS, turnCap: TURN_CAP, k: K, repairs: REPAIRS,
      temp: TEMP, model: MODEL, profileVersion: PROFILE_VERSION, keepImages: [...state.keepImages],
    })
  } else {
    logEvent('stream-resume', { done: doneIds.size, planned: plan.length })
  }
  if (doneIds.size) console.log(`resume: ${doneIds.size} instance(s) already settled; ${plan.filter((id) => !doneIds.has(id)).length} to run`)

  let next = 0
  const worker = async (): Promise<void> => {
    while (next < plan.length) {
      const i = next++
      const id = plan[i] as string
      if (doneIds.has(id)) continue
      // Day-1 STUB of the every-N batch trigger (N=25): the gate look is wired on later days.
      if (i > 0 && i % 25 === 0) logEvent('batch-look (stub)', { streamIndex: i })
      console.log(`[#${i}] ${id} …`)
      try {
        await processInstance(state, env, taskById.get(id) as BenchTask, i)
      } catch (e) {
        // processInstance settles its own rows; reaching here means settling itself failed.
        console.error(`[#${i}] ${id} SETTLE FAILURE: ${e instanceof Error ? e.message : String(e)}`)
        logEvent('settle-failure', { streamIndex: i, instanceId: id, error: String(e).slice(0, 300) })
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, () => worker()))

  const rows = loadLedger()
  printCurve(rows)

  const byArm = (arm: 'F' | 'L'): Row[] => rows.filter((r) => r.arm === arm)
  for (const arm of ['F', 'L'] as const) {
    const a = byArm(arm)
    const caps = a.reduce((s, r) => s + r.capBreaches, 0)
    const dl = a.filter((r) => r.deadlineHit).length
    const usd = a.reduce((s, r) => s + r.usd, 0)
    const tokIn = a.reduce((s, r) => s + r.tokensIn, 0)
    const tokOut = a.reduce((s, r) => s + r.tokensOut, 0)
    const guarded = a.reduce((s, r) => s + r.guardedMsgs, 0)
    console.log(
      `arm ${arm}: rows=${a.length} resolved=${a.filter((r) => r.hiddenResolved === true).length} ` +
        `errorRows=${a.filter((r) => r.error).length} deadlineHits=${dl} capBreaches=${caps} ` +
        `tokens=${tokIn}/${tokOut} guardedMsgs=${guarded} $${usd.toFixed(2)} (assumed $${PRICE_IN}/M in, $${PRICE_OUT}/M out)`,
    )
  }
  console.log(`ledger=${LEDGER}\nevents=${EVENTS}\nstore=${STORE}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
