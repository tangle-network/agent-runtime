/**
 * The third-person observer — the connective tissue that closes the loop.
 *
 * A driver spawns a worker; the worker can't see itself. `observe` reads the
 * worker's TRACE (what it actually did — every tool call, cost, failure) and
 * produces two streams:
 *   - `findings` / `report` — fed back DOWN (a steer for the next attempt) and
 *     OUT (the operator-facing "what I noticed + what to change").
 *   - `learned` — durable facts written to the cross-run `Corpus` so the NEXT
 *     run starts smarter (the continuous half of "continuous self-improvement").
 *
 * The default analyst produces production observations from execution evidence.
 * Injected analyses preserve their explicit proposal origins and evidence references.
 * The observer is harness-agnostic: it
 * reads a trace + an output, so it watches opencode, codex, hermes, or a BYO
 * agent identically.
 */
import {
  type AnalystFinding,
  makeProposalFinding,
  type ProposalFinding,
} from '@tangle-network/agent-eval'
import { assertProposalFindings } from '@tangle-network/agent-eval/analyst'
import type { AgentProfile } from '@tangle-network/agent-interface'
import type { Corpus, CorpusRecord } from './personify/wave-types'
import { profileChatClient } from './profile-chat-client'
import type { ExecutorConfig } from './supervise/runtime'

const observerId = 'observe/trace'

export interface ObserveInput {
  /** What the worker was asked to do. */
  task: string
  /** What it produced (its final answer / artifact summary). */
  output: string
  /** The worker's trace — any event array (sandbox events, tool-call records). */
  trace: ReadonlyArray<unknown>
  /** Terminal status only (passed/failed/unknown) — NOT a judge score; the
   *  observer never reads the verdict, it reads behavior. */
  outcome?: 'passed' | 'failed' | 'unknown'
  /** Provenance back to the run. */
  runId?: string
  /** Caller-owned references to the retained evidence supplied in this input. */
  evidenceRefs?: ReadonlyArray<ProposalFinding['evidence_refs'][number]>
}

/** @inline */
interface ObserveCommonOptions {
  /** When set, learned facts are appended (idempotent) for the next run to read. */
  corpus?: Corpus
  /** Tags written onto learned facts + used by the next run's corpus query. */
  tags?: ReadonlyArray<string>
  signal?: AbortSignal
  /** Cap the trace lines fed to the observer (keeps the call cheap). Default 80. */
  maxTraceLines?: number
  /** Maximum output characters delivered to the default observer. Default 1200. */
  maxOutputChars?: number
  /** Evidence origin for the default observer. Defaults to production for existing callers. */
  proposalOrigin?: ProposalFinding['proposal_origin']
}

/** A caller-selected analysis retains the same findings, usage, and corpus contract. */
export type ObservationAnalysis = (
  input: ObserveInput,
  context: { signal?: AbortSignal },
) => Promise<Pick<Observation, 'findings' | 'report' | 'usage'>>

export type ObserveOptions = ObserveCommonOptions &
  (
    | { analysis: ObservationAnalysis; profile?: AgentProfile; executor?: ExecutorConfig }
    | { analysis?: undefined; profile: AgentProfile; executor: ExecutorConfig }
  )

/** The default observer instruction — exported so an optimizer can seed its population. */
export const defaultAnalystInstruction =
  'You are a third-person OBSERVER watching an AI agent work. You see its TRACE (what it did), not its grader. ' +
  'From the trace, name SPECIFIC, behavior-grounded findings: wasted/duplicated tool calls, thrash/retries, ' +
  'token/cost waste, missing verification, failure patterns. For each, a concrete recommended_action, and ' +
  'whether the AGENT (fix its skills/prompt/tools) or the OPERATOR (fix framing/decomposition/config) should act. ' +
  'Only claim what the trace shows. No findings if the run was clean.'

export interface Observation {
  findings: ProposalFinding[]
  /** Facts persisted to the corpus (empty when no corpus was supplied). */
  learned: CorpusRecord[]
  /** Operator-facing markdown: what the observer noticed + what to change. */
  report: string
  /** Measured model usage for this analysis turn. */
  usage: { input: number; output: number; known: boolean }
}

/** Analysis can fail after paid work; its measured subtotal must remain recoverable. */
export class ObservationError extends Error {
  constructor(
    message: string,
    readonly usage: Observation['usage'],
    options?: ErrorOptions,
  ) {
    super(message, options)
    validateUsage(usage)
    this.name = 'ObservationError'
  }
}

function validateUsage(usage: Observation['usage']): void {
  if (
    !Number.isSafeInteger(usage.input) ||
    usage.input < 0 ||
    !Number.isSafeInteger(usage.output) ||
    usage.output < 0 ||
    typeof usage.known !== 'boolean'
  ) {
    throw new TypeError(
      'observation usage requires nonnegative safe integer subtotals and explicit known status',
    )
  }
}

