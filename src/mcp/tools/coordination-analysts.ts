import type { AnalystFinding, TraceAnalysisStore } from '@tangle-network/agent-eval'
import type { AgentProfile } from '@tangle-network/agent-interface'
import type { Spend, WorkerTraceEvidence } from '../../runtime'

/**
 * What one analyst lens may return.
 *
 * Two shapes, because two real producers exist and neither can be dropped. An eval-registry lens
 * returns validated `AnalystFinding`s — the schema every upstream consumer already reads. An
 * authored lens like `failuresAnalyst` returns a written brief for the driver and has no findings
 * to validate against. The union names both, so the boundary can no longer silently accept an
 * unvalidated shape (#630) while the authored lens keeps working.
 */
export type AnalystLensOutput = ReadonlyArray<AnalystFinding> | { readonly summary: string }

/** One lens on the menu `list_analysts` shows and `run_analyst` resolves. */
export interface AnalystKind {
  readonly id: string
  readonly description: string
  readonly area: string
}

/**
 * The trace-tool sets a DEFINED analyst may ask for — the exact group names agent-eval's
 * `buildTraceToolsForGroup` accepts, restated here so the `define_analyst` JSON Schema can
 * enumerate them for the model that writes one. Named, not free-form, because the group is the
 * lens's cost ceiling: `all` grants seven trace tools, `discovery` grants three and no deep reads.
 * A name eval does not know throws at registration, which is where the two lists are held together.
 */
export const analystToolGroupNames = [
  'all',
  'discovery',
  'discoveryAndRead',
  'discoveryAndSearch',
  'targeted',
  'singleTrace',
] as const

export type AnalystToolGroupName = (typeof analystToolGroupNames)[number]

/** Bounds on the recursive investigation a defined analyst may run. Each field is optional and is
 *  clamped to {@link ANALYST_DEFINITION_BOUNDS}; omitted fields take the engine's own default. */
export interface AuthoredAnalystLimits {
  readonly maxIterations?: number
  readonly maxLlmCalls?: number
  readonly maxToolCalls?: number
  readonly maxOutputChars?: number
}

/**
 * A trace analyst a MANAGER authored at run time: the research question, the policy for answering
 * it, the trace tools it may use, and the model seat it asks for. Data only.
 *
 * DATA, NEVER CODE, is the whole safety argument. `TraceAnalystDefinition` (agent-eval) also
 * carries `prepareContext` and `postProcess` FUNCTIONS; those are host-authored and are deliberately
 * absent here, because accepting a function from a tool argument would mean executing model-written
 * code inside the coordination handler — the one thing every other verb in this file refuses. What a
 * manager can author is exactly what a prompt can say.
 *
 * The model seat is PROPOSED, not granted: {@link AnalystRegistry.register} resolves `model` to an
 * engine and may refuse it, the same way `preflightSpawn` refuses a worker's model route.
 */
export interface AuthoredAnalystDefinition {
  /** Stable lens id. Lowercase, digits and hyphens; it becomes the `kind` passed to `run_analyst`
   *  and the `analyst_id` on every finding, so it is the attribution key. */
  readonly id: string
  /** One line naming what this lens looks for — what `list_analysts` shows the next manager. */
  readonly description: string
  /** The finding area this lens reports under (e.g. `coordination`, `tool-use`, `cost`). */
  readonly area: string
  /** The research question, in the manager's own words. */
  readonly question: string
  /** How to answer it: evidence rules, what counts as a finding, what to refuse to infer. */
  readonly instructions: string
  readonly toolGroup: AnalystToolGroupName
  /** The model seat the lens should run on. Omit to take the run's default analyst engine. */
  readonly model?: string
  readonly limits?: AuthoredAnalystLimits
  /** Minimum distinct evidence citations per finding. Default 1. */
  readonly minimumEvidenceCitations?: number
}

