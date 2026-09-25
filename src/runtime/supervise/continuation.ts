/**
 * The continuation: what a manager with a completion check is told when its turn ends and the
 * check is unmet, and the one rule that decides whether it is sent back.
 *
 * Measured on discovery-lab before this module (2026-09-24, 670 settled runs, 1,596 re-entries):
 * 1,565 re-entries followed a failed turn and resent the original task, and 31 carried note text.
 * The note Runtime wrote itself held seven fixed lines and no field for the check's verdict. Of 40
 * episodes where the director ended on its own and the outside check disagreed, 33 were told
 * nothing before they ended. 100 of 236 resubmits sent the identical packet. So the director
 * mostly graded itself, and when it was wrong it heard nothing it could use.
 *
 * The design (discovery `docs/38-one-loop-and-continuation.md`) makes three things single, and
 * this module holds the part Runtime owns:
 *
 *  - ONE CHECK. A check reading is a {@link CheckVerdict}: pass, the items it read, the composite,
 *    and one `FAIL <item> <where>: <reason>` line per failed item. The same check decides
 *    `submit_result`, runs when a turn ends without an accepted result, scores the finished run,
 *    and ranks versions. A check that could not run gives no verdict ({@link CheckUnavailableError}),
 *    and the loop pauses instead of blaming the director.
 *  - ONE RESEND RULE. {@link ContinuationPolicy} is required for a manager with a check. It holds a
 *    deadline and `maxBarren`, the re-entered turns in a row that may end without progress. There
 *    is no re-prompt count and no default: a retry default in source is a research decision.
 *  - ONE NOTE. {@link composeContinuationNote} writes it. Runtime owns the facts and their order;
 *    the {@link ContinuationProfile} owns every instruction word, so an optimizer can change the
 *    words without touching code. A play may append a section, never remove or rewrite one.
 *
 * Evidence behind the note's shape: located errors help (given the first mistake's true location,
 * fix rates rose 23.5 to 43.9 points, Tyen 2023); unsupported pressure does not (threats and tips
 * had no significant effect, Wharton 2025; challenges without evidence flipped correct answers,
 * FlipFlop); repeated summaries drop detail while itemized additions do not (ACE). So the note is
 * a list of located facts, findings are added and marked resolved rather than rewritten, and the
 * profile, not this file, decides how blunt the words are.
 */

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ValidationError } from '../../errors'
import type { DriverBudgetReadout, DriverProgressMark } from './driver-retry'

// ── The check ────────────────────────────────────────────────────────────────────────────────────

/**
 * One reading of a completion check.
 *
 * A check program prints an agent-eval `JudgeScore`; {@link verdictFromJudgeScore} reads it into
 * this shape. A plain boolean check is a verdict with no items.
 */
export interface CheckVerdict {
  /** Whether the check accepts the result. */
  readonly pass: boolean
  /** Every item the check read, by name: 1 when it passes, lower when it does not. The
   *  `JudgeScore.dimensions` of the check program. */
  readonly items?: Readonly<Record<string, number>>
  /** The check's score. */
  readonly composite?: number
  /** The pass threshold on `composite`, when the check has one. */
  readonly threshold?: number
  /** One `FAIL <item> <where>: <reason>` line per failed item, in the check's order. */
  readonly failures?: ReadonlyArray<string>
  /** The check's prose review of the result, when it writes one. */
  readonly review?: string
}

/**
 * The check could not run: its box did not start, its judge's provider refused, its program
 * crashed. It is not a verdict on the result. Inside a run the loop pauses, as it does for an
 * unavailable upstream, and the refusal tells the director its result was not judged.
 */
export class CheckUnavailableError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options)
    this.name = 'CheckUnavailableError'
  }
}

/** Read a check function's return value into a verdict. Anything but `true` or a passing verdict
 *  is a failure: a check fails closed. */
export function checkVerdictOf(outcome: unknown): CheckVerdict {
  if (outcome === true) return { pass: true }
  if (typeof outcome !== 'object' || outcome === null || Array.isArray(outcome)) {
    return { pass: false }
  }
  const raw = outcome as Record<string, unknown>
  const items =
    typeof raw.items === 'object' && raw.items !== null && !Array.isArray(raw.items)
      ? Object.fromEntries(
          Object.entries(raw.items as Record<string, unknown>).filter(
            (entry): entry is [string, number] =>
              typeof entry[1] === 'number' && Number.isFinite(entry[1]),
          ),
        )
      : undefined
  const failures = Array.isArray(raw.failures)
    ? raw.failures.filter((line): line is string => typeof line === 'string' && line.trim() !== '')
    : undefined
  return Object.freeze({
    pass: raw.pass === true,
    ...(items === undefined ? {} : { items: Object.freeze(items) }),
    ...(finite(raw.composite) ? { composite: raw.composite } : {}),
    ...(finite(raw.threshold) ? { threshold: raw.threshold } : {}),
    ...(failures === undefined ? {} : { failures: Object.freeze(failures) }),
    ...(typeof raw.review === 'string' && raw.review.trim() !== ''
      ? { review: raw.review.trim() }
      : {}),
  })
}

