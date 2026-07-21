/**
 * Two-session SWE-bench experiment with generation and official scoring split into separate modes.
 *
 * MODE=generate requires EXPERIMENT_ARM=independent-2|persistent-refine-2 and writes only Phase A.
 * The independent arm runs two fresh attempts. The persistent arm runs one attempt and one fresh
 * continuation with attempt one's cumulative patch pre-applied. Both use the same run-capable tools,
 * prompt, temperature, two worker sessions, and later-on-visible-tie selection rule. Per-row hashes
 * bind source, config, reproduction, prompt, tools, task, parent patch, and final patch.
 *
 * MODE=judge-only requires INDEPENDENT_PHASE_A, PERSISTENT_PHASE_A, and a distinct OUT. It validates
 * both complete Phase-A files and every paired fingerprint before the first serialized official score.
 *
 * Generate env: ZAI_API_KEY, REPRO_MANIFEST, IDS, OUT, MODEL, ZAI_BASE, MAX_TOKENS, TEMPERATURE,
 * INNER_TURNS, CONC, REPRO_TIMEOUT, LLM_TIMEOUT_MS, SWE_RUN_TIMEOUT, SWE_RUN_OUTPUT_LIMIT,
 * PRICE_IN, PRICE_OUT. Judge env: INDEPENDENT_PHASE_A, PERSISTENT_PHASE_A, OUT.
 */
import { execFile } from 'node:child_process'
import { appendFileSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { AgenticSurface, AgenticTask, ArtifactHandle, SurfaceScore } from '@tangle-network/agent-runtime/loops'
import { refine, runAgentic } from '@tangle-network/agent-runtime/loops'
import type { BenchTask } from './benchmarks/types'
import {
  createSweBenchEnvironment,
  resolveImageForMetadata,
  resolveSweBenchScorerVersion,
  SWE_RUN_TOOL_CONFIG,
  SWE_SEED_PROMPT_WITH_RUN,
  type SweImageIdentity,
} from './swe-bench-env'
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
import {
  type ExperimentArm,
  type ExperimentArmPreset,
  assertExactCompletedWorkerSessions,
  continuationDisposition,
  continuationStateNotice,
  preferLaterCandidate,
  resolveExperimentArm,
  resolveExperimentTemperature,
  shouldAcceptContinuation,
  shouldRunContinuation,
} from './swe-structural-policy'
import {
  assertFingerprintsEqual,
  createExecutionReceipt,
  createFingerprints,
  diffChanged,
  diffFingerprint,
  fingerprint,
  runtimeImplementationFingerprint,
  type ExecutionReceipt,
  type Fingerprints,
  type SharedExecutionReceipt,
} from './swe-structural-provenance'
import {
  assertCompleteTaskSet,
  assertDistinctArtifactPaths,
  assertJudgeCompletionMatchesInput,
  assertJudgeResumeFingerprints,
  assertPairedExecutionFingerprint,
  assertPairedFingerprints,
  completeJudgeScore,
} from './swe-structural-judge-policy'

const exec = promisify(execFile)
const TEMPERATURE = resolveExperimentTemperature(process.env)

function sourceTreeReceipt(
  rootUrl: URL,
  label: string,
  include: (path: string) => boolean,
): Array<{ name: string; content: string }> {
  const root = fileURLToPath(rootUrl)
  const receipt: Array<{ name: string; content: string }> = []
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && include(path)) {
        receipt.push({ name: `${label}/${relative(root, path)}`, content: readFileSync(path, 'utf8') })
      }
    }
  }
  visit(root)
  return receipt
}

// ---------- config ----------

type Mode = 'generate' | 'judge-only'
const MODE_INPUT = process.env.MODE ?? 'generate'
if (MODE_INPUT !== 'generate' && MODE_INPUT !== 'judge-only') {
  throw new Error(`MODE must be generate|judge-only, got "${MODE_INPUT}"`)
}
const MODE: Mode = MODE_INPUT
const OFFICIAL_SCORER_CACHE_LEVEL = 'instance' as const
if (
  MODE === 'judge-only' &&
  process.env.SWEBENCH_CACHE_LEVEL !== undefined &&
  process.env.SWEBENCH_CACHE_LEVEL !== OFFICIAL_SCORER_CACHE_LEVEL
) {
  throw new Error('MODE=judge-only requires SWEBENCH_CACHE_LEVEL=instance')
}
if (MODE === 'judge-only') process.env.SWEBENCH_CACHE_LEVEL = OFFICIAL_SCORER_CACHE_LEVEL
for (const legacy of ['ARM', 'ARM_NAME', 'K', 'REPAIRS', 'FORCE_TWO_SESSIONS', 'SOLO_TEMP', 'SKIP_JUDGE']) {
  if (process.env[legacy] !== undefined) {
    throw new Error(`${legacy} is not supported; use typed EXPERIMENT_ARM plus MODE=generate|judge-only`)
  }
}
const ARM_PRESET: ExperimentArmPreset | null = MODE === 'generate'
  ? resolveExperimentArm(process.env.EXPERIMENT_ARM ?? '')
  : null
const ZAI_BASE = process.env.ZAI_BASE ?? 'https://api.z.ai/api/coding/paas/v4'
const ZAI_KEY = process.env.ZAI_API_KEY ?? ''
if (MODE === 'generate' && !ZAI_KEY) throw new Error('ZAI_API_KEY required for MODE=generate')
const MODEL = process.env.MODEL ?? 'glm-5.2'
// glm-5.2 is a reasoning model: hidden reasoning consumes max_tokens, so <8000 starves content.
const MAX_TOKENS = Number(process.env.MAX_TOKENS ?? 12_000)
const INNER_TURNS = Number(process.env.INNER_TURNS ?? 40)
const CONC = Math.max(1, Math.min(4, Number(process.env.CONC ?? 2)))
const REPRO_TIMEOUT_S = Number(process.env.REPRO_TIMEOUT ?? 120)
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 480_000)
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
  if (MODE !== 'generate') return {}
  const p = process.env.REPRO_MANIFEST
  if (!p) throw new Error('REPRO_MANIFEST required for MODE=generate')
  return JSON.parse(readFileSync(p, 'utf8')) as Record<string, ReproManifestEntry>
})()

