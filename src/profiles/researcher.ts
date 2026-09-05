/**
 * Opinionated preset for source-grounded research
 * tasks. The agent is told to:
 *   - bound its work to a single `knowledgeNamespace`
 *   - emit `items[]` carrying provenance + confidence
 *   - emit `citations[]` linking quotes back to source urls
 *   - emit `proposedWrites[]` — never call materialize itself
 *   - describe `gaps` it could not answer
 *
 * The profile is stateless and agent-agnostic. The caller supplies the exact execution profile;
 * this preset adds only the researcher prompt, tools, parser, and validator.
 *
 * Propose-don't-apply: the profile NEVER writes to the knowledge base.
 * It produces `proposedWrites: KnowledgeUpdate[]` in the output. The
 * caller (gtm-agent, journey-eval, user) decides whether to feed those
 * updates through `applyKnowledgeWriteBlocks` / a KbStore put.
 *
 * Namespace isolation: every `KnowledgeItem` + `KnowledgeUpdate` in the
 * output carries `namespace`. The validator hard-fails when any item
 * touches a namespace other than `task.knowledgeNamespace`.
 *
 * @experimental
 */

import { type AgentProfile, agentProfileSchema } from '@tangle-network/agent-interface'
import type { SandboxEvent } from '@tangle-network/sandbox'
import { ConfigError } from '../errors'
import { assertExecutableAgentProfile } from '../runtime/supervise/model-policy'
import type {
  AgentRunSpec,
  DefaultVerdict,
  Driver,
  OutputAdapter,
  Validator,
} from '../runtime/types'

/** Source families a researcher profile may prefer for a task. One owner: the delegation
 *  vocabulary (`DelegateResearchArgs.sources`) re-exports this type rather than restating it.
 *  @experimental */
export type ResearchSource = 'web' | 'corpus' | 'twitter' | 'github' | 'docs'

/** Task contract for a source-grounded research agent. @experimental */
export interface ResearchTask {
  /** The research question to answer. */
  question: string
  /** Bound: e.g. "audience for cpg-founder ICP". */
  scope?: string
  /** Multi-tenant scope (customer-id, workspace-id). Validator enforces. */
  knowledgeNamespace: string
  sources?: ResearchSource[]
  recencyWindow?: { since?: Date; until?: Date }
  maxItems?: number
  /** Per-item minimum confidence in [0, 1]. Validator scores recall vs this. */
  minConfidence?: number
}

/**
 * Knowledge item emitted by the researcher.
 *
 * Profile-local type. When agent-knowledge promotes `KnowledgeClaim` →
 * top-level `KnowledgeItem` substrate-wide, these fields collapse 1:1.
 *
 * @experimental
 */
export interface KnowledgeItem {
  id: string
  /** Multi-tenant scope. MUST equal `task.knowledgeNamespace`. */
  namespace: string
  /** The factual claim, in the researcher's words. */
  claim: string
  /** Provenance — at least one entry required. */
  evidence: Array<{ source: string; quote?: string; url?: string; capturedAt: number }>
  /** Researcher's self-reported confidence in [0, 1]. */
  confidence: number
  /** Prior item ids this supersedes (chain). */
  supersedes?: string[]
  /** Set if the agent is retracting an earlier item. Unix ms. */
  retractedAt?: number
  authoredBy: { kind: 'human' | 'agent'; id: string }
}

/**
 * A proposed write to the knowledge base. The profile does NOT apply
 * these — the caller decides.
 *
 * @experimental
 */
export type KnowledgeUpdate =
  | { kind: 'insert'; namespace: string; item: KnowledgeItem }
  | { kind: 'supersede'; namespace: string; previousId: string; item: KnowledgeItem }
  | { kind: 'retract'; namespace: string; itemId: string; reason: string }

/**
 * Researcher output. Required fields are typed; optional fields preserve
 * the agent's free-form intelligence (`notes`, `raw`). The validator
 * enforces the typed minimum.
 *
 * @experimental
 */
export interface ResearchOutput {
  items: KnowledgeItem[]
  citations: Array<{ url: string; quote: string; confidence: number }>
  proposedWrites: KnowledgeUpdate[]
  gaps?: string[]
  notes?: string
  /** Anything the agent emitted beyond the typed fields. */
  raw?: unknown
}

