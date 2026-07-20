/**
 * Endpoint capacity gate — the typed port of `probe-capacity.sh`, generalized
 * after a proven blind spot: the bash probe watched ONLY the z.ai coding
 * endpoint while the supervisor BRAIN rides router.tangle.tools — three
 * evolution rounds went infra-null because the gate said "capacity" while the
 * router 503-stormed. Rule encoded here: gate every arm on the endpoint that
 * arm actually calls; supervisor arms MUST include the router-path probe.
 *
 * Secrets discipline: probes spawn `dotenvx run … -- bash -c 'curl …'` from
 * the secrets dir; the API key is referenced by NAME inside the child shell
 * (single-quoted script, so it is never expanded — let alone logged — in this
 * process).
 */

import { run } from './proc'
import type { SecretsEnv } from './arms'

export type CapacityProbe = () => Promise<boolean>

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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** One k-of-n probe window. Exported for direct reuse (bash probe-capacity.sh body). */
export async function probeWindow(gate: EndpointCapacityGate): Promise<{ ok: number; passed: boolean }> {
  const { k, n } = gate.kOfN
  let ok = 0
  for (let i = 0; i < n; i++) {
    if (await gate.probe().catch(() => false)) ok += 1
    if (i < n - 1) await sleep(gate.probeIntervalMs ?? 1000)
  }
  return { ok, passed: ok >= k }
}

/**
 * Block until the endpoint shows steady capacity (steadyM consecutive passing
 * k-of-n windows) or the ceiling elapses. Returns whether capacity was found —
 * callers decide whether a closed gate skips the instance or aborts the run.
 */
export async function waitForCapacity(gate: EndpointCapacityGate): Promise<boolean> {
  const steadyM = gate.steadyM ?? 1
  const deadline = Date.now() + gate.waitCeilingMs
  let consecutive = 0
  for (;;) {
    const { ok, passed } = await probeWindow(gate)
    gate.onStatus?.(`[${gate.name}] capacity: ${ok}/${gate.kOfN.n}${passed ? '' : ' (below k)'} steady=${passed ? consecutive + 1 : 0}/${steadyM}`)
    if (passed) {
      consecutive += 1
      if (consecutive >= steadyM) return true
    } else {
      consecutive = 0
    }
    if (Date.now() >= deadline) return false
    await sleep(gate.retryDelayMs ?? 30_000)
  }
}

// ---------------------------------------------------------------------------
// Probe functions.
// ---------------------------------------------------------------------------

export interface HttpProbeSpec {
  url: string
  /** NAME of the env var holding the bearer key (resolved in the dotenvx child). */
  apiKeyEnv: string
  model: string
  secrets: SecretsEnv
  /** curl --max-time, seconds. Default 40 (probe-capacity.sh). */
  maxTimeS?: number
  /**
   * max_tokens in the probe body. Default 8000 — glm-5.2 returns empty content
   * below that (measured), and an empty-content 200 would be a lying probe.
   */
  maxTokens?: number
}

export const ZAI_CODING_ENDPOINT = 'https://api.z.ai/api/coding/paas/v4/chat/completions'
export const ROUTER_ENDPOINT = 'https://router.tangle.tools/v1/chat/completions'

/** Build the probe request body (probe-body.json semantics). */
export function probeBody(model: string, maxTokens: number): string {
  return JSON.stringify({
    model,
    messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
    max_tokens: maxTokens,
    temperature: 0,
  })
}

/**
 * Generic chat-completions probe: true iff the endpoint returns HTTP 200
 * within the time budget. The key stays inside the child shell.
 */
export function httpCapacityProbe(spec: HttpProbeSpec): CapacityProbe {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(spec.apiKeyEnv)) {
    throw new Error(`invalid apiKeyEnv name: ${spec.apiKeyEnv}`)
  }
  const body = probeBody(spec.model, spec.maxTokens ?? 8000)
  const maxTime = spec.maxTimeS ?? 40
  return async () => {
    // Body via stdin (--data @-) so the payload never sits on a command line.
    // The HTTP code is marker-anchored because dotenvx writes its injection
    // banner to the same stdout stream.
    const script =
      `curl -sS -o /dev/null -w "HTTP_CODE=%{http_code}" --max-time ${maxTime} ` +
      `-X POST "$PROBE_URL" ` +
      `-H "Authorization: Bearer $${spec.apiKeyEnv}" -H "Content-Type: application/json" ` +
      `--data @-`
    const argv = ['run', ...spec.secrets.envFiles.flatMap((f) => ['-f', f]), '--', 'bash', '-c', script]
    const res = await run('dotenvx', argv, {
      cwd: spec.secrets.secretsDir,
      timeoutMs: (maxTime + 20) * 1000,
      stdin: body,
      env: { ...process.env, PROBE_URL: spec.url },
    })
    return /HTTP_CODE=200\s*$/.test(res.stdout)
  }
}

/** probe-capacity.sh's z.ai coding-plan probe (the WORKER path). */
export function zaiCodingProbe(secrets: SecretsEnv, model = 'glm-5.2'): CapacityProbe {
  return httpCapacityProbe({ url: ZAI_CODING_ENDPOINT, apiKeyEnv: 'ZAI_API_KEY', model, secrets })
}

/**
 * Router-path probe (the BRAIN path — router.tangle.tools with TANGLE_API_KEY).
 * Supervisor arms must gate on this; probing only z.ai is the proven blind spot.
 */
export function routerProbe(secrets: SecretsEnv, model = 'glm-5.2'): CapacityProbe {
  return httpCapacityProbe({ url: ROUTER_ENDPOINT, apiKeyEnv: 'TANGLE_API_KEY', model, secrets })
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
