/**
 * authorLoop — the codemode layer over the loop atom: an LLM reads a goal + the defineLoop
 * contract and WRITES a coded loop as a module; the caller spawns it as a first-class atom
 * (`loopChild` → the loop-executor) and it settles gated on its own `check`, budget-conserved
 * and depth-bounded like any spawned child.
 *
 * This is to `defineLoop` what `authorStrategy` is to `defineStrategy`: the "supervisor writes
 * the loop" seam. The authored body composes real code (spawns children on the nested scope,
 * fans out, pipelines) while the runtime owns iteration, the conserved budget, the gate, and
 * steer-between-rounds — so an authored loop can be WRONG but cannot overspend the pool or
 * skip the completion check.
 *
 * Safety is structural, not a sandbox (mirrors `authorStrategy`): the same `assertStrategyContract`
 * lint bounds the module to the loops import and bans out-of-band compute (require/eval/fetch/
 * process/node builtins), and the authored module is written to `outDir` and dynamically imported
 * under a TS-capable loader (tsx) since models emit type annotations.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatClient } from '@tangle-network/agent-eval'
import { assertStrategyContract } from './strategy-author'
import type { LoopDef } from './supervise/loop-executor'

/** The compressed consumable a skill carries: everything an author needs to emit a loop atom. */
export const loopAuthorContract = `
You author a LOOP ATOM for an agent supervisor. A loop runs a bounded, multi-round journey
toward a deployable check; a supervisor spawns / observes / steers it exactly like a worker.
You write ONE round; the runtime owns the round ceiling, the conserved budget, the gate, and
folding a supervisor's steer into the next round. So write real control flow inside a round,
but never write the loop's stop condition as "hope the model stops" — that is the runtime's job.

You export ONE module of EXACTLY this shape (no other imports, no commentary outside the code):

import { defineLoop } from '@tangle-network/agent-runtime/loops'
export default defineLoop('your-loop-name', {
  maxRounds: 3,
  round: async ({ task, scope, round, maxRounds, steer, budget, signal }) => {
    // arbitrary code for ONE round. Do real work by spawning children on the nested scope:
    //   const w = scope.spawn(childAgent, subtask, { budget: perRound, label: \`r\${round}\` })
    //   if (!w.ok) throw new Error(w.reason)      // fail loud: budget-exhausted | depth-exceeded
    //   const settled = await scope.next()        // conserved child work; settles gated
    // 'steer' is the supervisor's messages since the last round (fold them into what you do next).
    // 'signal' aborts if a forceful steer arrives mid-round — pass it to your awaited work.
    return { out: /* the running result */ undefined, done: false }  // done:true stops early
  },
  check: (out) => /* the deployable completion oracle */ Boolean(out),
})

The round context:
  task       the spawn task, verbatim.
  scope      the NESTED conserved scope. scope.spawn(agent, task, { budget, label }) reserves
             budget and fails closed; scope.next() awaits one child settlement. Budget NESTS —
             the pool reserves each spawn's full ceiling until it settles, so give children a
             per-round budget smaller than the loop's own.
  round      1-based round index. maxRounds is the declared ceiling.
  steer      readonly string[] — supervisor steer_agent messages that arrived since last round.
  budget     conserved-pool readouts (tokensLeft, usdLeft, deadlineMs) for in-body awareness.
  signal     AbortSignal — the spawn signal + a fresh per-round interrupt; honor it in awaits.

The round result: { out: unknown; done?: boolean }. 'out' is the running result the gate reads;
'done: true' is YOUR early stop (distinct from the runtime's gate 'check').

check(out): boolean | Promise<boolean>. The DEPLOYABLE oracle — an executable test, a state
verifier, a readiness score threshold — read off 'out', never the model judging itself. The loop
settles valid IFF check passes, and the runtime polls it after each round to stop the instant the
loop has delivered. A loop that exhausts maxRounds without check passing settles valid:false.

Rules:
- ALWAYS await every scope.spawn drain / async call — a floating rejection crashes the run.
- Do real work by SPAWNING children; raw un-metered inference in the body is not budget-conserved.
- Give 'check' a real oracle. A loop whose check is a self-judged score cannot be trusted.
- The only import allowed is '@tangle-network/agent-runtime/loops'. No require/eval/fetch/process/
  node builtins — the runtime meters and gates you; out-of-band compute breaks that.
`

