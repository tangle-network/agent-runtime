/**
 * `reflectiveProfileProposer`: the maintained `SurfaceProposer` for a profile's
 * text surfaces (a system prompt, instructions, a skill document, or named text
 * components) in `searchMethod`.
 *
 * Each proposal is one model call under Runtime's optimizer method
 * (`optimizerMethod`). The model reads the parents the policy chose, their
 * train results, the caller's train-only evidence beside them, and the train
 * summary of the search, and returns one complete replacement surface with a
 * label and a hypothesis. It never sees selection or test data: the search
 * hands a proposer the train split only, and `evidence` must keep to it.
 *
 * The call is a paid call on the proposal's cost ledger, priced at `pricing`,
 * with a maximum declared before it runs: every byte of the prompt as a token,
 * plus `maxOutputTokens`. A reply that holds no usable surface proposes
 * nothing; its cost stays in the ledger.
 */

import type { CustomTokenPricing, ProposalFinding } from '@tangle-network/agent-eval'
import type {
  MutableSurface,
  ProposeContext,
  SearchScoredCell,
  SurfaceProposer,
} from '@tangle-network/agent-eval/campaign'
import { ConfigError } from '../errors'
import { optimizerMethod } from './optimizer-prompt'

/** One chat completion, made by the caller's client. */
export type ReflectiveProposerChat = (request: {
  readonly messages: ReadonlyArray<{ readonly role: 'system' | 'user'; readonly content: string }>
  readonly maxOutputTokens: number
  /** Forward it as the provider's idempotency key, so a retried request is not billed twice. */
  readonly callId: string
  readonly signal: AbortSignal
}) => Promise<ReflectiveProposerReply>

export interface ReflectiveProposerReply {
  /** The model's visible reply. */
  readonly content: string
  /** Billed tokens as the provider reported them, or null when it reported none:
   * the call's cost is then unknown and counts at its declared maximum. */
  readonly usage: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly reasoningTokens?: number
    readonly cachedTokens?: number
  } | null
  /** The model the provider says served the call. Default `model`. */
  readonly model?: string
}

/** One parent, as `evidence` receives it. */
export interface ReflectiveProposerParent {
  /** The parent's node; null for a proposal outside a search. */
  readonly nodeId: string | null
  readonly surface: MutableSurface
  /** The parent's scored train cells. Unscored cells are absent, never zero. */
  readonly trainCells: readonly SearchScoredCell[]
}

export interface ReflectiveProfileProposerOptions {
  /** Names the proposer in the search's identity and its receipts. Default
   * `reflective-profile`. */
  readonly kind?: string
  /** The model `chat` calls, recorded on its receipt. */
  readonly model: string
  readonly chat: ReflectiveProposerChat
  /** Rates that price the call and its declared maximum. */
  readonly pricing: CustomTokenPricing
  /** Output tokens the call may bill. Default 16,000. */
  readonly maxOutputTokens?: number
  /**
   * What the surface is and how it is measured, as the model should read it:
   * the agent, its task, the score, and what transfers to unseen tasks. Runtime
   * adds the method, the operator, the parents and the output contract.
   */
  readonly frame: string
  /**
   * The caller's train-only evidence for one parent: for example each train
   * task, its expected answer, the parent's answer and its error. Return text
   * sections; Runtime places them under the parent. Never read selection or
   * test data here. Default: each scored train unit and its score.
   */
  readonly evidence?: (
    parent: ReflectiveProposerParent,
  ) => Promise<readonly string[]> | readonly string[]
  /** The longest surface text the proposer returns, in characters; a longer
   * reply proposes nothing. Default 12,000. */
  readonly maxSurfaceChars?: number
}

const OPERATOR: Record<NonNullable<ProposeContext['operator']>, string> = {
  draft:
    'OPERATOR: draft. Write a substantially different approach from the parent below, not an edit of it.',
  improve:
    'OPERATOR: improve. Edit the parent below to fix its dominant failure mode; keep what already works.',
  debug:
    'OPERATOR: debug. The parent below failed as a defect (crashes, no answer, a broken format). Fix the cause.',
  merge: 'OPERATOR: merge. Combine the strengths of the parents below into one surface.',
}