/** Options for the source-grounded researcher profile preset. @experimental */
export interface ResearcherProfileOptions {
  /** Caller-owned exact harness/provider/model identity. */
  profile: AgentProfile
  /** Custom system prompt replacement. Default = built-in researcher preset. */
  systemPrompt?: string
  /** Stable name for `AgentRunSpec.name`. Default = `profile.name`. */
  name?: string
  /**
   * Default 0.7. Minimum (citations with quote) / items ratio for `valid=true`.
   * Below this floor, citation_density scores < 1 and the item set is gated.
   */
  citationDensityMin?: number
}

const DEFAULT_CITATION_DENSITY_MIN = 0.7

/** Build a source-grounded researcher profile with output parsing and validation. @experimental */
export function researcherProfile(options: ResearcherProfileOptions & { task?: ResearchTask }): {
  profile: AgentProfile
  taskToPrompt: (task: ResearchTask) => string
  output: OutputAdapter<ResearchOutput>
  validator: Validator<ResearchOutput>
  agentRunSpec: AgentRunSpec<ResearchTask>
} {
  const base = agentProfileSchema.parse(options.profile) as AgentProfile
  assertExecutableAgentProfile(base, 'researcherProfile')
  const name = options.name ?? base.name
  const systemPrompt = options.systemPrompt ?? RESEARCHER_SYSTEM_PROMPT
  const citationDensityMin = options.citationDensityMin ?? DEFAULT_CITATION_DENSITY_MIN
  const profile: AgentProfile = {
    ...base,
    name,
    description: base.description ?? "Source-grounded research agent. Propose-don't-apply.",
    prompt: { ...base.prompt, systemPrompt },
    tools: { web_search: true, fs: true, shell: true, ...base.tools },
    metadata: { ...base.metadata, specialty: 'researcher' },
  }
  const output: OutputAdapter<ResearchOutput> = { parse: parseResearcherEvents }
  const validator: Validator<ResearchOutput> = options.task
    ? createResearcherValidator(options.task, { citationDensityMin })
    : createResearcherValidator(
        { question: '', knowledgeNamespace: '' },
        { citationDensityMin, namespaceCheck: false },
      )
  const agentRunSpec: AgentRunSpec<ResearchTask> = {
    name,
    profile,
    taskToPrompt: formatResearcherPrompt,
  }
  return { profile, taskToPrompt: formatResearcherPrompt, output, validator, agentRunSpec }
}

/** @experimental */
export interface MultiHarnessResearcherFanoutOptions {
  /** Exact execution profiles, one per parallel researcher. */
  profiles: ReadonlyArray<AgentProfile>
  /** Default citation density floor for the shared validator. */
  citationDensityMin?: number
  /** Optional task — narrows the validator's namespace check. */
  task?: ResearchTask
}

/**
 * Build a fanout topology over multiple harnesses. The kernel round-robins
 * `agentRuns` across the N parallel iterations and the `FanoutVote` driver
 * picks the highest-scoring valid output.
 *
 * @experimental
 */
export function multiHarnessResearcherFanout(options: MultiHarnessResearcherFanoutOptions): {
  agentRuns: AgentRunSpec<ResearchTask>[]
  output: OutputAdapter<ResearchOutput>
  validator: Validator<ResearchOutput>
  driver: Driver<ResearchTask, ResearchOutput, 'done'>
} {
  if (options.profiles.length === 0) {
    throw new ConfigError('multiHarnessResearcherFanout: at least one exact profile is required')
  }
  const agentRuns = options.profiles.map((profile) => {
    const { agentRunSpec } = researcherProfile({ profile })
    return agentRunSpec
  })
  const { output, validator } = researcherProfile({
    profile: options.profiles[0]!,
    citationDensityMin: options.citationDensityMin,
    task: options.task,
  })
  // Single fanout round across the N harnesses, then stop: the kernel
  // round-robins `agentRuns` over the N branches and selects the winner
  // (best valid score) across all iterations via `defaultSelectWinner`.
  const driver: Driver<ResearchTask, ResearchOutput, 'done'> = {
    name: 'researcher-fanout',
    async plan(task, history) {
      return history.length === 0 ? Array.from({ length: agentRuns.length }, () => task) : []
    },
    // 'done' is a terminal decision in the kernel; the loop finalizes after
    // the single fanout round and selects the winner via `defaultSelectWinner`.
    decide() {
      return 'done'
    },
    describePlan() {
      return { kind: 'fanout' }
    },
  }
  return { agentRuns, output, validator, driver }
}

