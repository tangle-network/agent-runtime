/**
 * authorStrategy — the agent-authored layer as a package primitive (software-3.0): an
 * LLM reads a benchmark's per-task LOSSES + the defineStrategy contract and writes a NEW
 * optimization strategy as code; the caller gates it like any human-built candidate
 * (runBenchmark + a frozen holdout).
 *
 * Brokered shot()/critique() calls spend through the Supervisor's conserved pool.
 * Source validation checks obvious forbidden operations; it is not an execution sandbox.
 * Code that uses other execution paths can access state or spend outside that pool.
 * Callers must provide isolation when authored code requires an enforced boundary.
 *
 * The authored module is written to `outDir` and dynamically imported — run under a
 * TS-capable loader (tsx) since models often emit type annotations.
 */

import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { sha256Bytes } from '../candidate-execution/digest'
import { strategyAuthorMethod } from '../improvement/optimizer-prompt'
import { assertAuthoredCode } from './authored-code'
import { profileChatClient } from './profile-chat-client'
import type { Strategy } from './strategy'
import type { ExecutorConfig } from './supervise/runtime'

/** The compressed consumable a skill carries: everything an author needs to emit a loop. */
export const strategyAuthorContract = `
You author an OPTIMIZATION STRATEGY for an agentic loop system. A strategy decides how to
spend a compute budget to beat a task's deployable check. You compose exactly two steps:

  shot(spec?: { handle?, messages?, steer?, profile?, tools? }): Promise<ShotResult | null>
    Runs ONE worker attempt (a bounded tool loop) over an artifact.
    - omit handle  => the shot opens its OWN fresh artifact and closes it after (a sample).
    - pass handle  => the shot CONTINUES that artifact (state accumulates across shots).
    - messages     => the carried conversation (pass the previous ShotResult.messages to continue).
    - steer        => a corrective instruction injected before the shot.
    - profile      => a complete AgentProfile — give THIS shot its own instructions,
      model, skills, tools, hooks, and subagents. Include name, harness, and
      model: { provider, default }; put standing instructions in prompt.systemPrompt.
      For example: { ...opts.workerProfile, name: 'researcher',
        prompt: { ...opts.workerProfile.prompt,
          systemPrompt: 'Inspect the evidence before proposing a change.' } }.
      Choose an available model from the current execution setup. Omit profile to use
      the worker's exact profile. Every shot spends from the same conserved budget.
    - tools        => string[] — restrict THIS shot to a subset of the task's tools by
      name (focus an explore shot on read-only tools, an execute shot on write tools).
      Restriction-only; unknown names make the shot fail. ALWAYS select from
      await listTools(handle) — never hardcode. Omitted => the shot sees every tool.
    ShotResult = { messages, score (0..1 on the task's check), passes, total, completions, toolErrors }
    Returns null if the attempt failed infra-wise.

  critique(messages): Promise<string | null>
    A firewalled trace-analyst reads the attempt's trajectory and returns ONE corrective
    instruction (or null when it judges the work complete). Costs ~1 completion.

  consult(messages, instruction): Promise<string | null>
    The RAW analyst channel: the same firewalled critic answers YOUR instruction over the
    trajectory verbatim (no reformatting) — use it when you need a specific reply format
    (a decision, a prediction). Costs ~1 completion.

  surface.open(task) / surface.close(handle)
    Open a persistent artifact you manage yourself (remember to close in a finally).
    close is idempotent — closing an already-closed handle is a safe no-op.

  listTools(handle): Promise<Array<{ name, description? }>>
    The tools THIS task actually offers. TOOL SETS VARY PER TASK — if you restrict a
    shot with \`tools\`, you MUST pick names from await listTools(handle); hardcoding
    names from an example kills your shots on every task whose tools differ.

Rules:
- ALWAYS await every shot/critique/surface call — a floating promise that rejects
  crashes the whole benchmark run.
- Stay within ~budget total shots; every shot/critique spends from a conserved pool.
- For a FRESH attempt OMIT \`messages\` entirely (never pass \`[]\` — an empty array is a
  fresh conversation too, but be explicit). To CONTINUE, pass the previous
  ShotResult.messages unchanged.
- Return { score, resolved, completions, progression, shots } — score = the BEST checkpoint
  you reached (keep-best, never final-state), progression = score after each shot.
- The module must be EXACTLY this shape (no other imports, no commentary outside code):

import { defineStrategy } from '@tangle-network/agent-runtime/kernel'
export default defineStrategy('your-strategy-name', async ({ surface, task, opts, budget, shot, critique, listTools }) => {
  // your composition (listTools comes from the destructured context — it is NOT a global)
})
`

export interface AuthorStrategyOptions {
  /** Exact author identity. Runtime binds it to every authoring turn. */
  profile: AgentProfile
  /** Execution substrate for the author. Behavioral settings are forbidden here. */
  executor: ExecutorConfig
  /** An exact fallback author tried once when the primary call fails or returns no code
   *  block (thinking models time out at the edge on long authoring prompts, or return
   *  empty content without `maxTokens`). Opt-in — absent means the primary's failure
   *  propagates. */
  fallbackProfile?: AgentProfile
  /** The contract text shown to the author. Default `strategyAuthorContract`. The
   *  meta-optimization coordinate: a GEPA/skill loop can evolve this text and gate each
   *  variant on the same frozen holdout as any strategy. */
  contract?: string
  /** The environment the losses came from (orientation only — never the verifiers). */
  environmentName: string
  /** The per-task losses table (e.g. JSON.stringify(report.perTask)) — the gradient. */
  lossesJson: string
  /** The budget the strategy must respect (shots/width). */
  budget: number
  /** Where the authored module file is written (created if missing). */
  outDir: string
  signal?: AbortSignal
}

