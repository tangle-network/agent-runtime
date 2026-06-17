/**
 * @experimental
 *
 * `delegate_code` MCP tool — async kickoff. The handler validates the
 * input, computes an idempotency key over the canonical fields, hands
 * the task to the queue, and returns `{ taskId, estimatedDurationMs }`.
 */

import type { CoderDelegate } from '../delegates'
import { formatDetachedSessionRef } from '../detached-turn'
import {
  type DelegateCodeArgs,
  type DelegateCodeResult,
  type DelegationTaskQueue,
  hashIdempotencyInput,
} from '../task-queue'

/** @experimental */
export const DELEGATE_CODE_TOOL_NAME = 'delegate_code'

/** @experimental */
export const DELEGATE_CODE_DESCRIPTION = [
  'Delegate a coding task to specialist coder agents that produce a validated patch.',
  '',
  'Use when: you need code written, fixed, refactored, or extended to satisfy a',
  'user goal that touches a real repository. The coder runs in an isolated',
  'sandbox, opens a fresh branch, keeps the diff minimal, runs the supplied',
  'test + typecheck commands, and emits a unified-diff patch.',
  '',
  'Returns immediately with a taskId. Poll delegation_status to retrieve the',
  'patch + validator verdict (typically minutes-to-hours, longer for large',
  'changes). Identical inputs return the same taskId — safe to retry.',
  '',
  'When variants > 1, multiple coder harnesses (claude-code, codex, opencode)',
  'attempt the task in parallel and the highest-scoring patch wins (smallest',
  'passing diff). Use variants for high-stakes changes; single variant for',
  'routine ones.',
  '',
  'Capability scope: the coder cannot modify paths outside repoRoot and cannot',
  'touch paths in config.forbiddenPaths. The validator hard-fails on a',
  'forbidden-path violation, diff above config.maxDiffLines, test failure, or',
  'typecheck failure — none of those make it past the gate.',
].join('\n')

/** @experimental */
export const DELEGATE_CODE_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    goal: {
      type: 'string',
      description: 'Natural-language description of what the coder must accomplish.',
    },
    repoRoot: {
      type: 'string',
      description: 'Absolute path inside the sandbox where the repo lives.',
    },
    contextHint: {
      type: 'string',
      description: 'Optional free-form context the coder sees in the prompt prelude.',
    },
    variants: {
      type: 'integer',
      minimum: 1,
      maximum: 8,
      description: 'Number of parallel coder harnesses. Default 1.',
    },
    config: {
      type: 'object',
      properties: {
        testCmd: { type: 'string' },
        typecheckCmd: { type: 'string' },
        forbiddenPaths: { type: 'array', items: { type: 'string' } },
        maxDiffLines: { type: 'integer', minimum: 1 },
      },
      additionalProperties: false,
    },
    namespace: {
      type: 'string',
      description: 'Multi-tenant scope (customer-id, workspace-id).',
    },
  },
  required: ['goal', 'repoRoot'],
  additionalProperties: false,
} as const

const SINGLE_VARIANT_ESTIMATE_MS = 6 * 60 * 1000 // 6 minutes — single coder
const FANOUT_PER_VARIANT_ESTIMATE_MS = 8 * 60 * 1000 // 8 minutes — fanout

/** @experimental */
export function validateDelegateCodeArgs(raw: unknown): DelegateCodeArgs {
  if (raw === null || typeof raw !== 'object') {
    throw new TypeError('delegate_code: arguments must be an object')
  }
  const value = raw as Record<string, unknown>
  const goal = value.goal
  if (typeof goal !== 'string' || goal.trim().length === 0) {
    throw new TypeError('delegate_code: `goal` must be a non-empty string')
  }
  const repoRoot = value.repoRoot
  if (typeof repoRoot !== 'string' || repoRoot.trim().length === 0) {
    throw new TypeError('delegate_code: `repoRoot` must be a non-empty string')
  }
  const args: DelegateCodeArgs = { goal: goal.trim(), repoRoot: repoRoot.trim() }
  if (typeof value.contextHint === 'string') args.contextHint = value.contextHint
  if (value.variants !== undefined) {
    const variants = Number(value.variants)
    if (!Number.isFinite(variants) || variants < 1 || variants > 8) {
      throw new RangeError('delegate_code: `variants` must be an integer in [1, 8]')
    }
    args.variants = Math.trunc(variants)
  }
  if (value.config !== undefined) {
    args.config = validateConfig(value.config)
  }
  if (typeof value.namespace === 'string') args.namespace = value.namespace
  return args
}

