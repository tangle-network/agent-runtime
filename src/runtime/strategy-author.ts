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

  shot(spec?: { handle?, messages?, steer? }): Promise<ShotResult | null>
    Runs ONE worker attempt (a bounded tool loop) over an artifact.
    - omit handle  => the shot opens its OWN fresh artifact and closes it after (a sample).
    - pass handle  => the shot CONTINUES that artifact (state accumulates across shots).
    - messages     => the carried conversation (pass the previous ShotResult.messages to continue).
    - steer        => a corrective instruction injected before the shot.
    ShotResult = { messages, score (0..1 on the task's check), passes, total, completions, toolErrors }
    Returns null if the attempt failed infra-wise.

  critique(messages): Promise<string | null>
    A firewalled trace-analyst reads the attempt's trajectory and returns ONE corrective
    instruction (or null when it judges the work complete). Costs ~1 completion.

  surface.open(task) / surface.close(handle)
    Open a persistent artifact you manage yourself (remember to close in a finally).

Rules:
- Stay within ~budget total shots; every shot/critique spends from a conserved pool.
- For a FRESH attempt OMIT \`messages\` entirely (never pass \`[]\` — an empty array is a
  fresh conversation too, but be explicit). To CONTINUE, pass the previous
  ShotResult.messages unchanged.
- Return { score, resolved, completions, progression, shots } — score = the BEST checkpoint
  you reached (keep-best, never final-state), progression = score after each shot.
- The module must be EXACTLY this shape (no other imports, no commentary outside code):

import { defineStrategy } from '@tangle-network/agent-runtime/loops'
export default defineStrategy('your-strategy-name', async ({ surface, task, budget, shot, critique }) => {
  // your composition
})
`

export interface AuthorStrategyOptions {
  /** The model-call seam (agent-eval `createChatClient`). */
  chat: ChatClient
  model?: string
  /** The environment the losses came from (orientation only — never the verifiers). */
  environmentName: string
  /** The per-task losses table (e.g. JSON.stringify(report.perTask)) — the gradient. */
  lossesJson: string
  /** The budget the strategy must respect (shots/width). */
  budget: number
  /** Where the authored module file is written (created if missing). */
  outDir: string
  temperature?: number
  signal?: AbortSignal
}

/** Runtime enforcement of the authored-module contract (the import rule was previously
 *  prompt-only — a live hole). A STATIC LINT, not a sandbox: it rejects the obvious
 *  escape hatches (foreign imports, require, eval, process/fs/network access) before the
 *  module is dynamically imported into this process. Treat authored code as semi-trusted:
 *  for fully untrusted authors, run the whole gate in a container. */
export function assertAuthoredCodeSafe(code: string): void {
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

/** Author + load a strategy from losses. Throws when the author emits no loadable module
 *  (callers may retry with another model — a named fallback, never silent). */
export async function authorStrategy(opts: AuthorStrategyOptions): Promise<AuthoredStrategy> {
  const res = await opts.chat.chat(
    {
      ...(opts.model ? { model: opts.model } : {}),
      messages: [
        {
          role: 'system',
          content:
            'You are a senior engineer authoring optimization strategies for agent loops. Output exactly one fenced ```ts code block and nothing else.',
        },
        {
          role: 'user',
          content: `${strategyAuthorContract}\n\nBASELINE RESULTS on the "${opts.environmentName}" environment (budget=${opts.budget}):\n${opts.lossesJson}\n\nAuthor ONE new strategy that you expect to beat the baselines on THIS environment at the same budget. Use the losses to target the observed failure mode. Output only the module code block.`,
        },
      ],
    },
    { ...(opts.signal ? { signal: opts.signal } : {}) },
  )
  const match = res.content.match(/```(?:ts|typescript)?\s*\n([\s\S]*?)```/)
  if (!match?.[1]) {
    throw new Error(
      `authorStrategy: no code block in the author's reply: ${res.content.slice(0, 300)}`,
    )
  }
  const code = match[1]
  assertAuthoredCodeSafe(code)
  mkdirSync(opts.outDir, { recursive: true })
  const file = join(opts.outDir, `authored-${Date.now()}.mts`)
  writeFileSync(file, code)
  const mod = (await import(`file://${file}`)) as { default?: Strategy }
  if (!mod.default || typeof mod.default.driver !== 'function' || !mod.default.name) {
    throw new Error(`authorStrategy: ${file} does not export a default Strategy`)
  }
  return { strategy: mod.default, file, code }
}
