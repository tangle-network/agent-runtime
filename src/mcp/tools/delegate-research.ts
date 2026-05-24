/**
 * @experimental
 *
 * `delegate_research` MCP tool — async kickoff for source-grounded
 * research tasks. Same async semantics as `delegate_code`: returns a
 * taskId immediately, idempotent on canonical inputs.
 *
 * The handler does not import a researcher profile directly — consumers
 * inject a `ResearcherDelegate` via `createMcpServer({ researcherDelegate })`.
 * The substrate cannot depend on `@tangle-network/agent-knowledge`
 * without inducing a dependency cycle.
 */

import type { ResearcherDelegate } from '../delegates'
import {
  type DelegateResearchArgs,
  type DelegateResearchResult,
  type DelegationTaskQueue,
  hashIdempotencyInput,
} from '../task-queue'
import type { ResearchSource } from '../types'

/** @experimental */
export const DELEGATE_RESEARCH_TOOL_NAME = 'delegate_research'

/** @experimental */
export const DELEGATE_RESEARCH_DESCRIPTION = [
  'Delegate a research question to specialist researcher agents that produce',
  'source-grounded, evidence-bearing knowledge items.',
  '',
  'Use when: you need to answer a factual question with external evidence —',
  'audience research, competitive intelligence, recency-bound web searches,',
  'corpus / docs lookups. The researcher emits items[] with provenance, a',
  'citations[] index, and proposedWrites[] you decide whether to persist.',
  '',
  'Returns immediately with a taskId. Poll delegation_status to retrieve the',
  'items + verdict. Identical inputs return the same taskId — safe to retry.',
  '',
  'When variants > 1, multiple researcher harnesses run in parallel and the',
  'highest-scoring valid output wins (citation density × source diversity ×',
  'recency match × gap coverage). Use variants when answers might disagree.',
  '',
  'Multi-tenant isolation: every item carries `namespace`. The validator',
  'hard-fails when any item is scoped outside `namespace`. Never pass another',
  "tenant's namespace.",
].join('\n')

const VALID_SOURCES: readonly ResearchSource[] = ['web', 'corpus', 'twitter', 'github', 'docs']

/** @experimental */
export const DELEGATE_RESEARCH_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    question: {
      type: 'string',
      description: 'The research question to answer.',
    },
    namespace: {
      type: 'string',
      description: 'Multi-tenant scope (customer-id, workspace-id). REQUIRED.',
    },
    scope: { type: 'string', description: 'Bound, e.g. "audience for cpg-founder ICP".' },
    sources: {
      type: 'array',
      items: { type: 'string', enum: [...VALID_SOURCES] },
    },
    variants: { type: 'integer', minimum: 1, maximum: 8 },
    config: {
      type: 'object',
      properties: {
        recencyWindow: {
          type: 'object',
          properties: {
            since: { type: 'string', description: 'ISO datetime' },
            until: { type: 'string', description: 'ISO datetime' },
          },
          additionalProperties: false,
        },
        maxItems: { type: 'integer', minimum: 1 },
        minConfidence: { type: 'number', minimum: 0, maximum: 1 },
      },
      additionalProperties: false,
    },
  },
  required: ['question', 'namespace'],
  additionalProperties: false,
} as const

const SINGLE_VARIANT_ESTIMATE_MS = 4 * 60 * 1000
const FANOUT_PER_VARIANT_ESTIMATE_MS = 6 * 60 * 1000

