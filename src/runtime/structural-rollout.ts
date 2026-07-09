/**
 * structuralRollout — the measured structural lever as a fourth member of the
 * sample/refine/sampleThenRefine strategy family: k independent samples, selection by
 * TASK-VISIBLE checks only, then a guarded self-repair loop steered by the checks'
 * failure output. Design: docs/design/structural-rollout-integration.md; measured basis
 * (bench/src/hev-structural.mts, bench/src/mbpp-structural.mts): +8.5..+21.3pp hidden-test
 * lift across Llama-3-8B/Qwen2.5-7B × HumanEval/MBPP, null only at saturation.
 *
 * Honesty invariants carried over from the proven rigs:
 *  - Visible checks are generated from task-visible information only, BEFORE any
 *    candidate exists, and FROZEN for every sample and repair round of the task.
 *  - OFFICIAL checks (shown in the task itself) rank lexicographically above
 *    model-AUTHORED guesses. This ordering is measured, not stylistic: authored guesses
 *    run 17–70% wrong depending on model × spec richness, and unweighted they flipped
 *    selection NEGATIVE on MBPP (6 noisy guesses outvoting the one reliable check).
 *  - A candidate that crashed before the checks could run ranks below one that ran and
 *    failed everything.
 *  - Repair sees ONLY the checks' failure output, and never displaces a candidate that
 *    passes more official checks with one that passes fewer (wrong visible examples
 *    poison repair at saturation — the glm /47,/116 regressions).
 *
 * Placement rule: this is an INFERENCE-TIME capability (it wraps the model call via the
 * strategy seam). It does not belong in improve()/selfImprove (training-time); improve()
 * may later tune `StructuralRolloutPolicy` as an optimizable surface.
 */

import { randomBytes } from 'node:crypto'
import {
  type AgenticTask,
  defineStrategy,
  type Strategy,
  type StrategyCtx,
  type StrategyResult,
} from './strategy'
import type { SelectionReceipt } from './types'

type Msg = Record<string, unknown>

// ── Policy ────────────────────────────────────────────────────────────────────────

/** The rollout's compute recipe — promoted from the proven rigs' env vars (K/REPAIRS/
 *  TESTGEN/DIVERSE/TEMPERATURE). Defaults are the measured sweet spot: repair value
 *  concentrates at low k (~+12pp at k=1, +1–3pp at k=5), so `k=5, repairRounds=2` is the
 *  full recipe and `k=1, repairRounds=2` the low-compute preset. */
export interface StructuralRolloutPolicy {
  /** Independent samples per task (selection breadth). */
  k: number
  /** Repair shots after selection, each steered by the checks' failure output. */
  repairRounds: number
  /** Model-authored visible checks requested per task; 0 disables authoring. */
  testgen: number
  /** Per-slot strategy-lens prefixes on the k samples (attacks the all-k-fail bucket).
   *  Measured as a paired null (+0.6pp) — kept as an optional knob, off by default. */
  diverse?: boolean
  /** Sampling temperature for every shot of this strategy; omitted ⇒ the worker default. */
  temperature?: number
}

/** The measured default recipe: 5 samples, 2 guarded repair rounds, 6 authored checks. */
export const defaultStructuralRolloutPolicy: StructuralRolloutPolicy = {
  k: 5,
  repairRounds: 2,
  testgen: 6,
}

function resolvePolicy(overrides?: Partial<StructuralRolloutPolicy>): StructuralRolloutPolicy {
  const policy = { ...defaultStructuralRolloutPolicy, ...overrides }
  if (!Number.isInteger(policy.k) || policy.k < 1) {
    throw new Error(`structuralRollout: policy.k must be an integer >= 1, got ${policy.k}`)
  }
  if (!Number.isInteger(policy.repairRounds) || policy.repairRounds < 0) {
    throw new Error(
      `structuralRollout: policy.repairRounds must be an integer >= 0, got ${policy.repairRounds}`,
    )
  }
  if (!Number.isInteger(policy.testgen) || policy.testgen < 0) {
    throw new Error(
      `structuralRollout: policy.testgen must be an integer >= 0, got ${policy.testgen}`,
    )
  }
  return policy
}

