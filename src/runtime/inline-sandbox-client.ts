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
import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
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
 */
export function inlineSandboxClient(factory: ExecutorFactory<unknown>): SandboxClient {
  let seq = 0
  return {
    async create(options?: CreateSandboxOptions): Promise<SandboxInstance> {
      const id = `inline-${seq++}`
      // The `create(options)` backend override is threaded to the factory through
      // the `ExecutorContext.seams` channel (the designed opaque-seam extension
      // point), so a BYO executor that varies per-cell — e.g. the cli-bridge
      // executor reading its harness/model off `backend.type`/`backend.model.model`
      // — sees the same per-create config a real sandbox executor gets, without a
      // second client per cell.
      const createOptions = options
      return {
        id,
        async *streamPrompt(
          message: string,
          opts?: { signal?: AbortSignal },
        ): AsyncGenerator<SandboxEvent> {
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
          const spec: AgentSpec = { profile: { name: id }, harness: null }
          const exec = factory(spec, {
            nodeId: id,
            signal: controller.signal,
            seams: { createOptions },
          })
          try {
            const artifact = await settle(exec, message, controller.signal)
            const out = artifact.out as { content?: string } | undefined
            // Speak the runtime's metering protocol: `extractLlmCallEvent` reads
            // flat `llm_call` events, not the nested result payload — without
            // this the kernel meters the iteration as a fabricated $0 / 0 tokens.
            const tokensIn = artifact.spent.tokens.input
            const tokensOut = artifact.spent.tokens.output
            const costUsd = artifact.spent.usd
            if (tokensIn || tokensOut || costUsd) {
              yield {
                type: 'llm_call',
                data: { tokensIn, tokensOut, costUsd },
              } as unknown as SandboxEvent
            }
            yield {
              type: 'result',
              data: {
                finalText: out?.content ?? '',
                tokenUsage: {
                  inputTokens: tokensIn,
                  outputTokens: tokensOut,
                },
                costUsd,
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
