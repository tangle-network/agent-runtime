/**
 * cli-bridge leaf runtime as a `SandboxClient` — the local cli-bridge fronting a
 * harness CLI (opencode / kimi-code / …) exposed as an OpenAI-compatible endpoint,
 * driven by the SAME `runLoop`/`loopDispatch` kernel as a hosted sandbox. One shot =
 * one POST to `${url}/v1/chat/completions`; its `choices[0].message.content` is the
 * terminal `finalText` the kernel's `answerOutput` parses, and `usage.prompt_tokens`/
 * `usage.completion_tokens` are the tokens the cost ledger meters.
 *
 * Built on `inlineSandboxClient` (the ONE pseudo-box shell) — no hand-rolled box,
 * create, or streamPrompt. The bridge is off-box inference, so like the router
 * executor it exposes no fs/exec/fork; those degrade gracefully via the optional
 * `SandboxClient` methods.
 *
 * `harness`/`model` may be fixed at construction OR supplied per-cell through the
 * `create({ backend })` override (matching how a hosted sandbox client reads its
 * backend): `backend.type` selects the harness, `backend.model.model` the model. So
 * ONE client drives every harness×model cell of a matrix — the per-create override
 * wins over the constructor default. The bridge model id is `${harness}/${model}`
 * (an already-`${harness}/`-prefixed model passes through unchanged). Bridge
 * inference is free, so `spent.usd = 0`.
 */
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { BackendType, CreateSandboxOptions } from '@tangle-network/sandbox'
import { inlineSandboxClient } from './inline-sandbox-client'
import type { ExecutorFactory, ExecutorResult } from './supervise/types'
import type { SandboxClient } from './types'

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:3355'
const BRIDGE_TIMEOUT_MS = 900_000

export interface CliBridgeConfig {
  /** cli-bridge base URL. Defaults to `http://127.0.0.1:3355`. */
  url?: string
  /** Bearer token the bridge requires (fail loud when empty). */
  bearer: string
  /** Default harness when a `create({ backend })` override does not set one. */
  harness?: string
  /** Default model when a `create({ backend })` override does not set one. */
  model?: string
}

/** `${harness}/${model}`, unless `model` is already `${harness}/`-prefixed. */
function bridgeModelId(harness: string, model: string): string {
  return model.startsWith(`${harness}/`) ? model : `${harness}/${model}`
}

/** Read the per-create backend override (harness + model), falling back to the
 *  client-level defaults. Fail loud when neither source names a harness/model —
 *  a bridge call with no target is a config bug, not a silent default. */
function resolveTarget(
  cfg: CliBridgeConfig,
  createOptions: CreateSandboxOptions | undefined,
): { harness: string; model: string } {
  const backend = createOptions?.backend as
    | { type?: BackendType; model?: { model?: string } }
    | undefined
  const harness = backend?.type ?? cfg.harness
  const model = backend?.model?.model ?? cfg.model
  if (!harness)
    throw new Error(
      'cliBridgeSandboxClient: no harness (set cfg.harness or create({ backend: { type } }))',
    )
  if (!model)
    throw new Error(
      'cliBridgeSandboxClient: no model (set cfg.model or create({ backend: { model: { model } } }))',
    )
  return { harness, model }
}