/**
 * Read an agent-eval `JudgeScore` from a check program into a verdict.
 *
 * Each dimension is a checked item. `notes` lines that start with `FAIL ` are the failures; the
 * remaining lines are the check's review. The verdict passes when `composite >= threshold` and the
 * score is not marked `failed`; a `failed` score means the judge itself did not run, which is
 * {@link CheckUnavailableError}, not a verdict.
 */
export function verdictFromJudgeScore(
  score: {
    readonly dimensions: Readonly<Record<string, number>>
    readonly composite: number
    readonly notes: string
    readonly failed?: true
  },
  threshold: number,
): CheckVerdict {
  if (score.failed === true) {
    throw new CheckUnavailableError(`the check's judge did not run: ${score.notes}`)
  }
  const lines = score.notes.split('\n').map((line) => line.trimEnd())
  const failures = lines.filter((line) => line.startsWith('FAIL '))
  const review = lines.filter((line) => !line.startsWith('FAIL ') && line.trim() !== '').join('\n')
  return checkVerdictOf({
    pass: score.composite >= threshold,
    items: score.dimensions,
    composite: score.composite,
    threshold,
    failures,
    ...(review === '' ? {} : { review }),
  })
}

/** Items that fail in `verdict`: every item below 1, or the named items of its FAIL lines. */
export function failedItems(verdict: CheckVerdict): ReadonlyArray<string> {
  if (verdict.items !== undefined) {
    return Object.entries(verdict.items)
      .filter(([, value]) => value < 1)
      .map(([name]) => name)
  }
  return (verdict.failures ?? []).map((line) => line.slice('FAIL '.length).split(/[\s:]/u)[0] ?? '')
}

/** Items that pass in `verdict`. */
export function passedItems(verdict: CheckVerdict): ReadonlyArray<string> {
  return Object.entries(verdict.items ?? {})
    .filter(([, value]) => value >= 1)
    .map(([name]) => name)
}

/** One time the check ran inside the run, whatever started it. */
export interface CheckRead {
  /** 1-based count of check reads in this manager, the unavailable ones included. */
  readonly read: number
  /** The driver attempt the read belongs to. */
  readonly attempt: number
  /** Epoch ms. */
  readonly at: number
  /** `submit`: a `submit_result` call. `turn-end`: the turn ended with no accepted result. */
  readonly source: 'submit' | 'turn-end'
  /** Absent when the check could not run. */
  readonly verdict?: CheckVerdict
  /** Why the check could not run. */
  readonly unavailable?: string
}

// ── The resend rule ──────────────────────────────────────────────────────────────────────────────

/**
 * How a manager with a completion check is sent back when its turn ends unmet.
 *
 * Required for an external manager with a check: Runtime supplies no default, because a retry
 * default in source is a research decision the record must make. There is no re-prompt count.
 * The loop re-enters until the check passes, `report_blocked` ends the run, or a bound ends it:
 * this deadline, the budget, `maxBarren` turns in a row without progress, or cancellation.
 * Progress means the check's best composite rose, an accepted result, or a worker that delivered.
 */
export interface ContinuationPolicy {
  /** No re-entry starts at or after this instant: epoch ms, or an ISO 8601 time. */
  readonly deadline: number | string
  /** Re-entered turns in a row that may end without progress before the run ends. Minimum 1.
   *  The evidence for 2: repair loses most of its effect within two or three attempts, and a
   *  fresh start at the same budget scored higher (Debugging Decay Index). */
  readonly maxBarren: number
  /** Every instruction word of the note. */
  readonly profile: ContinuationProfile
  /** `verbatim` sends the check's FAIL lines, the protected items, and what changed. A check with
   *  `feedback: 'pass-only'` overrides this to `off`. */
  readonly failures: 'verbatim' | 'off'
  /** `on` runs the question panel at each continuation and puts its admitted findings in the note.
   *  Requires `runPanel`. */
  readonly panel: 'on' | 'off'
  /** `on` states the bar: every check item with its state, the best version's verdict and the
   *  gap, the reference result, and the check's review. */
  readonly bar: 'on' | 'off'
  /** The play's registered reference result, for the bar. */
  readonly reference?: string
  /** The best version's verdict on the same check, for the bar. The version loop sets it. */
  readonly best?: { readonly label: string; readonly verdict: CheckVerdict }
  /** The panel's dollar caps. Required with `panel: 'on'`. */
  readonly panelUsd?: { readonly perContinuation: number; readonly perRun: number }
  /** The question panel. Required with `panel: 'on'`. */
  readonly runPanel?: ContinuationPanel
  /** A play's own section, appended after Runtime's sections. It cannot remove or rewrite one. */
  readonly append?: ContinuationAppend
}