/** Build the maintained reflective proposer for a profile text surface. */
export function reflectiveProfileProposer(
  options: ReflectiveProfileProposerOptions,
): SurfaceProposer<ProposalFinding> {
  const kind = options.kind ?? 'reflective-profile'
  const maxOutputTokens = options.maxOutputTokens ?? 16_000
  const maxSurfaceChars = options.maxSurfaceChars ?? 12_000
  if (!kind.trim() || kind.trim() !== kind) {
    throw new ConfigError('reflectiveProfileProposer(): kind must be a trimmed non-empty string')
  }
  if (!options.model?.trim())
    throw new ConfigError('reflectiveProfileProposer(): model is required')
  if (typeof options.chat !== 'function') {
    throw new ConfigError('reflectiveProfileProposer(): chat must be a function')
  }
  if (!options.frame?.trim())
    throw new ConfigError('reflectiveProfileProposer(): frame is required')
  for (const [name, value] of [
    ['maxOutputTokens', maxOutputTokens],
    ['maxSurfaceChars', maxSurfaceChars],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new ConfigError(`reflectiveProfileProposer(): ${name} must be a positive integer`)
    }
  }
  const evidenceOf = options.evidence ?? defaultEvidence

  return {
    kind,
    async propose(ctx) {
      if (!ctx.costLedger) {
        throw new ConfigError(
          'reflectiveProfileProposer(): the proposal has no cost ledger; run it through improve() with searchMethod',
        )
      }
      // The train view retires when the ledger moves on: read every parent's
      // cells before the first await.
      const parents: ReflectiveProposerParent[] = (
        ctx.parents ?? [{ nodeId: null, artifact: ctx.currentSurface }]
      ).map((parent) => ({
        nodeId: parent.nodeId,
        surface: parent.artifact,
        trainCells: parent.nodeId && ctx.train ? [...ctx.train.scoredCells(parent.nodeId)] : [],
      }))
      const shape = surfaceShape(ctx.currentSurface)
      const sections: string[] = []
      for (const [index, parent] of parents.entries()) {
        const evidence = await evidenceOf(parent)
        sections.push(
          [
            `## Parent ${index + 1}${parent.nodeId ? ` (${parent.nodeId})` : ''}: its current surface`,
            renderSurface(parent.surface),
            `## Parent ${index + 1}: its train results (${parent.trainCells.length} scored cells)`,
            ...evidence,
          ].join('\n'),
        )
      }
      const system = [
        optimizerMethod,
        '',
        options.frame.trim(),
        '',
        outputContract(shape, maxSurfaceChars),
      ].join('\n')
      const user = [
        OPERATOR[ctx.operator ?? 'improve'],
        '',
        ...sections,
        '',
        '## The search so far (train split only)',
        ctx.summary?.trim() || '(nothing measured yet)',
      ].join('\n')
      const messages = [
        { role: 'system' as const, content: system },
        { role: 'user' as const, content: user },
      ]
      // A byte-level tokenizer never makes more tokens than bytes; 16 per message
      // covers the chat template.
      const inputTokens =
        messages.reduce((total, message) => total + Buffer.byteLength(message.content, 'utf8'), 0) +
        16 * messages.length
      const paid = await ctx.costLedger.runPaidCall({
        channel: 'proposer',
        phase: ctx.costPhase ?? 'proposal',
        actor: kind,
        model: options.model,
        signal: ctx.signal,
        maximumCharge: {
          customTokenPricing: options.pricing,
          inputTokens,
          outputTokens: maxOutputTokens,
        },
        execute: (signal, callId) => options.chat({ messages, maxOutputTokens, callId, signal }),
        receipt: (reply) =>
          reply.usage === null
            ? {
                model: reply.model ?? options.model,
                inputTokens: 0,
                outputTokens: 0,
                costUnknown: true,
                usageUnknown: true,
              }
            : {
                model: reply.model ?? options.model,
                inputTokens: reply.usage.inputTokens,
                outputTokens: reply.usage.outputTokens,
                ...(reply.usage.reasoningTokens === undefined
                  ? {}
                  : { reasoningTokens: reply.usage.reasoningTokens }),
                ...(reply.usage.cachedTokens === undefined
                  ? {}
                  : { cachedTokens: reply.usage.cachedTokens }),
                customTokenPricing: options.pricing,
              },
      })
      if (!paid.succeeded) throw paid.error
      const proposal = parseProposal(paid.value.content, shape, maxSurfaceChars)
      return proposal === null ? [] : [proposal]
    },
  }
}

