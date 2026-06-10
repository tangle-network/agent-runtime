/**
 * authorStrategy — the agent-authored layer as a package primitive (software-3.0): an
 * LLM reads a benchmark's per-task LOSSES + the defineStrategy contract and writes a NEW
 * optimization strategy as code; the caller gates it like any human-built candidate
 * (runBenchmark + a frozen holdout).
 *
 * Structurally safe by construction: the authored body composes shot()/critique() and
 * spends through the Supervisor's conserved pool — it can be wrong, but it cannot
 * Goodhart the check (it never sees the verifiers) and it cannot win by overspending.
 *
 * The authored module is written to `outDir` and dynamically imported — run under a
 * TS-capable loader (tsx) since models often emit type annotations.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatClient } from '@tangle-network/agent-eval'
import type { Strategy } from './strategy'

/** The compressed consumable a skill carries: everything an author needs to emit a loop. */
export const strategyAuthorContract = `
You author an OPTIMIZATION STRATEGY for an agentic loop system. A strategy decides how to
spend a compute budget to beat a task's deployable check. You compose exactly two steps:

  shot(spec?: { handle?, messages?, steer?, persona?, tools? }): Promise<ShotResult | null>
    Runs ONE worker attempt (a bounded tool loop) over an artifact.
    - omit handle  => the shot opens its OWN fresh artifact and closes it after (a sample).
    - pass handle  => the shot CONTINUES that artifact (state accumulates across shots).
    - messages     => the carried conversation (pass the previous ShotResult.messages to continue).
    - steer        => a corrective instruction injected before the shot.
    - persona      => { systemPrompt?, model? } — give THIS shot its own role and/or model
      (multi-agent strategies: a researcher shot then an engineer shot, a panel of k
      personas over one budget). On a fresh shot the systemPrompt replaces the task's; on
      a carried conversation it arrives as a hand-off message. Same conserved budget.
    - tools        => string[] — restrict THIS shot to a subset of the task's tools by
      name (focus an explore shot on read-only tools, an execute shot on write tools).
      Restriction-only; unknown names make the shot fail. ALWAYS select from
      await listTools(handle) — never hardcode. Omitted => the shot sees every tool.
    ShotResult = { messages, score (0..1 on the task's check), passes, total, completions, toolErrors }
    Returns null if the attempt failed infra-wise.

  critique(messages): Promise<string | null>
    A firewalled trace-analyst reads the attempt's trajectory and returns ONE corrective
    instruction (or null when it judges the work complete). Costs ~1 completion.

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

import { defineStrategy } from '@tangle-network/agent-runtime/loops'
export default defineStrategy('your-strategy-name', async ({ surface, task, budget, shot, critique, listTools }) => {
  // your composition (listTools comes from the destructured context — it is NOT a global)
})
`

export interface AuthorStrategyOptions {
  /** The model-call seam (agent-eval `createChatClient`). */
  chat: ChatClient
  model?: string
  /** A NAMED fallback author tried once when the primary call fails or returns no code
   *  block (thinking models time out at the edge on long authoring prompts, or return
   *  empty content without `maxTokens`). Opt-in — absent means the primary's failure
   *  propagates. */
  fallbackModel?: string
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
  temperature?: number
  /** Completion cap — required by thinking-model authors that stream reasoning first. */
  maxTokens?: number
  signal?: AbortSignal
}

/** Static CONTRACT lint over an authored strategy module — the module-boundary
 *  enforcement of the harness's two measurement invariants:
 *    - author blindness: the only import allowed is the loops surface. A body that could
 *      reach the filesystem, network, or process could read or mutate verifier/artifact
 *      state outside the brokered shots, and the harness-verified score would stop
 *      meaning "what the shots achieved".
 *    - conserved dose: no out-of-band compute (fetch/require/eval) — every unit a
 *      strategy spends is metered by the Supervisor's pool, which is what makes
 *      equal-budget comparisons between strategies valid.
 *  A lint, not a sandbox: its job is keeping the benchmark numbers interpretable. */
export function assertStrategyContract(code: string): void {
  const allowedImport =
    /^\s*import\s+\{[^}]*\}\s+from\s+['"]@tangle-network\/agent-runtime\/loops['"]/
  for (const line of code.split('\n')) {
    if (/^\s*import\s/.test(line) && !allowedImport.test(line)) {
      throw new Error(`authored code rejected: foreign import — ${line.trim().slice(0, 120)}`)
    }
  }
  const banned: Array<[RegExp, string]> = [
    [/\brequire\s*\(/, 'require()'],
    [/\bimport\s*\(/, 'dynamic import()'],
    [/\beval\s*\(/, 'eval()'],
    [/new\s+Function\s*\(/, 'new Function()'],
    [/\bprocess\s*[.[]/, 'process access'],
    [/\bglobalThis\s*[.[]/, 'globalThis access'],
    [/\bfetch\s*\(/, 'network access'],
    [/child_process|node:fs|node:net|node:http|worker_threads/, 'node builtin access'],
  ]
  for (const [re, what] of banned) {
    if (re.test(code)) throw new Error(`authored code rejected: ${what}`)
  }
}

export interface AuthoredStrategy {
  strategy: Strategy
  file: string
  code: string
}

/** One authoring attempt: chat with the given model, extract the fenced module. Throws
 *  when the reply carries no code block. */
async function requestAuthoredCode(
  opts: AuthorStrategyOptions,
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
            'You are a senior engineer authoring optimization strategies for agent loops. Output exactly one fenced ```ts code block and nothing else.',
        },
        {
          role: 'user',
          content: `${opts.contract ?? strategyAuthorContract}\n\nBASELINE RESULTS on the "${opts.environmentName}" environment (budget=${opts.budget}):\n${opts.lossesJson}\n\nAuthor ONE new strategy that you expect to beat the baselines on THIS environment at the same budget. Use the losses to target the observed failure mode. Output only the module code block.`,
        },
      ],
    },
    { ...(opts.signal ? { signal: opts.signal } : {}) },
  )
  const match = res.content.match(/```(?:ts|typescript)?\s*\n([\s\S]*?)```/)
  if (!match?.[1]) {
    throw new Error(
      `authorStrategy: no code block in the author's reply (model=${model ?? 'default'}): ${res.content.slice(0, 300)}`,
    )
  }
  return match[1]
}

/** Author + load a strategy from losses. Throws when the author emits no loadable module;
 *  with `fallbackModel` set, the named fallback gets one attempt first. */
export async function authorStrategy(opts: AuthorStrategyOptions): Promise<AuthoredStrategy> {
  let code: string
  try {
    code = await requestAuthoredCode(opts, opts.model)
  } catch (primaryError) {
    if (!opts.fallbackModel) throw primaryError
    code = await requestAuthoredCode(opts, opts.fallbackModel)
  }
  assertStrategyContract(code)
  mkdirSync(opts.outDir, { recursive: true })
  const file = join(opts.outDir, `authored-${Date.now()}.mts`)
  writeFileSync(file, code)
  const mod = (await import(`file://${file}`)) as { default?: Strategy }
  if (!mod.default || typeof mod.default.driver !== 'function' || !mod.default.name) {
    throw new Error(`authorStrategy: ${file} does not export a default Strategy`)
  }
  return { strategy: mod.default, file, code }
}