/** Resolve and check a policy before any compute. Returns the deadline in epoch ms. */
export function admitContinuationPolicy(policy: ContinuationPolicy, context: string): number {
  if (typeof policy !== 'object' || policy === null) {
    throw new ValidationError(`${context}: continuation must be an object`)
  }
  const deadlineMs =
    typeof policy.deadline === 'string' ? Date.parse(policy.deadline) : policy.deadline
  if (typeof deadlineMs !== 'number' || !Number.isFinite(deadlineMs) || deadlineMs <= 0) {
    throw new ValidationError(
      `${context}: continuation.deadline must be a finite time (epoch ms or ISO 8601)`,
    )
  }
  if (!Number.isInteger(policy.maxBarren) || policy.maxBarren < 1) {
    throw new ValidationError(`${context}: continuation.maxBarren must be an integer >= 1`)
  }
  if (policy.failures !== 'verbatim' && policy.failures !== 'off') {
    throw new ValidationError(`${context}: continuation.failures must be 'verbatim' or 'off'`)
  }
  if (policy.panel !== 'on' && policy.panel !== 'off') {
    throw new ValidationError(`${context}: continuation.panel must be 'on' or 'off'`)
  }
  if (policy.bar !== 'on' && policy.bar !== 'off') {
    throw new ValidationError(`${context}: continuation.bar must be 'on' or 'off'`)
  }
  if (policy.panel === 'on') {
    if (typeof policy.runPanel !== 'function') {
      throw new ValidationError(`${context}: continuation.panel 'on' needs runPanel`)
    }
    const usd = policy.panelUsd
    if (
      usd === undefined ||
      !finite(usd.perContinuation) ||
      !finite(usd.perRun) ||
      usd.perContinuation <= 0 ||
      usd.perRun < usd.perContinuation
    ) {
      throw new ValidationError(
        `${context}: continuation.panel 'on' needs panelUsd with 0 < perContinuation <= perRun`,
      )
    }
  }
  if (policy.append !== undefined && typeof policy.append !== 'function') {
    throw new ValidationError(`${context}: continuation.append must be a function`)
  }
  admitContinuationProfile(policy.profile, context)
  return deadlineMs
}

// ── The profile ──────────────────────────────────────────────────────────────────────────────────

/**
 * Every instruction word of the note. Runtime supplies the facts and their order; this data
 * supplies the words, so the note can be improved (by a person, reflection, or GEPA) without a code
 * change. Templates may name the facts in {@link CONTINUATION_FACTS} as `{name}`.
 */
export interface ContinuationProfile {
  /** Recorded with every note, so each continuation names the words it carried. */
  readonly id: string
  /** Section 1, the verdict. The first line should state the failure as a fact. */
  readonly opening: string
  /** Section 7: what to do before the next submit. */
  readonly plan: string
  /** Section 8: what the harness enforces, and the honest exit. */
  readonly rules: string
  /** Section headings; an empty heading prints the section without one. */
  readonly headings: {
    readonly failures: string
    readonly protected: string
    readonly changed: string
    readonly findings: string
    readonly bar: string
    readonly plan: string
    readonly rules: string
  }
  /** The bar's standing instruction, printed under its heading. */
  readonly barRule?: string
  /** The panel's question templates. `{item}` expands over failed items and `{worker}` over
   *  settled workers; a template with neither is asked once. */
  readonly questions?: ReadonlyArray<string>
  /** The panel's model, when the profile chooses one. */
  readonly panelModel?: string
}

/** The facts a profile template may name. */
export const CONTINUATION_FACTS = [
  'composite',
  'threshold',
  'failed',
  'total',
  'reads',
  'owed',
  'settled',
  'delivered',
  'continuation',
] as const

type ContinuationFact = (typeof CONTINUATION_FACTS)[number]

const factNames: ReadonlySet<string> = new Set(CONTINUATION_FACTS)
const placeholder = /\{([a-zA-Z]+)\}/gu

function admitContinuationProfile(profile: ContinuationProfile, context: string): void {
  if (typeof profile !== 'object' || profile === null) {
    throw new ValidationError(`${context}: continuation.profile must be an object`)
  }
  if (typeof profile.id !== 'string' || profile.id.trim() === '') {
    throw new ValidationError(`${context}: continuation.profile.id must be non-empty`)
  }
  const texts: Array<[string, unknown]> = [
    ['opening', profile.opening],
    ['plan', profile.plan],
    ['rules', profile.rules],
    ...Object.entries(profile.headings ?? {}).map(([key, value]): [string, unknown] => [
      `headings.${key}`,
      value,
    ]),
    ...(profile.barRule === undefined ? [] : [['barRule', profile.barRule] as [string, unknown]]),
  ]
  for (const key of ['failures', 'protected', 'changed', 'findings', 'bar', 'plan', 'rules']) {
    if (typeof (profile.headings as Record<string, unknown> | undefined)?.[key] !== 'string') {
      throw new ValidationError(`${context}: continuation.profile.headings.${key} must be a string`)
    }
  }
  for (const [key, text] of texts) {
    if (typeof text !== 'string') {
      throw new ValidationError(`${context}: continuation.profile.${key} must be a string`)
    }
    for (const match of text.matchAll(placeholder)) {
      if (!factNames.has(match[1] ?? '')) {
        throw new ValidationError(
          `${context}: continuation.profile.${key} names {${match[1]}}, which is not a fact Runtime supplies (${CONTINUATION_FACTS.join(', ')})`,
        )
      }
    }
  }
  if (profile.opening.trim() === '') {
    throw new ValidationError(`${context}: continuation.profile.opening must be non-empty`)
  }
  for (const [index, question] of (profile.questions ?? []).entries()) {
    if (typeof question !== 'string' || question.trim() === '') {
      throw new ValidationError(
        `${context}: continuation.profile.questions[${index}] must be a non-empty string`,
      )
    }
  }
}