// ── Visible checks: the CheckSource seam (the only net-new seam of the design) ──────

/** One task-visible executable check (e.g. a single-line Python assert). */
export interface VisibleCheck {
  code: string
  /** 'official' = shown in the task itself (docstring example, shown assert);
   *  'authored' = the model's own guess. Official outranks authored in selection. */
  kind: 'official' | 'authored'
}

/** What a CheckSource composes with. `consult` is the strategy family's raw analyst
 *  channel (metered by the conserved pool, offline-injectable via `opts.complete`) —
 *  check authoring goes through it rather than a bespoke model client. */
export interface CheckSourceCtx {
  /** Authored-check budget for this task (`policy.testgen`). */
  count: number
  /** The symbol authored checks must reference; undefined ⇒ authoring is skipped
   *  (no guesses beats guesses pinned to nothing). */
  entrySymbol?: string
  /** One metered LLM call: instruction in, reply text out, null when the channel went
   *  down. The task's visible prompt is included by the channel itself. */
  consult(instruction: string): Promise<string | null>
}

/** Produces the task's visible checks. MUST derive them from agent-visible information
 *  only, before any candidate exists — the strategy freezes the returned set for every
 *  sample and repair round of the task. */
export interface CheckSource {
  generate(task: AgenticTask, ctx: CheckSourceCtx): Promise<VisibleCheck[]>
}

const authorInstruction = (count: number, entry: string) =>
  `Read the task below. Write exactly ${count} single-line assert statements that test the ` +
  `function \`${entry}\`, based ONLY on the behavior the task itself describes. Each assert ` +
  `must be one physical line of the form \`assert ${entry}(...) == expected\` (or a True/False ` +
  'check). Do NOT implement the function. Do NOT copy shown examples verbatim if you can test ' +
  'other cases too. Output ONLY the assert lines inside a single ```python code block.'

/** The proven authored-assert filter (lifted from the rigs' generateTests): keep only
 *  single-line, paren-balanced asserts that reference the entry symbol — malformed lines
 *  are dropped here rather than poisoning every candidate's score identically. */
export function filterAuthoredAsserts(reply: string, entrySymbol: string, count: number): string[] {
  const fences = [...reply.matchAll(/```(?:python|py)?\s*\n([\s\S]*?)```/gi)].map((m) =>
    (m[1] ?? '').trim(),
  )
  const block = fences.length > 0 ? fences.join('\n') : reply
  const balanced = (s: string) => {
    let d = 0
    for (const ch of s) {
      if (ch === '(' || ch === '[' || ch === '{') d += 1
      else if (ch === ')' || ch === ']' || ch === '}') d -= 1
      if (d < 0) return false
    }
    return d === 0
  }
  return block
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('assert ') && l.includes(entrySymbol) && balanced(l))
    .slice(0, count)
}

/** Default authored-check source: one metered LLM call per task, before sampling,
 *  filtered through `filterAuthoredAsserts`. Returns [] (no signal, never a fabricated
 *  check) when the budget is 0, no entry symbol resolves, or the channel went down. */
export function modelAuthoredChecks(overrides: { count?: number } = {}): CheckSource {
  return {
    async generate(_task, ctx): Promise<VisibleCheck[]> {
      const count = overrides.count ?? ctx.count
      if (count <= 0 || !ctx.entrySymbol) return []
      const entry = ctx.entrySymbol
      const reply = await ctx.consult(authorInstruction(count, entry))
      if (!reply) return []
      return filterAuthoredAsserts(reply, entry, count).map((code) => ({
        code,
        kind: 'authored' as const,
      }))
    },
  }
}

/** Official checks the surface stashed on the task (e.g. MBPP's shown assert). Reads
 *  `task.meta[key]` as a string array; anything else means no official checks. */
export function officialChecksFromMeta(key = 'visibleChecks'): CheckSource {
  return {
    async generate(task): Promise<VisibleCheck[]> {
      const raw = task.meta?.[key]
      if (!Array.isArray(raw)) return []
      return raw
        .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
        .map((code) => ({ code, kind: 'official' as const }))
    },
  }
}

/** Concatenate check sources (official first by convention — ordering does not affect
 *  scoring, which reads each check's `kind`). */
