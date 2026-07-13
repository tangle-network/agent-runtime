/**
 * `reflective-swe` — the two INTELLIGENCE pieces that turn a flat SWE eval into a
 * findable lift. A hardcoded generic instruction scores Δ=0 because it targets no
 * real failure; lift only appears when a candidate attacks the mechanism the
 * worker actually loses to. That mechanism is not knowable a priori — it has to
 * be READ off the failing runs. So this module is two halves of one loop:
 *
 *   1. AUTOPSY (`autopsySweFailures`) — read the per-instance rows `sweEvalRunner`
 *      returns, send the FAILING ones to a router analyst, and get back a concrete
 *      mechanism per failure (empty-patch / wrong-file-or-function / no-reproduction
 *      / patch-doesnt-apply / regression / gave-up-early / other) with a one-line
 *      evidence quote. Aggregate into ranked `AnalystFinding`s: one per mechanism,
 *      ordered by how many failures it explains, so the dominant mode is finding #0.
 *
 *   2. REFLECTIVE PROPOSE (`reflectiveSweRefine`, `authorDiverseSweSeeds`) — the two
 *      `promptGenerator` seams (refine / authorDiverseSeeds), each reading those
 *      findings and driving the SHIPPED senior optimizer method
 *      (`optimizerMethod`) to author candidate standing-instructions that target the
 *      dominant mode(s), each carrying a hypothesis + predicted mechanism. `refine`
 *      polishes toward the mechanism; `authorDiverseSweSeeds` spreads across framings
 *      so the search can escape a basin. Both are factories that CLOSE OVER the
 *      router transport (there is no other way to be a valid seam — the seam type
 *      carries no transport), exactly as `gepaRefine` / `routerSeedAuthor` do.
 *
 * FIREWALL: the analyst uses the judge's `resolved=false` only to SELECT which
 * tasks to inspect; every finding's claim is about OBSERVED behavior (an empty
 * diff, an edit to the wrong file), never the acceptance score itself — so the
 * findings are trace-observable and carry `derived_from_judge: false`, safe to
 * steer the loop.
 */

import {
  type AnalystFinding,
  type AnalystSeverity,
  callLlmJson,
  type LlmClientOptions,
  makeFinding,
} from '@tangle-network/agent-eval'
import { optimizerMethod } from '../improvement/optimizer-prompt'
import type { GenerateContext } from './generator'
import type { AuthorDiverseSeeds, PromptDraft, RefinePrompt } from './prompt-generator'

/** The concrete failure mechanisms the analyst classifies a lost task into. A
 *  closed vocabulary so findings aggregate cleanly; anything unrecognized folds
 *  into `other` rather than fragmenting the ranking. */
export const FAILURE_MECHANISMS = [
  'empty-patch',
  'wrong-file-or-function',
  'no-reproduction',
  'patch-doesnt-apply',
  'regression',
  'gave-up-early',
  'other',
] as const

export type FailureMechanism = (typeof FAILURE_MECHANISMS)[number]

/** The concrete fix direction each mechanism points the proposer at — durable
 *  domain knowledge, carried on the finding's `recommended_action` so the
 *  reflective proposer has a target and not just a label. */
const MECHANISM_ACTION: Record<FailureMechanism, string> = {
  'empty-patch':
    'The worker finished without emitting any diff — require it to produce and confirm a non-empty unified diff before yielding.',
  'wrong-file-or-function':
    'The worker edited the wrong site — require it to locate the failing symbol from the traceback (search/grep) and confirm the edit target before changing code.',
  'no-reproduction':
    'The worker edited without reproducing the failure — require it to reproduce the failing test first, then edit until that test passes.',
  'patch-doesnt-apply':
    'The produced diff did not apply cleanly — require the worker to apply and re-run its own diff in the workspace before finishing.',
  regression:
    'The fix broke previously-passing behavior — require running the existing relevant tests before finishing so a fix does not trade one failure for another.',
  'gave-up-early':
    'The worker yielded before exhausting its budget — instruct it to keep iterating (reproduce, edit, verify) and never return without a genuine patch attempt.',
  other:
    'Mechanism not auto-classified — inspect the trajectory manually before proposing a targeted fix.',
}

/**
 * One failing (or passing) instance row the autopsy reads. Structurally a
 * superset of `sweEvalRunner`'s `SweEvalTaskResult` (`id`, `resolved`,
 * `patchBytes`) so `details.rows` can be handed in directly, plus the richer
 * evidence fields (`patch` text, `systemPrompt`, `notes`) an extended runner may
 * capture. `instanceId` is accepted as an alias for `id`.
 */