/**
 * Build a validator that closes over a specific `ResearchTask`'s constraints.
 *
 * Checks in order:
 *   1. Items must be non-empty.
 *   2. Every item carries `evidence.length >= 1`.
 *   3. Every item + proposedWrite is scoped to `task.knowledgeNamespace`
 *      (hard-fail on any namespace mismatch — defence in depth for the
 *      multi-tenant invariant).
 *   4. Citation density (citations with quote / items) >= floor.
 *
 * Aggregate score:
 *   0.4 · citation_density
 * + 0.2 · source_diversity (distinct sources / max(items, 1))
 * + 0.2 · recency_match (mean fraction within `recencyWindow`)
 * + 0.2 · (1 − gaps/maxGaps), maxGaps = max(items, 1)
 *
 * @experimental
 */
export function createResearcherValidator(
  task: ResearchTask,
  config: { citationDensityMin?: number; namespaceCheck?: boolean } = {},
): Validator<ResearchOutput> {
  const citationDensityMin = config.citationDensityMin ?? DEFAULT_CITATION_DENSITY_MIN
  const namespaceCheck = config.namespaceCheck ?? true
  return {
    async validate(output) {
      const notes: string[] = []
      const scores: Record<string, number> = {}
      let pass = true

      if (!Array.isArray(output.items) || output.items.length === 0) {
        pass = false
        notes.push('no items')
        scores.items = 0
      } else {
        scores.items = 1
      }

      const missingEvidence = (output.items ?? []).filter(
        (item) => !Array.isArray(item.evidence) || item.evidence.length === 0,
      )
      if (missingEvidence.length > 0) {
        pass = false
        notes.push(`${missingEvidence.length} item(s) without evidence`)
        scores.provenance = 0
      } else {
        scores.provenance = 1
      }

      if (namespaceCheck) {
        const foreignItems = (output.items ?? []).filter(
          (item) => item.namespace !== task.knowledgeNamespace,
        )
        const foreignWrites = (output.proposedWrites ?? []).filter(
          (write) => write.namespace !== task.knowledgeNamespace,
        )
        if (foreignItems.length > 0 || foreignWrites.length > 0) {
          pass = false
          notes.push(
            `namespace violation: ${foreignItems.length} item(s) + ${foreignWrites.length} write(s) ` +
              `outside ${task.knowledgeNamespace}`,
          )
          scores.namespace = 0
        } else {
          scores.namespace = 1
        }
      }

      const itemCount = Math.max(output.items?.length ?? 0, 1)
      const citationsWithQuote = (output.citations ?? []).filter(
        (citation) => typeof citation.quote === 'string' && citation.quote.length > 0,
      ).length
      const citationDensity = Math.min(1, citationsWithQuote / itemCount)
      if (citationDensity < citationDensityMin) {
        pass = false
        notes.push(
          `citation density ${citationDensity.toFixed(2)} below floor ${citationDensityMin.toFixed(2)}`,
        )
      }
      scores.citation_density = citationDensity

      const sourceSet = new Set<string>()
      for (const item of output.items ?? []) {
        for (const evidence of item.evidence ?? []) {
          if (evidence.source) sourceSet.add(evidence.source)
        }
      }
      scores.source_diversity = Math.min(1, sourceSet.size / itemCount)

      scores.recency_match = recencyMatchScore(output.items ?? [], task.recencyWindow)

      const maxGaps = itemCount
      const gapCount = output.gaps?.length ?? 0
      scores.gap_coverage = Math.max(0, 1 - gapCount / maxGaps)

      const score =
        0.4 * scores.citation_density +
        0.2 * scores.source_diversity +
        0.2 * scores.recency_match +
        0.2 * scores.gap_coverage

      const verdict: DefaultVerdict = {
        valid: pass,
        score: Number.isFinite(score) ? score : 0,
        scores,
      }
      if (notes.length > 0) verdict.notes = notes.join('; ')
      return verdict
    },
  }
}

function recencyMatchScore(items: KnowledgeItem[], window: ResearchTask['recencyWindow']): number {
  if (!window || (window.since === undefined && window.until === undefined)) return 1
  if (items.length === 0) return 0
  const sinceMs = window.since?.getTime() ?? Number.NEGATIVE_INFINITY
  const untilMs = window.until?.getTime() ?? Number.POSITIVE_INFINITY
  let hits = 0
  let total = 0
  for (const item of items) {
    for (const evidence of item.evidence ?? []) {
      if (typeof evidence.capturedAt !== 'number') continue
      total += 1
      if (evidence.capturedAt >= sinceMs && evidence.capturedAt <= untilMs) hits += 1
    }
  }
  return total === 0 ? 0 : hits / total
}