/** Standing behavior callers put in the strategy-author AgentProfile. */
export const strategyAuthorSystemPrompt =
  'You are a senior researcher authoring optimization strategies for agent loops: you read ' +
  'per-task losses like experimental data, form a mechanism-level hypothesis, and author the ' +
  'one composition that tests it. Output exactly one fenced ```ts code block and nothing else.'

/** Static CONTRACT lint over an authored strategy module — the module-boundary
 *  enforcement of the harness's two measurement invariants:
 *    - author blindness: the only import allowed is the kernel surface. A body that could
 *      reach the filesystem, network, or process could read or mutate verifier/artifact
 *      state outside the brokered shots, and the harness-verified score would stop
 *      meaning "what the shots achieved".
 *    - conserved dose: no out-of-band compute (fetch/require/eval) — every unit a
 *      strategy spends is metered by the Supervisor's pool, which is what makes
 *      equal-budget comparisons between strategies valid.
 *  A lint, not a sandbox: its job is keeping the benchmark numbers interpretable. */
export function assertStrategyContract(code: string): void {
  // The shared authored-code lint, with this contract's one allowed import. Marginally looser
  // than the pre-0.169.1 check on purpose: any import FORM of the kernel module passes (the lint
  // gates which module, not the syntax), and the refusal is a ValidationError.
  assertAuthoredCode(code, { allowedImports: ['@tangle-network/agent-runtime/kernel'] })
}

export interface AuthoredStrategy {
  strategy: Strategy
  file: string
  code: string
}

/** One authoring turn: the author's reply and what the call reported spending. */
export interface StrategyAuthorTurn {
  content: string
  /** The model the provider reported answering. */
  model: string
  inputTokens: number
  outputTokens: number
  /** False when the call reported no token usage. */
  tokensKnown: boolean
  /** Provider-billed dollars; null when the call reported none. */
  costUsd: number | null
}

/** What an author wrote: the fenced module, or null when no reply carried one, and every
 *  authoring turn that ran (the primary, then the fallback when the primary failed). */
export interface StrategySource {
  code: string | null
  turns: StrategyAuthorTurn[]
}

/** Ask the author for a strategy module. A failed call throws; a reply without a fenced
 *  module is `code: null`. With `fallbackProfile`, the fallback gets one attempt when the
 *  primary call fails or its reply carries no module. */
export async function requestStrategySource(opts: AuthorStrategyOptions): Promise<StrategySource> {
  const turns: StrategyAuthorTurn[] = []
  const attempt = async (profile: AgentProfile): Promise<string | null> => {
    const res = await profileChatClient({
      profile,
      executor: opts.executor,
      context: 'strategy author',
    }).chat(
      {
        messages: [
          {
            role: 'user',
            content: `${opts.contract ?? strategyAuthorContract}\n\nBASELINE RESULTS on the "${opts.environmentName}" environment (budget=${opts.budget}) — the per-task losses are your gradient:\n${opts.lossesJson}\n\nAuthor ONE new strategy that you expect to beat the baselines on THIS environment at the same budget.\n${strategyAuthorMethod}\n\nOutput only the module code block.`,
          },
        ],
      },
      { ...(opts.signal ? { signal: opts.signal } : {}) },
    )
    turns.push({
      content: res.content,
      model: res.model,
      inputTokens: res.usage.promptTokens,
      outputTokens: res.usage.completionTokens,
      tokensKnown: res.usage.captured !== false,
      costUsd: res.costUsd,
    })
    return res.content.match(/```(?:ts|typescript)?\s*\n([\s\S]*?)```/)?.[1] ?? null
  }
  try {
    const code = await attempt(opts.profile)
    if (code !== null || !opts.fallbackProfile) return { code, turns }
  } catch (primaryError) {
    if (!opts.fallbackProfile) throw primaryError
  }
  return { code: await attempt(opts.fallbackProfile), turns }
}

/** Lint an authored module, write it under `outDir` at a name its content fixes, and import
 *  its default Strategy. The same source always loads from the same file. Throws when the
 *  module breaks the contract or exports no Strategy. */
export async function loadAuthoredStrategy(
  code: string,
  outDir: string,
): Promise<{ strategy: Strategy; file: string }> {
  assertStrategyContract(code)
  const digest = sha256Bytes(Buffer.from(code, 'utf8')).slice('sha256:'.length)
  const file = join(outDir, `strategy-${digest}.mts`)
  if (!existsSync(file)) {
    mkdirSync(outDir, { recursive: true })
    const partial = `${file}.${process.pid}.tmp`
    writeFileSync(partial, code)
    renameSync(partial, file)
  }
  const mod = (await import(pathToFileURL(file).href)) as { default?: Strategy }
  if (!mod.default || typeof mod.default.driver !== 'function' || !mod.default.name) {
    throw new Error(`authorStrategy: ${file} does not export a default Strategy`)
  }
  return { strategy: mod.default, file }
}

/** Author + load a strategy from losses. Throws when the author emits no loadable module;
 *  with `fallbackProfile` set, the fallback gets one attempt first. */
export async function authorStrategy(opts: AuthorStrategyOptions): Promise<AuthoredStrategy> {
  const { code, turns } = await requestStrategySource(opts)
  if (code === null) {
    throw new Error(
      `authorStrategy: no code block in the author's reply: ${(turns.at(-1)?.content ?? '').slice(0, 300)}`,
    )
  }
  return { ...(await loadAuthoredStrategy(code, opts.outDir)), code }
}