export interface SweFailureRow {
  /** SWE-bench instance id (the runner emits this as `id`). */
  id?: string
  /** Alias for `id`, accepted for callers that name it `instanceId`. */
  instanceId?: string
  /** The judge verdict — the analyst inspects only the `false` rows. */
  resolved: boolean
  /** The worker's diff, when the caller captured its text. */
  patch?: string
  /** Size of the captured patch in bytes — present on the runner's audit row;
   *  a `0` here is itself strong evidence of `empty-patch`. */
  patchBytes?: number
  /** The system prompt the worker was driven with, when available per-row. */
  systemPrompt?: string
  /** Free-form drive trajectory / notes, when captured. */
  notes?: string
  /** Set when the judge threw for this instance. */
  judgeError?: string
}

export interface AutopsyOptions {
  /** Router transport. Provide this OR `baseUrl` + `key`. */
  llm?: LlmClientOptions
  /** Router base URL, used to build the transport when `llm` is omitted. */
  baseUrl?: string
  /** Router key, used to build the transport when `llm` is omitted. */
  key?: string
  /** Analyst model. `reflectModel` wins when both are set. */
  model?: string
  reflectModel?: string
  /** The shared system prompt the failing tasks were driven with
   *  (`details.systemPrompt`), handed to the analyst as WHY-context. */
  systemPrompt?: string
  /** Cooperative cancellation. */
  signal?: AbortSignal
}

/** Default analyst / author model — a model the Tangle router serves. Callers
 *  should pass their own; this is the zero-config fallback. */
const defaultReflectModel = 'deepseek-v4-flash'

/** The maximum patch bytes handed to the analyst per instance — enough to
 *  classify, bounded so a giant diff cannot blow the context. */
const PATCH_EVIDENCE_LIMIT = 4_000

/** Wire shape of one per-instance classification the analyst returns. */
interface FailureClassificationWire {
  instanceId: string
  mechanism: string
  evidence?: string
}

/**
 * AUTOPSY — classify the FAILING rows into ranked mechanism findings.
 *
 * Sends every unresolved instance's observable evidence (patch size, patch text
 * when present, drive notes) to a router analyst in ONE structured call, gets a
 * mechanism + one-line evidence quote per instance, then aggregates: group by
 * mechanism, count, rank by count desc, and emit one `AnalystFinding` per group
 * (the dominant mode first). Returns `[]` when nothing failed — a clean exam has
 * no autopsy.
 */
export async function autopsySweFailures(
  rows: ReadonlyArray<SweFailureRow>,
  opts: AutopsyOptions,
): Promise<AnalystFinding[]> {
  const failing = rows.filter((r) => !r.resolved)
  if (failing.length === 0) return []

  const llm = resolveLlm(opts)
  const model = opts.reflectModel ?? opts.model ?? defaultReflectModel

  const classificationById = await classifyFailures(failing, model, llm, opts.systemPrompt)

  // Fold each failure into its mechanism bucket, defaulting to `other` when the
  // analyst omitted or returned an unrecognized label.
  const buckets = new Map<FailureMechanism, { rowId: string; evidence: string }[]>()
  for (const row of failing) {
    const id = rowId(row)
    const raw = classificationById.get(id)
    const mechanism = normalizeMechanism(raw?.mechanism, row)
    const evidence = (raw?.evidence ?? '').trim() || defaultEvidence(row)
    const bucket = buckets.get(mechanism) ?? []
    bucket.push({ rowId: id, evidence })
    buckets.set(mechanism, bucket)
  }

  const total = failing.length
  const ranked = [...buckets.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  )

  return ranked.map(([mechanism, members], rank) =>
    makeFinding({
      analyst_id: 'swe-failure-autopsy',
      // `derived_from_judge=false`: the judge only SELECTED these rows; the
      // claim is about observed behavior (an empty/misplaced diff), so it is a
      // legitimate steering input and passes the firewall.
      derived_from_judge: false,
      severity: severityForShare(members.length / total, rank),
      area: mechanism,
      claim: `${members.length}/${total} failing task(s) failed via ${mechanism}`,
      rationale: MECHANISM_ACTION[mechanism],
      recommended_action: MECHANISM_ACTION[mechanism],
      confidence: members.length / total,
      evidence_refs: members.map((m) => ({
        kind: 'artifact' as const,
        uri: `swe://${m.rowId}`,
        excerpt: m.evidence,
      })),
      metadata: {
        mechanism,
        count: members.length,
        instanceIds: members.map((m) => m.rowId),
      },
    }),
  )
}