export interface AuthorLoopOptions {
  /** The model-call seam (agent-eval `createChatClient`). */
  chat: ChatClient
  model?: string
  /** A NAMED fallback author tried once when the primary call fails or returns no code block
   *  (thinking models can time out at the edge on long authoring prompts, or return empty
   *  content without `maxTokens`). Opt-in — absent means the primary's failure propagates. */
  fallbackModel?: string
  /** The contract text shown to the author. Default `loopAuthorContract`. A skill/GEPA loop can
   *  evolve this text and gate each variant on the same check as any loop. */
  contract?: string
  /** What the loop must accomplish — the objective, in plain language (the author's orientation). */
  goal: string
  /** Optional orienting context: the check's shape, the child agents available, prior findings —
   *  never the check's internals (the author stays blind to the oracle, like `authorStrategy`). */
  context?: string
  /** The round ceiling the loop must respect. */
  maxRounds: number
  /** Where the authored module file is written (created if missing). */
  outDir: string
  temperature?: number
  /** Completion cap — required by thinking-model authors that stream reasoning first. */
  maxTokens?: number
  signal?: AbortSignal
}

export interface AuthoredLoop {
  loop: LoopDef
  file: string
  code: string
}

/** One authoring attempt: chat with the given model, extract the fenced module. Throws when
 *  the reply carries no code block. */
async function requestAuthoredCode(
  opts: AuthorLoopOptions,
  model: string | undefined,
): Promise<string> {
  const res = await opts.chat.chat(
    {
      ...(model ? { model } : {}),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
      messages: [
        {
          role: 'system',
          content:
            'You are a senior engineer authoring coded loop atoms for an agent supervisor. Output exactly one fenced ```ts code block and nothing else.',
        },
        {
          role: 'user',
          content: `${opts.contract ?? loopAuthorContract}\n\nGOAL: ${opts.goal}\nMAX ROUNDS: ${opts.maxRounds}${opts.context ? `\n\nCONTEXT:\n${opts.context}` : ''}\n\nAuthor ONE loop that reaches the goal within the round ceiling, gated on a real check. Output only the module code block.`,
        },
      ],
    },
    { ...(opts.signal ? { signal: opts.signal } : {}) },
  )
  const match = res.content.match(/```(?:ts|typescript)?\s*\n([\s\S]*?)```/)
  if (!match?.[1]) {
    throw new Error(
      `authorLoop: no code block in the author's reply (model=${model ?? 'default'}): ${res.content.slice(0, 300)}`,
    )
  }
  return match[1]
}

/** True when a dynamically-imported default export is a runnable `LoopDef`. */
function isLoopDef(value: unknown): value is LoopDef {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { round?: unknown }).round === 'function' &&
    typeof (value as { name?: unknown }).name === 'string' &&
    Number.isInteger((value as { maxRounds?: unknown }).maxRounds)
  )
}

/**
 * Author + load a coded loop from a goal. Throws when the author emits no loadable module; with
 * `fallbackModel` set, the named fallback gets one attempt first. The returned `loop` is handed
 * to `loopChild(loop, journal)` and spawned as a first-class atom.
 */
export async function authorLoop(opts: AuthorLoopOptions): Promise<AuthoredLoop> {
  let code: string
  try {
    code = await requestAuthoredCode(opts, opts.model)
  } catch (primaryError) {
    if (!opts.fallbackModel) throw primaryError
    code = await requestAuthoredCode(opts, opts.fallbackModel)
  }
  assertStrategyContract(code)
  mkdirSync(opts.outDir, { recursive: true })
  const file = join(opts.outDir, `authored-loop-${Date.now()}.mts`)
  writeFileSync(file, code)
  const mod = (await import(`file://${file}`)) as { default?: unknown }
  if (!isLoopDef(mod.default)) {
    throw new Error(`authorLoop: ${file} does not default-export a LoopDef (defineLoop(...))`)
  }
  return { loop: mod.default, file, code }
}
