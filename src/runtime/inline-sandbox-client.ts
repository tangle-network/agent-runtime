/**
 * The ONE pseudo-box adapter: present any one-shot `Executor` (router / bridge /
 * BYO) as a `SandboxClient` so the round-synchronous `runAgentRounds` can drive it
 * without each call site re-faking a box. This is the single shell that
 * `bench/src/router-executor.ts`, generate-eval's old `bridgeSandboxClient`, and
 * the search-bench bridge transport were each re-implementing.
 *
 * It is deliberately for NON-box executors only — a real sandbox harness already
 * IS a `SandboxClient` (boxes, sessions, fs, fork are real there). Here each
 * `streamPrompt` runs the executor once and emits the terminal
 * `{type:'result', data:{finalText, tokenUsage, costUsd}}` event that
 * `answerOutput`/the kernel's cost ledger already parse — no sessions, no fs,
 * no fork (those degrade gracefully via the optional `SandboxClient` methods).
 */

import { type AgentProfile, agentProfileSchema } from '@tangle-network/agent-interface'
import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { assertBoxlessPromptOptions } from './prompt-options'
import type { AgentSpec, Executor, ExecutorFactory, ExecutorResult } from './supervise/types'
import type { SandboxClient } from './types'

function isAsyncIterable(v: unknown): v is AsyncIterable<unknown> {
  return typeof v === 'object' && v !== null && Symbol.asyncIterator in v
}

/** Drive a (possibly streaming) executor to its terminal artifact. */
async function settle(
  exec: Executor<unknown>,
  task: unknown,
  signal: AbortSignal,
): Promise<ExecutorResult<unknown>> {
  const r = exec.execute(task, signal)
  if (isAsyncIterable(r)) {
    for await (const _ of r) {
      // streaming executors meter as they run; the artifact is read after drain.
    }
    return exec.resultArtifact()
  }
  return r
}

/**
 * Adapt an `ExecutorFactory` into a `SandboxClient` for `runAgentRounds`. The factory is
 * instantiated fresh per `streamPrompt` (mirrors the per-spawn executor lifecycle):
 * run once on the prompt, emit the terminal result event, tear down.
 *
 * There is no box, so a per-prompt `backend` or `model` override is refused rather than dropped;
 * other per-prompt options (`timeoutMs`, `context`) are accepted and ignored.
 */
export function inlineSandboxClient(
  factory: ExecutorFactory<unknown>,
  defaults: { profile?: AgentProfile } = {},
): SandboxClient {
  const capturedDefaultProfile =
    defaults.profile === undefined
      ? undefined
      : agentProfileSchema.parse(structuredClone(defaults.profile))
  let seq = 0
  return {
    async create(options?: CreateSandboxOptions): Promise<SandboxInstance> {
      const id = `inline-${seq++}`
      // The requested backend remains visible so Runtime can reject a conflicting redundant
      // declaration. The exact profile below remains the sole behavioral source.
      const createOptions = options
      return {
        id,
        async *streamPrompt(
          message: string,
          opts?: { signal?: AbortSignal },
        ): AsyncGenerator<SandboxEvent> {
          assertBoxlessPromptOptions(opts, 'inlineSandboxClient')
          // Chain the caller's turn signal into the executor's spawn signal so
          // an abort reaches `exec.execute` — a cooperative executor settles
          // (throws) instead of running to completion after cancellation.
          const controller = new AbortController()
          const callerSignal = opts?.signal
          const onAbort = () =>
            controller.abort(callerSignal?.reason ?? new Error('prompt aborted'))
          if (callerSignal) {
            if (callerSignal.aborted) onAbort()
            else callerSignal.addEventListener('abort', onAbort, { once: true })
          }
          const requestedProfile =
            (options?.backend && typeof options.backend === 'object'
              ? (options.backend as { profile?: unknown }).profile
              : undefined) ?? capturedDefaultProfile
          const parsedProfile = agentProfileSchema.safeParse(requestedProfile)
          if (!parsedProfile.success) {
            throw new Error(
              'inlineSandboxClient: an exact AgentProfile is required; pass defaults.profile or create({ backend: { profile } })',
            )
          }
          const spec: AgentSpec = { profile: parsedProfile.data, harness: null }
          const exec = factory(spec, { signal: controller.signal, seams: { createOptions } })
          try {
            const artifact = await settle(exec, message, controller.signal)
            const out = artifact.out as
              | {
                  content?: string
                  estimatedCostUsd?: number
                  promptCache?: Readonly<Record<string, number | string>>
                }
              | undefined
            // Speak the runtime's metering protocol: `extractLlmCallEvent` reads
            // flat `llm_call` events, not the nested result payload — without
            // this the kernel meters the iteration as a fabricated $0 / 0 tokens.
            const tokensIn = artifact.spent.tokens.input
            const tokensOut = artifact.spent.tokens.output
            const costUsd = artifact.spent.usd
            const estimatedCostUsd = out?.estimatedCostUsd
            if (
              artifact.spent.iterations > 0 ||
              artifact.spent.tokensKnown === false ||
              artifact.spent.usdKnown === false ||
              tokensIn > 0 ||
              tokensOut > 0 ||
              costUsd > 0 ||
              estimatedCostUsd !== undefined
            ) {
              yield {
                type: 'llm_call',
                data: {
                  ...(artifact.spent.tokensKnown === false ? {} : { tokensIn, tokensOut }),
                  ...(artifact.spent.usdKnown !== false ? { costUsd } : {}),
                  ...(artifact.spent.tokensKnown === false ? { tokensKnown: false } : {}),
                  ...(artifact.spent.usdKnown === false ? { costKnown: false } : {}),
                  ...(artifact.spent.usdKnown !== false
                    ? {
                        costKnown: true,
                        costProvenance: 'provider-receipt',
                      }
                    : {}),
                  ...(estimatedCostUsd !== undefined ? { estimatedCostUsd } : {}),
                  ...(out?.promptCache ? { promptCache: out.promptCache } : {}),
                },
              } as unknown as SandboxEvent
            }
            yield {
              type: 'result',
              data: {
                finalText: out?.content ?? '',
                ...(artifact.spent.tokensKnown === false
                  ? { tokensKnown: false }
                  : {
                      tokenUsage: {
                        inputTokens: tokensIn,
                        outputTokens: tokensOut,
                      },
                    }),
                ...(artifact.spent.usdKnown === false
                  ? { costKnown: false, ...(costUsd > 0 ? { costUsd } : {}) }
                  : {
                      costUsd,
                      costKnown: true,
                      costProvenance: 'provider-receipt',
                    }),
                ...(estimatedCostUsd !== undefined ? { estimatedCostUsd } : {}),
                ...(out?.promptCache ? { promptCache: out.promptCache } : {}),
              },
            } as unknown as SandboxEvent
          } finally {
            callerSignal?.removeEventListener('abort', onAbort)
            await exec.teardown('brutalKill').catch(() => {})
          }
        },
        async delete(): Promise<void> {},
      } as unknown as SandboxInstance
    },
  }
}
