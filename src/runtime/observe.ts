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
 * Findings are production observations (`proposal_origin:'production'`) and
 * never come from final evaluation (`derived_from_judge:false`). The observer is harness-agnostic: it
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
}

export interface ObserveOptions {
  /** Exact analyst identity. */
  profile: AgentProfile
  /** Execution substrate. All behavior comes from the profile. */
  executor: ExecutorConfig
  /** When set, learned facts are appended (idempotent) for the next run to read. */
  corpus?: Corpus
  /** Tags written onto learned facts + used by the next run's corpus query. */
  tags?: ReadonlyArray<string>
  signal?: AbortSignal
  /** Cap the trace lines fed to the observer (keeps the call cheap). Default 80. */
  maxTraceLines?: number
}

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
export async function observe(input: ObserveInput, opts: ObserveOptions): Promise<Observation> {
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
            `FINAL OUTPUT (truncated):\n${input.output.slice(0, 1200)}\n\n` +
            `TRACE (in order; "xN" = repeated):\n${traceSummary}`,
        },
      ],
    },
    { ...(opts.signal ? { signal: opts.signal } : {}) },
  )

  const parsed = parseFindings(res.content)
  const producedAt = input.runId ? `${input.runId}` : observerId
  const findings = assertProposalFindings(
    parsed.map((f) =>
      makeProposalFinding({
        analyst_id: observerId,
        area: `${f.area}`,
        severity: f.severity,
        claim: f.claim,
        recommended_action: f.recommended_action,
        confidence: typeof f.confidence === 'number' ? f.confidence : 0.5,
        evidence_refs: [],
        // The observer reads behavior, never a final evaluation result.
        derived_from_judge: false,
        proposal_origin: 'production',
        metadata: { audience: f.audience },
        ...(input.runId ? { subject: input.runId } : {}),
      }),
    ),
    'observe findings',
  )

  const learned: CorpusRecord[] = []
  if (opts.corpus) {
    for (const f of findings) {
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
        evidence: [{ kind: 'finding', uri: f.finding_id }],
      }
      const r = await opts.corpus.append(record)
      if (r.succeeded) learned.push(record)
    }
  }

  const usage = res.usage
  const inputTokens = usage?.promptTokens
  const outputTokens = usage?.completionTokens
  return {
    findings: [...findings],
    learned,
    report: renderReport(findings),
    usage: {
      input: inputTokens ?? 0,
      output: outputTokens ?? 0,
      known:
        usage?.captured !== false &&
        typeof inputTokens === 'number' &&
        typeof outputTokens === 'number',
    },
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
  } catch {
    const m = content.match(/\{[\s\S]*\}/)
    obj = m ? JSON.parse(m[0]) : { findings: [] }
  }
  const arr = (obj as { findings?: unknown }).findings
  return Array.isArray(arr) ? (arr as RawFinding[]) : []
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