/** Compact the trace into the lines the observer reasons over — tool calls,
 *  errors, and statuses, in order. Keeps the model call bounded + grounded. */
function summarizeTrace(trace: ReadonlyArray<unknown>, maxLines: number): string {
  const lines: string[] = []
  for (const ev of trace) {
    const e = ev as { type?: string; data?: Record<string, unknown> }
    const t = (e.type ?? '').toLowerCase()
    const d = e.data ?? {}
    const part = (d.part ?? {}) as { type?: string; tool?: string; state?: { status?: string } }
    if (part.type === 'tool')
      lines.push(`tool:${part.tool}${part.state?.status ? `(${part.state.status})` : ''}`)
    else if (t.includes('error'))
      lines.push(`ERROR: ${String(d.message ?? d.detail ?? '').slice(0, 200)}`)
    else if (t === 'status' && typeof d.status === 'string') lines.push(`status:${d.status}`)
    else if (t.includes('tool')) lines.push(`tool-event:${t}`)
  }
  // Collapse runs of identical lines into "xN" so repeated thrash is visible + short.
  const out: string[] = []
  for (const ln of lines) {
    const prev = out[out.length - 1]
    const m = prev?.match(/^(.*?)(?: x(\d+))?$/)
    if (m && m[1] === ln) out[out.length - 1] = `${ln} x${(Number(m[2]) || 1) + 1}`
    else out.push(ln)
  }
  return out.slice(0, maxLines).join('\n') || '(no tool/error events in trace)'
}

const findingsSchema = {
  name: 'observer_findings',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      findings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            area: {
              type: 'string',
              description: 'tool-use | cost | verification | process | failure | latency',
            },
            severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
            claim: {
              type: 'string',
              description: 'what you OBSERVED in the trace (a fact, with the evidence)',
            },
            recommended_action: {
              type: 'string',
              description: 'the concrete change for the agent or operator',
            },
            audience: {
              type: 'string',
              enum: ['agent', 'operator'],
              description: 'who should act on this',
            },
            confidence: { type: 'number' },
          },
          required: ['area', 'severity', 'claim', 'recommended_action', 'audience', 'confidence'],
        },
      },
    },
    required: ['findings'],
  },
} as const

/** The third-person trace analyst: read a worker's trace and produce steer findings for the next attempt plus durable `learned` facts for the cross-run corpus. */
async function analyzeWithProfile(
  input: ObserveInput,
  opts: ObserveCommonOptions & { profile: AgentProfile; executor: ExecutorConfig },
): ReturnType<ObservationAnalysis> {
  if (
    opts.proposalOrigin !== undefined &&
    !['production', 'search'].includes(opts.proposalOrigin)
  ) {
    throw new TypeError('observer proposal origin must be production or search')
  }
  for (const limit of [opts.maxTraceLines, opts.maxOutputChars]) {
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0)) {
      throw new TypeError('observer context limits must be nonnegative safe integers')
    }
  }
  const traceSummary = summarizeTrace(input.trace, opts.maxTraceLines ?? 80)
  const res = await profileChatClient({
    profile: opts.profile,
    executor: opts.executor,
    context: 'observe analyst',
  }).chat(
    {
      jsonSchema: findingsSchema as unknown as { name: string; schema: Record<string, unknown> },
      messages: [
        {
          role: 'user',
          content:
            `TASK: ${input.task}\n\nOUTCOME: ${input.outcome ?? 'unknown'}\n\n` +
            `FINAL OUTPUT:\n${input.output.slice(0, opts.maxOutputChars ?? 1200)}\n\n` +
            `TRACE (in order; "xN" = repeated):\n${traceSummary}`,
        },
      ],
    },
    { ...(opts.signal ? { signal: opts.signal } : {}) },
  )

  const inputTokens = res.usage?.promptTokens
  const outputTokens = res.usage?.completionTokens
  const usage = {
    input: inputTokens ?? 0,
    output: outputTokens ?? 0,
    known:
      res.usage?.captured !== false &&
      typeof inputTokens === 'number' &&
      typeof outputTokens === 'number',
  }
  validateUsage(usage)
  try {
    const parsed = parseFindings(res.content)
    const findings = assertProposalFindings(
      parsed.map((f) =>
        makeProposalFinding({
          analyst_id: observerId,
          area: f.area,
          severity: f.severity,
          claim: f.claim,
          recommended_action: f.recommended_action,
          confidence: f.confidence,
          evidence_refs: [...(input.evidenceRefs ?? [])],
          // The observer reads behavior, never a final evaluation result.
          derived_from_judge: false,
          proposal_origin: opts.proposalOrigin ?? 'production',
          metadata: { audience: f.audience },
          ...(input.runId ? { subject: input.runId } : {}),
        }),
      ),
      'observe findings',
    )

    return {
      findings: [...findings],
      report: renderReport(findings),
      usage,
    }
  } catch (cause) {
    throw new ObservationError(cause instanceof Error ? cause.message : String(cause), usage, {
      cause,
    })
  }
}

