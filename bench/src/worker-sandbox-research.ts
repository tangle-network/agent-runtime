/**
 * Sandbox research worker — the REAL test of FinSearchComp.
 *
 * The benchmark needs an agent that can fetch live financial data. A local
 * opencode worker can't (no web tool) — but a SANDBOX agent can: it has web
 * search + bash + code execution. This worker provisions a sandbox, streams the
 * question (the adapter's prompt already says "research using live web/market
 * sources, state the final answer"), and captures the agent's answer.
 *
 * Refine is sequential in the SAME box (the agent keeps its session + any data it
 * already pulled). Round 1 = blind; rounds 2..k re-examine, gated: keep the answer
 * unless a concrete error is found — never churn a correct figure. Returns the
 * round-1 answer (blind) and the final answer (refine) so one run scores both.
 */

import { extractLlmCallEvent } from '@tangle-network/agent-runtime/loops'
import { Sandbox } from '@tangle-network/sandbox'
import type { BenchTask } from './benchmarks/types'
import { DEFAULT_SANDBOX_REFINE_DIRECTIVE } from './directives'
import { runRefineLoop } from './refine-loop'

export interface SandboxResearchConfig {
  sandboxBaseUrl: string
  sandboxKey: string
  routerBaseUrl: string
  routerKey: string
  model: string
  provider?: string
  rounds?: number
  /** Per-round stream timeout. Default 6min. */
  perRoundMs?: number
  /** Refine directive (the GEPA-optimizable surface). Defaults to the hand-written gated one. */
  refineDirective?: string
}

export interface SandboxResearchShot {
  round1Answer: string
  finalAnswer: string
  rounds: number
  ok: boolean
  detail?: string
  /** REAL token usage summed from the sandbox stream events (never fabricated). */
  usage: { input: number; output: number }
  /** REAL cost summed from the sandbox stream events. */
  costUsd: number
}

/* biome-ignore lint/suspicious/noExplicitAny: the sandbox SDK box is loosely typed across versions */
type Box = any

async function createWithRetry(client: Sandbox, opts: unknown, attempts = 4): Promise<Box> {
  let lastErr: unknown
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return (await client.create(opts as never)) as Box
    } catch (err) {
      lastErr = err
      if (i < attempts) await new Promise((r) => setTimeout(r, 6000 * i))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

interface RoundResult {
  answer: string
  input: number
  output: number
  costUsd: number
}

async function streamAnswer(box: Box, prompt: string, perRoundMs: number): Promise<RoundResult> {
  // perRoundMs is a true-HANG backstop, not a work cap: deep multi-step web
  // research legitimately takes minutes, and cutting it mid-research understates
  // the agent (it's why blind looked artificially weak). Default it generous;
  // perRoundMs <= 0 disables the cap entirely (run to completion).
  const signal = perRoundMs > 0 ? AbortSignal.timeout(perRoundMs) : undefined
  let answer = ''
  let input = 0
  let output = 0
  let costUsd = 0
  for await (const ev of box.streamPrompt(prompt, signal ? { signal } : {})) {
    const d = ev?.data as Record<string, unknown> | undefined
    const t = d?.finalText ?? d?.text ?? d?.result
    if (typeof t === 'string' && t.length > 0) answer = t
    // REAL usage from the stream — same extractor the loop kernel uses. No fabrication.
    const llm = extractLlmCallEvent(ev as never, 'sandbox-research')
    if (llm) {
      input += llm.tokensIn ?? 0
      output += llm.tokensOut ?? 0
      costUsd += llm.costUsd ?? 0
    }
  }
  return { answer, input, output, costUsd }
}

export async function solveSandboxResearch(
  task: BenchTask,
  cfg: SandboxResearchConfig,
): Promise<SandboxResearchShot> {
  const rounds = Math.max(1, cfg.rounds ?? 3)
  // Generous hang-backstop default (20min); real research rounds finish in minutes.
  const perRoundMs = cfg.perRoundMs ?? 1_200_000
  const directive = cfg.refineDirective ?? DEFAULT_SANDBOX_REFINE_DIRECTIVE
  const client = new Sandbox({ baseUrl: cfg.sandboxBaseUrl, apiKey: cfg.sandboxKey, timeoutMs: 180_000 } as never)

  // Accumulated across rounds — the box is a shared session Ctx; usage/cost are REAL
  // from the stream (never fabricated). Carry-forward is the LAST NON-EMPTY answer
  // (an empty round must not overwrite a good prior or carry blank forward).
  let input = 0
  let output = 0
  let costUsd = 0
  const lastNonEmpty = (h: ReadonlyArray<{ artifact: string }>): string =>
    [...h].reverse().find((x) => x.artifact.trim().length > 0)?.artifact ?? ''

  const res = await runRefineLoop<string, Box>({
    rounds,
    setup: async () => {
      const box = await createWithRetry(client, {
        name: `finsearch-${Math.random().toString(36).slice(2, 10)}`,
        environment: 'universal',
        backend: {
          type: 'opencode',
          model: {
            provider: cfg.provider ?? 'openai',
            model: cfg.model,
            baseUrl: cfg.routerBaseUrl,
            apiKey: cfg.routerKey,
          },
        },
      })
      if (typeof box.refresh === 'function') {
        for (let i = 0; i < 80 && box.status && box.status !== 'running'; i += 1) {
          await new Promise((r) => setTimeout(r, 3000))
          await box.refresh()
        }
      }
      return box
    },
    prompt: (r, history) =>
      r === 1
        ? task.prompt
        : `${task.prompt}\n\n--- Your previous answer ---\n${lastNonEmpty(history).slice(-3000)}\n\n${directive}`,
    runShot: async (prompt, _r, box) => {
      try {
        const round = await streamAnswer(box, prompt, perRoundMs)
        input += round.input
        output += round.output
        costUsd += round.costUsd
        return { artifact: round.answer }
      } catch (err) {
        return { artifact: '', note: (err instanceof Error ? err.message : String(err)).slice(0, 80) }
      }
    },
    teardown: async (box) => {
      try {
        await box.delete?.()
      } catch {
        // platform reaps on expiry
      }
    },
  })

  const notes = res.rounds.filter((rr) => rr.note).map((rr) => `round ${rr.round}: ${rr.note}`)
  const finalAnswer = lastNonEmpty(res.rounds)
  return {
    round1Answer: res.blind.artifact,
    finalAnswer,
    rounds,
    ok: finalAnswer.trim().length > 0,
    detail: notes.length ? notes.join(' · ') : undefined,
    usage: { input, output },
    costUsd,
  }
}