export function composeCheckSources(...sources: CheckSource[]): CheckSource {
  return {
    async generate(task, ctx): Promise<VisibleCheck[]> {
      const all: VisibleCheck[] = []
      for (const source of sources) all.push(...(await source.generate(task, ctx)))
      return all
    },
  }
}

/** The symbol authored checks are pinned to: `task.meta.entryPoint` when the surface
 *  provides it, else the LAST `def name(` in the visible prompt (a code-completion stub
 *  lists helpers first, the entry stub last). Undefined ⇒ authoring is skipped. */
export function resolveEntrySymbol(task: AgenticTask): string | undefined {
  const meta = task.meta?.entryPoint
  if (typeof meta === 'string' && meta.trim().length > 0) return meta.trim()
  const defs = [...task.userPrompt.matchAll(/(?:^|\n)\s*def\s+([A-Za-z_]\w*)\s*\(/g)]
  const last = defs[defs.length - 1]
  return last?.[1]
}

// ── Check execution: the CheckRunner seam ────────────────────────────────────────────

/** How one candidate fared against the frozen visible checks, split by check kind. */
export interface CheckOutcome {
  passedOfficial: number
  totalOfficial: number
  passedAuthored: number
  totalAuthored: number
  /** The checks' failure report — the ONLY feedback the repair loop may see. */
  failureOutput: string
  /** True when the candidate crashed before any check could run — ranks below a
   *  candidate that ran and failed everything. */
  crashed?: boolean
}

/** Minimal exec channel the default runner needs. `SandboxInstance` (and therefore
 *  `ValidationCtx.box`) satisfies it structurally. */
export interface CheckExecChannel {
  exec(
    command: string,
    options?: { timeoutMs?: number },
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>
}

export interface CheckRunContext {
  task: AgenticTask
  /** Live exec channel for this run (`ValidationCtx.box` / a sandbox instance). */
  box?: CheckExecChannel
  signal?: AbortSignal
}

/** Executes the frozen checks against one candidate. Implementations MUST fail loud
 *  (throw) when they cannot execute — a silent zero poisons selection. */
export interface CheckRunner {
  run(candidate: string, checks: VisibleCheck[], ctx: CheckRunContext): Promise<CheckOutcome>
}

/** The check program (mirrors the rigs' visible-check judge): candidate executes at
 *  module level, then each check runs INDIVIDUALLY in try/except so one malformed line
 *  cannot zero the rest; the summary line carries a per-call NONCE so a candidate
 *  printing a forged summary cannot be parsed as the verdict. */
function buildCheckProgram(
  candidate: string,
  official: string[],
  authored: string[],
  nonce: string,
): string {
  const officialB64 = Buffer.from(JSON.stringify(official), 'utf8').toString('base64')
  const authoredB64 = Buffer.from(JSON.stringify(authored), 'utf8').toString('base64')
  return `${candidate}\n
import base64 as _b64, json as _json, sys as _sys
_official = _json.loads(_b64.b64decode("${officialB64}").decode("utf8"))
_authored = _json.loads(_b64.b64decode("${authoredB64}").decode("utf8"))
_lines = []
def _run(_tests):
    _att, _fail = 0, 0
    for _t in _tests:
        _att += 1
        try:
            exec(_t, dict(globals()))
        except Exception as _e:
            _fail += 1
            _lines.append("CHECK FAILED: %s -> %s: %s" % (_t.strip()[:200], type(_e).__name__, str(_e)[:200]))
    return _att, _fail
_o_att, _o_fail = _run(_official)
_a_att, _a_fail = _run(_authored)
print("SRCK-${nonce} official=%d/%d authored=%d/%d" % (_o_att - _o_fail, _o_att, _a_att - _a_fail, _a_att))
_sys.stdout.write("\\n".join(_lines)[-1500:])
_sys.exit(0 if (_o_fail + _a_fail) == 0 and (_o_att + _a_att) > 0 else 1)
`
}

/** Default CheckRunner backend: pipes the check program into `python3` over the sandbox
 *  exec channel (`ctx.box`, or one bound at construction). Never shells out to docker
 *  itself — the jail is the sandbox's concern. No channel ⇒ throws; it must never
 *  silently score 0. Empty check sets short-circuit to a no-signal outcome (nothing to
 *  execute, so no channel is required). */
export function sandboxCheckRunner(
  options: { box?: CheckExecChannel; python?: string; timeoutMs?: number } = {},
): CheckRunner {
  const python = options.python ?? 'python3'
  const timeoutMs = options.timeoutMs ?? 20000
  return {
    async run(candidate, checks, ctx): Promise<CheckOutcome> {
      if (checks.length === 0) {
        return {
          passedOfficial: 0,
          totalOfficial: 0,
          passedAuthored: 0,
          totalAuthored: 0,
          failureOutput: '',
        }
      }
      const box = ctx.box ?? options.box
      if (!box) {
        throw new Error(
          'sandboxCheckRunner: no execution channel — bind one via sandboxCheckRunner({ box }) ' +
            'or CheckRunContext.box (ValidationCtx.box / a sandbox instance). Refusing to score ' +
            'without executing: a silent 0 would poison selection.',
        )
      }
      const nonce = randomBytes(8).toString('hex')
      const official = checks.filter((c) => c.kind === 'official').map((c) => c.code)
      const authored = checks.filter((c) => c.kind === 'authored').map((c) => c.code)
      const program = buildCheckProgram(candidate, official, authored, nonce)
      const b64 = Buffer.from(program, 'utf8').toString('base64')
      const r = await box.exec(`printf '%s' '${b64}' | base64 -d | ${python} -`, { timeoutMs })
      const summary = new RegExp(
        `SRCK-${nonce} official=(\\d+)/(\\d+) authored=(\\d+)/(\\d+)`,
      ).exec(r.stdout)
      if (!summary) {
        // The candidate crashed (or hung) before the check scaffold could report.
        const detail =
          (r.stderr || r.stdout).slice(-1500) ||
          'no output (crashed or timed out before the checks could run)'
        return {
          passedOfficial: 0,
          totalOfficial: 0,
          passedAuthored: 0,
          totalAuthored: 0,
          failureOutput: detail,
          crashed: true,
        }
      }
      // Strip the sentinel line from repair feedback — the model must never learn the
      // summary format it could try to forge.
      const failureOutput = r.stdout.replace(summary[0], '').slice(-1500).trim()
      return {
        passedOfficial: Number(summary[1]),
        totalOfficial: Number(summary[2]),
        passedAuthored: Number(summary[3]),
        totalAuthored: Number(summary[4]),
        failureOutput,
      }
    },
  }
}

// ── Selection order (measured, not stylistic) ────────────────────────────────────────

const frac = (passed: number, total: number) => (total > 0 ? passed / total : 0)

/** The selection order: crash < ran; then official pass-fraction; authored guesses only
 *  break ties. Returns > 0 when `a` outranks `b`. Strictly lexicographic — on MBPP,
 *  letting 6 noisy guesses outvote the one official check flipped selection negative. */
export function compareCheckOutcomes(a: CheckOutcome, b: CheckOutcome): number {
  const aCrashed = a.crashed === true
  const bCrashed = b.crashed === true
  if (aCrashed !== bCrashed) return aCrashed ? -1 : 1
  if (aCrashed) return 0
  const official = frac(a.passedOfficial, a.totalOfficial) - frac(b.passedOfficial, b.totalOfficial)
  if (official !== 0) return official
  return frac(a.passedAuthored, a.totalAuthored) - frac(b.passedAuthored, b.totalAuthored)
}

/** Display scalar for receipts/reports (the rigs' `visibleScore` shape): crash = -1,
 *  else official fraction + 0.001 × authored fraction. Selection itself uses the exact
 *  lexicographic comparator, never this scalar. */
export function visibleCheckScore(o: CheckOutcome): number {
  if (o.crashed) return -1
  return frac(o.passedOfficial, o.totalOfficial) + 0.001 * frac(o.passedAuthored, o.totalAuthored)
}

/** Argmax by `compareCheckOutcomes`, FIRST index wins ties (deterministic; with zero
 *  visible coverage every candidate ties at no-signal and index 0 is the blind pick). */
export function selectBestIndex(outcomes: ReadonlyArray<CheckOutcome>): number {
  let best = 0
  for (let i = 1; i < outcomes.length; i += 1) {
    if (compareCheckOutcomes(outcomes[i] as CheckOutcome, outcomes[best] as CheckOutcome) > 0) {
      best = i
    }
  }
  return best
}

/** The repair keep-best guard: a challenger displaces the incumbent only when it is
 *  strictly better in the selection order AND passes at least as many official checks.
 *  The raw-count clause is deliberate belt-and-braces over the comparator (a custom
 *  runner can report shifted totals): repair must NEVER replace a candidate that passes
 *  more official checks with one that passes fewer. */
export function canDisplace(challenger: CheckOutcome, incumbent: CheckOutcome): boolean {
  if (challenger.crashed === true) return false
  if (challenger.passedOfficial < incumbent.passedOfficial) return false
  return compareCheckOutcomes(challenger, incumbent) > 0
}

const totalChecks = (o: CheckOutcome) => o.totalOfficial + o.totalAuthored

const passesAllChecks = (o: CheckOutcome) =>
  o.crashed !== true &&
  totalChecks(o) > 0 &&
  o.passedOfficial === o.totalOfficial &&
  o.passedAuthored === o.totalAuthored

// ── Candidate extraction ─────────────────────────────────────────────────────────────

/** The candidate a shot produced, read from its conversation: the LAST `submit_answer`
 *  tool-call argument (verifier environments submit the artifact explicitly), else the
 *  latest assistant reply's fenced code block — preferring a block containing a `def`,
 *  because repair replies echo the failure report in a bare fence BEFORE the fixed code
 *  (the rigs' extractRepairCode lesson) — else the latest non-empty assistant text. */
export function defaultExtractCandidate(messages: ReadonlyArray<Msg>): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const calls = messages[i]?.tool_calls as
      | Array<{ function?: { name?: string; arguments?: string } }>
      | undefined
    if (!calls) continue
    for (let j = calls.length - 1; j >= 0; j -= 1) {
      const call = calls[j]
      if (call?.function?.name !== 'submit_answer') continue
      try {
        const args = JSON.parse(call.function.arguments ?? '{}') as { answer?: unknown }
        if (typeof args.answer === 'string' && args.answer.trim()) return args.answer.trim()
      } catch {
        /* malformed arguments — keep scanning */
      }
    }
  }
  const contents: string[] = []
  for (const m of messages) {
    if (m.role === 'assistant' && typeof m.content === 'string' && m.content.trim()) {
      contents.push(m.content)
    }
  }
  const fencesOf = (text: string) =>
    [...text.matchAll(/```(?:python|py)?\s*\n([\s\S]*?)```/gi)].map((m) => (m[1] ?? '').trim())
  for (let i = contents.length - 1; i >= 0; i -= 1) {
    const fences = fencesOf(contents[i] as string)
    for (let j = fences.length - 1; j >= 0; j -= 1) {
      if (/(^|\n)\s*def\s+\w+/.test(fences[j] as string)) return fences[j] as string
    }
  }
  for (let i = contents.length - 1; i >= 0; i -= 1) {
    const fences = fencesOf(contents[i] as string)
    if (fences.length > 0) return fences[fences.length - 1] as string
  }
  return (contents[contents.length - 1] ?? '').trim()
}