interface ChatCompletion {
  choices?: { message?: { content?: string } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  model?: string
  error?: { message?: string }
}

/**
 * POST one chat completion to the bridge. Uses the `node:http(s)` core client
 * rather than global `fetch` ON PURPOSE: the bridge runs a harness CLI to
 * completion and returns headers + body only when that finishes — routinely
 * >5 min on a heavy agent turn. `fetch` (undici) caps the wait for the first
 * response header at a fixed `headersTimeout` (~300s) that no per-request option
 * or `AbortSignal` overrides, so it aborts a live-but-slow bridge with an opaque
 * "Headers Timeout Error". The core client has no such cap; the ONLY bound is the
 * `AbortSignal` below (`BRIDGE_TIMEOUT_MS`), which we honor explicitly.
 */
function bridgePost(
  url: string,
  bearer: string,
  bridgeModel: string,
  prompt: string,
  signal: AbortSignal,
): Promise<{ content: string; input: number; output: number }> {
  const target = new URL(`${url.replace(/\/$/, '')}/v1/chat/completions`)
  const body = JSON.stringify({ model: bridgeModel, messages: [{ role: 'user', content: prompt }] })
  const requestFn = target.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error(`cli-bridge ${bridgeModel}: aborted before request`))
      return
    }
    const req = requestFn(
      target,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${bearer}`,
          'content-length': Buffer.byteLength(body),
        },
        // No header/body idle timeout: a slow bridge is a live bridge; the abort
        // signal is the sole deadline.
        timeout: 0,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          const status = res.statusCode ?? 0
          if (status < 200 || status >= 300) {
            reject(new Error(`cli-bridge ${bridgeModel}: HTTP ${status} ${text.slice(0, 300)}`))
            return
          }
          let j: ChatCompletion
          try {
            j = JSON.parse(text) as ChatCompletion
          } catch {
            reject(new Error(`cli-bridge ${bridgeModel}: non-JSON body ${text.slice(0, 300)}`))
            return
          }
          if (j.error) {
            reject(new Error(`cli-bridge ${bridgeModel}: ${j.error.message}`))
            return
          }
          resolve({
            content: j.choices?.[0]?.message?.content ?? '',
            input: j.usage?.prompt_tokens ?? 0,
            output: j.usage?.completion_tokens ?? 0,
          })
        })
      },
    )
    const onAbort = (): void => {
      req.destroy(
        new Error(
          `cli-bridge ${bridgeModel}: aborted (${BRIDGE_TIMEOUT_MS}ms deadline or upstream cancel)`,
        ),
      )
    }
    signal.addEventListener('abort', onAbort, { once: true })
    req.on('error', (e) => reject(new Error(`cli-bridge ${bridgeModel}: ${e.message}`)))
    req.on('close', () => signal.removeEventListener('abort', onAbort))
    req.write(body)
    req.end()
  })
}

/**
 * A `SandboxClient` whose every prompt is one cli-bridge chat completion, metered
 * and driven by the shared `runLoop` kernel. Pass a fixed `harness`/`model`, or omit
 * them and set the target per cell via `create({ backend: { type, model: { model } } })`.
 */
export function cliBridgeSandboxClient(cfg: CliBridgeConfig): SandboxClient {
  if (!cfg.bearer) throw new Error('cliBridgeSandboxClient: bearer is required')
  const url = cfg.url ?? DEFAULT_BRIDGE_URL
  let seq = 0
  const factory: ExecutorFactory<unknown> = (_spec, ctx) => {
    const id = `cli-bridge-${seq++}`
    const createOptions = ctx.seams.createOptions as CreateSandboxOptions | undefined
    const { harness, model } = resolveTarget(cfg, createOptions)
    const bridgeModel = bridgeModelId(harness, model)
    let artifact: ExecutorResult<unknown> | undefined
    return {
      runtime: 'cli',
      async execute(task, signal): Promise<ExecutorResult<unknown>> {
        const started = Date.now()
        const timeout = AbortSignal.timeout(BRIDGE_TIMEOUT_MS)
        const composed = AbortSignal.any([signal, timeout])
        const r = await bridgePost(url, cfg.bearer, bridgeModel, String(task), composed)
        artifact = {
          outRef: `cli-bridge:${id}`,
          out: { content: r.content },
          spent: {
            iterations: 1,
            tokens: { input: r.input, output: r.output },
            usd: 0,
            ms: Date.now() - started,
          },
        }
        return artifact
      },
      teardown: () => Promise.resolve({ destroyed: true }),
      resultArtifact() {
        if (!artifact)
          throw new Error('cliBridgeSandboxClient: resultArtifact() read before execute()')
        return artifact
      },
    }
  }
  return inlineSandboxClient(factory)
}