/** One structured analyst call over all failing rows. Isolated so the test can
 *  script the router with a single response. */
async function classifyFailures(
  failing: ReadonlyArray<SweFailureRow>,
  model: string,
  llm: LlmClientOptions,
  systemPrompt: string | undefined,
): Promise<Map<string, FailureClassificationWire>> {
  const system = [
    'You are a senior SWE-bench failure analyst. Each block below is one held-out',
    'coding task the agent FAILED (the official judge marked it unresolved). Classify',
    'why each one failed into EXACTLY ONE mechanism from this closed set:',
    `  ${FAILURE_MECHANISMS.join(', ')}.`,
    'Definitions: empty-patch = the worker produced no diff at all; wrong-file-or-function =',
    'it edited code, but not the site the failure lives in; no-reproduction = it edited without',
    'first reproducing the failing behavior; patch-doesnt-apply = its diff is malformed / does not',
    'apply; regression = it changed the target but broke other behavior; gave-up-early = it yielded',
    'before spending its budget on a real attempt; other = none of the above fits.',
    'For each task return its instanceId, the single best mechanism, and a ONE-LINE evidence quote',
    '(≤160 chars) drawn from the shown patch/notes that justifies the label. Return JSON only.',
  ].join('\n')

  const specBlock = systemPrompt?.trim()
    ? `The agent was driven with this system prompt:\n${systemPrompt.trim()}\n\n`
    : ''
  const taskBlocks = failing.map((row) => renderFailureBlock(row)).join('\n\n')
  const user = `${specBlock}Failed tasks:\n\n${taskBlocks}\n\nClassify every task above.`

  const { value } = await callLlmJson<{ classifications?: FailureClassificationWire[] }>(
    {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0,
      jsonSchema: {
        name: 'swe_failure_classifications',
        schema: {
          type: 'object',
          properties: {
            classifications: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  instanceId: { type: 'string' },
                  mechanism: { type: 'string', enum: [...FAILURE_MECHANISMS] },
                  evidence: { type: 'string' },
                },
                required: ['instanceId', 'mechanism'],
              },
            },
          },
          required: ['classifications'],
        },
      },
    },
    llm,
  )

  const byId = new Map<string, FailureClassificationWire>()
  for (const c of value.classifications ?? []) {
    if (c?.instanceId) byId.set(c.instanceId, c)
  }
  return byId
}

/** Compact per-instance evidence block for the analyst: id, patch size (a `0`
 *  is itself the empty-patch signal), a truncated patch when the text is
 *  present, plus any captured notes / judge error. */
function renderFailureBlock(row: SweFailureRow): string {
  const id = rowId(row)
  const bytes = row.patch !== undefined ? row.patch.length : (row.patchBytes ?? 0)
  const lines = [`[${id}] patchBytes=${bytes}`]
  if (row.judgeError) lines.push(`judgeError: ${row.judgeError}`)
  if (row.patch !== undefined) {
    const body = row.patch.trim()
    lines.push(
      body
        ? `patch:\n${body.slice(0, PATCH_EVIDENCE_LIMIT)}${body.length > PATCH_EVIDENCE_LIMIT ? '\n… (truncated)' : ''}`
        : 'patch: (empty)',
    )
  }
  if (row.notes?.trim()) lines.push(`notes: ${row.notes.trim().slice(0, 800)}`)
  return lines.join('\n')
}

/** Coerce the analyst's label into the closed vocabulary; an empty patch is
 *  authoritative regardless of what the model said. */
function normalizeMechanism(raw: string | undefined, row: SweFailureRow): FailureMechanism {
  const bytes = row.patch !== undefined ? row.patch.trim().length : (row.patchBytes ?? 0)
  if (bytes === 0) return 'empty-patch'
  const key = (raw ?? '').trim().toLowerCase()
  return (FAILURE_MECHANISMS as readonly string[]).includes(key)
    ? (key as FailureMechanism)
    : 'other'
}

/** A deterministic evidence line when the analyst returned none. */
function defaultEvidence(row: SweFailureRow): string {
  const bytes = row.patch !== undefined ? row.patch.trim().length : (row.patchBytes ?? 0)
  if (bytes === 0) return 'the worker finished without producing any diff'
  if (row.judgeError) return `judge error: ${row.judgeError}`
  return `patch of ${bytes} bytes did not resolve the task`
}

