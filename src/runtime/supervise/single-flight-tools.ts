/**
 * Serve method-supplied supervisor tools on the coordination MCP as single-flight, fenced calls.
 *
 * A method tool can run for hours: a literature graph spawns and joins its own children inside one
 * call. The coordination transport answers 504 at `requestTimeoutMs`, so an unwrapped long call
 * reaches the caller as a hard tool error while its handler keeps running. A caller that retries
 * starts a second full run. Run mech-interp-foundations-glm2-20260911d spawned the same enumerate
 * and extract children twice this way.
 *
 * Two rules close that failure:
 * - Identity. A call joins an existing invocation when its tool name and its RFC 8785 canonical
 *   arguments match, and that invocation has not yet returned its outcome to a caller. The handler
 *   is not invoked again. Key order does not matter: the observed retry reordered every key.
 * - Fence. A call waits at most `fenceMs` for the outcome. If the handler is still running, the call
 *   returns a non-error pending result. A later identical call keeps waiting, then returns the value
 *   or throws the handler's error once the handler settles.
 *
 * An invocation's identity ends when a call returns its outcome. The next identical call is a fresh
 * run, because equal arguments do not make a call a replay. Code mode's `execute` and Knowledge's
 * `knowledge_search` read live state, so their callers repeat identical arguments to get a current
 * answer. A handler that finishes within the fence therefore behaves exactly as it did unwrapped.
 * No escape hatch is needed: the only calls this absorbs are ones whose caller could not have seen
 * the outcome.
 */

import { canonicalCandidateJson } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import type { McpToolDescriptor } from '../../mcp/server'
import { withTimeout } from '../util'

type Outcome =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: unknown }

interface Invocation {
  readonly startedAt: number
  /** Resolves once the handler settles; never rejects, so an uncollected failure is not unhandled. */
  readonly settled: Promise<Outcome>
  outcome: Outcome | undefined
  /** Calls currently inside their fence for this invocation. */
  waiting: number
}

/** The non-error answer for a call whose handler is still running when its fence elapses. */
export interface PendingToolCall {
  readonly pending: true
  readonly tool: string
  readonly elapsedMs: number
  readonly instruction: string
}

export interface SingleFlightTools {
  readonly tools: ReadonlyArray<McpToolDescriptor>
  /** Invocations still running with no call waiting on them: work that outlived its request. The
   *  transport charges these against its concurrency limit until they settle. */
  background(): number
}

export function singleFlightTools(
  tools: ReadonlyArray<McpToolDescriptor>,
  options: { readonly fenceMs: number; readonly now?: () => number },
): SingleFlightTools {
  const { fenceMs } = options
  if (!Number.isSafeInteger(fenceMs) || fenceMs <= 0) {
    throw new ValidationError('singleFlightTools: fenceMs must be a positive safe integer')
  }
  const now = options.now ?? Date.now
  // One registry per coordination server, which serves exactly one manager scope. Driver retries
  // and re-prompts reuse that server, so a re-entered harness joins the run it already started.
  const invocations = new Map<string, Invocation>()

  const start = (tool: McpToolDescriptor, raw: unknown): Invocation => {
    const invocation: Invocation = {
      startedAt: now(),
      // An async wrapper turns a synchronous throw into a recorded failure, like a rejection.
      settled: (async () => tool.handler(raw))().then(
        (value): Outcome => {
          invocation.outcome = { ok: true, value }
          return invocation.outcome
        },
        (error: unknown): Outcome => {
          invocation.outcome = { ok: false, error }
          return invocation.outcome
        },
      ),
      outcome: undefined,
      waiting: 0,
    }
    return invocation
  }

  const wrap = (tool: McpToolDescriptor): McpToolDescriptor =>
    Object.freeze({
      ...tool,
      handler: async (raw: unknown): Promise<unknown> => {
        const key = invocationKey(tool.name, raw)
        let invocation = invocations.get(key)
        if (invocation === undefined) {
          invocation = start(tool, raw)
          invocations.set(key, invocation)
        }
        if (invocation.outcome === undefined) {
          invocation.waiting++
          try {
            await withTimeout(invocation.settled, fenceMs)
          } finally {
            invocation.waiting--
          }
        }
        const outcome = invocation.outcome
        if (outcome === undefined) return pendingToolCall(tool.name, now() - invocation.startedAt)
        // This call returns the outcome, so the invocation's identity ends here.
        if (invocations.get(key) === invocation) invocations.delete(key)
        if (outcome.ok) return outcome.value
        throw outcome.error
      },
    })

  return {
    tools: Object.freeze(tools.map(wrap)),
    background() {
      let count = 0
      for (const invocation of invocations.values()) {
        if (invocation.outcome === undefined && invocation.waiting === 0) count++
      }
      return count
    },
  }
}

function invocationKey(name: string, raw: unknown): string {
  try {
    return canonicalCandidateJson([name, raw])
  } catch (error) {
    throw new ValidationError(
      `${name}: arguments must be finite JSON so a repeated call can join its earlier run`,
      { cause: error },
    )
  }
}

function pendingToolCall(tool: string, elapsedMs: number): PendingToolCall {
  return {
    pending: true,
    tool,
    elapsedMs,
    instruction:
      `${tool} is still running; nothing failed. Call ${tool} again with the same arguments to ` +
      'keep waiting. That call joins this run and returns its result, or its error, once it ' +
      'finishes. Different arguments start a separate run.',
  }
}
