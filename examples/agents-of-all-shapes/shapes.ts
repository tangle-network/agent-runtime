/**
 * Agents of all shapes produce one telemetry contract.
 *
 * Each shape is a different way to produce agent runs. They all converge on
 * the same canonical OTel GenAI spans (`shared/intelligence.ts`), so the
 * `InsightReport` is computed identically no matter who ran the agent:
 * Tangle's runtime, an OpenAI-compatible router (tcloud / OpenRouter), a
 * Mastra agent, the Claude Agent SDK, or a Python agno agent.
 *
 * The runs below are deterministic so the showcase is verifiable in CI with
 * no LLM key. Each shape's header shows the live wiring. Replace the seeded
 * batch for your framework's telemetry and it lands on the same engine. None
 * of this touches a Tangle sandbox.
 */

import type { FailureClass } from '@tangle-network/agent-eval'
import type { AgentRun } from './shared/intelligence'

/** Deterministic pseudo-random in [0,1) from a string seed. Keeps the
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
  /** Fraction of runs with a task failure. */
  taskFailureRate: number
  failureClass: FailureClass
}

function batch(spec: BatchSpec): AgentRun[] {
  const runs: AgentRun[] = []
  const candidateId = `${spec.shape}:${spec.model}`
  for (let i = 0; i < spec.n; i++) {
    const scenarioId = `scenario-${i.toString().padStart(2, '0')}`
    const runId = `${candidateId}:${scenarioId}:seed-0`
    const failed = rand(`${runId}:f`) < spec.taskFailureRate
    runs.push({
      runId,
      candidateId,
      scenarioId,
      model: spec.model,
      score: failed ? 0.1 + rand(`${runId}:s`) * 0.25 : 0.62 + rand(`${runId}:s`) * 0.35,
      costUsd: 0.004 + rand(`${runId}:c`) * 0.05,
      costProvenance: 'observed',
      inputTokens: 700 + Math.floor(rand(`${runId}:i`) * 1500),
      outputTokens: 120 + Math.floor(rand(`${runId}:o`) * 600),
      startMs: 1_700_000_000_000 + i * 1000,
      durationMs: 800 + Math.floor(rand(`${runId}:d`) * 4000),
      terminalOutcome: 'succeeded',
      ...(failed ? { failureClass: spec.failureClass } : {}),
    })
  }
  return runs
}

/**
 * 1. Tangle agent-runtime / router (tcloud).
 *
 * LIVE: retain the runtime's trace tree, then add one task root carrying the
 * exact run, candidate, scenario, terminal, cost-source, and eval fields in
 * the README contract. Close the exporter before reporting delivery.
 */
export function tangleRuntimeRuns(): AgentRun[] {
  return batch({
    shape: 'tangle-runtime',
    model: 'tcloud/claude-sonnet-4-6@2026-05-08',
    n: 12,
    taskFailureRate: 0.17,
    failureClass: 'tool_recovery_failure',
  })
}

/**
 * 2. OpenAI-compatible router: tcloud / OpenRouter / OpenAI / vLLM.
 *
 * LIVE: any OpenAI-compatible client. Point it at the router's baseURL and
 * record one task root and one GenAI child per call:
 *   const res = await openai.chat.completions.create({ model, messages })
 *   // Child usage comes from res.usage. Task quality comes from your eval.
 */
export function openAiCompatibleRuns(): AgentRun[] {
  return batch({
    shape: 'openai-compatible',
    model: 'openrouter/openai/gpt-4.1-2025-04-14',
    n: 10,
    taskFailureRate: 0.2,
    failureClass: 'format_drift',
  })
}

/**
 * 3. Mastra agent (TypeScript).
 *
 * LIVE: Mastra emits OpenTelemetry natively. Configure its OTLP exporter to
 * point at `${TANGLE_INTELLIGENCE_URL}/v1/otlp`, then add the task-root fields
 * from the README contract:
 *   export const mastra = new Mastra({ telemetry: { enabled: true,
 *     export: { type: 'otlp', endpoint: `${TANGLE_INTELLIGENCE_URL}/v1/otlp/v1/traces` } } })
 * No Tangle SDK is required.
 */
export function mastraRuns(): AgentRun[] {
  return batch({
    shape: 'mastra',
    model: 'openai/gpt-4o-2024-11-20',
    n: 10,
    taskFailureRate: 0.1,
    failureClass: 'instruction_following',
  })
}

/**
 * 4. Claude Agent SDK (TypeScript).
 *
 * LIVE: wrap the SDK's query loop, emit one GenAI child per turn, then close
 * the task root with the exact terminal status and eval result:
 *   for await (const msg of query({ prompt, options })) { ...collect usage... }
 *   // Model and token fields come from msg.usage.
 */
export function claudeAgentSdkRuns(): AgentRun[] {
  return batch({
    shape: 'claude-agent-sdk',
    model: 'anthropic/claude-sonnet-4-6@2026-05-08',
    n: 10,
    taskFailureRate: 0.12,
    failureClass: 'reasoning_error',
  })
}

/** Every shape merged into one view across frameworks. */
export function allShapes(): Record<string, AgentRun[]> {
  return {
    'tangle-runtime': tangleRuntimeRuns(),
    'openai-compatible': openAiCompatibleRuns(),
    mastra: mastraRuns(),
    'claude-agent-sdk': claudeAgentSdkRuns(),
  }
}