// ── The strategy ─────────────────────────────────────────────────────────────────────

/** Per-slot approach lenses for `diverse` mode — copied from bench/src/directives.ts
 *  (the measured rig plumbing; a paired null there, kept as an optional knob). */
const DIVERSE_LENSES: ReadonlyArray<string> = [
  'Answer directly and decisively from what you already know. State the single best answer without hedging.',
  'Decompose the question into the sub-facts it depends on. Establish each sub-fact explicitly, then compose them into the answer.',
  'Reason from first principles. Ignore the most obvious or popular guess; derive the answer from underlying facts and relationships.',
  'Name the most plausible WRONG answer and the trap that makes it tempting. Rule it out, then commit to the answer that survives.',
]

function slotLens(slot: number): string {
  const lens = DIVERSE_LENSES[slot % DIVERSE_LENSES.length] as string
  const tag =
    slot < DIVERSE_LENSES.length ? '' : ` (variant ${Math.floor(slot / DIVERSE_LENSES.length) + 1})`
  return `${lens}${tag}`
}

function repairSteer(outcome: CheckOutcome): string {
  return [
    'Your latest solution failed some of the task-visible checks.',
    'Result of running the visible checks against it:',
    '```',
    outcome.failureOutput.trim() || '(the code crashed before the checks could run)',
    '```',
    'Fix the solution so the visible checks pass. Provide the COMPLETE corrected solution the',
    'same way you provided the original (same tool or format) — not a fragment or a diff.',
  ].join('\n')
}