/** Every bound `define_analyst` enforces before a definition reaches a registry.
 *
 *  MOTIVE, stated as numbers, because a fence whose motive cannot be stated is over-engineering:
 *  a defined lens spends real model calls from the run's own account on every settle it is routed
 *  over, and its `instructions` are re-sent on every one of them. So the two fields that multiply
 *  — `instructions` bytes and `maxLlmCalls` — are the ones with hard ceilings, and the ceilings are
 *  twice agent-eval's own defaults (`maxIterations` 12, `maxLlmCalls` 8, `maxToolCalls` 48,
 *  `maxOutputChars` 10_000): enough headroom for a deeper question than the shipped lenses ask,
 *  not enough for one definition to become the dominant cost of a run. */
export const ANALYST_DEFINITION_BOUNDS = Object.freeze({
  idPattern: /^[a-z0-9][a-z0-9-]{1,63}$/,
  maxDescriptionChars: 300,
  maxAreaChars: 64,
  maxQuestionChars: 1_000,
  maxInstructionsChars: 20_000,
  maxModelChars: 128,
  maxIterations: 24,
  maxLlmCalls: 16,
  maxToolCalls: 96,
  maxOutputChars: 20_000,
  maxEvidenceCitations: 10,
  /** Lenses ONE manager may define, counting those it defined in a PRIOR process of a durable run.
   *  This bounds MENU GROWTH, not spend: a definition costs nothing until `run_analyst` is called,
   *  so the failure it stops is a manager that keeps re-authoring a lens instead of running one —
   *  each definition adds a line every later `list_analysts` re-reads. Eight is more than the five
   *  calibrated lenses agent-eval ships. Per-run analyst SPEND is bounded by the conserved pool the
   *  engine draws from, not here. */
  maxDefinitionsPerManager: 8,
})

/** What the coordination layer records when a definition is admitted: the exact accepted bytes, the
 *  kind the registry returned, and a digest over the definition so a finding can be traced back to
 *  the words that produced it. */
export interface DefinedAnalystRecord {
  readonly definition: AuthoredAnalystDefinition
  readonly kind: AnalystKind
  /** Canonical digest of `definition` — the reproducibility key. */
  readonly digest: string
  readonly definedAt: number
}

/** What the coordination layer hands one registry lens run. */
export interface AnalystRunContext {
  /**
   * Charge the model spend this lens run made to the run's conserved pool — the pool an agent
   * analyst reserves from. A registry whose lens calls a model calls this with the spend it
   * measured; unknown tokens or dollars stay explicitly unknown. The spend is journaled as
   * Runtime-owned accounting. Under a dollar ceiling an unknown dollar cost closes the pool's
   * dollar admission, as an agent analyst's unknown cost does, and the lens keeps its findings.
   */
  readonly charge: (spend: Spend) => Promise<void>
}

export interface AnalystRegistry {
  readonly kinds: ReadonlyArray<AnalystKind>
  /** Run one lens. THROWING is the failure channel: it is published as `{ analystRunFailed }`. */
  readonly run: (
    kindId: string,
    trace: TraceAnalysisStore,
    context?: AnalystRunContext,
  ) => Promise<AnalystLensOutput>
  /**
   * OPT-IN: admit a MANAGER-AUTHORED lens while the run is in flight, so a driver can change the
   * questions asked of its own children's traces instead of picking from a menu fixed before the
   * run started. Present = `define_analyst` is mounted; absent = the menu is fixed (the status quo).
   *
   * The coordination layer validates and bounds the definition first (see
   * {@link ANALYST_DEFINITION_BOUNDS}) and refuses a duplicate id, so an implementation receives
   * only well-formed, in-bounds definitions. It returns the {@link AnalystKind} the lens is now
   * reachable as; `run_analyst` must resolve that id immediately afterwards. THROWING is the
   * refusal channel — an unavailable model seat, a policy that forbids authored lenses — and the
   * message reaches the manager as the tool result's `reason`, so it can re-author.
   */
  readonly register?: (definition: AuthoredAnalystDefinition) => Promise<AnalystKind> | AnalystKind
}

/** A trace-analyst result re-entered as a message on the bus (the `finding` event kind). */
export interface AnalystFindingEvent {
  readonly fromWorker: string
  readonly analyst: string
  /** Native analyst execution that produced this review, when this is an agent route. */
  readonly analystWorkerId?: string
  readonly assignmentId?: string
  /** The analyst's result. ABSENT when the analyst returned `undefined` (no findings); any other
   *  value is canonicalized to finite RFC 8785 JSON at publish (`canonicalFindingEvent`), so
   *  digesting subscribers (the coordination-event id) never throw on analyst-shaped data. */
  readonly findings?: unknown
}