/** Built-in source-grounded research contract added to a caller-owned exact profile. */
export const RESEARCHER_SYSTEM_PROMPT = [
  'You are a research agent. Your job is to answer a research question with',
  'source-grounded knowledge items that the caller will choose whether to',
  'persist to a multi-tenant knowledge base.',
  '',
  'Hard rules:',
  "  1. Every item you emit MUST carry the task's knowledgeNamespace exactly.",
  '     Never write to a different namespace.',
  '  2. Every item MUST carry at least one evidence entry with a source.',
  '     A quote + url is strongly preferred; capturedAt is unix ms.',
  '  3. You propose writes — you do NOT apply them. The caller decides.',
  '  4. Self-report confidence honestly in [0, 1]. Do not inflate.',
  '  5. List what you could not answer in `gaps`. Better to admit a gap',
  '     than fabricate.',
  '',
  'When you finish, emit a single final structured message of the shape:',
  '  ```json',
  '  { "items": [{ "id": "...", "namespace": "...", "claim": "...",',
  '                "evidence": [{ "source": "...", "quote": "...",',
  '                               "url": "...", "capturedAt": 0 }],',
  '                "confidence": 0.0,',
  '                "authoredBy": { "kind": "agent", "id": "..." } }],',
  '    "citations": [{ "url": "...", "quote": "...", "confidence": 0.0 }],',
  '    "proposedWrites": [{ "kind": "insert", "namespace": "...",',
  '                         "item": { /* same shape as items[] */ } }],',
  '    "gaps": ["..."],',
  '    "notes": "free-form commentary" }',
  '  ```',
].join('\n')

function formatResearcherPrompt(task: ResearchTask): string {
  const sources = task.sources?.length ? task.sources.join(', ') : '(no preference)'
  const window = formatRecencyWindow(task.recencyWindow)
  return [
    `Question: ${task.question}`,
    `Knowledge namespace (DO NOT cross): ${task.knowledgeNamespace}`,
    `Scope: ${task.scope ?? '(unspecified)'}`,
    `Preferred sources: ${sources}`,
    `Recency window: ${window}`,
    `Max items: ${task.maxItems ?? '(no cap)'}`,
    `Per-item minimum confidence: ${task.minConfidence ?? '(no floor)'}`,
    '',
    'Produce knowledge items with provenance + citations + proposed writes.',
    'List gaps for anything you could not answer. Emit the final JSON',
    'result block exactly as instructed.',
  ].join('\n')
}

function formatRecencyWindow(window: ResearchTask['recencyWindow']): string {
  if (!window) return '(none)'
  const since = window.since ? window.since.toISOString() : '-∞'
  const until = window.until ? window.until.toISOString() : 'now'
  return `${since} .. ${until}`
}

/**
 * Walk the event stream and return the last structured `research.result`
 * payload. Falls back to scanning text deltas for a fenced JSON block.
 */