interface CommonConfigReceipt {
  schema: 'swe-structural-v2'
  model: string
  zaiBase: string
  maxTokens: number
  temperature: number
  innerTurns: number
  concurrency: number
  reproTimeoutS: number
  llmTimeoutMs: number
  sweRunTimeoutS: number
  sweRunOutputLimit: number
  runTool: true
  seedPrompt: 'SWE_SEED_PROMPT_WITH_RUN'
  taskIds: string[]
}

interface ExperimentConfigReceipt extends CommonConfigReceipt {
  arm: ExperimentArm
  k: 1 | 2
  repairs: 0 | 1
  alwaysRunContinuation: boolean
  persistent: boolean
  workerSessions: 2
}

const SOURCE_RECEIPT = [
  ['swe-structural.mts', new URL('./swe-structural.mts', import.meta.url)],
  ['swe-structural-policy.ts', new URL('./swe-structural-policy.ts', import.meta.url)],
  ['swe-structural-provenance.ts', new URL('./swe-structural-provenance.ts', import.meta.url)],
  ['swe-structural-judge-policy.ts', new URL('./swe-structural-judge-policy.ts', import.meta.url)],
  ['swe-bench-env.ts', new URL('./swe-bench-env.ts', import.meta.url)],
  ['swe-jail.ts', new URL('./swe-jail.ts', import.meta.url)],
  ['swe-temp.ts', new URL('./swe-temp.ts', import.meta.url)],
  ['benchmarks/swe-bench.ts', new URL('./benchmarks/swe-bench.ts', import.meta.url)],
  ['benchmarks/_harness.ts', new URL('./benchmarks/_harness.ts', import.meta.url)],
  ['runtime/strategy.ts', new URL('../../src/runtime/strategy.ts', import.meta.url)],
].map(([name, url]) => ({ name: String(name), content: readFileSync(url as URL, 'utf8') }))

const RUNTIME_IMPLEMENTATION_FINGERPRINT = runtimeImplementationFingerprint({ runAgentic, refine })
const RUNTIME_TREE_FINGERPRINT = fingerprint([
  ...sourceTreeReceipt(new URL('../../src/', import.meta.url), 'agent-runtime/src', (path) => path.endsWith('.ts')),
  ...sourceTreeReceipt(
    new URL('../../node_modules/@tangle-network/agent-eval/dist/', import.meta.url),
    'agent-eval/dist',
    (path) => path.endsWith('.js'),
  ),
  {
    name: 'agent-runtime/package.json',
    content: readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  },
  {
    name: 'agent-runtime/pnpm-lock.yaml',
    content: readFileSync(new URL('../../pnpm-lock.yaml', import.meta.url), 'utf8'),
  },
  {
    name: 'agent-eval/package.json',
    content: readFileSync(new URL('../../node_modules/@tangle-network/agent-eval/package.json', import.meta.url), 'utf8'),
  },
])

function makeExperimentConfig(preset: ExperimentArmPreset, taskIds: string[]): ExperimentConfigReceipt {
  return {
    schema: 'swe-structural-v2',
    arm: preset.arm,
    k: preset.k,
    repairs: preset.repairs,
    alwaysRunContinuation: preset.alwaysRunContinuation,
    persistent: preset.persistent,
    workerSessions: preset.workerSessions,
    model: MODEL,
    zaiBase: ZAI_BASE,
    maxTokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    innerTurns: INNER_TURNS,
    concurrency: CONC,
    reproTimeoutS: REPRO_TIMEOUT_S,
    llmTimeoutMs: LLM_TIMEOUT_MS,
    sweRunTimeoutS: SWE_RUN_TOOL_CONFIG.timeoutS,
    sweRunOutputLimit: SWE_RUN_TOOL_CONFIG.outputLimit,
    runTool: true,
    seedPrompt: 'SWE_SEED_PROMPT_WITH_RUN',
    taskIds: [...taskIds],
  }
}

function commonConfig(config: ExperimentConfigReceipt): CommonConfigReceipt {
  const {
    arm: _arm,
    k: _k,
    repairs: _repairs,
    alwaysRunContinuation: _alwaysRunContinuation,
    persistent: _persistent,
    workerSessions: _workerSessions,
    ...common
  } = config
  return common
}

function reproReceipt(entry: ReproManifestEntry | undefined): ReproManifestEntry | null {
  return entry ? { script: entry.script, source: entry.source, stage0Class: entry.stage0Class } : null
}

function expectedFingerprints(
  bt: BenchTask,
  config: ExperimentConfigReceipt,
  tools: unknown,
  repro: ReproManifestEntry | undefined,
): Fingerprints {
  return createFingerprints({
    source: SOURCE_RECEIPT,
    config,
    commonConfig: commonConfig(config),
    repro: reproReceipt(repro),
    prompt: SWE_SEED_PROMPT_WITH_RUN,
    tools,
    task: { id: bt.id, prompt: bt.prompt, metadata: bt.metadata ?? null },
  })
}

// ---------- transport: zai direct, patient ladder, leak guard at the chokepoint ----------

interface Counter {
  workerSessionsStarted: number
  workerSessionsCompleted: number
  calls: number
  httpAttempts: number
  tokensIn: number
  tokensOut: number
  guardedMsgs: number
}