// ── The panel ────────────────────────────────────────────────────────────────────────────────────

/** What the question panel reads for one continuation. */
export interface ContinuationPanelInput {
  /** 1-based continuation number. */
  readonly continuation: number
  readonly task: unknown
  /** The check's verdict this note reports; absent when no result reached the check. */
  readonly verdict?: CheckVerdict
  /** Every check read so far, oldest first. */
  readonly reads: ReadonlyArray<CheckRead>
  /** The expanded questions, one per atomic question. */
  readonly questions: ReadonlyArray<string>
  /** `<runDir>/root-stream.jsonl`, the director's own trace, when the run has a directory. */
  readonly rootStreamPath?: string
  /** Settled workers, with the evidence reference their trace is read from. */
  readonly workers: ReadonlyArray<{ readonly id: string; readonly label: string }>
  readonly bar?: ContinuationPolicy['best']
  readonly reference?: string
  /** The dollars this panel call may spend. */
  readonly usdCap: number
  readonly signal: AbortSignal
}

/** One answer the panel proposes for the note. */
export interface PanelFinding {
  readonly question: string
  /** The finding, stated as a claim about the run. */
  readonly claim: string
  /** Every `trace://` citation in the answer, and whether the trace store holds it. */
  readonly citations: ReadonlyArray<{ readonly uri: string; readonly resolved: boolean }>
  /** Whether an independent verifier, shown only the cited spans, agreed with the claim. */
  readonly verified: boolean
  /** The failed check items the finding explains, when it names any. */
  readonly items?: ReadonlyArray<string>
}

export interface ContinuationPanelResult {
  readonly findings: ReadonlyArray<PanelFinding>
  /** Dollars spent; `null` when the provider reported no cost. Unknown is never zero. */
  readonly usd: number | null
  /** Provider receipts, recorded verbatim in `panel.jsonl`. */
  readonly receipts?: unknown
}

/** Ask the panel's questions over the run's own traces. */
export type ContinuationPanel = (input: ContinuationPanelInput) => Promise<ContinuationPanelResult>

/** A play's own section for one note. Return `undefined` to add nothing this time. */
export type ContinuationAppend = (context: {
  readonly continuation: number
  readonly verdict?: CheckVerdict
  readonly reads: ReadonlyArray<CheckRead>
  readonly signal: AbortSignal
}) => Promise<{ readonly heading: string; readonly text: string } | undefined>

/** A finding that reached the note, with the continuation that admitted it. */
export interface AdmittedFinding extends PanelFinding {
  readonly admittedAt: number
  /** Set once every item the finding named passes. */
  readonly resolvedAt?: number
}

/** Findings reach the note only when every citation resolves, at least two distinct spans are
 *  cited, and the independent verifier agreed. The best method in Who&When found the failing step
 *  14.2% of the time, so an unverified finding is noise with a citation. */
export function admitFinding(finding: PanelFinding): boolean {
  if (!finding.verified) return false
  if (finding.citations.length === 0) return false
  if (!finding.citations.every((citation) => citation.resolved)) return false
  return new Set(finding.citations.map((citation) => citation.uri)).size >= 2
}

/** About 1,500 tokens of findings. */
const FINDINGS_CHAR_CAP = 6_000

/**
 * Rank the admitted findings by how many failed items they explain, drop repeats, and keep them
 * within the note's cap. Earlier findings stay as they were written (ACE: itemized additions keep
 * detail that repeated rewrites lose); a finding whose items all pass now is marked resolved.
 */
export function distillFindings(
  prior: ReadonlyArray<AdmittedFinding>,
  proposed: ReadonlyArray<PanelFinding>,
  failing: ReadonlySet<string>,
  continuation: number,
): ReadonlyArray<AdmittedFinding> {
  const key = (claim: string) => claim.toLowerCase().replace(/\s+/gu, ' ').trim()
  const known = new Set(prior.map((finding) => key(finding.claim)))
  const carried = prior.map((finding) =>
    finding.resolvedAt === undefined &&
    (finding.items?.length ?? 0) > 0 &&
    (finding.items ?? []).every((item) => !failing.has(item))
      ? { ...finding, resolvedAt: continuation }
      : finding,
  )
  const fresh = proposed
    .filter(admitFinding)
    .filter((finding) => {
      const k = key(finding.claim)
      if (known.has(k)) return false
      known.add(k)
      return true
    })
    .map((finding) => ({
      finding,
      links: (finding.items ?? []).filter((item) => failing.has(item)).length,
    }))
    .sort((a, b) => b.links - a.links)
  const out: AdmittedFinding[] = [...carried]
  let used = carried
    .filter((finding) => finding.resolvedAt === undefined)
    .reduce((sum, finding) => sum + finding.claim.length, 0)
  for (const { finding } of fresh) {
    if (used + finding.claim.length > FINDINGS_CHAR_CAP) break
    used += finding.claim.length
    out.push({ ...finding, admittedAt: continuation })
  }
  return out
}

