import { AgentTurnResultSchema } from '@tangle-network/agent-interface'
import type { ExecutorResult } from './types'

// `errorCode` reuses the interface's own optional-string schema, so the envelope stays strict
// without this package importing a second copy of zod.
const outcomeSchema = AgentTurnResultSchema.pick({ success: true, error: true })
  .extend({ errorCode: AgentTurnResultSchema.shape.error })
  .strict()

/** Why an executor's own envelope says the execution failed, with the provider's machine code
 *  when it reported one. */
export interface ExecutorFailure {
  readonly error: string
  readonly errorCode?: string
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
    ...(outcome.errorCode === undefined ? {} : { errorCode: outcome.errorCode }),
  }
}

/** The failure text alone, for callers that record a settlement reason. */
export function executorFailureReason(
  result: Pick<ExecutorResult<unknown>, 'outcome'>,
): string | undefined {
  return executorFailure(result)?.error
}

/**
 * The platform's own failure vocabulary: machine codes and lifecycle messages that the sandbox
 * runtime, the router, or the egress path put in an executor envelope when the platform, not
 * the agent's work, ended the execution. Each entry names its evidence: the count is how many
 * down children carried it on the 2026-09-20 fleet corpus (277 down settlements across 691
 * runs), every one of them stamped `infra: false` by the hard-coded call site this table
 * replaced. The table is deliberately the platform's fixed strings, not the agent's prose.
 */
export const PLATFORM_FAILURE_CODES: ReadonlySet<string> = new Set(
  [
    'QUOTA_EXCEEDED', // the Sandbox interactive status failed (HTTP 429; code QUOTA_EXCEEDED): 3
    'provider_quota_exceeded', // No provider served model "kimi-k2" (provider_quota_exceeded): 7
    'buffer.overflow', // agent-dev-container#7730: the 10,000-event buffer dropped the stream
    'TIMEOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EPIPE',
    'EADDRINUSE', // listen EADDRINUSE: address already in use: 2
  ].map((code) => code.toLowerCase()),
)

export const PLATFORM_FAILURE_MESSAGES: ReadonlyArray<RegExp> = [
  /^terminated$/u, // the box was terminated under the execution: 25
  /Execution exceeded its time limit/u, // the platform's execution TTL: 4
  /Execution interrupted: the agent runtime restarted/u, // buffer.overflow misreported: 3
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
  /provider_quota_exceeded|QUOTA_EXCEEDED|rate limit/iu,
  /is at its box cap/u, // seat capacity: 4
  /could not materialize the seat credential/u, // 3
  /OpenCode exited while a model step was still in progress/u, // tmpfs OOM, SIGKILL: 4
  /the agent runtime restarted/u,
]

/**
 * Whether an executor envelope's failure was the platform's, as far as the envelope can say.
 *
 * `true` when the code or the message is in the platform's own vocabulary above. `undefined`
 * otherwise: the harness reported a failure and nothing in the envelope attributes it, so the
 * settlement carries no `infra` claim at all rather than a false one. This path never answers
 * `false`, because an executor envelope cannot prove the agent's work was at fault; the throw
 * path in `scope.ts` still answers `false` for an ordinary thrown result, where the runtime does
 * know. Until this function existed both envelope sites stamped `infra: false` unconditionally,
 * and the flag caught 1 of the 78 platform losses it was checked against on the fleet corpus.
 */
export function executorFailureInfra(failure: ExecutorFailure): true | undefined {
  const code = failure.errorCode?.toLowerCase()
  if (code !== undefined && PLATFORM_FAILURE_CODES.has(code)) return true
  return PLATFORM_FAILURE_MESSAGES.some((pattern) => pattern.test(failure.error)) ? true : undefined
}

/** Preserve deterministic result pointers across built-in executors and replay.
 * FNV-1a is an identity convention here, not a cryptographic integrity check. */
export function contentRef(prefix: string, value: unknown): string {
  let str: string
  try {
    str = JSON.stringify(value) ?? String(value)
  } catch {
    str = String(value)
  }
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${prefix}:${(h >>> 0).toString(16).padStart(8, '0')}`
}
