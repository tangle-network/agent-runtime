import type { Outcome } from './personify/types'
import {
  type AgenticOptions,
  type AgenticSurface,
  type AgenticTask,
  type ArtifactHandle,
  createStrategyLeaf,
  drainOne,
  perChild,
  profileTurnLimit,
  type ShotTask,
  type StrategyMessage,
  type StrategyShotResult,
} from './strategy'
import type { Agent, Scope } from './supervise/types'
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

/**
 * A Strategy is HOW you spend the compute budget to beat the Environment's check — it
 * builds the driver `Agent` the Supervisor runs. This is the OPEN extension point: a dev
 * authors their own by implementing `driver()` to return an Agent whose `act()` spawns
 * shots/analysts via `scope.spawn` / `scope.next` / `scope.send`. The two built-ins are
 * the reference implementations to copy:
 *   sample — K INDEPENDENT attempts, keep the best-verifying (best-of-N / resample).
 *   refine — attempt → observe() reads the trace → steer the next → repeat (iterate).
 * (A multi-agent "team" is just a Strategy whose driver spawns several different agents.)
 */
declare const strategyResult: unique symbol

export interface Strategy<Result extends StrategyResult = StrategyResult> {
  readonly name: string
  /** @internal Associates a strategy with its typed result without adding a runtime field. */
  readonly [strategyResult]?: Result
  driver(
    surface: AgenticSurface,
    task: AgenticTask,
    opts: AgenticOptions,
    budget: number,
  ): Agent<unknown, Outcome<unknown>>
}

// ── The composable LEGO: author a strategy in ~15 lines from two steps ───────────
//
// A strategy body gets `shot()` (run one worker attempt over an artifact) and
// `critique()` (the firewalled analyst reads the trace → a steer). Compose them — no
// Supervisor/Scope ceremony. This is the skillifiable unit: an agent can emit a
// `defineStrategy(name, body)` of a few step-calls; it can't reliably emit a 70-line
// driver. (depthStrategy/breadthStrategy are the hand-written reference impls; refine/sample
// stay on them — proven — while NEW strategies are authored compactly here.)

export interface ShotSpec {
  /** present ⇒ continue this artifact (depth); absent ⇒ the shot opens a fresh one (sample/restart). */
  handle?: ArtifactHandle
  messages?: StrategyMessage[]
  steer?: string
  /** Exact profile for this shot. Omitted means `AgenticOptions.workerProfile`. */
  profile?: AgentProfile
  /** Restrict THIS shot to a subset of the domain's tools (by name) — focus a shot on
   *  the relevant capabilities. Restriction-only; unknown names throw. Omitted ⇒ all. */
  tools?: string[]
}

export interface StrategyResult {
  score: number
  resolved: boolean
  completions: number
  progression: number[]
  shots: number
}

/** Artifact lifecycle a strategy may manage itself — open/close ONLY. Raw `call`/`score`
 *  are withheld: scores reach the body solely through `shot()`'s StrategyShotResult (the
 *  harness-verified channel), so a body cannot peek the check or fabricate around it. */
export interface StrategyArtifacts {
  readonly name: string
  open(task: AgenticTask): Promise<ArtifactHandle>
  close(handle: ArtifactHandle): Promise<void>
}

/** What a strategy body composes with: the artifact lifecycle, the budget, and the two steps. */
export interface StrategyCtx {
  /** Open/close artifacts the body manages itself (e.g. one persistent handle for depth). */
  readonly surface: StrategyArtifacts
  readonly task: AgenticTask
  readonly opts: AgenticOptions
  readonly budget: number
  readonly scope: Scope<Outcome<unknown>>
  /** Run ONE worker shot; its harness-scored result, or null if it went down. */
  shot(spec?: ShotSpec): Promise<StrategyShotResult | null>
  /** The firewalled critic reads the trajectory → a steer string, or null on COMPLETE/down. */
  critique(messages: StrategyMessage[]): Promise<string | null>
  /** The RAW analyst channel: the firewalled critic answers `instruction` over the
   *  trajectory verbatim — no findings extraction, so verdict-shaped formats
   *  (CONTINUE/STOP decisions, calibrated predictions) survive. Same firewall:
   *  trajectory in, never scores. Null when the analyst went down. */
  consult(messages: StrategyMessage[], instruction: string): Promise<string | null>
  /** The tools THIS artifact's task actually offers (names + descriptions only — never
   *  the implementations). Tool sets vary per task on heterogeneous domains; a strategy
   *  that restricts shots MUST select from this list, never from hardcoded names. */
  listTools(handle: ArtifactHandle): Promise<Array<{ name: string; description?: string }>>
}