/** Map a mechanism's share of failures (and its rank) to a severity. The
 *  dominant mode is `high`, a substantial secondary `medium`, the long tail
 *  `low`. */
function severityForShare(share: number, rank: number): AnalystSeverity {
  if (rank === 0 || share >= 0.5) return 'high'
  if (share >= 0.25) return 'medium'
  return 'low'
}

/** `id` is the runner's field; `instanceId` an accepted alias. */
function rowId(row: SweFailureRow): string {
  return row.instanceId ?? row.id ?? '(unknown-instance)'
}

// ---------------------------------------------------------------------------
// Reflective proposer — the two `promptGenerator` seams, driven by the shipped
// senior optimizer method off the autopsy findings.
// ---------------------------------------------------------------------------

export interface ReflectiveSweOptions {
  /** Router transport. Provide this OR `baseUrl` + `key`. */
  llm?: LlmClientOptions
  baseUrl?: string
  key?: string
  /** Author model. `reflectModel` wins when both are set. */
  model?: string
  reflectModel?: string
  /** How many candidate drafts the refine arm authors. Default 3. */
  populationSize?: number
  /** Authoring temperature. Refine defaults to 0.4 (targeted); the diverse-seed
   *  arm overrides to a higher spread. */
  temperature?: number
}

/** Wire shape of one authored candidate from the reflective author. */
interface ReflectiveDraftWire {
  instruction: string
  targetsMechanism?: string
  hypothesis?: string
  predictedMechanism?: string
  framing?: string
}

/**
 * REFLECTIVE REFINE — a `promptGenerator` `refine(ctx)` seam. Reads the autopsy
 * `ctx.findings`, drives the SHIPPED `optimizerMethod` to author
 * `populationSize` standing-instruction candidates, each aimed at the dominant
 * failure mode(s) and each carrying a hypothesis + predicted mechanism in its
 * rationale. Returns `PromptDraft[]`. Factory form (closes over the transport)
 * because the seam type carries none — the same shape as `gepaRefine`.
 */
export function reflectiveSweRefine(opts: ReflectiveSweOptions): RefinePrompt {
  const llm = resolveLlm(opts)
  const model = opts.reflectModel ?? opts.model ?? defaultReflectModel
  const population = opts.populationSize ?? 3
  const temperature = opts.temperature ?? 0.4

  return async (ctx: GenerateContext): Promise<PromptDraft[]> => {
    const wire = await authorFromFindings(ctx, population, {
      llm,
      model,
      temperature,
      diverse: false,
    })
    return wire.map((c, i) => toRefineDraft(c, i))
  }
}

/**
 * DIVERSE SEEDS — a `promptGenerator` `authorDiverseSeeds(ctx, count)` seam. Same
 * finding-grounded authoring as `reflectiveSweRefine`, but each candidate is
 * REQUIRED to take a genuinely different framing so the population spans basins
 * instead of polishing one — the local-minimum escape arm. Factory form,
 * mirroring `routerSeedAuthor`; the returned callback is `(ctx, count)`.
 */
export function authorDiverseSweSeeds(opts: ReflectiveSweOptions): AuthorDiverseSeeds {
  const llm = resolveLlm(opts)
  const model = opts.reflectModel ?? opts.model ?? defaultReflectModel
  const temperature = opts.temperature ?? 1.0

  return async (ctx: GenerateContext, count: number): Promise<PromptDraft[]> => {
    const wire = await authorFromFindings(ctx, count, { llm, model, temperature, diverse: true })
    return wire.slice(0, count).map((c, i) => toSeedDraft(c, i))
  }
}

interface AuthorCall {
  llm: LlmClientOptions
  model: string
  temperature: number
  diverse: boolean
}

/** The shared LLM authoring call for both seams: embed `optimizerMethod`, render
 *  the ranked findings, ask for `count` finding-targeted instruction candidates. */