const newCounter = (): Counter => ({
  workerSessionsStarted: 0,
  workerSessionsCompleted: 0,
  calls: 0,
  httpAttempts: 0,
  tokensIn: 0,
  tokensOut: 0,
  guardedMsgs: 0,
})

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
    systemPrompt: SWE_SEED_PROMPT_WITH_RUN,
    userPrompt: cfg.promptAppendix ? `${bt.prompt}\n\n${cfg.promptAppendix}` : bt.prompt,
    meta: { instanceId: bt.id },
  }
  let error: string | undefined
  try {
    cfg.instanceCounter.workerSessionsStarted += 1
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
    if (counter.calls < 1) throw new Error('worker session completed without a successful model call')
    cfg.instanceCounter.workerSessionsCompleted += 1
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

// Arm composition deliberately stays outside the built-in sample/refine strategies while each
// worker session still runs through runAgentic(refine, budget=1). The built-ins cannot reproduce
// this controlled comparison: sample exposes only aggregate scores and has no stable later-on-tie
// patch receipt; refine may stop after shot one, adds an analyst call, and carries conversation
// history. This layer supplies only the missing experiment policy: exactly two fresh worker
// sessions, optional parent-patch state, shared visible selection, and exact per-session receipts.

// ---------- in-image candidate scoring ----------

/** Severity ordering for selection (lower is better): 0 repro-pass, 1 repro-fail, 2 timeout,
 *  3 apply-fail, 4 empty. Both experiment arms deterministically prefer session two on a tie. */
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
  diffHash: string
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
  parentDiffHash: string
  diff: string
  finalDiffHash: string
  changedFromParent: boolean
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

interface PhaseARow {
  instanceId: string
  arm: ExperimentArm
  config: ExperimentConfigReceipt
  fingerprints: Fingerprints
  repo: string
  model: string
  image: string | null
  execution: ExecutionReceipt | null
  executionFingerprint: string
  execMode: 'image'
  temperature: number
  innerTurns: number
  k: number
  maxRepairs: number
  // canary + repro provenance (system arm)
  canaryExit: number | null
  canaryPass: boolean | null
  reproSource: string
  reproStage0Class: string | null
  reproStatus: string
  reproScript: string | null
  reproPreExit: number | null
  reproGoldExit: number | null
  reproOutcomeFingerprint: string
  // candidates + selection + continuation receipts
  candidates: CandidateRow[]
  selection: { mode: string; selectedIdx: number; movedOffFirst: boolean } | null
  repairs: RepairRow[]
  repairStop: string | null
  finalFrom: string
  parentDiffHash: string | null
  finalDiff: string
  finalDiffHash: string
  changedFromParent: boolean | null
  // cost + guard receipts
  /** Number of fresh runAgentic worker invocations, including invocations that returned an error. */
  workerSessionsStarted: number
  /** Number of runAgentic invocations that returned successfully after at least one model call. */
  workerSessions: number
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

interface PhaseAContext {
  preset: ExperimentArmPreset
  config: ExperimentConfigReceipt
  tools: unknown
  sharedExecution: SharedExecutionReceipt
  expectedImageIdentities: Map<string, SweImageIdentity>
}

async function phaseA(env: Env, bt: BenchTask, ctx: PhaseAContext): Promise<PhaseARow> {
  const t0 = Date.now()
  const md = bt.metadata as Record<string, string>
  const counter = newCounter()
  const row: PhaseARow = {
    instanceId: bt.id, arm: ctx.preset.arm, config: ctx.config,
    fingerprints: expectedFingerprints(bt, ctx.config, ctx.tools, MANIFEST[bt.id]),
    repo: md.repo, model: MODEL, image: null, execution: null, executionFingerprint: '', execMode: 'image',
    temperature: TEMPERATURE, innerTurns: INNER_TURNS,
    k: ctx.preset.k, maxRepairs: ctx.preset.repairs,
    canaryExit: null, canaryPass: null, reproSource: 'none', reproStage0Class: null,
    reproStatus: 'none', reproScript: null,
    reproPreExit: null, reproGoldExit: null, reproOutcomeFingerprint: '',
    candidates: [], selection: null, repairs: [],
    repairStop: null, finalFrom: 'none', parentDiffHash: null, finalDiff: '',
    finalDiffHash: diffFingerprint(''), changedFromParent: null,
    workerSessionsStarted: 0, workerSessions: 0, llmCalls: 0, httpAttempts: 0,
    tokensIn: 0, tokensOut: 0,
    guardedMsgs: 0, wallMs: 0,
  }
  const marks = leakMarks(md)
  try {
    const img = await resolveImageForMetadata(bt.metadata ?? {})
    if (!img.ok) throw new Error(`image missing: ${img.reason}`)
    row.image = img.tag
    row.execution = createExecutionReceipt(ctx.sharedExecution, img)
    row.executionFingerprint = fingerprint(row.execution)
    ctx.expectedImageIdentities.set(bt.id, img.identity)

    // 1. EXECUTION CANARY (image substrate, gold in-container — script-side only, zero model calls).
    const pkg = IMPORT_NAME[md.repo]
    if (!pkg) throw new Error(`no IMPORT_NAME for ${md.repo} — canary not expressible`)
    const gold = String(md.patch ?? '')
    if (!gold.trim()) throw new Error('gold patch missing from metadata')
    const c = await runPyInJail(img.identity.id, null, importCanaryScript(pkg), gold, { timeoutS: REPRO_TIMEOUT_S })
    if (c.infraError) throw new Error(c.infraError)
    row.canaryExit = c.code
    row.canaryPass = c.code === 0 && c.out.includes(APPLY_SENTINEL)
    if (!row.canaryPass) throw new Error(`canary failed (exit ${c.code}): this substrate cannot grade this instance`)

    // 2. Repro reuse + re-verification on THIS substrate (validity without gold, soundness with).
    const manifest = MANIFEST[bt.id]
    let repro: string | null = null
    if (manifest) {
      row.reproSource = manifest.source
      row.reproStage0Class = manifest.stage0Class
      row.reproScript = manifest.script
      const pre = await runPyInJail(img.identity.id, null, manifest.script, undefined, { timeoutS: REPRO_TIMEOUT_S })
      if (pre.infraError) throw new Error(pre.infraError)
      row.reproPreExit = pre.code
      if (pre.timedOut) row.reproStatus = 'degraded-timeout'
      else if (pre.code === 0) row.reproStatus = 'degraded-invalid'
      else {
        const post = await runPyInJail(img.identity.id, null, manifest.script, gold, { timeoutS: REPRO_TIMEOUT_S })
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
    for (let i = 0; i < ctx.preset.k; i += 1) {
      const a = await emitAttempt(env.environment, bt, { temperature: TEMPERATURE, marks, instanceCounter: counter })
      diffs.push(a.diff)
      row.candidates.push({
        idx: i, diff: a.diff, diffHash: diffFingerprint(a.diff), diffBytes: a.diff.length,
        completions: a.completions, calls: a.calls,
        tokensIn: a.tokensIn, tokensOut: a.tokensOut, wallMs: a.wallMs, attemptError: a.error ?? null,
        applyOk: null, reproExit: null, reproTimedOut: false, severity: -1, reproOutTail: '',
      })
    }

    // 4. In-image scoring + argmax.
    const scores: CandScore[] = []
    for (let i = 0; i < ctx.preset.k; i += 1) {
      const s = await scoreCandidate(img.identity.id, repro, diffs[i] as string)
      scores.push(s)
      const cand = row.candidates[i] as CandidateRow
      cand.applyOk = s.applyOk
      cand.reproExit = s.exit
      cand.reproTimedOut = s.timedOut
      cand.severity = s.severity
      cand.reproOutTail = s.out
    }
    let selectedIdx = 0
    for (let i = 1; i < ctx.preset.k; i += 1) {
      if (preferLaterCandidate((scores[selectedIdx] as CandScore).severity, (scores[i] as CandScore).severity)) {
        selectedIdx = i
      }
    }
    const mode = repro ? 'visible-severity-later-tie' : 'no-repro-later-tie'
    row.selection = { mode, selectedIdx, movedOffFirst: selectedIdx !== 0 }

    // 5. The persistent arm starts exactly one continuation from session one's cumulative patch.
    // Both arms use the same later-on-visible-tie policy.
    let best = {
      diff: diffs[selectedIdx] as string,
      score: scores[selectedIdx] as CandScore,
      from: ctx.preset.persistent ? 'session:1' : `attempt:${selectedIdx + 1}`,
    }
    if (!ctx.preset.persistent) {
      row.repairStop = 'independent-arm'
    } else {
      for (let round = 1; shouldRunContinuation({ round, preset: ctx.preset }); round += 1) {
        const parentDiff = best.diff
        const parentDiffHash = diffFingerprint(parentDiff)
        row.parentDiffHash = parentDiffHash
        const reproductionEvidence = repro
          ? `--- REPRODUCTION SCRIPT (written from the issue; exit 0 = fixed) ---\n${tail(repro, 6_000)}\n\n` +
            `--- REPRODUCTION OUTPUT on the current state (exit ${best.score.exit ?? 'n/a'}) ---\n${best.score.out}\n\n`
          : '--- EXTERNAL REPRODUCTION ---\nNo external reproduction is available. Use the run tool to construct local, issue-specific checks.\n\n'
        const repairInstruction = best.score.severity === 0
          ? 'The visible reproduction PASSES, but it is only a partial check. Re-read the full issue and audit ' +
            'the current patch for missed cases or regressions. Keep the visible check passing while correcting ' +
            'any incomplete source behavior you find with minimal edit_file changes. Do not modify tests.'
          : 'The visible reproduction still fails (or no external reproduction is available). Diagnose why the ' +
            'current state does not resolve the full issue, then correct the SOURCE with minimal edit_file changes ' +
            '(you may revise or revert parts of the previous fix — it is already in the files). Do not modify tests.'
        const appendix =
          continuationStateNotice(best.diff) +
          reproductionEvidence +
          '--- REPAIR INSTRUCTIONS ---\n' +
          repairInstruction
        const a = await emitAttempt(env.environment, bt, {
          temperature: TEMPERATURE, marks, instanceCounter: counter, preApply: best.diff, promptAppendix: appendix,
        })
        const ns = await scoreCandidate(img.identity.id, repro, a.diff)
        const finalDiffHash = diffFingerprint(a.diff)
        const changedFromParent = diffChanged(parentDiff, a.diff)
        const accepted = shouldAcceptContinuation(best.score.severity, ns.severity)
        const disposition = continuationDisposition(accepted, changedFromParent)
        row.repairs.push({
          round, baseFrom: best.from, baseSeverity: best.score.severity, parentDiffHash,
          diff: a.diff, finalDiffHash, changedFromParent, diffBytes: a.diff.length,
          completions: a.completions, calls: a.calls, tokensIn: a.tokensIn, tokensOut: a.tokensOut,
          wallMs: a.wallMs, attemptError: a.error ?? null, applyOk: ns.applyOk, reproExit: ns.exit,
          severity: ns.severity, accepted,
        })
        if (accepted) {
          best = {
            diff: a.diff,
            score: ns,
            from: disposition.finalFrom,
          }
          row.repairStop = disposition.stop
        } else {
          best.from = disposition.finalFrom
          row.repairStop = disposition.stop
        }
      }
    }
    row.finalDiff = best.diff
    row.finalDiffHash = diffFingerprint(best.diff)
    row.finalFrom = best.from
    row.changedFromParent = row.parentDiffHash === null
      ? null
      : row.finalDiffHash !== row.parentDiffHash
    return row
  } catch (e) {
    row.error = e instanceof Error ? e.message.slice(0, 400) : String(e).slice(0, 400)
    return row
  } finally {
    row.reproOutcomeFingerprint = fingerprint({
      canaryExit: row.canaryExit,
      canaryPass: row.canaryPass,
      image: row.execution?.image ?? null,
      reproGoldExit: row.reproGoldExit,
      reproPreExit: row.reproPreExit,
      reproSource: row.reproSource,
      reproStage0Class: row.reproStage0Class,
      reproStatus: row.reproStatus,
    })
    row.workerSessionsStarted = counter.workerSessionsStarted
    row.workerSessions = counter.workerSessionsCompleted
    row.llmCalls = counter.calls
    row.httpAttempts = counter.httpAttempts
    row.tokensIn = counter.tokensIn
    row.tokensOut = counter.tokensOut
    row.guardedMsgs = counter.guardedMsgs
    row.wallMs = Date.now() - t0
  }
}

// ---------- driver ----------

function loadPhaseRows(path: string, required = false): Map<string, PhaseARow> {
  if (!existsSync(path)) {
    if (required) throw new Error(`required Phase-A file does not exist: ${path}`)
    return new Map()
  }
  const rows = new Map<string, PhaseARow>()
  for (const [index, line] of readFileSync(path, 'utf8').split('\n').entries()) {
    if (!line.trim()) continue
    const row = JSON.parse(line) as PhaseARow
    if (!row.instanceId) throw new Error(`${path}:${index + 1}: missing instanceId`)
    if (rows.has(row.instanceId)) throw new Error(`${path}:${index + 1}: duplicate instanceId ${row.instanceId}`)
    rows.set(row.instanceId, row)
  }
  if (required && rows.size === 0) throw new Error(`required Phase-A file is empty: ${path}`)
  return rows
}

function manifestFromRow(row: PhaseARow): ReproManifestEntry | undefined {
  if (row.reproScript === null) {
    if (row.reproSource !== 'none' || row.reproStage0Class !== null) {
      throw new Error(`${row.instanceId}: incomplete null-repro receipt`)
    }
    return undefined
  }
  if (row.reproSource === 'none' || row.reproStage0Class === null) {
    throw new Error(`${row.instanceId}: incomplete repro receipt`)
  }
  return { script: row.reproScript, source: row.reproSource, stage0Class: row.reproStage0Class }
}

function assertPresetConfig(config: ExperimentConfigReceipt, arm: ExperimentArm, context: string): void {
  const preset = resolveExperimentArm(arm)
  if (
    config.schema !== 'swe-structural-v2' ||
    !config.model ||
    !config.zaiBase ||
    !Number.isFinite(config.maxTokens) ||
    config.maxTokens <= 0 ||
    !Number.isFinite(config.temperature) ||
    !Number.isInteger(config.innerTurns) ||
    config.innerTurns <= 0 ||
    !Number.isInteger(config.concurrency) ||
    config.concurrency < 1 ||
    !Number.isFinite(config.reproTimeoutS) ||
    config.reproTimeoutS <= 0 ||
    !Number.isFinite(config.llmTimeoutMs) ||
    config.llmTimeoutMs <= 0 ||
    config.runTool !== true ||
    config.seedPrompt !== 'SWE_SEED_PROMPT_WITH_RUN' ||
    !Number.isFinite(config.sweRunTimeoutS) ||
    config.sweRunTimeoutS <= 0 ||
    !Number.isFinite(config.sweRunOutputLimit) ||
    config.sweRunOutputLimit <= 0 ||
    !Array.isArray(config.taskIds) ||
    config.taskIds.length === 0
  ) {
    throw new Error(`${context}: unsupported config schema or worker surface`)
  }
  for (const key of ['arm', 'k', 'repairs', 'alwaysRunContinuation', 'persistent', 'workerSessions'] as const) {
    if (config[key] !== preset[key]) {
      throw new Error(`${context}: config ${key}=${String(config[key])}, expected ${String(preset[key])}`)
    }
  }
}

async function assertPhaseRow(
  row: PhaseARow,
  bt: BenchTask,
  config: ExperimentConfigReceipt,
  tools: unknown,
  repro: ReproManifestEntry | undefined,
  sharedExecution: SharedExecutionReceipt,
  context: string,
): Promise<void> {
  if (row.instanceId !== bt.id) throw new Error(`${context}: instance mismatch ${row.instanceId} != ${bt.id}`)
  if (row.arm !== config.arm) throw new Error(`${context}: arm mismatch ${row.arm} != ${config.arm}`)
  if (!row.config) throw new Error(`${context}: missing config receipt`)
  assertPresetConfig(row.config, row.arm, context)
  if (fingerprint(row.config) !== fingerprint(config)) throw new Error(`${context}: config receipt mismatch`)
  assertFingerprintsEqual(row.fingerprints, expectedFingerprints(bt, config, tools, repro), context)
  if (
    row.model !== config.model ||
    row.temperature !== config.temperature ||
    row.innerTurns !== config.innerTurns ||
    row.k !== config.k ||
    row.maxRepairs !== config.repairs
  ) {
    throw new Error(`${context}: row execution fields do not match config receipt`)
  }
  if (row.repo !== String((bt.metadata as Record<string, unknown> | undefined)?.repo ?? '')) {
    throw new Error(`${context}: row repo does not match task metadata`)
  }
  if (row.error) throw new Error(`${context}: Phase A contains an error: ${row.error}`)
  assertExactCompletedWorkerSessions({
    started: row.workerSessionsStarted,
    completed: row.workerSessions,
    sessions: [...row.candidates, ...row.repairs],
    context,
  })
  const currentImage = await resolveImageForMetadata(bt.metadata ?? {})
  if (!currentImage.ok) throw new Error(`${context}: image unavailable during receipt validation: ${currentImage.reason}`)
  const expectedExecution = createExecutionReceipt(sharedExecution, currentImage)
  const actualExecution = row.execution
  if (!actualExecution || fingerprint(actualExecution) !== fingerprint(expectedExecution)) {
    throw new Error(`${context}: execution receipt mismatch`)
  }
  if (
    row.config.sweRunTimeoutS !== actualExecution.runTool.timeoutS ||
    row.config.sweRunOutputLimit !== actualExecution.runTool.outputLimit
  ) {
    throw new Error(`${context}: config and execution run-tool settings do not match`)
  }
  if (row.executionFingerprint !== fingerprint(expectedExecution)) {
    throw new Error(`${context}: execution fingerprint mismatch`)
  }
  if (row.image !== expectedExecution.image.tag) throw new Error(`${context}: image tag receipt mismatch`)
  if (row.finalDiffHash !== diffFingerprint(row.finalDiff)) throw new Error(`${context}: final diff hash mismatch`)
  const expectedReproOutcome = fingerprint({
    canaryExit: row.canaryExit,
    canaryPass: row.canaryPass,
    image: actualExecution.image,
    reproGoldExit: row.reproGoldExit,
    reproPreExit: row.reproPreExit,
    reproSource: row.reproSource,
    reproStage0Class: row.reproStage0Class,
    reproStatus: row.reproStatus,
  })
  if (row.reproOutcomeFingerprint !== expectedReproOutcome) {
    throw new Error(`${context}: reproduction outcome fingerprint mismatch`)
  }
  for (const candidate of row.candidates) {
    if (candidate.diffHash !== diffFingerprint(candidate.diff)) {
      throw new Error(`${context}: candidate ${candidate.idx} diff hash mismatch`)
    }
  }

  const preset = resolveExperimentArm(row.arm)
  if (row.candidates.length !== preset.k || row.repairs.length !== preset.repairs) {
    throw new Error(
      `${context}: arm shape mismatch (candidates=${row.candidates.length}, repairs=${row.repairs.length})`,
    )
  }
  let selectedIdx = 0
  for (let i = 1; i < row.candidates.length; i += 1) {
    if (preferLaterCandidate(row.candidates[selectedIdx]!.severity, row.candidates[i]!.severity)) selectedIdx = i
  }
  const expectedMode = row.reproStatus === 'ok' ? 'visible-severity-later-tie' : 'no-repro-later-tie'
  if (
    row.selection?.selectedIdx !== selectedIdx ||
    row.selection.mode !== expectedMode ||
    row.selection.movedOffFirst !== (selectedIdx !== 0)
  ) {
    throw new Error(`${context}: selectedIdx violates later-on-visible-tie policy`)
  }

  if (!preset.persistent) {
    if (row.parentDiffHash !== null || row.changedFromParent !== null) {
      throw new Error(`${context}: independent arm must not claim a parent/refinement`)
    }
    if (row.repairStop !== 'independent-arm') throw new Error(`${context}: independent arm stop receipt mismatch`)
    const selected = row.candidates[selectedIdx]!
    if (row.finalDiff !== selected.diff || row.finalFrom !== `attempt:${selectedIdx + 1}`) {
      throw new Error(`${context}: independent final patch does not match selected attempt`)
    }
    return
  }

  const continuation = row.repairs[0]!
  const parent = row.candidates[0]!.diff
  if (continuation.baseFrom !== 'session:1' || continuation.baseSeverity !== row.candidates[0]!.severity) {
    throw new Error(`${context}: continuation parent receipt mismatch`)
  }
  if (continuation.parentDiffHash !== diffFingerprint(parent)) throw new Error(`${context}: parent diff hash mismatch`)
  if (continuation.finalDiffHash !== diffFingerprint(continuation.diff)) throw new Error(`${context}: continuation diff hash mismatch`)
  if (continuation.changedFromParent !== diffChanged(parent, continuation.diff)) {
    throw new Error(`${context}: continuation changedFromParent mismatch`)
  }
  const shouldAccept = shouldAcceptContinuation(continuation.baseSeverity, continuation.severity)
  if (continuation.accepted !== shouldAccept) throw new Error(`${context}: continuation violates shared tie policy`)
  const expectedFinal = continuation.accepted ? continuation.diff : parent
  const disposition = continuationDisposition(continuation.accepted, continuation.changedFromParent)
  if (row.finalDiff !== expectedFinal || row.finalFrom !== disposition.finalFrom || row.repairStop !== disposition.stop) {
    throw new Error(`${context}: persistent final patch/provenance mismatch`)
  }
  if (row.parentDiffHash !== continuation.parentDiffHash) throw new Error(`${context}: row parent diff hash mismatch`)
  if (row.changedFromParent !== (row.finalDiffHash !== row.parentDiffHash)) {
    throw new Error(`${context}: row changedFromParent mismatch`)
  }
}

async function assertOfficialScoreImagePinned(row: PhaseARow, bt: BenchTask, context: string): Promise<void> {
  const expected = row.execution?.image
  if (!expected) throw new Error(`${context}: missing immutable image receipt`)
  const current = await resolveImageForMetadata(bt.metadata ?? {})
  if (!current.ok) throw new Error(`${context}: image unavailable: ${current.reason}`)
  if (
    current.tag !== expected.tag ||
    current.namespace !== expected.namespace ||
    current.identity.id !== expected.id
  ) {
    throw new Error(
      `${context}: official-score image changed ` +
        `(${expected.namespace}:${expected.tag}@${expected.id} -> ` +
        `${current.namespace}:${current.tag}@${current.identity.id})`,
    )
  }
}

async function loadTasksAndTools(ids: string[]): Promise<{
  env: Env
  taskById: Map<string, BenchTask>
  tools: unknown
  sharedExecution: SharedExecutionReceipt
  expectedImageIdentities: Map<string, SweImageIdentity>
}> {
  const expectedImageIdentities = new Map<string, SweImageIdentity>()
  const env = await createSweBenchEnvironment(ids.length, {
    ids,
    cloneCache: true,
    enableRun: true,
    expectedImageIdentities,
    adapterOptions: { cacheLevel: OFFICIAL_SCORER_CACHE_LEVEL },
  })
  await env.adapter.preflight?.()
  const scorerVersion = await resolveSweBenchScorerVersion()
  const taskById = new Map((await env.adapter.loadTasks({ ids, split: 'test' })).map((task) => [task.id, task]))
  const missing = ids.filter((id) => !taskById.has(id))
  if (missing.length) throw new Error(`instances not found in SWE-bench_Verified: ${missing.join(', ')}`)
  const first = taskById.get(ids[0]!)!
  const fingerprintTask: AgenticTask = {
    id: first.id,
    systemPrompt: SWE_SEED_PROMPT_WITH_RUN,
    userPrompt: first.prompt,
    meta: { instanceId: first.id },
  }
  const fingerprintHandle: ArtifactHandle = { id: 'fingerprint-only', surface: 'swe-bench-verified' }
  return {
    env,
    taskById,
    tools: await env.environment.tools(fingerprintTask, fingerprintHandle),
    sharedExecution: {
      runTool: { ...SWE_RUN_TOOL_CONFIG },
      runtimeImplementationFingerprint: RUNTIME_IMPLEMENTATION_FINGERPRINT,
      runtimeTreeFingerprint: RUNTIME_TREE_FINGERPRINT,
      officialScorer: {
        package: 'swebench',
        version: scorerVersion,
        cacheLevel: OFFICIAL_SCORER_CACHE_LEVEL,
        namespacePolicy: 'phase-a-image',
      },
    },
    expectedImageIdentities,
  }
}

async function generateMain(): Promise<void> {
  const preset = ARM_PRESET as ExperimentArmPreset
  const ids = process.env.IDS
    ? process.env.IDS.split(',').map((value) => value.trim()).filter(Boolean)
    : await cachedInstanceIds()
  if (!ids.length) throw new Error('no cached sweb.eval images found and no IDS given')
  if (new Set(ids).size !== ids.length) throw new Error('IDS contains duplicates')
  const out = process.env.OUT ?? `swe-stage1-${preset.arm}.phaseA.jsonl`
  const config = makeExperimentConfig(preset, ids)
  assertPresetConfig(config, preset.arm, 'generate config')
  const { env, taskById, tools, sharedExecution, expectedImageIdentities } = await loadTasksAndTools(ids)

  console.log(`═══ SWE-bench Phase A — ${preset.arm} ═══`)
  console.log(
    `sessions=2 k=${preset.k} repairs=${preset.repairs} persistent=${preset.persistent ? 1 : 0} ` +
      `model=${MODEL} maxTokens=${MAX_TOKENS} innerTurns=${INNER_TURNS} temperature=${TEMPERATURE} runTool=1 judge=DISABLED`,
  )
  console.log(`instances=${ids.length} out=${out}`)

  const done = loadPhaseRows(out)
  for (const [id, row] of done) {
    if (!ids.includes(id)) throw new Error(`${out}: resume row ${id} is outside current IDS`)
    await assertPhaseRow(row, taskById.get(id)!, config, tools, MANIFEST[id], sharedExecution, `${out}:${id}`)
  }
  const todo = ids.filter((id) => !done.has(id))
  if (done.size) console.log(`resume accepted: ${done.size}/${ids.length} fingerprint-matched rows`)

  let next = 0
  const worker = async (): Promise<void> => {
    while (next < todo.length) {
      const index = next++
      const id = todo[index]!
      const row = await phaseA(env, taskById.get(id)!, {
        preset,
        config,
        tools,
        sharedExecution,
        expectedImageIdentities,
      })
      await assertPhaseRow(
        row,
        taskById.get(id)!,
        config,
        tools,
        MANIFEST[id],
        sharedExecution,
        `${preset.arm}:${id}`,
      )
      done.set(id, row)
      appendFileSync(out, `${JSON.stringify(row)}\n`)
      console.log(
        `[${index + 1}/${todo.length}] ${id} sessions=${row.workerSessions} ` +
          `severity=[${row.candidates.map((candidate) => candidate.severity).join(',')}] ` +
          `continuation=[${row.repairs.map((repair) => repair.severity).join(',')}] ` +
          `final=${row.finalFrom} changed=${row.changedFromParent ?? 'n/a'} calls=${row.llmCalls}`,
      )
    }
  }
  await Promise.all(Array.from({ length: CONC }, () => worker()))

  const rows = ids.map((id) => done.get(id)!)
  const totalSessions = rows.reduce((sum, row) => sum + row.workerSessions, 0)
  const totalIn = rows.reduce((sum, row) => sum + row.tokensIn, 0)
  const totalOut = rows.reduce((sum, row) => sum + row.tokensOut, 0)
  const usd = (totalIn / 1e6) * PRICE_IN + (totalOut / 1e6) * PRICE_OUT
  console.log(
    `Phase A complete: rows=${rows.length}/${ids.length} sessions=${totalSessions}/${2 * ids.length} ` +
      `tokens=${totalIn}/${totalOut} assumedCost=$${usd.toFixed(2)}; no official scores were called`,
  )
}

interface JudgeRow {
  schema: 'swe-structural-judge-v2'
  instanceId: string
  arm: ExperimentArm
  pairFingerprint: string
  phaseFileFingerprint: string
  inputFingerprint: string
  executionFingerprint: string
  finalDiffHash: string
  hiddenResolved: boolean
  judgeDetail: string | null
  judgeMs: number
  judgeSkipped: 'empty-patch' | null
}

function loadJudgeRows(path: string): Map<string, JudgeRow> {
  if (!existsSync(path)) return new Map()
  const rows = new Map<string, JudgeRow>()
  for (const [index, line] of readFileSync(path, 'utf8').split('\n').entries()) {
    if (!line.trim()) continue
    const row = JSON.parse(line) as JudgeRow
    if (row.schema !== 'swe-structural-judge-v2') {
      throw new Error(`${path}:${index + 1}: unsupported judge row schema`)
    }
    if (typeof row.hiddenResolved !== 'boolean') {
      throw new Error(`${path}:${index + 1}: incomplete judge row must be removed and retried`)
    }
    if (row.judgeSkipped !== null && row.judgeSkipped !== 'empty-patch') {
      throw new Error(`${path}:${index + 1}: unsupported judge skip receipt ${row.judgeSkipped}`)
    }
    resolveExperimentArm(row.arm)
    const key = `${row.arm}:${row.instanceId}`
    if (rows.has(key)) throw new Error(`${path}:${index + 1}: duplicate judge row ${key}`)
    rows.set(key, row)
  }
  return rows
}

function requirePath(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} required for MODE=judge-only`)
  return value
}

async function judgeOnlyMain(): Promise<void> {
  const independentPath = requirePath('INDEPENDENT_PHASE_A')
  const persistentPath = requirePath('PERSISTENT_PHASE_A')
  const out = requirePath('OUT')
  assertDistinctArtifactPaths({ INDEPENDENT_PHASE_A: independentPath, PERSISTENT_PHASE_A: persistentPath, OUT: out })
  const independent = loadPhaseRows(independentPath, true)
  const persistent = loadPhaseRows(persistentPath, true)
  const independentConfig = [...independent.values()][0]!.config
  const persistentConfig = [...persistent.values()][0]!.config
  if (!independentConfig || !persistentConfig) throw new Error('Phase-A file is missing its config receipt')
  assertPresetConfig(independentConfig, 'independent-2', independentPath)
  assertPresetConfig(persistentConfig, 'persistent-refine-2', persistentPath)
  if (fingerprint(commonConfig(independentConfig)) !== fingerprint(commonConfig(persistentConfig))) {
    throw new Error('Phase-A files have different common configuration fingerprints')
  }
  const ids = independentConfig.taskIds
  if (fingerprint(ids) !== fingerprint(persistentConfig.taskIds)) {
    throw new Error('Phase-A files have different task-id fingerprints')
  }
  for (const [path, rows] of [[independentPath, independent], [persistentPath, persistent]] as const) {
    assertCompleteTaskSet(rows.keys(), ids, path)
  }

  // No official judge call occurs before every row in both files passes these checks.
  const { env, taskById, tools, sharedExecution } = await loadTasksAndTools(ids)
  for (const id of ids) {
    const left = independent.get(id)!
    const right = persistent.get(id)!
    await assertPhaseRow(
      left,
      taskById.get(id)!,
      independentConfig,
      tools,
      manifestFromRow(left),
      sharedExecution,
      `${independentPath}:${id}`,
    )
    await assertPhaseRow(
      right,
      taskById.get(id)!,
      persistentConfig,
      tools,
      manifestFromRow(right),
      sharedExecution,
      `${persistentPath}:${id}`,
    )
    assertPairedFingerprints(left.fingerprints, right.fingerprints, id)
    assertPairedExecutionFingerprint(left.executionFingerprint, right.executionFingerprint, id)
    if (left.reproOutcomeFingerprint !== right.reproOutcomeFingerprint) {
      throw new Error(`${id}: paired reproduction outcomes do not match`)
    }
  }

  const phaseFileFingerprints: Record<ExperimentArm, string> = {
    'independent-2': fingerprint({ bytes: readFileSync(independentPath, 'utf8') }),
    'persistent-refine-2': fingerprint({ bytes: readFileSync(persistentPath, 'utf8') }),
  }
  const pairFingerprint = fingerprint({
    commonConfig: independent.get(ids[0]!)!.fingerprints.commonConfig,
    ids,
    phaseFiles: phaseFileFingerprints,
    prompt: independent.get(ids[0]!)!.fingerprints.prompt,
    source: independent.get(ids[0]!)!.fingerprints.source,
    tools: independent.get(ids[0]!)!.fingerprints.tools,
    executions: ids.map((id) => independent.get(id)!.executionFingerprint),
  })
  const judged = loadJudgeRows(out)
  const arms: Array<{ arm: ExperimentArm; path: string; rows: Map<string, PhaseARow> }> = [
    { arm: 'independent-2', path: independentPath, rows: independent },
    { arm: 'persistent-refine-2', path: persistentPath, rows: persistent },
  ]
  for (const existing of judged.values()) {
    const input = arms.find(({ arm }) => arm === existing.arm)?.rows.get(existing.instanceId)
    if (!input) throw new Error(`${out}: judge resume row has no paired Phase-A input`)
    assertJudgeCompletionMatchesInput(existing, input.finalDiff, `${out}:${existing.arm}:${existing.instanceId}`)
    assertJudgeResumeFingerprints(existing, {
      pairFingerprint,
      phaseFileFingerprint: phaseFileFingerprints[existing.arm],
      inputFingerprint: input.fingerprints.composite,
      executionFingerprint: input.executionFingerprint,
      finalDiffHash: input.finalDiffHash,
    }, `${out}:${existing.arm}:${existing.instanceId}`)
  }

  console.log(`all ${2 * ids.length} Phase-A rows matched; official scoring starts now (serialized)`)
  for (const id of ids) {
    for (const { arm, rows } of arms) {
      const key = `${arm}:${id}`
      if (judged.has(key)) continue
      const input = rows.get(id)!
      const started = Date.now()
      // Fail without appending: a transient official-scorer error must be retried on resume.
      const { hiddenResolved, judgeDetail, judgeSkipped } = await completeJudgeScore(
        input.finalDiff,
        async () => {
          const task = taskById.get(id)!
          process.env.SWEBENCH_NAMESPACE = input.execution!.image.namespace
          await assertOfficialScoreImagePinned(input, task, `${key}:before`)
          const score = await env.adapter.judge(task, input.finalDiff)
          await assertOfficialScoreImagePinned(input, task, `${key}:after`)
          return score
        },
      )
      const row: JudgeRow = {
        schema: 'swe-structural-judge-v2',
        instanceId: id,
        arm,
        pairFingerprint,
        phaseFileFingerprint: phaseFileFingerprints[arm],
        inputFingerprint: input.fingerprints.composite,
        executionFingerprint: input.executionFingerprint,
        finalDiffHash: input.finalDiffHash,
        hiddenResolved,
        judgeDetail,
        judgeMs: Date.now() - started,
        judgeSkipped,
      }
      judged.set(key, row)
      appendFileSync(out, `${JSON.stringify(row)}\n`)
      console.log(`[judge] ${key} resolved=${hiddenResolved} skipped=${judgeSkipped ?? '-'}`)
    }
  }
}

const main = MODE === 'generate' ? generateMain : judgeOnlyMain
main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