/** Author a Strategy from the composable steps — the open, compact way. */
export function defineStrategy<Result extends StrategyResult>(
  name: string,
  run: (ctx: StrategyCtx) => Promise<Result>,
): Strategy<Result> {
  return {
    name,
    driver: (surface, task, opts, budget) => ({
      name,
      async act(_t, scope): Promise<Outcome<unknown>> {
        let seq = 0
        // HARNESS-VERIFIED scoring: the deliverable score is computed HERE from the shots
        // the harness actually brokered + scored via surface.score() — NEVER the value the
        // (possibly authored / adversarial) body returns. An authored strategy cannot
        // fabricate a win; it can only report what its real shots achieved. Keep-best.
        let verifiedBest = 0
        let verifiedResolved = false
        // Close is IDEMPOTENT by construction for the body: authored code double-closes
        // (often as a floating promise inside a finally), and a second close must be a
        // no-op rather than a domain error that escapes as an unhandled rejection and
        // kills the whole benchmark run. A close failure on a LIVE handle still throws.
        const openHandles = new Set<string>()
        const ctx: StrategyCtx = {
          // Narrowed to open/close — the body gets no raw call()/score() access.
          surface: {
            name: surface.name,
            open: async (t) => {
              const h = await surface.open(t)
              openHandles.add(h.id)
              return h
            },
            close: async (h) => {
              if (!h || !openHandles.has(h.id)) return
              openHandles.delete(h.id)
              await surface.close(h)
            },
          },
          task,
          opts,
          budget,
          scope,
          async shot(spec) {
            const profile = spec?.profile ?? opts.workerProfile
            const innerTurns = profileTurnLimit(profile, 'authored strategy shot')
            const child = createStrategyLeaf(`shot:${seq}`, 'shot', profile, surface, opts)
            seq += 1
            const res = scope.spawn(
              child,
              {
                task,
                handle: spec?.handle,
                messages: spec?.messages,
                steer: spec?.steer,
                profile,
                tools: spec?.tools,
              } as ShotTask,
              { budget: perChild(innerTurns), label: child.name },
            )
            if (!res.ok) return null
            const settled = await drainOne(scope)
            if (settled.kind === 'down') return null
            const out = settled.out as unknown as StrategyShotResult
            if (out.score > verifiedBest) verifiedBest = out.score
            if (out.total > 0 && out.passes === out.total) verifiedResolved = true
            return out
          },
          async listTools(handle) {
            const tools = await surface.tools(task, handle)
            return tools.map((t) => ({
              name: t.function.name,
              ...(t.function.description ? { description: t.function.description } : {}),
            }))
          },
          async critique(messages) {
            const child = createStrategyLeaf(
              `analyst:${seq}`,
              'analyst',
              opts.analystProfile ?? opts.workerProfile,
              surface,
              opts,
            )
            seq += 1
            const res = scope.spawn(
              child,
              { task, messages },
              { budget: perChild(1), label: child.name },
            )
            if (!res.ok) return null
            const settled = await drainOne(scope)
            if (settled.kind === 'down') return null
            const findings = settled.out as unknown as string
            return /^\s*COMPLETE\b/i.test(findings) ? null : findings
          },
          async consult(messages, instruction) {
            const child = createStrategyLeaf(
              `analyst:${seq}`,
              'analyst',
              opts.analystProfile ?? opts.workerProfile,
              surface,
              opts,
            )
            seq += 1
            const res = scope.spawn(
              child,
              { task, messages, rawInstruction: instruction },
              { budget: perChild(1), label: child.name },
            )
            if (!res.ok) return null
            const settled = await drainOne(scope)
            if (settled.kind === 'down') return null
            return settled.out as unknown as string
          },
        }
        const r = await run(ctx)
        // Override the body's self-reported score/resolved with the harness-verified
        // values. The body's progression/completions/shots are advisory (display only) —
        // but NORMALIZED: an authored body that omits them must not poison downstream
        // consumers (losses tables, anytime curves) with undefined.
        return {
          kind: 'done',
          deliverable: {
            mode: name,
            ...r,
            progression: Array.isArray(r.progression) ? r.progression : [],
            completions: typeof r.completions === 'number' ? r.completions : 0,
            shots: typeof r.shots === 'number' ? r.shots : 0,
            score: verifiedBest,
            resolved: verifiedResolved,
          },
        }
      },
    }),
  }
}