/** @experimental */
export function validateDelegateResearchArgs(raw: unknown): DelegateResearchArgs {
  if (raw === null || typeof raw !== 'object') {
    throw new TypeError('delegate_research: arguments must be an object')
  }
  const value = raw as Record<string, unknown>
  const question = value.question
  if (typeof question !== 'string' || question.trim().length === 0) {
    throw new TypeError('delegate_research: `question` must be a non-empty string')
  }
  const namespace = value.namespace
  if (typeof namespace !== 'string' || namespace.trim().length === 0) {
    throw new TypeError('delegate_research: `namespace` is required')
  }
  const args: DelegateResearchArgs = { question: question.trim(), namespace: namespace.trim() }
  if (typeof value.scope === 'string') args.scope = value.scope
  if (value.sources !== undefined) {
    if (!Array.isArray(value.sources)) {
      throw new TypeError('delegate_research: `sources` must be a string array')
    }
    const sources: ResearchSource[] = value.sources.map((src, i) => {
      if (typeof src !== 'string' || !VALID_SOURCES.includes(src as ResearchSource)) {
        throw new TypeError(
          `delegate_research: sources[${i}] must be one of ${VALID_SOURCES.join('|')}`,
        )
      }
      return src as ResearchSource
    })
    args.sources = sources
  }
  if (value.variants !== undefined) {
    const variants = Number(value.variants)
    if (!Number.isFinite(variants) || variants < 1 || variants > 8) {
      throw new RangeError('delegate_research: `variants` must be an integer in [1, 8]')
    }
    args.variants = Math.trunc(variants)
  }
  if (value.config !== undefined) {
    args.config = validateConfig(value.config)
  }
  return args
}

function validateConfig(raw: unknown): DelegateResearchArgs['config'] {
  if (raw === null || typeof raw !== 'object') {
    throw new TypeError('delegate_research: `config` must be an object')
  }
  const value = raw as Record<string, unknown>
  const out: NonNullable<DelegateResearchArgs['config']> = {}
  if (value.recencyWindow !== undefined) {
    if (value.recencyWindow === null || typeof value.recencyWindow !== 'object') {
      throw new TypeError('delegate_research: `config.recencyWindow` must be an object')
    }
    const window = value.recencyWindow as Record<string, unknown>
    const windowOut: NonNullable<NonNullable<DelegateResearchArgs['config']>['recencyWindow']> = {}
    if (window.since !== undefined) {
      if (typeof window.since !== 'string' || Number.isNaN(Date.parse(window.since))) {
        throw new TypeError('delegate_research: `recencyWindow.since` must be an ISO datetime')
      }
      windowOut.since = window.since
    }
    if (window.until !== undefined) {
      if (typeof window.until !== 'string' || Number.isNaN(Date.parse(window.until))) {
        throw new TypeError('delegate_research: `recencyWindow.until` must be an ISO datetime')
      }
      windowOut.until = window.until
    }
    out.recencyWindow = windowOut
  }
  if (value.maxItems !== undefined) {
    const n = Number(value.maxItems)
    if (!Number.isFinite(n) || n < 1) {
      throw new RangeError('delegate_research: `config.maxItems` must be a positive integer')
    }
    out.maxItems = Math.trunc(n)
  }
  if (value.minConfidence !== undefined) {
    const n = Number(value.minConfidence)
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      throw new RangeError('delegate_research: `config.minConfidence` must be in [0, 1]')
    }
    out.minConfidence = n
  }
  return out
}

/** @experimental */
export interface DelegateResearchHandlerOptions {
  queue: DelegationTaskQueue
  delegate: ResearcherDelegate
  estimateDurationMs?: (args: DelegateResearchArgs) => number
}

/** @experimental */
export function createDelegateResearchHandler(
  options: DelegateResearchHandlerOptions,
): (raw: unknown) => Promise<DelegateResearchResult> {
  const estimateDurationMs = options.estimateDurationMs ?? defaultEstimate
  return async (raw) => {
    const args = validateDelegateResearchArgs(raw)
    const idempotencyKey = hashIdempotencyInput({
      profile: 'researcher',
      question: args.question,
      namespace: args.namespace,
      scope: args.scope,
      sources: args.sources,
      variants: args.variants ?? 1,
      config: args.config,
    })
    const submitted = options.queue.submit<DelegateResearchArgs>({
      profile: 'researcher',
      args,
      namespace: args.namespace,
      idempotencyKey,
      run: async (ctx) => options.delegate(args, ctx),
    })
    return {
      taskId: submitted.taskId,
      estimatedDurationMs: estimateDurationMs(args),
    }
  }
}

function defaultEstimate(args: DelegateResearchArgs): number {
  const variants = Math.max(1, args.variants ?? 1)
  if (variants === 1) return SINGLE_VARIANT_ESTIMATE_MS
  return FANOUT_PER_VARIANT_ESTIMATE_MS
}
