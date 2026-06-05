/**
 * @experimental
 *
 * The LIVE operator driver — an `Agent` whose `act` hands the operator toolbox to an LLM tool-loop,
 * so the MODEL's tool calls ARE the topology. This is the piece that makes "the root decides any
 * topology" real: the driver does not run a fixed plan: each turn it calls a tool
 * (spawn_worker / await_next / observe_worker / steer_worker / run_analyst / stop) and the shape of
 * the run — how many workers, how deep, when to branch, when to stop — emerges from those calls.
 *
 * It runs INSIDE the keystone Supervisor: `act(task, scope)` builds `createOperatorToolbox` over the
 * scope it is handed, so every spawn reserves from the conserved budget pool (equal-k by
 * construction — an LLM that tries to spawn past the pool gets a fail-closed error, never extra
 * compute), the journal records the tree, and a worker may itself be a driver (drivers-of-drivers).
 *
 * Selection is the driver's, not the supervisor's (selector ≠ judge): the driver reads the DEPLOYABLE
 * verdict off each `await_next` settlement (the ledger `toolbox.settled()`) and returns the best
 * valid worker's output as its deliverable. The analyst lens (`run_analyst`) reads only the trace and
 * never the score — it informs the driver's steering, not its selection.
 *
 * The LLM call is INJECTED (`chat`) so this stays runtime-agnostic: in-process it is a router chat
 * with tools; in a sandbox it is the harness's own tool-calling loop pointed at the toolbox over MCP.
 */

import type { Agent, Budget, ResultBlobStore, Scope } from '../../loops'
import type { McpToolDescriptor } from '../server'
import {
  createOperatorToolbox,
  type MakeWorkerAgent,
  type OperatorToolboxOptions,
  type SettledWorker,
} from './operator-toolbox'

/** One tool-call the model emitted — provider-neutral (OpenAI/Anthropic both map onto this). */
export interface ToolCallRequest {
  readonly id: string
  readonly name: string
  /** Raw JSON arguments string as emitted by the model. */
  readonly arguments: string
}

/** What one `chat` turn returns: assistant text (if any) + the tool calls the model wants run. */
export interface ToolChatTurn {
  readonly content: string | null
  readonly toolCalls: ToolCallRequest[]
}

/** The injected LLM-with-tools call. `messages` is the running transcript (system/user/assistant/tool
 *  roles, OpenAI shape); `tools` are the toolbox tools as function schemas. Returns the next turn. */
export type ToolChat = (
  messages: ReadonlyArray<Record<string, unknown>>,
  tools: ReadonlyArray<{
    type: 'function'
    function: { name: string; description?: string; parameters: unknown }
  }>,
) => Promise<ToolChatTurn>

export interface OperatorDriverOptions {
  /** The driver persona — the lead-steerer system prompt (judgment: spawn, review, steer, stop). */
  readonly systemPrompt: string
  /** Render the run's task into the opening user message (domain-specific; the toolbox stays blind). */
  readonly describeTask: (task: unknown) => string
  /** The injected LLM-with-tools call (router in-process; the harness loop in a sandbox). */
  readonly chat: ToolChat
  /** Shared with the Supervisor — the same blob store the scope writes worker outputs to. */
  readonly blobs: ResultBlobStore
  /** Turn a `spawn_worker` profile into a leaf agent (registry-resolved on spawn). */
  readonly makeWorkerAgent: MakeWorkerAgent
  /** Per-worker conserved budget reserved on each spawn (the pool caps total spawns ⇒ equal-k). */
  readonly perWorker: Budget
  /** Optional analyst seam (enables list_analysts / run_analyst). */
  readonly analystKinds?: OperatorToolboxOptions['analystKinds']
  readonly runAnalyst?: OperatorToolboxOptions['runAnalyst']
  /** Hard ceiling on LLM turns — a backstop so a non-stopping model still terminates. */
  readonly maxTurns: number
  /** Reject `stop` until at least this many workers have settled `done` — an operator cannot ship
   *  nothing. Default 0 (a driver may legitimately stop with no work). Set ≥1 to force a real attempt. */
  readonly minWorkersBeforeStop?: number
  /** Consecutive bare (no-tool-call) turns tolerated before the run ends as a no-winner. Default 3. */
  readonly maxBareTurns?: number
  /** Optional per-turn observability hook (the driver's reasoning + the tool results it saw). */
  readonly onStep?: (step: OperatorStep) => void
}

export interface OperatorStep {
  readonly turn: number
  readonly content: string | null
  readonly calls: Array<{ name: string; args: string; result: unknown }>
}

/** The driver's deliverable `Out` — the selected worker's output + the run's shape. The Supervisor
 *  content-addresses this as the winner; `selected` is null when no worker settled `done`. */
export interface OperatorDriverResult {
  readonly mode: 'operator-driver'
  /** Did the selected worker's DEPLOYABLE verdict pass? */
  readonly resolved: boolean
  /** The selected worker's deployable score in [0,1]. */
  readonly score: number
  /** The selected worker's output (rehydrated from its result blob), or null if none settled done. */
  readonly selected: unknown
  /** LLM turns the driver took. */
  readonly turns: number
  /** Every worker the driver drained (the full ledger). */
  readonly workers: ReadonlyArray<SettledWorker>
  /** Why the driver stopped (its `stop` reason, or the backstop that fired). */
  readonly stopReason: string
}

/** Map the toolbox's MCP tool descriptors to provider-neutral function schemas for `chat`. */
function toolSchemas(tools: ReadonlyArray<McpToolDescriptor>) {
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }))
}

/** Best valid worker by deployable score (ties → highest score, then earliest); falls back to the
 *  best-scoring worker when none passed. Mirrors the kernel's defaultSelectWinner intent (the
 *  driver is the selector and reads the deployable verdict — never an oracle). */