/** Expand the profile's question templates over the failed items and the settled workers. */
export function expandQuestions(
  templates: ReadonlyArray<string>,
  failing: ReadonlyArray<string>,
  workers: ReadonlyArray<{ readonly id: string; readonly label: string }>,
): ReadonlyArray<string> {
  const out: string[] = []
  for (const template of templates) {
    const hasItem = template.includes('{item}')
    const hasWorker = template.includes('{worker}')
    if (!hasItem && !hasWorker) {
      out.push(template)
      continue
    }
    const items = hasItem ? failing : ['']
    const each = hasWorker ? workers.map((worker) => `${worker.id} (${worker.label})`) : ['']
    for (const item of items) {
      for (const worker of each) {
        out.push(template.replaceAll('{item}', item).replaceAll('{worker}', worker))
      }
    }
  }
  return out
}

// ── The note ─────────────────────────────────────────────────────────────────────────────────────

/** The facts one note is written from. */
export interface ContinuationNoteInput {
  readonly profile: ContinuationProfile
  /** 1-based. */
  readonly continuation: number
  /** The verdict this turn ended on; absent when no result has reached the check. */
  readonly verdict?: CheckVerdict
  /** The verdict the previous note reported, for what changed. */
  readonly previous?: CheckVerdict
  /** Check reads so far, the unavailable ones included. */
  readonly reads: number
  /** `verbatim` only when the policy and the check both allow the FAIL lines. */
  readonly failures: 'verbatim' | 'off'
  readonly findings?: ReadonlyArray<AdmittedFinding>
  readonly bar?: {
    readonly best?: ContinuationPolicy['best']
    readonly reference?: string
  }
  readonly appended?: ReadonlyArray<{ readonly heading: string; readonly text: string }>
  /** What the run owes, from the check's description. */
  readonly owed?: string
  readonly progress: DriverProgressMark
  /** Whether `read_continuation` is served to this manager. */
  readonly canReadMore: boolean
  /** Whether the check's score comes from cases the director cannot see. */
  readonly sealed?: boolean
}

/** At most this many FAIL lines in the note; the rest through `read_continuation`. */
export const NOTE_FAILURE_LINES = 40

/**
 * Write one continuation note, sections 1 to 8 of docs/38. Section 9, the run's state, is
 * `composeReentryTask`, which wraps this text. Pure: the same input writes the same note.
 */