/** Analyze through the selected implementation, then retain its validated findings in the corpus. */
export async function observe(input: ObserveInput, opts: ObserveOptions): Promise<Observation> {
  opts.signal?.throwIfAborted()
  const analysis = opts.analysis
    ? await opts.analysis(input, { ...(opts.signal ? { signal: opts.signal } : {}) })
    : await analyzeWithProfile(input, opts)
  validateUsage(analysis.usage)
  const learned: CorpusRecord[] = []
  try {
    opts.signal?.throwIfAborted()
    const findings = assertProposalFindings(analysis.findings, 'observe findings')
    const producedAt = input.runId ?? observerId
    if (opts.corpus) {
      for (const f of findings) {
        opts.signal?.throwIfAborted()
        const record: CorpusRecord = {
          schemaVersion: '1.0.0',
          id: f.finding_id,
          runId: input.runId ?? observerId,
          producedAt: f.produced_at ?? producedAt,
          area: f.area,
          claim: f.recommended_action ?? f.claim,
          ...(f.claim ? { rationale: f.claim } : {}),
          tags: [...(opts.tags ?? []), `audience:${(f.metadata?.audience as string) ?? 'agent'}`],
          confidence: f.confidence,
          evidence: [{ kind: 'finding', uri: f.finding_id }, ...f.evidence_refs],
        }
        const r = await opts.corpus.append(record)
        if (!r.succeeded) {
          throw new Error(
            `observe corpus append failed for '${record.id}' after storing ${learned.length}/${findings.length} findings: ${r.error}`,
          )
        }
        learned.push(record)
      }
    }

    return { ...analysis, findings: [...findings], learned }
  } catch (cause) {
    throw new ObservationError(
      cause instanceof Error ? cause.message : String(cause),
      analysis.usage,
      { cause },
    )
  }
}

interface RawFinding {
  area: string
  severity: AnalystFinding['severity']
  claim: string
  recommended_action: string
  audience: 'agent' | 'operator'
  confidence: number
}

function parseFindings(content: string): RawFinding[] {
  let obj: unknown
  try {
    obj = JSON.parse(content)
  } catch (error) {
    throw new Error('observe response: expected a JSON object with findings', { cause: error })
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    throw new Error('observe response: expected a JSON object with findings')
  }
  const response = obj as Record<string, unknown>
  if (
    !Array.isArray(response.findings) ||
    Object.keys(response).some((key) => key !== 'findings')
  ) {
    throw new Error('observe response: expected only a findings array')
  }
  const schema = findingsSchema.schema.properties.findings.items
  for (const [index, value] of response.findings.entries()) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`observe response: findings[${index}] must be an object`)
    }
    const finding = value as Record<string, unknown>
    const invalidField =
      Object.keys(finding).some((key) => !schema.required.some((field) => field === key)) ||
      ['area', 'claim', 'recommended_action'].some(
        (key) => typeof finding[key] !== 'string' || finding[key].trim().length === 0,
      ) ||
      !schema.properties.severity.enum.some((severity) => severity === finding.severity) ||
      !schema.properties.audience.enum.some((audience) => audience === finding.audience) ||
      typeof finding.confidence !== 'number' ||
      !Number.isFinite(finding.confidence) ||
      finding.confidence < 0 ||
      finding.confidence > 1
    if (invalidField) {
      throw new Error(
        `observe response: findings[${index}] does not match the required finding schema`,
      )
    }
  }
  return response.findings as RawFinding[]
}

/** Operator-facing report, split by who should act. The agent block is the
 *  steer; the operator block is the advice. */
export function renderReport(findings: ReadonlyArray<AnalystFinding>): string {
  if (findings.length === 0) return '✓ clean run — the observer found nothing to change.'
  const audience = (f: AnalystFinding): string => (f.metadata?.audience as string) ?? 'agent'
  const forAgent = findings.filter((f) => audience(f) === 'agent')
  const forOperator = findings.filter((f) => audience(f) === 'operator')
  const block = (title: string, fs: ReadonlyArray<AnalystFinding>): string =>
    fs.length === 0
      ? ''
      : `**${title}**\n${fs
          .map((f) => `- [${f.severity}] ${f.claim}\n  → ${f.recommended_action ?? ''}`)
          .join('\n')}\n`
  return [
    block('For the agent (fix skills / prompt / tools)', forAgent),
    block('For you (the operator)', forOperator),
  ]
    .filter(Boolean)
    .join('\n')
}