function parseResearcherEvents(events: SandboxEvent[]): ResearchOutput {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (!event) continue
    const type = String(event.type ?? '')
    const data = isRecord(event.data) ? event.data : {}
    if (type === 'result' || type === 'final' || type === 'research.result') {
      const direct = coerceResearchOutput(data.result ?? data.output ?? data)
      // opencode reports the agent's terminal answer in `finalText` (not result/output).
      // Parse it too, and prefer it when `direct` is an all-empty shape — otherwise an
      // event carrying both `{items:[],citations:[],proposedWrites:[]}` and a rich
      // finalText would silently drop the real answer.
      const finalText = pickString(data.finalText)
      const fenced = finalText ? extractFencedJson(finalText) : undefined
      const fromFinalText = fenced ? coerceResearchOutput(fenced) : undefined
      if (direct && !isEmptyOutput(direct)) return direct
      if (fromFinalText) return fromFinalText
      if (direct) return direct
    }
  }
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (!event) continue
    const data = isRecord(event.data) ? event.data : {}
    const text = pickString(data.text) ?? pickString(data.delta) ?? pickString(data.finalText)
    if (!text) continue
    const fenced = extractFencedJson(text)
    if (!fenced) continue
    const coerced = coerceResearchOutput(fenced)
    if (coerced) return coerced
  }
  return { items: [], citations: [], proposedWrites: [] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** A coerced output that carries no items, citations, or proposed writes. */
function isEmptyOutput(o: ResearchOutput): boolean {
  return o.items.length === 0 && o.citations.length === 0 && o.proposedWrites.length === 0
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function extractFencedJson(text: string): unknown | undefined {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (!match) return undefined
  const body = (match[1] ?? '').trim()
  if (!body) return undefined
  try {
    return JSON.parse(body)
  } catch {
    return undefined
  }
}

function coerceResearchOutput(value: unknown): ResearchOutput | undefined {
  if (!isRecord(value)) return undefined
  const items = coerceItems(value.items)
  const citations = coerceCitations(value.citations)
  const proposedWrites = coerceProposedWrites(value.proposedWrites)
  // Reject completely empty payloads — those signal "no result block",
  // not "a valid empty result".
  if (items === undefined && citations === undefined && proposedWrites === undefined) {
    return undefined
  }
  const output: ResearchOutput = {
    items: items ?? [],
    citations: citations ?? [],
    proposedWrites: proposedWrites ?? [],
  }
  if (Array.isArray(value.gaps)) {
    output.gaps = value.gaps.filter((entry): entry is string => typeof entry === 'string')
  }
  const notes = pickString(value.notes)
  if (notes) output.notes = notes
  // Preserve any extra fields the agent emitted that don't fit the typed
  // surface — callers can inspect `raw` without forcing them through the
  // typed coercion. We only include `raw` when the agent emitted fields
  // beyond the known set.
  const known = new Set(['items', 'citations', 'proposedWrites', 'gaps', 'notes'])
  const extras: Record<string, unknown> = {}
  let extrasCount = 0
  for (const [key, val] of Object.entries(value)) {
    if (known.has(key)) continue
    extras[key] = val
    extrasCount += 1
  }
  if (extrasCount > 0) output.raw = extras
  return output
}

function coerceItems(value: unknown): KnowledgeItem[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: KnowledgeItem[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const id = pickString(entry.id)
    const namespace = pickString(entry.namespace)
    const claim = pickString(entry.claim)
    const evidence = coerceEvidence(entry.evidence)
    const confidence = toFiniteNumber(entry.confidence)
    const authoredBy = coerceAuthoredBy(entry.authoredBy)
    if (!id || !namespace || !claim || !authoredBy) continue
    const item: KnowledgeItem = {
      id,
      namespace,
      claim,
      evidence,
      confidence: clamp01(confidence),
      authoredBy,
    }
    if (Array.isArray(entry.supersedes)) {
      item.supersedes = entry.supersedes.filter((s): s is string => typeof s === 'string')
    }
    const retractedAt = toFiniteNumber(entry.retractedAt)
    if (retractedAt > 0) item.retractedAt = retractedAt
    out.push(item)
  }
  return out
}

function coerceEvidence(value: unknown): KnowledgeItem['evidence'] {
  if (!Array.isArray(value)) return []
  const out: KnowledgeItem['evidence'] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const source = pickString(entry.source)
    if (!source) continue
    const item: KnowledgeItem['evidence'][number] = {
      source,
      capturedAt: toFiniteNumber(entry.capturedAt),
    }
    const quote = pickString(entry.quote)
    if (quote) item.quote = quote
    const url = pickString(entry.url)
    if (url) item.url = url
    out.push(item)
  }
  return out
}

function coerceAuthoredBy(value: unknown): KnowledgeItem['authoredBy'] | undefined {
  if (!isRecord(value)) return undefined
  const kind = value.kind === 'human' || value.kind === 'agent' ? value.kind : undefined
  const id = pickString(value.id)
  if (!kind || !id) return undefined
  return { kind, id }
}

function coerceCitations(value: unknown): ResearchOutput['citations'] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: ResearchOutput['citations'] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const url = pickString(entry.url)
    const quote = pickString(entry.quote)
    if (!url || !quote) continue
    out.push({ url, quote, confidence: clamp01(toFiniteNumber(entry.confidence)) })
  }
  return out
}

function coerceProposedWrites(value: unknown): KnowledgeUpdate[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: KnowledgeUpdate[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const namespace = pickString(entry.namespace)
    if (!namespace) continue
    if (entry.kind === 'insert') {
      const items = coerceItems([entry.item])
      const item = items?.[0]
      if (!item) continue
      out.push({ kind: 'insert', namespace, item })
    } else if (entry.kind === 'supersede') {
      const previousId = pickString(entry.previousId)
      const items = coerceItems([entry.item])
      const item = items?.[0]
      if (!previousId || !item) continue
      out.push({ kind: 'supersede', namespace, previousId, item })
    } else if (entry.kind === 'retract') {
      const itemId = pickString(entry.itemId)
      const reason = pickString(entry.reason)
      if (!itemId || !reason) continue
      out.push({ kind: 'retract', namespace, itemId, reason })
    }
  }
  return out
}

function toFiniteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}