export function composeContinuationNote(input: ContinuationNoteInput): string {
  const { profile, verdict } = input
  const items = verdict?.items ?? {}
  const total = Object.keys(items).length
  const failing = verdict === undefined ? [] : failedItems(verdict)
  const facts: Record<ContinuationFact, string> = {
    composite: verdict?.composite === undefined ? 'unknown' : format(verdict.composite),
    threshold: verdict?.threshold === undefined ? 'unknown' : format(verdict.threshold),
    failed:
      verdict === undefined || (total === 0 && (verdict.failures?.length ?? 0) === 0)
        ? 'unknown'
        : String(failing.length),
    total: total === 0 ? 'unknown' : String(total),
    reads: String(input.reads),
    owed: input.owed?.trim() || 'not described',
    settled: String(input.progress.settledCount),
    delivered: String(input.progress.deliveredCount ?? 0),
    continuation: String(input.continuation),
  }
  const fill = (text: string) =>
    text.replace(placeholder, (_, name: string) => facts[name as ContinuationFact] ?? `{${name}}`)
  // The opening states a failed verdict. When there is no verdict, or the check passes on a state
  // no result was submitted for, the fact replaces it: the profile cannot state a verdict that
  // does not exist.
  const sections: string[] = [
    verdict === undefined
      ? 'No result has reached the check yet. The run ends only when a result passes it through submit_result.'
      : verdict.pass
        ? 'The check passes on the current state, but no result was submitted. Call submit_result to end the run.'
        : fill(profile.opening).trim(),
  ]
  const section = (heading: string, body: ReadonlyArray<string>) => {
    if (body.length === 0) return
    sections.push([...(heading.trim() === '' ? [] : [`## ${fill(heading)}`]), ...body].join('\n'))
  }
  if (input.failures === 'verbatim' && verdict !== undefined) {
    const lines = verdict.failures ?? []
    const shown = lines.slice(0, NOTE_FAILURE_LINES)
    const more = lines.length - shown.length
    section(profile.headings.failures, [
      ...shown,
      ...(more > 0
        ? [
            input.canReadMore
              ? `${more} more failure lines: call read_continuation with continuation ${input.continuation}.`
              : `${more} more failure lines are not shown.`,
          ]
        : []),
    ])
    const passing = passedItems(verdict)
    section(profile.headings.protected, passing.length === 0 ? [] : [passing.join(', ')])
    if (input.previous !== undefined) {
      const before = new Set(failedItems(input.previous))
      const now = new Set(failing)
      const fixed = [...before].filter((item) => !now.has(item))
      const broke = [...now].filter((item) => !before.has(item))
      section(profile.headings.changed, [
        ...(fixed.length === 0 ? [] : [`Now passing: ${fixed.join(', ')}.`]),
        ...(broke.length === 0 ? [] : [`Newly failing: ${broke.join(', ')}.`]),
        ...(fixed.length === 0 && broke.length === 0
          ? ['No item changed since the last note.']
          : []),
        ...(input.previous.composite !== undefined && verdict.composite !== undefined
          ? [`Composite: ${format(input.previous.composite)} then ${format(verdict.composite)}.`]
          : []),
      ])
    }
  }
  if (input.findings !== undefined) {
    const open = input.findings.filter((finding) => finding.resolvedAt === undefined)
    const resolved = input.findings.filter((finding) => finding.resolvedAt === input.continuation)
    section(profile.headings.findings, [
      ...open.map(
        (finding) =>
          `- [hypothesis] ${finding.claim}` +
          (finding.items?.length ? ` (items: ${finding.items.join(', ')})` : '') +
          ` Evidence: ${finding.citations.map((citation) => citation.uri).join(', ')}`,
      ),
      ...resolved.map((finding) => `- [resolved] ${finding.claim}`),
    ])
  }
  if (input.bar !== undefined && verdict !== undefined) {
    const body: string[] = []
    if (profile.barRule?.trim()) body.push(fill(profile.barRule).trim())
    for (const [item, value] of Object.entries(items)) {
      const best = input.bar.best?.verdict.items?.[item]
      body.push(
        `- ${item}: ${value >= 1 ? 'passes' : `fails (${format(value)})`}` +
          (best === undefined
            ? ''
            : ` / ${input.bar.best?.label}: ${best >= 1 ? 'passes' : `fails (${format(best)})`}`),
      )
    }
    if (input.bar.best?.verdict.composite !== undefined) {
      body.push(
        `Best version ${input.bar.best.label}: composite ${format(input.bar.best.verdict.composite)}.`,
      )
    }
    if (input.bar.reference?.trim()) body.push(`Reference result: ${input.bar.reference.trim()}`)
    if (verdict.review?.trim()) body.push(`The check's review: ${verdict.review.trim()}`)
    section(profile.headings.bar, body)
  }
  section(profile.headings.plan, profile.plan.trim() === '' ? [] : [fill(profile.plan).trim()])
  section(profile.headings.rules, [
    ...(profile.rules.trim() === '' ? [] : [fill(profile.rules).trim()]),
    ...(input.sealed ? ['The score comes from cases you cannot see.'] : []),
  ])
  for (const appended of input.appended ?? []) {
    section(appended.heading, appended.text.trim() === '' ? [] : [appended.text.trim()])
  }
  return sections.join('\n\n')
}

// ── The record ───────────────────────────────────────────────────────────────────────────────────

/** One continuation as the settle record carries it (`DriverContinuationRecord.continuations`). */
export interface ContinuationEntry {
  /** 1-based. */
  readonly continuation: number
  /** The driver attempt whose end this note answered. */
  readonly attempt: number
  /** sha256 of the note's text. */
  readonly noteDigest: string
  readonly profile: string
  readonly switches: {
    readonly failures: 'verbatim' | 'off'
    readonly panel: 'on' | 'off'
    readonly bar: 'on' | 'off'
  }
  /** The verdict the note reported: `null` when no result had reached the check. */
  readonly before: VerdictSummary | null
  /** The verdict at the director's next turn end: `null` when the run ended first. */
  readonly after: VerdictSummary | null
  /** The panel's part: questions asked, findings admitted, dollars (`null` = unknown). */
  readonly panel?: {
    readonly asked: number
    readonly proposed: number
    readonly admitted: number
    readonly usd: number | null
  }
  /** Sections a play appended. */
  readonly appended: number
}

export interface VerdictSummary {
  readonly pass: boolean
  readonly composite?: number
  readonly failed?: number
  readonly total?: number
}

export function summarizeVerdict(verdict: CheckVerdict | undefined): VerdictSummary | null {
  if (verdict === undefined) return null
  const total = Object.keys(verdict.items ?? {}).length
  return {
    pass: verdict.pass,
    ...(verdict.composite === undefined ? {} : { composite: verdict.composite }),
    ...(total === 0 ? {} : { failed: failedItems(verdict).length, total }),
  }
}

