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
 *   arguments match, and that invocation has not yet settled. The handler is not invoked again.
 *   Key order does not matter: the observed retry reordered every key.
 * - Fence. A call waits at most `fenceMs` for the outcome. If the handler is still running, the
 *   call returns a receipt. The handler keeps running, and its outcome is published to the
 *   manager's inbox, where its next wake delivers it. Nothing has to call again to collect it.
 *
 * An invocation's identity ends when its handler settles. The next identical call is a fresh run,
 * because equal arguments do not make a call a replay: code mode's `execute` and Knowledge's
 * `knowledge_search` read live state, so their callers repeat identical arguments to get a current
 * answer. A handler that finishes within the fence therefore behaves exactly as it did unwrapped.
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
  /** Set when a call's fence elapsed first: the outcome then goes to the inbox under it. */
  receipt: string | undefined
}

/** The answer for a call whose handler is still running when its fence elapses. */
export interface ToolCallReceipt {
  readonly running: true
  readonly receipt: string
  readonly tool: string
  readonly elapsedMs: number
  readonly instruction: string
}

/** Where a receipted call's outcome goes: the manager's inbox (`CoordinationTools`). */
export interface ToolReceiptSink {
  openToolReceipt(tool: string): string
  settleToolReceipt(
    receipt: string,
    outcome:
      | { readonly ok: true; readonly value: unknown }
      | { readonly ok: false; readonly error: unknown },
  ): Promise<void>
}

export interface SingleFlightTools {
  readonly tools: ReadonlyArray<McpToolDescriptor>
  /** Invocations still running with no call waiting on them: work that outlived its request. The
   *  transport charges these against its concurrency limit until they settle. */
  background(): number
}

export function singleFlightTools(
  tools: ReadonlyArray<McpToolDescriptor>,
  options: {
    readonly fenceMs: number
    readonly receipts: ToolReceiptSink
    readonly now?: () => number
  },
): SingleFlightTools {
  const { fenceMs, receipts } = options
  if (!Number.isSafeInteger(fenceMs) || fenceMs <= 0) {
    throw new ValidationError('singleFlightTools: fenceMs must be a positive safe integer')
  }
  const now = options.now ?? Date.now
  // One registry per coordination server, which serves exactly one manager scope. Driver retries
  // and re-entries reuse that server, so a re-entered harness joins the run it already started.
  const invocations = new Map<string, Invocation>()

  const start = (tool: McpToolDescriptor, raw: unknown, key: string): Invocation => {
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
      receipt: undefined,
    }
    void invocation.settled.then(async (outcome) => {
      if (invocations.get(key) === invocation) invocations.delete(key)
      if (invocation.receipt !== undefined) {
        await receipts.settleToolReceipt(invocation.receipt, outcome).catch((error: unknown) => {
          console.error('Runtime could not publish a receipted tool outcome', {
            tool: tool.name,
            receipt: invocation.receipt,
            error: error instanceof Error ? error.message : String(error),
          })
        })
      }
    })
    return invocation
  }

  const wrap = (tool: McpToolDescriptor): McpToolDescriptor =>
    Object.freeze({
      ...tool,
      handler: async (raw: unknown): Promise<unknown> => {
        const key = invocationKey(tool.name, raw)
        let invocation = invocations.get(key)
        if (invocation === undefined) {
          invocation = start(tool, raw, key)
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
        if (outcome === undefined) {
          invocation.receipt ??= receipts.openToolReceipt(tool.name)
          return toolCallReceipt(tool.name, invocation.receipt, now() - invocation.startedAt)
        }
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

function toolCallReceipt(tool: string, receipt: string, elapsedMs: number): ToolCallReceipt {
  return {
    running: true,
    receipt,
    tool,
    elapsedMs,
    instruction:
      `${tool} is still running; nothing failed. Do not call it again: its result arrives with ` +
      `receipt ${receipt} when you are next woken. Continue other work, or end your turn to wait.`,
  }
}