/** Producer-side cleanliness for the `finding` event. The findings payload is arbitrary analyst
 *  output, the digest a subscriber computes (RFC 8785) throws on ANY `undefined` value — nested
 *  included — and a throwing subscriber leaves the event invisible to EVERY subscriber. The
 *  producer, not the digest, owns keeping the event canonical: an `undefined` payload is stripped
 *  to key-absence, everything else is JSON round-tripped (nested `undefined` object values drop,
 *  `undefined` array slots become `null`), and a payload JSON cannot represent at all (cycle,
 *  BigInt, bare function) becomes a record OF that fact — degraded findings beat a vanished
 *  event. */
export function canonicalFindingEvent(finding: AnalystFindingEvent): AnalystFindingEvent {
  if (finding.findings === undefined) {
    const { findings: _absent, ...present } = finding
    return present
  }
  try {
    // JSON.stringify returns undefined (not a string) for a bare function/symbol payload;
    // JSON.parse then throws, landing in the same non-canonical fallback as cycles and BigInt.
    return { ...finding, findings: JSON.parse(JSON.stringify(finding.findings)) as unknown }
  } catch (error) {
    return {
      ...finding,
      findings: { nonCanonicalFindings: error instanceof Error ? error.message : String(error) },
    }
  }
}

/**
 * One analyst-on-settle ROUTE: which lens runs (`kind`), over WHICH settled workers (`over`),
 * delivered to WHOM (`to`), wrapped in WHAT standing instruction (`directive`). The generalized
 * form of the bare-string entry — a string `k` is exactly `{ kind: k }`: every settle feeds the
 * lens and the findings go to the driver via the bus. This is the analyzes-edge of an agent
 * graph expressed at the coordination layer; the finding is ALWAYS also published on the bus
 * (the audit trail), routing adds delivery, never replaces the record.
 */
export interface AnalyzeOnSettleRoute {
  /** Analyze this manager's final output and settled-child references before it closes.
   * Requires an agent route; omitted means each eligible worker settlement. */
  readonly at?: 'worker' | 'manager-end'
  /** Worker outcomes admitted to this route. Defaults to done; down includes failed attempts. */
  readonly statuses?: ReadonlyArray<'done' | 'down'>
  /** The analyst id: a lens id resolved against the `analysts` registry, or — when `agent` is
   *  present — the AGENT analyst's stable identity carried on its finding/steer events (it need
   *  not exist in any registry). */
  readonly kind: string
  /**
   * Make this analyst a tool-equipped AGENT instead of a registry lens: on each matching settle
   * the runtime spawns this profile as a WORKER through the SAME spawn machinery a driver spawn
   * uses (`Scope.spawn` + the run's `makeWorkerAgent` seam) — so its spend reserves from the
   * conserved pool, its node is journaled and traced like any worker, and a node-pinning seam
   * sees the spawn context marker (`WorkerSpawnContext.analyst`). Its task is `directive` plus
   * the settled worker's tool-trace evidence; its settle OUTPUT is the findings, published as a
   * `finding` event (same canonicalization) and delivered per `to` exactly like registry-analyst
   * findings. A settle that failed publishes `{ analystRunFailed }`; a spawn the pool or fences
   * refuse publishes `{ analystSpawnRefused }` — observable, never a silent drop. An agent
   * analyst's settlement never enters the settled-worker ledger, never feeds the finalizer, and
   * never re-fires the analyst-on-settle hook (no analyst-on-analyst cascade by construction).
   */
  readonly agent?: AgentProfile
  /** Deliver the findings to this live worker, named by its PROFILE NAME (the stable node
   *  identity a graph pins) or its spawn label. Omit = the driver (bus only). Delivery goes
   *  through the same authorization + steer machinery a driver-authored steer uses and is
   *  recorded as a `steer` event carrying `analyst`, so a routed delivery is observable and a
   *  failed one (`delivered: false`) is a recorded outcome, never a silent drop. */
  readonly to?: string
  /** Standing instruction wrapped around the findings on a routed delivery — what the recipient
   *  should DO with the analysis. For an AGENT analyst (`agent` set) it is instead the analysis
   *  directive handed to the agent as its task; the routed delivery then carries the bare
   *  findings, because the directive was already consumed upstream. Omit = the bare findings
   *  JSON (and, for an agent analyst, a task of evidence only). */
  readonly directive?: string
  /** Restrict which settled workers feed this lens, by profile name or spawn label. Omit =
   *  every settled `done` worker. */
  readonly over?: ReadonlyArray<string>
}