async function authorFromFindings(
  ctx: GenerateContext,
  count: number,
  call: AuthorCall,
): Promise<ReflectiveDraftWire[]> {
  const findingBlock = renderFindings(ctx.findings)
  const diverseClause = call.diverse
    ? 'CRITICAL: the candidates must NOT be paraphrases of each other — each MUST take a genuinely ' +
      'different framing (one imperative directive, one pre-flight checklist, one written ' +
      'failure-mode-first, one as a principle, …) so the search can escape a local optimum. '
    : 'Each candidate should sharpen the incumbent framing toward the dominant failure mode. '

  const system = [
    'You are a senior optimizer improving an autonomous SWE-bench coding agent by authoring',
    'standing instructions appended to its system prompt. Follow this method exactly:',
    '',
    optimizerMethod,
    '',
    'DELIVERABLE: candidate standing-instruction lines. Each candidate is ONE self-contained',
    'instruction (1–3 sentences) that will be appended to the agent system prompt and measured',
    'on held-out tasks you cannot see. Each MUST target the dominant failure mode(s) named in the',
    'findings, and MUST carry a hypothesis + the predicted mechanism it interrupts. Generalize the',
    'fix to the failure CLASS — never mention a specific instance id or file from the findings.',
    diverseClause,
    'Return JSON only.',
  ].join('\n')

  const user = [
    `Domain: ${ctx.domain}`,
    '',
    'Ranked failure findings from the autopsy (most failures first):',
    findingBlock || '(no findings captured — infer likely SWE failure modes for this domain)',
    '',
    `Author exactly ${count} candidate instruction line(s).`,
  ].join('\n')

  const { value } = await callLlmJson<{ candidates?: ReflectiveDraftWire[] }>(
    {
      model: call.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: call.temperature,
      jsonSchema: {
        name: 'reflective_swe_candidates',
        schema: {
          type: 'object',
          properties: {
            candidates: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  instruction: { type: 'string' },
                  targetsMechanism: { type: 'string' },
                  hypothesis: { type: 'string' },
                  predictedMechanism: { type: 'string' },
                  framing: { type: 'string' },
                },
                required: ['instruction', 'targetsMechanism'],
              },
            },
          },
          required: ['candidates'],
        },
      },
    },
    call.llm,
  )

  return (value.candidates ?? []).filter((c) => c?.instruction?.trim())
}

/** Render the ranked findings for the author prompt: mechanism, claim, the fix
 *  direction, and a representative evidence excerpt. */
function renderFindings(findings: ReadonlyArray<AnalystFinding>): string {
  return findings
    .map((f, i) => {
      const excerpt = f.evidence_refs.find((e) => e.excerpt?.trim())?.excerpt?.trim()
      return [
        `${i + 1}. [${f.area}] ${f.claim} (severity=${f.severity})`,
        f.recommended_action ? `   fix direction: ${f.recommended_action}` : undefined,
        excerpt ? `   evidence: "${excerpt}"` : undefined,
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n')
}

function toRefineDraft(c: ReflectiveDraftWire, i: number): PromptDraft {
  const mechanism = (c.targetsMechanism ?? c.predictedMechanism ?? 'failure-mode').trim()
  return {
    instruction: c.instruction.trim(),
    label: `refine:${mechanism || 'failure-mode'}`,
    rationale: buildRationale(c, mechanism, `finding-targeted rewrite #${i + 1}`),
  }
}

function toSeedDraft(c: ReflectiveDraftWire, i: number): PromptDraft {
  const mechanism = (c.targetsMechanism ?? c.predictedMechanism ?? 'failure-mode').trim()
  const framing = c.framing?.trim()
  return {
    instruction: c.instruction.trim(),
    label: framing ? `seed:${framing}` : `seed:${mechanism || `fresh-${i + 1}`}`,
    rationale: buildRationale(
      c,
      mechanism,
      `diverse seed #${i + 1}${framing ? ` (${framing})` : ''}`,
    ),
  }
}

/** Compose the auditable rationale — it MUST name the failure mode the draft
 *  targets so a promotion decision can be read against the autopsy. */
function buildRationale(c: ReflectiveDraftWire, mechanism: string, fallback: string): string {
  const parts: string[] = []
  parts.push(`targets ${mechanism || 'failure-mode'}`)
  if (c.hypothesis?.trim()) parts.push(`hypothesis: ${c.hypothesis.trim()}`)
  if (c.predictedMechanism?.trim() && c.predictedMechanism.trim() !== mechanism) {
    parts.push(`predicted mechanism: ${c.predictedMechanism.trim()}`)
  }
  return parts.length > 1
    ? parts.join('; ')
    : `${fallback} — targets ${mechanism || 'failure-mode'}`
}

/** Build the router transport from either a full `llm` or discrete
 *  `baseUrl` + `key`. */
function resolveLlm(opts: {
  llm?: LlmClientOptions
  baseUrl?: string
  key?: string
  signal?: AbortSignal
}): LlmClientOptions {
  if (opts.llm) return opts.llm
  return {
    ...(opts.baseUrl === undefined ? {} : { baseUrl: opts.baseUrl }),
    ...(opts.key === undefined ? {} : { apiKey: opts.key }),
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
  }
}