export function noteDigest(note: string): string {
  return `sha256:${createHash('sha256').update(note).digest('hex')}`
}

/** A run directory's continuation files: the root's at `<runDir>/continuations/<n>/`, a nested
 *  manager's at `<runDir>/continuations/managers/<owner>/<n>/`. */
export const CONTINUATIONS_DIR = 'continuations'

/**
 * Write one continuation's files under `<dir>/<n>/`: `note.md`, `verdict.json`, and
 * `panel.jsonl` when the panel ran. The director reads them through `read_continuation`, because
 * its box cannot read the driver's run directory.
 */
export async function writeContinuationFiles(
  dir: string,
  continuation: number,
  files: {
    readonly note: string
    readonly verdict?: CheckVerdict
    readonly panel?: ReadonlyArray<unknown>
  },
): Promise<void> {
  const at = join(dir, String(continuation))
  await mkdir(at, { recursive: true })
  await writeFile(join(at, 'note.md'), `${files.note}\n`, 'utf8')
  await writeFile(
    join(at, 'verdict.json'),
    `${JSON.stringify(files.verdict ?? null, null, 2)}\n`,
    'utf8',
  )
  if (files.panel !== undefined) {
    await writeFile(
      join(at, 'panel.jsonl'),
      files.panel.map((line) => JSON.stringify(line)).join('\n') + (files.panel.length ? '\n' : ''),
      'utf8',
    )
  }
}

// ── The progress reading ─────────────────────────────────────────────────────────────────────────

/** The best composite across `reads`, or `undefined` when no read scored. */
export function bestComposite(reads: ReadonlyArray<CheckRead>): number | undefined {
  let best: number | undefined
  for (const read of reads) {
    const value = read.verdict?.composite
    if (value !== undefined && (best === undefined || value > best)) best = value
  }
  return best
}

/** The readout a continuation is composed from. */
export interface ContinuationContext {
  /** The attempt that just completed, 1-based. */
  readonly attempt: number
  /** Continuations this run has already sent. */
  readonly continuations: number
  /** The mark read after the completed drive. */
  readonly progress: DriverProgressMark
  readonly budget: DriverBudgetReadout
  /** Re-entered drives in a row, this one included, that ended without progress. */
  readonly barrenReentries: number
  readonly signal: AbortSignal
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function format(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/u, '')
}

// ── One manager's continuations ──────────────────────────────────────────────────────────────────

/** What a manager's continuation keeper reads from its run. */
export interface ContinuationKeeperInput {
  readonly policy: ContinuationPolicy
  readonly task: unknown
  /** What the run owes, from the check's description. */
  readonly owed?: string
  /** The check's feedback mode: `pass-only` keeps the FAIL lines out of every note. */
  readonly feedback?: 'verbatim' | 'pass-only'
  readonly sealed?: boolean
  /** Every check read so far, oldest first. */
  readonly reads: () => ReadonlyArray<CheckRead>
  /** Settled workers, for the panel's `{worker}` questions. */
  readonly workers: () => ReadonlyArray<{ readonly id: string; readonly label: string }>
  /** Where each continuation's files go (`<dir>/<n>/`). Omit to keep them in memory only. */
  readonly dir?: string
  readonly rootStreamPath?: string
  /** Whether `read_continuation` is served to this manager. */
  readonly canReadMore: boolean
}

/** One manager's continuation state: the notes it was sent and the panel's running ledger. */
export interface ContinuationKeeper {
  /** Write the next note. The driver loop calls it only when the check is unmet. */
  compose(context: ContinuationContext): Promise<string>
  /** `read_continuation`: the full record of continuation `n`, or the latest. */
  read(continuation: number | undefined): unknown
  /** The settle record's `continuations`, with the last note's `after` read from the final check. */
  entries(): ReadonlyArray<ContinuationEntry>
}

