/**
 * Endpoint capacity gate — the typed port of `probe-capacity.sh`, generalized
 * after a proven blind spot: the bash probe watched ONLY the z.ai coding
 * endpoint while the supervisor BRAIN rides router.tangle.tools — three
 * evolution rounds went infra-null because the gate said "capacity" while the
 * router 503-stormed. Rule encoded here: gate every arm on the endpoint that
 * arm actually calls; supervisor arms MUST include the router-path probe.
 *
 * The containing experiment is launched through dotenvx, so probes read the already-scoped key
 * from this process and enter Runtime through one exact AgentProfile.
 */

import { runBenchRouterTurn } from '../router-turn'
import type { SecretsEnv } from './arms'

export type CapacityProbe = (signal?: AbortSignal) => Promise<boolean>

export interface EndpointCapacityGate {
  /** Human label for status lines (e.g. 'z.ai-coding', 'router'). */
  name: string
  probe: CapacityProbe
  /** Window passes when >= k of n probes succeed (bash: 3 of 4). */
  kOfN: { k: number; n: number }
  /** Consecutive passing windows required before opening. Default 1. */
  steadyM?: number
  /** Total wait budget; exceeded → gate reports no-capacity (orchestrate: 300 min). */
  waitCeilingMs: number
  /** Pause between probes inside a window (bash: 1s). */
  probeIntervalMs?: number
  /** Pause between windows while waiting (orchestrate: 30s). */
  retryDelayMs?: number
  onStatus?: (msg: string) => void
}

export function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined
    const onAbort = () => {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(signal?.reason ?? new Error('capacity wait aborted'))
    }
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** One k-of-n probe window. Exported for direct reuse (bash probe-capacity.sh body). */
export async function probeWindow(
  gate: EndpointCapacityGate,
  signal?: AbortSignal,
): Promise<{ ok: number; passed: boolean }> {
  const { k, n } = gate.kOfN
  let ok = 0
  for (let i = 0; i < n; i++) {
    signal?.throwIfAborted()
    try {
      if (await gate.probe(signal)) ok += 1
    } catch {
      // Endpoint failures count as a failed probe; caller cancellation does not.
      signal?.throwIfAborted()
    }
    signal?.throwIfAborted()
    if (i < n - 1) await sleepWithSignal(gate.probeIntervalMs ?? 1000, signal)
  }
  return { ok, passed: ok >= k }
}

/**
 * Block until the endpoint shows steady capacity (steadyM consecutive passing
 * k-of-n windows) or the ceiling elapses. Returns whether capacity was found —
 * callers decide whether a closed gate skips the instance or aborts the run.
 */
export async function waitForCapacity(gate: EndpointCapacityGate, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted()
  const steadyM = gate.steadyM ?? 1
  const deadline = Date.now() + gate.waitCeilingMs
  let consecutive = 0
  for (;;) {
    signal?.throwIfAborted()
    const { ok, passed } = await probeWindow(gate, signal)
    signal?.throwIfAborted()
    gate.onStatus?.(`[${gate.name}] capacity: ${ok}/${gate.kOfN.n}${passed ? '' : ' (below k)'} steady=${passed ? consecutive + 1 : 0}/${steadyM}`)
    if (passed) {
      consecutive += 1
      if (consecutive >= steadyM) return true
    } else {
      consecutive = 0
    }
    if (Date.now() >= deadline) return false
    await sleepWithSignal(gate.retryDelayMs ?? 30_000, signal)
  }
}

// ---------------------------------------------------------------------------
// Probe functions.
// ---------------------------------------------------------------------------

export interface HttpProbeSpec {
  url: string
  provider: string
  /** NAME of the env var holding the bearer key (resolved in the dotenvx child). */
  apiKeyEnv: string
  model: string
  /** curl --max-time, seconds. Default 40 (probe-capacity.sh). */
  maxTimeS?: number
  /**
   * max_tokens in the probe body. Default 8000 — glm-5.2 returns empty content
   * below that (measured), and an empty-content 200 would be a lying probe.
   */
  maxTokens?: number
}

export const ZAI_CODING_ENDPOINT = 'https://api.z.ai/api/coding/paas/v4'
export const ROUTER_ENDPOINT = 'https://router.tangle.tools/v1'

/**
 * Generic chat-completions probe through Runtime: true only when the selected model emits `OK`
 * within the time budget.
 */
export function httpCapacityProbe(spec: HttpProbeSpec): CapacityProbe {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(spec.apiKeyEnv)) {
    throw new Error(`invalid apiKeyEnv name: ${spec.apiKeyEnv}`)
  }
  const maxTime = spec.maxTimeS ?? 40
  return async (signal?: AbortSignal) => {
    signal?.throwIfAborted()
    const routerKey = process.env[spec.apiKeyEnv]
    if (!routerKey) throw new Error(`${spec.apiKeyEnv} is required; launch through dotenvx`)
    const turn = await runBenchRouterTurn(
      {
        routerBaseUrl: spec.url.replace(/\/chat\/completions\/?$/u, ''),
        routerKey,
        profile: {
          name: `capacity-${spec.model}`,
          harness: 'cli-base',
          model: {
            provider: spec.provider,
            default: spec.model,
            metadata: { temperature: 0, maxTokens: spec.maxTokens ?? 8000 },
          },
          prompt: { systemPrompt: 'Reply with the single word OK.' },
        },
        timeoutMs: maxTime * 1000,
        signal,
      },
      'Capacity probe.',
    )
    return turn.finalText.trim() === 'OK'
  }
}

/** probe-capacity.sh's z.ai coding-plan probe (the WORKER path). */
export function zaiCodingProbe(secrets: SecretsEnv, model = 'glm-5.2'): CapacityProbe {
  void secrets
  return httpCapacityProbe({
    url: ZAI_CODING_ENDPOINT,
    apiKeyEnv: 'ZAI_API_KEY',
    provider: 'zai',
    model,
  })
}

/**
 * Router-path probe (the BRAIN path — router.tangle.tools with TANGLE_API_KEY).
 * Supervisor arms must gate on this; probing only z.ai is the proven blind spot.
 */
export function routerProbe(secrets: SecretsEnv, model = 'glm-5.2'): CapacityProbe {
  void secrets
  return httpCapacityProbe({
    url: ROUTER_ENDPOINT,
    apiKeyEnv: 'TANGLE_API_KEY',
    provider: 'tangle-router',
    model,
  })
}

/** The gates an arm must pass, by kind: solo → worker path; supervisor → BOTH paths. */
export function gatesForArmKind(
  kind: 'solo' | 'supervisor',
  secrets: SecretsEnv,
  opts: { waitCeilingMs?: number; model?: string; onStatus?: (msg: string) => void } = {},
): EndpointCapacityGate[] {
  const base = {
    kOfN: { k: 3, n: 4 },
    waitCeilingMs: opts.waitCeilingMs ?? 300 * 60_000,
    ...(opts.onStatus ? { onStatus: opts.onStatus } : {}),
  }
  const worker: EndpointCapacityGate = { name: 'z.ai-coding', probe: zaiCodingProbe(secrets, opts.model), ...base }
  if (kind === 'solo') return [worker]
  const brain: EndpointCapacityGate = { name: 'router', probe: routerProbe(secrets, opts.model), ...base }
  return [worker, brain]
}