function describeOutcome(label: string, o: CheckOutcome): string {
  if (o.crashed) return `${label}: crashed before the checks could run`
  return (
    `${label}: official ${o.passedOfficial}/${o.totalOfficial}, ` +
    `authored ${o.passedAuthored}/${o.totalAuthored}`
  )
}

export type RepairStop =
  | 'already-passing'
  | 'no-signal'
  | 'repaired-pass'
  | 'rounds-exhausted'
  | 'no-candidates'

/** The body's deliverable — a `StrategyResult` plus selection provenance. The extra
 *  fields ride through `defineStrategy`'s deliverable spread onto `AgenticRunResult`
 *  (score/resolved stay harness-verified, exactly as for every authored strategy). */
export interface StructuralRolloutResult extends StrategyResult {
  /** One receipt per scored candidate (k samples, then repairs), `SelectionReceipt`
   *  shaped like the kernel's (`types.ts`), selector 'driver'. */
  selection: SelectionReceipt[]
  repairStop: RepairStop
  officialChecks: number
  authoredChecks: number
}

export interface StructuralRolloutConfig {
  /** Knobs; missing fields take the measured defaults (k=5, repairRounds=2, testgen=6). */
  policy?: Partial<StructuralRolloutPolicy>
  /** Where the visible checks come from. Default: official checks from
   *  `task.meta.visibleChecks` composed with `modelAuthoredChecks()`. */
  checkSource?: CheckSource
  /** How candidates are measured. Default `sandboxCheckRunner()` — it needs an exec
   *  channel (bind one to the runner, or pass `box` here) and fails loud without one. */
  checkRunner?: CheckRunner
  /** Exec channel threaded into every check run of this strategy (a sandbox instance /
   *  `ValidationCtx.box`). The strategy seam itself carries no sandbox, so the caller
   *  who owns one supplies it here or binds it into the runner. */
  box?: CheckExecChannel
  /** Candidate extraction from a shot's conversation. Default `defaultExtractCandidate`. */
  extractCandidate?: (messages: ReadonlyArray<Msg>) => string
}