type SurfaceShape = { kind: 'text' } | { kind: 'components'; names: readonly string[] }

function surfaceShape(surface: MutableSurface): SurfaceShape {
  if (typeof surface === 'string') return { kind: 'text' }
  if (surface.kind === 'components') {
    return { kind: 'components', names: Object.keys(surface.components).sort() }
  }
  throw new ConfigError(
    'reflectiveProfileProposer(): a code surface is improved through worktrees, not a text proposer',
  )
}

function renderSurface(surface: MutableSurface): string {
  if (typeof surface === 'string') return ['"""', surface, '"""'].join('\n')
  if (surface.kind !== 'components') return '(a code surface)'
  return Object.keys(surface.components)
    .sort()
    .map((name) => [`### Component ${name}`, '"""', surface.components[name], '"""'].join('\n'))
    .join('\n')
}

function outputContract(shape: SurfaceShape, maxChars: number): string {
  const surface =
    shape.kind === 'text'
      ? '"surface": "<the complete new text>"'
      : `"surface": { ${shape.names.map((name) => `"${name}": "<its complete new text>"`).join(', ')} }`
  return [
    'OUTPUT. Reply with one JSON object and nothing else:',
    `{"label": "<at most 8 words naming the change>", "hypothesis": "<the dominant failure mode, the mechanism, and the predicted effect on the score>", ${surface}}`,
    shape.kind === 'text'
      ? `The surface must stand alone, at most ${maxChars} characters: the agent sees nothing else from you.`
      : `Return every component, each complete, at most ${maxChars} characters in all: the agent sees nothing else from you.`,
  ].join('\n')
}

/** The proposal in a reply: the whole reply as JSON, else its outermost {...} span. */
function parseProposal(
  content: string,
  shape: SurfaceShape,
  maxChars: number,
): { surface: MutableSurface; label: string; rationale: string } | null {
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  for (const text of [content, start >= 0 && end > start ? content.slice(start, end + 1) : '']) {
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      continue
    }
    if (typeof value !== 'object' || value === null) continue
    const { label, hypothesis, surface } = value as Record<string, unknown>
    const parsed = surfaceOf(surface, shape, maxChars)
    if (parsed === null) continue
    return {
      surface: parsed,
      label: String(label ?? '').slice(0, 80),
      rationale: String(hypothesis ?? '').slice(0, 4000),
    }
  }
  return null
}

function surfaceOf(value: unknown, shape: SurfaceShape, maxChars: number): MutableSurface | null {
  if (shape.kind === 'text') {
    return typeof value === 'string' && value.trim() && value.length <= maxChars ? value : null
  }
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const names = Object.keys(record).sort()
  if (names.join('\n') !== shape.names.join('\n')) return null
  let total = 0
  const components: Record<string, string> = {}
  for (const name of names) {
    const text = record[name]
    if (typeof text !== 'string' || !text.trim()) return null
    total += text.length
    components[name] = text
  }
  return total <= maxChars ? { kind: 'components', components } : null
}

function defaultEvidence(parent: ReflectiveProposerParent): string[] {
  return parent.trainCells.map((cell) => `- train unit ${cell.unitId}: score ${cell.score}`)
}
