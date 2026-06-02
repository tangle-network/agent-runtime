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

/** Default gated refine directive (hand-written). GEPA optimizes this surface. */
export const DEFAULT_SANDBOX_REFINE_DIRECTIVE =
  'Double-check it: re-verify the figure against live sources and the requested units/precision/tolerance. If it is correct, restate the SAME final answer unchanged. Change it ONLY if you find a concrete error in the value or the source. End with the explicit final answer.'

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
  try {
    if (typeof box.refresh === 'function') {
      for (let i = 0; i < 80 && box.status && box.status !== 'running'; i += 1) {
        await new Promise((r) => setTimeout(r, 3000))
        await box.refresh()
      }
    }
    let round1Answer = ''
    let finalAnswer = ''
    let prev = ''
    let input = 0
    let output = 0
    let costUsd = 0
    const notes: string[] = []
    for (let r = 1; r <= rounds; r += 1) {
      const prompt =
        r === 1
          ? task.prompt
          : `${task.prompt}\n\n--- Your previous answer ---\n${prev.slice(-3000)}\n\n${directive}`
      let answer = ''
      try {
        const round = await streamAnswer(box, prompt, perRoundMs)
        answer = round.answer
        input += round.input
        output += round.output
        costUsd += round.costUsd
      } catch (err) {
        notes.push(`round ${r}: ${(err instanceof Error ? err.message : String(err)).slice(0, 80)}`)
      }
      if (answer.trim().length > 0) {
        if (r === 1) round1Answer = answer
        finalAnswer = answer
        prev = answer
      }
    }
    return {
      round1Answer,
      finalAnswer,
      rounds,
      ok: finalAnswer.trim().length > 0,
      detail: notes.length ? notes.join(' · ') : undefined,
      usage: { input, output },
      costUsd,
    }
  } finally {
    try {
      await box.delete?.()
    } catch {
      // platform reaps on expiry
    }
  }
}