/** Build the continuation state for one manager with a check. */
export function createContinuationKeeper(input: ContinuationKeeperInput): ContinuationKeeper {
  const { policy } = input
  const failures: 'verbatim' | 'off' = input.feedback === 'pass-only' ? 'off' : policy.failures
  const entries: ContinuationEntry[] = []
  const notes: Array<{
    readonly note: string
    readonly verdict?: CheckVerdict
    readonly panel?: ReadonlyArray<unknown>
    /** The check read the note answered, for the `after` reading. */
    readonly read: number
  }> = []
  let findings: ReadonlyArray<AdmittedFinding> = []
  let panelUsd = 0
  let panelUsdKnown = true

  const latestVerdict = (): { verdict?: CheckVerdict; read: number } => {
    const reads = input.reads()
    for (let i = reads.length - 1; i >= 0; i -= 1) {
      const read = reads[i]
      if (read?.verdict !== undefined) return { verdict: read.verdict, read: read.read }
    }
    return { read: 0 }
  }

  const closePrevious = (): void => {
    const last = entries.at(-1)
    const lastNote = notes.at(-1)
    if (last === undefined || lastNote === undefined) return
    const latest = latestVerdict()
    entries[entries.length - 1] = {
      ...last,
      after: latest.read > lastNote.read ? summarizeVerdict(latest.verdict) : null,
    }
  }

  return {
    async compose(context) {
      closePrevious()
      const continuation = entries.length + 1
      const { verdict, read } = latestVerdict()
      const failing = verdict === undefined ? [] : failedItems(verdict)
      let panelRecord: ContinuationEntry['panel'] | undefined
      let panelLines: unknown[] | undefined
      if (policy.panel === 'on' && policy.runPanel !== undefined && policy.panelUsd !== undefined) {
        const workers = input.workers()
        const questions = expandQuestions(policy.profile.questions ?? [], failing, workers)
        const left = policy.panelUsd.perRun - panelUsd
        const usdCap = Math.min(policy.panelUsd.perContinuation, left)
        // An unknown cost closes the panel for the rest of the run: its cap can no longer be
        // proven, and an unmeasured spend is never read as zero.
        if (questions.length > 0 && usdCap > 0 && panelUsdKnown) {
          const result = await policy.runPanel({
            continuation,
            task: input.task,
            ...(verdict === undefined ? {} : { verdict }),
            reads: input.reads(),
            questions,
            ...(input.rootStreamPath === undefined ? {} : { rootStreamPath: input.rootStreamPath }),
            workers,
            ...(policy.best === undefined ? {} : { bar: policy.best }),
            ...(policy.reference === undefined ? {} : { reference: policy.reference }),
            usdCap,
            signal: context.signal,
          })
          if (result.usd === null) panelUsdKnown = false
          else panelUsd += result.usd
          findings = distillFindings(findings, result.findings, new Set(failing), continuation)
          panelRecord = {
            asked: questions.length,
            proposed: result.findings.length,
            admitted: findings.filter((finding) => finding.admittedAt === continuation).length,
            usd: result.usd,
          }
          panelLines = [
            ...result.findings.map((finding) => ({
              kind: 'finding',
              admitted: admitFinding(finding),
              ...finding,
            })),
            ...(result.receipts === undefined
              ? []
              : [{ kind: 'receipts', receipts: result.receipts }]),
          ]
        } else {
          panelRecord = { asked: 0, proposed: 0, admitted: 0, usd: 0 }
        }
      }
      const appended = policy.append
        ? await policy.append({
            continuation,
            ...(verdict === undefined ? {} : { verdict }),
            reads: input.reads(),
            signal: context.signal,
          })
        : undefined
      const note = composeContinuationNote({
        profile: policy.profile,
        continuation,
        ...(verdict === undefined ? {} : { verdict }),
        ...(notes.at(-1)?.verdict === undefined ? {} : { previous: notes.at(-1)?.verdict }),
        reads: input.reads().length,
        failures,
        ...(policy.panel === 'on' ? { findings } : {}),
        ...(policy.bar === 'on'
          ? {
              bar: {
                ...(policy.best === undefined ? {} : { best: policy.best }),
                ...(policy.reference === undefined ? {} : { reference: policy.reference }),
              },
            }
          : {}),
        ...(appended === undefined ? {} : { appended: [appended] }),
        ...(input.owed === undefined ? {} : { owed: input.owed }),
        progress: context.progress,
        canReadMore: input.canReadMore,
        ...(input.sealed === true ? { sealed: true } : {}),
      })
      notes.push({
        note,
        ...(verdict === undefined ? {} : { verdict }),
        ...(panelLines === undefined ? {} : { panel: panelLines }),
        read,
      })
      entries.push({
        continuation,
        attempt: context.attempt,
        noteDigest: noteDigest(note),
        profile: policy.profile.id,
        switches: { failures, panel: policy.panel, bar: policy.bar },
        before: summarizeVerdict(verdict),
        after: null,
        ...(panelRecord === undefined ? {} : { panel: panelRecord }),
        appended: appended === undefined ? 0 : 1,
      })
      if (input.dir !== undefined) {
        await writeContinuationFiles(input.dir, continuation, {
          note,
          ...(verdict === undefined ? {} : { verdict }),
          ...(panelLines === undefined ? {} : { panel: panelLines }),
        })
      }
      return note
    },
    read(continuation) {
      const index = continuation === undefined ? notes.length - 1 : continuation - 1
      const entry = notes[index]
      if (entry === undefined) {
        return {
          found: false,
          reason:
            notes.length === 0
              ? 'no continuation has been sent in this run'
              : `continuations run from 1 to ${notes.length}`,
        }
      }
      return {
        found: true,
        continuation: index + 1,
        note: entry.note,
        // Under `pass-only` the check's lines stay hidden here too.
        verdict:
          failures === 'off' && entry.verdict !== undefined
            ? { pass: entry.verdict.pass }
            : (entry.verdict ?? null),
        findings: findings.filter((finding) => finding.admittedAt <= index + 1),
      }
    },
    entries() {
      closePrevious()
      return entries.map((entry) => ({ ...entry }))
    },
  }
}
