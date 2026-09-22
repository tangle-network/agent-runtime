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
import type {
  AgentSpec,
  Executor,
  ExecutorFactory,
  ExecutorResult,
  UsageEvent,
} from './supervise/types'
import { abortableAsyncIterable, awaitAbortable } from './turn-timeout'
import type { SandboxClient } from './types'

function isAsyncIterable(v: unknown): v is AsyncIterable<unknown> {
  return typeof v === 'object' && v !== null && Symbol.asyncIterator in v
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  const reason = signal.reason
  throw reason instanceof Error
    ? reason
    : new Error(reason === undefined ? 'prompt aborted' : String(reason))
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
          let exec: Executor<unknown> | undefined
          try {
            exec = factory(spec, { signal: controller.signal, seams: { createOptions } })
            const run = exec.execute(message, controller.signal)
            let artifact: ExecutorResult<unknown>
            if (isAsyncIterable(run)) {
              for await (const event of abortableAsyncIterable(
                run as AsyncIterable<UsageEvent>,
                controller.signal,
              )) {
                if (event.kind !== 'runtime_event') continue
                const { type, ...data } = event.event
                yield {
                  type,
                  data,
                  ...(event.eventId === undefined ? {} : { id: event.eventId }),
                  ...(event.cursor === undefined ? {} : { cursor: event.cursor }),
                  ...(event.sequence === undefined ? {} : { sequence: event.sequence }),
                  ...(event.occurredAt === undefined ? {} : { occurredAt: event.occurredAt }),
                } as unknown as SandboxEvent
              }
              throwIfAborted(controller.signal)
              artifact = exec.resultArtifact()
            } else {
              artifact = await awaitAbortable(run, controller.signal)
            }
            throwIfAborted(controller.signal)
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
            if (exec) {
              try {
                await awaitAbortable(
                  Promise.resolve().then(() => exec?.teardown('brutalKill')),
                  controller.signal,
                )
              } catch {
                // Teardown cannot replace the turn's result or abort reason.
              }
            }
          }
        },
        async delete(): Promise<void> {},
      } as unknown as SandboxInstance
    },
  }
}