/** Exact analyst assignment recorded before execution. The existing spawn journal retains the
 * profile and task bytes; these digests bind the review to those bytes and its source evidence. */
export interface AnalystAssignmentRecord {
  readonly assignmentId: string
  readonly kind: string
  readonly sourceWorker: string
  /** Complete retained source envelope behind the analyst task's bounded excerpt. */
  readonly sourceEvidenceRef?: string
  readonly sourceTrace: WorkerTraceEvidence
  readonly sourceOutRef?: string
  readonly profileDigest: string
  readonly taskDigest: string
  readonly directive?: string
  readonly to?: string
}

/** One rejected field of an authored analyst definition: which field, and what is wrong with it. */
interface AnalystDefinitionIssue {
  readonly path: string
  readonly message: string
}

/**
 * Validate and BOUND one `define_analyst` argument.
 *
 * Every reason is collected, never short-circuited: a manager re-authoring from a partial list of
 * complaints spends a turn per complaint. Numeric limits are CLAMPED rather than rejected — asking
 * for 200 tool calls is a mis-estimate, not a malformed definition, and the accepted value is
 * returned so the manager reads the ceiling it actually got.
 */
export function parseAuthoredAnalystDefinition(
  raw: unknown,
): { definition: AuthoredAnalystDefinition } | { issues: ReadonlyArray<AnalystDefinitionIssue> } {
  const issues: AnalystDefinitionIssue[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { issues: [{ path: 'definition', message: 'must be an object' }] }
  }
  const o = raw as Record<string, unknown>
  const bounds = ANALYST_DEFINITION_BOUNDS

  const text = (field: string, max: number): string => {
    const value = o[field]
    if (typeof value !== 'string' || value.trim().length === 0) {
      issues.push({ path: field, message: 'is required and must be a non-empty string' })
      return ''
    }
    const trimmed = value.trim()
    if (trimmed.length > max) {
      issues.push({
        path: field,
        message: `must be at most ${max} characters (received ${trimmed.length})`,
      })
      return ''
    }
    return trimmed
  }

  const id = text('id', 64)
  if (id.length > 0 && !bounds.idPattern.test(id)) {
    issues.push({
      path: 'id',
      message:
        'must be 2-64 characters of lowercase letters, digits and hyphens, starting with a letter or digit',
    })
  }
  const description = text('description', bounds.maxDescriptionChars)
  const area = text('area', bounds.maxAreaChars)
  const question = text('question', bounds.maxQuestionChars)
  const instructions = text('instructions', bounds.maxInstructionsChars)

  const toolGroup = o.toolGroup
  if (!(analystToolGroupNames as ReadonlyArray<unknown>).includes(toolGroup)) {
    issues.push({
      path: 'toolGroup',
      message: `must be one of ${analystToolGroupNames.join(', ')}`,
    })
  }

  let model: string | undefined
  if (o.model !== undefined) {
    if (typeof o.model !== 'string' || o.model.trim().length === 0) {
      issues.push({ path: 'model', message: 'must be a non-empty string when present' })
    } else if (o.model.length > bounds.maxModelChars) {
      issues.push({ path: 'model', message: `must be at most ${bounds.maxModelChars} characters` })
    } else {
      model = o.model.trim()
    }
  }

  const clampedLimit = (
    field: keyof AuthoredAnalystLimits,
    max: number,
    source: Record<string, unknown>,
  ): number | undefined => {
    const value = source[field]
    if (value === undefined) return undefined
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
      issues.push({ path: `limits.${field}`, message: 'must be a positive integer' })
      return undefined
    }
    return Math.min(value, max)
  }
  let limits: AuthoredAnalystLimits | undefined
  if (o.limits !== undefined) {
    if (!o.limits || typeof o.limits !== 'object' || Array.isArray(o.limits)) {
      issues.push({ path: 'limits', message: 'must be an object' })
    } else {
      const source = o.limits as Record<string, unknown>
      const knownLimits = new Set([
        'maxIterations',
        'maxLlmCalls',
        'maxToolCalls',
        'maxOutputChars',
      ])
      for (const key of Object.keys(source)) {
        if (!knownLimits.has(key)) {
          issues.push({
            path: `limits.${key}`,
            message: `is not an investigation limit (accepted: ${[...knownLimits].join(', ')})`,
          })
        }
      }
      const maxIterations = clampedLimit('maxIterations', bounds.maxIterations, source)
      const maxLlmCalls = clampedLimit('maxLlmCalls', bounds.maxLlmCalls, source)
      const maxToolCalls = clampedLimit('maxToolCalls', bounds.maxToolCalls, source)
      const maxOutputChars = clampedLimit('maxOutputChars', bounds.maxOutputChars, source)
      const present = {
        ...(maxIterations === undefined ? {} : { maxIterations }),
        ...(maxLlmCalls === undefined ? {} : { maxLlmCalls }),
        ...(maxToolCalls === undefined ? {} : { maxToolCalls }),
        ...(maxOutputChars === undefined ? {} : { maxOutputChars }),
      }
      if (Object.keys(present).length > 0) limits = present
    }
  }

  let minimumEvidenceCitations: number | undefined
  if (o.minimumEvidenceCitations !== undefined) {
    const value = o.minimumEvidenceCitations
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
      issues.push({ path: 'minimumEvidenceCitations', message: 'must be a positive integer' })
    } else {
      minimumEvidenceCitations = Math.min(value, bounds.maxEvidenceCitations)
    }
  }

  // A field this contract does not name is refused rather than dropped: a manager that passed
  // `prepareContext` must learn the lens will not run its code, not silently get a lens without it.
  const known = new Set([
    'id',
    'description',
    'area',
    'question',
    'instructions',
    'toolGroup',
    'model',
    'limits',
    'minimumEvidenceCitations',
  ])
  for (const key of Object.keys(o)) {
    if (!known.has(key)) {
      issues.push({
        path: key,
        message: `is not part of an authored analyst definition (accepted: ${[...known].join(', ')})`,
      })
    }
  }

  if (issues.length > 0) return { issues }
  return {
    definition: Object.freeze({
      id,
      description,
      area,
      question,
      instructions,
      toolGroup: toolGroup as AnalystToolGroupName,
      ...(model === undefined ? {} : { model }),
      ...(limits === undefined ? {} : { limits: Object.freeze(limits) }),
      ...(minimumEvidenceCitations === undefined ? {} : { minimumEvidenceCitations }),
    }),
  }
}

/** Normalize the two spellings of an analyst-on-settle entry to the route form. */
export function normalizeAnalyzeOnSettle(
  entry: string | AnalyzeOnSettleRoute,
): AnalyzeOnSettleRoute {
  const route = typeof entry === 'string' ? { kind: entry } : entry
  if (route.at !== undefined && route.at !== 'worker' && route.at !== 'manager-end') {
    throw new TypeError('analyzeOnSettle.at must be worker or manager-end')
  }
  if (route.at === 'manager-end' && route.agent === undefined) {
    throw new TypeError('manager-end analysis requires an agent profile')
  }
  if (
    route.statuses !== undefined &&
    (!Array.isArray(route.statuses) ||
      route.statuses.length === 0 ||
      route.statuses.some((status) => status !== 'done' && status !== 'down'))
  ) {
    throw new TypeError('analyzeOnSettle.statuses must contain done or down')
  }
  return route
}

export interface AnalystRunInFlight {
  readonly route: Pick<AnalyzeOnSettleRoute, 'kind' | 'to'>
  readonly sourceWorker: string
  readonly assignmentId: string
}
