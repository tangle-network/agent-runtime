/**
 * Agents of all shapes → one Tangle Intelligence pipe.
 *
 * Each shape is a different way to PRODUCE agent runs. They all converge on
 * the same canonical OTel GenAI spans (`shared/intelligence.ts`), so the
 * `InsightReport` is computed identically no matter who ran the agent —
 * Tangle's runtime, an OpenAI-compatible router (tcloud / OpenRouter), a
 * Mastra agent, the Claude Agent SDK, or a Python agno agent.
 *
 * The runs below are deterministic so the showcase is verifiable in CI with
 * no LLM key. Each shape's header shows the REAL wiring — swap the seeded
 * batch for your framework's telemetry and it lands on the same engine. None
 * of this touches a Tangle sandbox.
 */

import type { AgentRun } from './shared/intelligence'

/** Deterministic pseudo-random in [0,1) from a string seed — keeps the
 *  showcase reproducible (no `Math.random()` in asserted output). */
function rand(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

interface BatchSpec {
  shape: string
  model: string
  n: number
  /** Fraction of runs that fail, with the failure tag to attach. */
  failRate: number
  failureMode: string
}

function batch(spec: BatchSpec): AgentRun[] {
  const runs: AgentRun[] = []
  for (let i = 0; i < spec.n; i++) {
    const id = `${spec.shape}-${i}`
    const failed = rand(`${id}:f`) < spec.failRate
    runs.push({
      runId: id,
      model: spec.model,
      score: failed ? 0.1 + rand(`${id}:s`) * 0.25 : 0.62 + rand(`${id}:s`) * 0.35,
      costUsd: 0.004 + rand(`${id}:c`) * 0.05,
      inputTokens: 700 + Math.floor(rand(`${id}:i`) * 1500),
      outputTokens: 120 + Math.floor(rand(`${id}:o`) * 600),
      startMs: 1_700_000_000_000 + i * 1000,
      durationMs: 800 + Math.floor(rand(`${id}:d`) * 4000),
      ...(failed ? { failureMode: spec.failureMode } : {}),
    })
  }
  return runs
}

/**
 * 1. Tangle agent-runtime / router (tcloud).
 *
 * LIVE: agent-runtime already emits every loop event; ship them with the
 * built-in exporter (see `examples/intelligence-export`):
 *   const exporter = createOtelExporter({ endpoint, headers })
 *   for await (const e of runAgentTaskStream({ task, backend })) {
 *     exporter.exportSpan(loopEventToOtelSpan({ kind: e.type, runId, ... }, traceId))
 *   }
 * Attach your eval/judge score as a `score` attribute on the run's span.
 */
export function tangleRuntimeRuns(): AgentRun[] {
  return batch({
    shape: 'tangle-runtime',
    model: 'tcloud/claude-sonnet-4-6@2026-05-08',
    n: 12,
    failRate: 0.17,
    failureMode: 'tool_recovery_failure',
  })
}

/**
 * 2. OpenAI-compatible router — tcloud / OpenRouter / OpenAI / vLLM.
 *
 * LIVE: any OpenAI-compatible client. Point it at the router's baseURL and
 * record the OTel GenAI span per call:
 *   const res = await openai.chat.completions.create({ model, messages })
 *   // emit a span with gen_ai.request.model, gen_ai.usage.{input,output}_tokens,
 *   // gen_ai.usage.cost_usd, and your `score`.
 */
export function openAiCompatibleRuns(): AgentRun[] {
  return batch({
    shape: 'openai-compatible',
    model: 'openrouter/google/gemini-2.5-pro',
    n: 10,
    failRate: 0.2,
    failureMode: 'format_drift',
  })
}

/**
 * 3. Mastra agent (TypeScript).
 *
 * LIVE: Mastra emits OpenTelemetry natively. Configure its OTLP exporter to
 * point at `${INTELLIGENCE_BASE}/v1/otlp` (hosted) OR collect the spans and
 * call `toInsightReport` in-process:
 *   export const mastra = new Mastra({ telemetry: { enabled: true,
 *     export: { type: 'otlp', endpoint: `${INTELLIGENCE_BASE}/v1/otlp/v1/traces` } } })
 * Add a `score` attribute from your eval step. No Tangle SDK required.
 */
export function mastraRuns(): AgentRun[] {
  return batch({
    shape: 'mastra',
    model: 'openai/gpt-4o-2024-11-20',
    n: 10,
    failRate: 0.1,
    failureMode: 'instruction_following',
  })
}

/**
 * 4. Claude Agent SDK (TypeScript).
 *
 * LIVE: wrap the SDK's query loop and emit one GenAI span per turn:
 *   for await (const msg of query({ prompt, options })) { ...collect usage... }
 *   // span: gen_ai.request.model='claude-...', gen_ai.usage.* from msg.usage,
 *   //       score from your acceptance check.
 */
export function claudeAgentSdkRuns(): AgentRun[] {
  return batch({
    shape: 'claude-agent-sdk',
    model: 'anthropic/claude-sonnet-4-6@2026-05-08',
    n: 10,
    failRate: 0.12,
    failureMode: 'reasoning_error',
  })
}

/** Every shape, merged — the fleet view across frameworks. */
export function allShapes(): Record<string, AgentRun[]> {
  return {
    'tangle-runtime': tangleRuntimeRuns(),
    'openai-compatible': openAiCompatibleRuns(),
    mastra: mastraRuns(),
    'claude-agent-sdk': claudeAgentSdkRuns(),
  }
}