/** A NEW strategy, authored from the steps (~20 lines): refine, but when a steered shot
 *  fails to improve the score it ABANDONS that line and restarts fresh (branch-when-stuck)
 *  — the widen/MCTS idea the depth-stuck failure motivated. Scored keep-best (the best
 *  checkpoint across all lines), the deployable metric. This is the "experts build BETTER
 *  optimizations" path: a new technique, compact, with zero Supervisor ceremony. */
export const adaptiveRefine = defineStrategy(
  'adaptiveRefine',
  async ({ surface, task, budget, shot, critique }) => {
    let handle = await surface.open(task)
    const progression: number[] = []
    let messages: StrategyMessage[] | undefined
    let steer: string | undefined
    let completions = 0
    let best = -1
    let shots = 0
    try {
      for (shots = 0; shots < budget; shots += 1) {
        const out = await shot({ handle, messages, steer })
        if (!out) break
        completions += out.completions
        progression.push(out.score)
        if (out.score >= 1) break
        if (out.score <= best) {
          // Stuck: steering isn't improving this line — abandon it, restart fresh.
          await surface.close(handle)
          handle = await surface.open(task)
          messages = undefined
          steer = undefined
          continue
        }
        best = out.score
        messages = out.messages
        const findings = await critique(out.messages)
        completions += 1
        if (!findings) break
        steer = `A reviewer flagged unfinished items:\n${findings}\n\nAddress each with the tools, verify they took, then continue.`
      }
      const score = progression.length ? Math.max(...progression) : 0
      return { score, resolved: score >= 1, completions, progression, shots }
    } finally {
      await surface.close(handle)
    }
  },
)

/** The explore-then-exploit MIX: spend ⌈budget/2⌉ on independent samples (kept open),
 *  then refine the best-verifying line with the remaining budget. Sample's basin escape +
 *  refine's accumulation — the third built-in, authored from the public steps. */
export const sampleThenRefine = defineStrategy(
  'sampleThenRefine',
  async ({ surface, task, budget, shot, critique }) => {
    const explore = Math.max(1, Math.ceil(budget / 2))
    const open = new Set<ArtifactHandle>()
    const progression: number[] = []
    let completions = 0
    let shots = 0
    try {
      // Explore: independent lines on handles we own (kept open so the best can continue).
      let best: { handle: ArtifactHandle; out: StrategyShotResult } | undefined
      for (let i = 0; i < explore; i += 1) {
        const handle = await surface.open(task)
        open.add(handle)
        const out = await shot({ handle })
        if (!out) continue
        shots += 1
        completions += out.completions
        progression.push(out.score)
        if (!best || out.score > best.out.score) best = { handle, out }
        if (out.score >= 1) break
      }
      if (!best) return { score: 0, resolved: false, completions, progression, shots }
      // Exploit: close the losers, refine the winner with the remaining budget.
      for (const h of [...open]) {
        if (h !== best.handle) {
          await surface.close(h)
          open.delete(h)
        }
      }
      let messages = best.out.messages
      let topScore = best.out.score
      for (let i = explore; i < budget && topScore < 1; i += 1) {
        const findings = await critique(messages)
        completions += 1
        if (!findings) break
        const out = await shot({
          handle: best.handle,
          messages,
          steer: `A reviewer flagged unfinished items:\n${findings}\n\nAddress each with the tools, verify they took, then continue.`,
        })
        if (!out) break
        shots += 1
        completions += out.completions
        progression.push(out.score)
        messages = out.messages
        if (out.score > topScore) topScore = out.score
      }
      const score = progression.length ? Math.max(...progression) : 0
      return { score, resolved: score >= 1, completions, progression, shots }
    } finally {
      for (const h of open) await surface.close(h)
    }
  },
)