function selectBest(workers: ReadonlyArray<SettledWorker>): SettledWorker | undefined {
  const done = workers.filter((w) => w.status === 'done')
  if (done.length === 0) return undefined
  const valid = done.filter((w) => w.valid)
  const pool = valid.length > 0 ? valid : done
  return pool.reduce((best, w) => ((w.score ?? 0) > (best.score ?? 0) ? w : best))
}

/** Build the live operator driver as an `Agent` run by the Supervisor. */
export function createOperatorDriverAgent(
  opts: OperatorDriverOptions,
): Agent<unknown, OperatorDriverResult> {
  return {
    name: 'operator-driver',
    async act(task, scope): Promise<OperatorDriverResult> {
      const toolbox = createOperatorToolbox({
        scope: scope as Scope<unknown>,
        blobs: opts.blobs,
        makeWorkerAgent: opts.makeWorkerAgent,
        perWorker: opts.perWorker,
        ...(opts.analystKinds ? { analystKinds: opts.analystKinds } : {}),
        ...(opts.runAnalyst ? { runAnalyst: opts.runAnalyst } : {}),
      })
      const byName = new Map(toolbox.tools.map((t) => [t.name, t]))
      const schemas = toolSchemas(toolbox.tools)
      const messages: Array<Record<string, unknown>> = [
        { role: 'system', content: opts.systemPrompt },
        { role: 'user', content: opts.describeTask(task) },
      ]

      let turn = 0
      let bareTurns = 0
      const maxBareTurns = opts.maxBareTurns ?? 3
      for (; turn < opts.maxTurns && !toolbox.isStopped(); turn += 1) {
        const out = await opts.chat(messages, schemas)
        messages.push({
          role: 'assistant',
          content: out.content,
          ...(out.toolCalls.length > 0
            ? {
                tool_calls: out.toolCalls.map((c) => ({
                  id: c.id,
                  type: 'function',
                  function: { name: c.name, arguments: c.arguments },
                })),
              }
            : {}),
        })

        if (out.toolCalls.length === 0) {
          // The model answered in prose instead of acting (some providers ignore tool_choice).
          // An operator's job is to ORCHESTRATE, not solve — re-nudge firmly. Bounded by maxBareTurns
          // so a model that simply will not drive ends as a no-winner rather than spinning forever.
          bareTurns += 1
          if (bareTurns >= maxBareTurns) break
          messages.push({
            role: 'user',
            content:
              'You did not call a tool. You CANNOT answer in prose — your only deliverable is a worker result. ' +
              'Call a tool now: spawn_worker to attempt the task, await_next to read a result, or stop only after a worker has completed.',
          })
          continue
        }
        bareTurns = 0

        const calls: OperatorStep['calls'] = []
        for (const c of out.toolCalls) {
          const tool = byName.get(c.name)
          let result: unknown
          // Guard: an operator cannot declare done with nothing to ship. A `stop` before
          // `minWorkersBeforeStop` workers have settled `done` is rejected with a corrective
          // result and the loop continues (bounded by maxTurns) — fixes the premature-done failure
          // where the model "answers" without ever spawning a worker.
          const min = opts.minWorkersBeforeStop ?? 0
          const doneSoFar = toolbox.settled().filter((w) => w.status === 'done').length
          if (c.name === 'stop' && min > 0 && doneSoFar < min) {
            result = { error: `cannot stop yet — ${doneSoFar}/${min} workers have completed. You must spawn_worker and await_next at least ${min} worker(s) (you cannot answer directly) before stopping.` }
          } else if (!tool) result = { error: `unknown tool ${JSON.stringify(c.name)}` }
          else {
            // Parse args first; malformed JSON is a model-fixable mistake — feed it back, do NOT
            // call the handler with garbage. A handler throw (bad/missing arg) is likewise fed back
            // so the model self-corrects, rather than throwing out of act() and discarding the whole
            // run over one correctable tool call. (A genuinely fatal wiring error keeps erroring and
            // the run ends at maxTurns as a no-winner — never a crash.)
            let args: unknown
            let parseError = false
            try {
              args = c.arguments ? JSON.parse(c.arguments) : {}
            } catch {
              parseError = true
            }
            if (parseError) {
              result = { error: `invalid JSON in arguments for ${c.name} — re-emit valid JSON.` }
            } else {
              try {
                result = await tool.handler(args ?? {})
              } catch (err) {
                result = { error: `tool ${c.name} failed: ${err instanceof Error ? err.message : String(err)}` }
              }
            }
          }
          calls.push({ name: c.name, args: c.arguments, result })
          messages.push({
            role: 'tool',
            tool_call_id: c.id,
            name: c.name,
            content: JSON.stringify(result),
          })
          if (toolbox.isStopped()) break
        }
        opts.onStep?.({ turn, content: out.content, calls })
      }

      // Drain any workers the driver spawned but did not await, so their verdicts join the ledger
      // before selection. Going through await_next keeps ONE ledger (it records each settlement);
      // it returns { idle: true } once the live set is empty.
      const awaitNext = byName.get('await_next')
      if (awaitNext) {
        for (;;) {
          const r = (await awaitNext.handler({})) as { idle?: boolean }
          if (r?.idle) break
        }
      }

      const workers = toolbox.settled()
      const best = selectBest(workers)
      const selected = best?.outRef ? await opts.blobs.get(best.outRef) : null
      return {
        mode: 'operator-driver',
        resolved: best?.valid ?? false,
        score: best?.score ?? 0,
        selected: selected ?? null,
        turns: turn,
        workers,
        stopReason: toolbox.stopReason() ?? (toolbox.isStopped() ? 'stopped' : 'max-turns'),
      }
    },
  }
}