function validateConfig(raw: unknown): DelegateCodeArgs['config'] {
  if (raw === null || typeof raw !== 'object') {
    throw new TypeError('delegate_code: `config` must be an object')
  }
  const value = raw as Record<string, unknown>
  const out: NonNullable<DelegateCodeArgs['config']> = {}
  if (value.testCmd !== undefined) {
    if (typeof value.testCmd !== 'string') {
      throw new TypeError('delegate_code: `config.testCmd` must be a string')
    }
    out.testCmd = value.testCmd
  }
  if (value.typecheckCmd !== undefined) {
    if (typeof value.typecheckCmd !== 'string') {
      throw new TypeError('delegate_code: `config.typecheckCmd` must be a string')
    }
    out.typecheckCmd = value.typecheckCmd
  }
  if (value.forbiddenPaths !== undefined) {
    if (!Array.isArray(value.forbiddenPaths)) {
      throw new TypeError('delegate_code: `config.forbiddenPaths` must be a string array')
    }
    out.forbiddenPaths = value.forbiddenPaths.map((entry, i) => {
      if (typeof entry !== 'string') {
        throw new TypeError(`delegate_code: forbiddenPaths[${i}] must be a string`)
      }
      return entry
    })
  }
  if (value.maxDiffLines !== undefined) {
    const n = Number(value.maxDiffLines)
    if (!Number.isFinite(n) || n < 1) {
      throw new RangeError('delegate_code: `config.maxDiffLines` must be a positive integer')
    }
    out.maxDiffLines = Math.trunc(n)
  }
  return out
}

/** @experimental */
export interface DelegateCodeHandlerOptions {
  queue: DelegationTaskQueue
  delegate: CoderDelegate
  /** Override the duration hint. */
  estimateDurationMs?: (args: DelegateCodeArgs) => number
  /**
   * Record a deterministic detached-session resume key on single-variant
   * submissions (derived from the idempotency key, so retried identical
   * inputs name the same logical turn). Enable only when the wired delegate
   * dispatches via sandbox sessions — `detachedSessionDelegate` routes
   * onto its `driveTurn` tick path when the ref is present. Fanout
   * (`variants > 1`) never records a ref: one resume key cannot express N
   * sessions + winner selection.
   */
  detachedDispatch?: boolean
}

/** @experimental */
export function createDelegateCodeHandler(
  options: DelegateCodeHandlerOptions,
): (raw: unknown) => Promise<DelegateCodeResult> {
  const estimateDurationMs = options.estimateDurationMs ?? defaultEstimate
  return async (raw) => {
    const args = validateDelegateCodeArgs(raw)
    const idempotencyKey = hashIdempotencyInput({
      profile: 'coder',
      goal: args.goal,
      repoRoot: args.repoRoot,
      contextHint: args.contextHint,
      variants: args.variants ?? 1,
      config: args.config,
      namespace: args.namespace,
    })
    const detached = options.detachedDispatch === true && (args.variants ?? 1) <= 1
    const submitted = options.queue.submit<DelegateCodeArgs>({
      profile: 'coder',
      args,
      namespace: args.namespace,
      idempotencyKey,
      ...(detached
        ? {
            detachedSessionRef: formatDetachedSessionRef({
              sessionId: `dlg-turn-coder-${idempotencyKey}`,
            }),
          }
        : {}),
      run: async (ctx) => options.delegate(args, ctx),
    })
    return {
      taskId: submitted.taskId,
      estimatedDurationMs: estimateDurationMs(args),
    }
  }
}

function defaultEstimate(args: DelegateCodeArgs): number {
  const variants = Math.max(1, args.variants ?? 1)
  if (variants === 1) return SINGLE_VARIANT_ESTIMATE_MS
  return FANOUT_PER_VARIANT_ESTIMATE_MS
}
