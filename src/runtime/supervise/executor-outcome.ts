import { AgentTurnResultSchema } from '@tangle-network/agent-interface'
import {
  type AgentTurnFailure,
  AgentTurnFailureSchema,
} from '@tangle-network/agent-interface/environment-provider'
import { z } from 'zod'
import { jsonContentText } from '../json-content-hash'
import { fnv1a32Hex } from '../util'
import { causeChain } from './error-message'
import type { ExecutorResult } from './types'

const outcomeSchema = AgentTurnResultSchema.pick({ success: true, error: true, failure: true })
  .extend({
    errorCode: AgentTurnResultSchema.shape.error,
    statusCode: z.number().int().min(400).max(599).optional(),
  })
  .strict()

/** Why an executor's own envelope says the execution failed, with the provider's machine code
 *  when it reported one. */
export interface ExecutorFailure {
  readonly failure?: AgentTurnFailure
  readonly error: string
  readonly errorCode?: string
  readonly statusCode?: number
}

/** Read only the executor envelope; application output and grades are not execution status. */
export function executorFailure(
  result: Pick<ExecutorResult<unknown>, 'outcome'>,
): ExecutorFailure | undefined {
  if (result.outcome === undefined) return undefined
  const outcome = outcomeSchema.parse(result.outcome)
  if (outcome.success) return undefined
  return {
    error: outcome.error ?? 'Agent execution failed',
    ...(outcome.failure === undefined ? {} : { failure: outcome.failure }),
    ...(outcome.errorCode === undefined ? {} : { errorCode: outcome.errorCode }),
    ...(outcome.statusCode === undefined ? {} : { statusCode: outcome.statusCode }),
  }
}

/** The failure text alone, for callers that record a settlement reason. */
export function executorFailureReason(
  result: Pick<ExecutorResult<unknown>, 'outcome'>,
): string | undefined {
  return executorFailure(result)?.error
}

/** Canonical producer classifications take precedence over the legacy code/message vocabulary. */
const TURN_FAILURE_POLICY = {
  capacity: {
    classification: 'unavailable',
    failureKind: 'infra',
    infra: true,
    code: 'upstream-unavailable',
    owner: 'platform',
  },
  caller: {
    classification: 'terminal',
    failureKind: 'deterministic',
    infra: undefined,
    code: 'request-rejected',
    owner: 'caller',
  },
  infra: {
    classification: 'transient',
    failureKind: 'infra',
    infra: true,
    code: 'transport',
    owner: 'platform',
  },
  work: {
    classification: 'transient',
    failureKind: 'deterministic',
    infra: undefined,
    code: 'work-failed',
    owner: 'work',
  },
} as const

export const turnFailurePolicy = (failure: AgentTurnFailure) => TURN_FAILURE_POLICY[failure.kind]

/** Validate the shared contract on an envelope or any wrapped cause; malformed legacy data falls back. */
export function turnFailureOf(value: unknown): AgentTurnFailure | undefined {
  for (const link of causeChain(value)) {
    try {
      const parsed = AgentTurnFailureSchema.safeParse(Reflect.get(link, 'failure'))
      if (parsed.success) return parsed.data
    } catch {
      /* A foreign getter cannot replace the original failure. */
    }
  }
  return undefined
}

export const PLATFORM_FAILURE_CODES: ReadonlySet<string> = new Set(
  [
    'QUOTA_EXCEEDED', // the Sandbox interactive status failed (HTTP 429; code QUOTA_EXCEEDED): 3
    'provider_quota_exceeded', // No provider served model "kimi-k2" (provider_quota_exceeded): 7
    'provider_quota_exhausted', // the router's current code for the same refusal
    'buffer.overflow', // agent-container#7730: the 10,000-event buffer dropped the stream
    'EXECUTION_INTERRUPTED', // agent-container#16844: the sidecar stalled and aborted the turn
    'TIMEOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EPIPE',
    'EADDRINUSE', // listen EADDRINUSE: address already in use: 2
  ].map((code) => code.toLowerCase()),
)

const PLATFORM_FAILURE_MESSAGES: ReadonlyArray<RegExp> = [
  /^terminated$/u, // the box was terminated under the execution: 25
  /Execution exceeded its time limit/u, // the platform's execution TTL: 4
  /Platform key[- ]verification/u, // key-verification brownout: 9
  /Platform key delegation failed/u,
  /Bad Gateway/iu, // egress proxy header timeout, router 502: 4
  /Cannot connect to API/u, // egress proxy killed by downloads: 3
  /Failed to connect to Sandbox API/u, // the driver lost its box environment (discovery-lab#888)
  /fetch failed/u,
  /A sandbox lifecycle operation is already in progress/u, // 2
  /exceeded its string bound/u, // Tangle Sandbox event data exceeded its string bound: 4
  /exceeds its JSON bound/u, // 3
  /No provider served model/u, // router capacity: 7
  /Invalid API key/u, // the sandbox model key expired mid-turn: 2
  /provider_quota_exceeded|provider_quota_exhausted|QUOTA_EXCEEDED|rate limit/iu,
  /is at its box cap/u, // seat capacity: 4
  /could not materialize the seat credential/u, // 3
  /OpenCode exited while a model step was still in progress/u, // tmpfs OOM, SIGKILL: 4
  /the agent runtime restarted/u,
]

/** Producer-owned classification first; legacy platform codes/messages otherwise leave attribution unknown. */
export function executorFailureInfra(failure: ExecutorFailure): true | undefined {
  if (failure.failure) return turnFailurePolicy(failure.failure).infra
  const code = failure.errorCode?.toLowerCase()
  if (code !== undefined && PLATFORM_FAILURE_CODES.has(code)) return true
  return PLATFORM_FAILURE_MESSAGES.some((pattern) => pattern.test(failure.error)) ? true : undefined
}

/** Preserve deterministic result pointers across built-in executors and replay.
 * FNV-1a is an identity convention here, not a cryptographic integrity check. */
export function contentRef(prefix: string, value: unknown): string {
  const str = jsonContentText(value)
  return `${prefix}:${fnv1a32Hex(str)}`
}