/**
 * Build the structuralRollout `Strategy`: k shots → score each by the frozen visible
 * checks (official above authored, crash lowest) → argmax with first-index tie-break →
 * up to `repairRounds` repair shots steered by the failure output, keep-best under the
 * official-check guard. Authored via `defineStrategy`, so the deliverable score stays
 * harness-verified and every shot is metered by the conserved pool.
 *
 * Budget note: `runAgentic`'s `budget` sizes the pool — pass at least
 * `k + repairRounds + 1` so the samples, repairs, and the check-author consult all admit.
 */
export function structuralRollout(config: StructuralRolloutConfig = {}): Strategy {
  const policy = resolvePolicy(config.policy)
  const checkSource =
    config.checkSource ?? composeCheckSources(officialChecksFromMeta(), modelAuthoredChecks())
  const checkRunner = config.checkRunner ?? sandboxCheckRunner()
  const extract = config.extractCandidate ?? defaultExtractCandidate

  const inner = defineStrategy(
    'structuralRollout',
    async (ctx: StrategyCtx): Promise<StructuralRolloutResult> => {
      const { task, shot } = ctx
      const progression: number[] = []
      const receipts: SelectionReceipt[] = []
      let completions = 0
      let shots = 0

      // Freeze the visible checks BEFORE any candidate exists — every sample and repair
      // round is measured against this same set. Authoring goes through the strategy's
      // raw analyst channel, so its spend is metered and the offline transport applies.
      const consult = async (instruction: string): Promise<string | null> => {
        const reply = await ctx.consult([], instruction)
        completions += 1
        return reply
      }
      const entrySymbol = resolveEntrySymbol(task)
      const checks = await checkSource.generate(task, {
        count: policy.testgen,
        ...(entrySymbol ? { entrySymbol } : {}),
        consult,
      })
      const officialChecks = checks.filter((c) => c.kind === 'official').length
      const authoredChecks = checks.length - officialChecks
      const runCtx: CheckRunContext = { task, ...(config.box ? { box: config.box } : {}) }

      interface Candidate {
        index: number
        messages: Msg[]
        outcome: CheckOutcome
        shotScore: number
        shotResolved: boolean
      }

      // k independent samples, each on its own artifact, scored by the frozen checks.
      const candidates: Candidate[] = []
      for (let i = 0; i < policy.k; i += 1) {
        const out = await shot(policy.diverse ? { steer: slotLens(i) } : undefined)
        if (!out) break // pool starved — select among what settled
        shots += 1
        completions += out.completions
        progression.push(out.score)
        const outcome = await checkRunner.run(extract(out.messages), checks, runCtx)
        candidates.push({
          index: candidates.length,
          messages: out.messages,
          outcome,
          shotScore: out.score,
          shotResolved: out.total > 0 && out.passes === out.total,
        })
      }
      if (candidates.length === 0) {
        return {
          score: 0,
          resolved: false,
          completions,
          progression,
          shots,
          selection: receipts,
          repairStop: 'no-candidates',
          officialChecks,
          authoredChecks,
        }
      }

      // Argmax by the official-first order; first index wins ties (the blind pick when
      // the task has zero visible coverage).
      let best = candidates[selectBestIndex(candidates.map((c) => c.outcome))] as Candidate
      for (const c of candidates) {
        receipts.push({
          candidateIndex: c.index,
          selected: false,
          score: visibleCheckScore(c.outcome),
          reason: describeOutcome('sample', c.outcome),
          selector: 'driver',
        })
      }

      // Guarded repair: steered ONLY by the checks' failure output, keep-best, and a
      // repair never displaces a candidate that passes more official checks.
      let seq = candidates.length
      let repairStop: RepairStop = 'already-passing'
      if (!passesAllChecks(best.outcome)) {
        if (best.outcome.crashed !== true && totalChecks(best.outcome) === 0) {
          repairStop = 'no-signal' // no visible checks ⇒ nothing honest to steer on
        } else {
          repairStop = 'rounds-exhausted'
          for (let r = 0; r < policy.repairRounds; r += 1) {
            const out = await shot({ messages: best.messages, steer: repairSteer(best.outcome) })
            if (!out) break
            shots += 1
            completions += out.completions
            progression.push(out.score)
            const outcome = await checkRunner.run(extract(out.messages), checks, runCtx)
            const displaced = canDisplace(outcome, best.outcome)
            const label = displaced
              ? 'repair (displaced the incumbent)'
              : outcome.crashed !== true && outcome.passedOfficial < best.outcome.passedOfficial
                ? 'repair (held out: passes fewer official checks than the incumbent)'
                : 'repair (held out: no improvement)'
            receipts.push({
              candidateIndex: seq,
              selected: false,
              score: visibleCheckScore(outcome),
              reason: describeOutcome(label, outcome),
              selector: 'driver',
            })
            if (displaced) {
              best = {
                index: seq,
                messages: out.messages,
                outcome,
                shotScore: out.score,
                shotResolved: out.total > 0 && out.passes === out.total,
              }
            }
            seq += 1
            if (passesAllChecks(best.outcome)) {
              repairStop = 'repaired-pass'
              break
            }
          }
        }
      }

      const winner = receipts.find((r) => r.candidateIndex === best.index)
      if (winner) winner.selected = true

      return {
        score: best.shotScore,
        resolved: best.shotResolved,
        completions,
        progression,
        shots,
        selection: receipts,
        repairStop,
        officialChecks,
        authoredChecks,
      }
    },
  )

  if (policy.temperature === undefined) return inner
  // The shot temperature is an AgenticOptions concern; the policy override threads in at
  // the driver seam so the strategy stays a plain defineStrategy member.
  return {
    name: inner.name,
    driver: (surface, task, opts, budget) =>
      inner.driver(surface, task, { ...opts, temperature: policy.temperature }, budget),
  }
}
