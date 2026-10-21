/**
 * Shared SWE execution-jail + zai-client primitives — extracted from swe-repro-calibrate.mts
 * (the Stage-0 calibrator, commit 5102c43b) so Stage 1/2 drivers (swe-structural.mts) run on the
 * SAME canary-verified jail instead of forking one. Behavior is byte-identical to the calibrator's
 * in-file originals; the calibrator now imports these.
 *
 * The jail is the byte-identical invocation pattern of swe-bench-env's `run` tool: the instance's
 * cached swebench Docker image, conda testbed, cwd=/testbed, --network none, dual timeout.
 */
import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { AgentProfile } from '@tangle-network/agent-interface'
import type { ToolSpec } from '@tangle-network/agent-runtime/kernel'
import { runBenchRouterTurn, withBenchProfile } from './router-turn'

const exec = promisify(execFile)

// ---------- zai chat client (Runtime transport; patient 429 ladder) ----------

interface ZaiCfg {
  base: string
  key: string
  timeoutMs: number
  /** Optional hard wall-clock stop (epoch ms). No HTTP attempt starts — and no retry-ladder sleep
   *  runs — past this instant, so a per-instance deadline reaches INTO the 429 ladder instead of
   *  letting a doomed retry sleep for another 240s after the instance was already written off. */
  deadlineAt?: number
  /** Caller-owned retry ladder length. Default 7. */
  maxAttempts?: number
}

interface ZaiRaw {
  /** The OpenAI-compatible message and usage fields expected by existing SWE callers. */
  json: Record<string, unknown>
  /** Runtime completion attempts spent (retries included). */
  attempts: number
}

/**
 * One OpenAI-shape chat completion against the zai coding endpoint, with the calibrator's retry
 * discipline: zai 429s arrive in sustained bursts (measured: an overnight code-1305 storm zeroed
 * 6/23 instances even on a 30s ladder), so rate-limit retries climb a long ladder (60s → 120s →
 * 240s cap) while transient errors retry on a 2s base. An "empty" completion — no content AND no
 * tool_calls — is the glm reasoning path starving `content` when reasoning eats max_tokens, and is
 * retried too (a tool_calls turn with empty content is a NORMAL tool-loop turn, not starvation).
 */
export async function zaiChatRaw(
  cfg: ZaiCfg,
  body: Record<string, unknown>,
  profile: AgentProfile,
): Promise<ZaiRaw> {
  const {
    model,
    messages,
    tools,
    temperature,
    max_tokens: maxTokens,
    tool_choice: toolChoice,
    ...extraBody
  } = body
  if (typeof model !== 'string' || model.length === 0) {
    throw new Error('completion body.model must be a non-empty string')
  }
  if (profile.model?.default !== model) {
    throw new Error('completion body.model must equal AgentProfile.model.default')
  }
  if (!Array.isArray(messages)) throw new Error('completion body.messages must be an array')
  const typedTools = Array.isArray(tools) ? (tools as ToolSpec[]) : []
  const typedToolChoice =
    toolChoice === 'auto' || toolChoice === 'required' || toolChoice === 'none'
      ? toolChoice
      : undefined
  let lastErr = ''
  let delayBase = 2_000
  const maxAttempts = cfg.maxAttempts ?? 7
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error('ZaiCfg.maxAttempts must be a positive safe integer')
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      const delay = Math.min(delayBase * 2 ** (attempt - 2), 240_000)
      if (cfg.deadlineAt !== undefined && Date.now() + delay >= cfg.deadlineAt) {
        throw new Error(`completion abandoned at deadline (attempt ${attempt}): ${lastErr}`)
      }
      await new Promise((r) => setTimeout(r, delay))
    }
    if (cfg.deadlineAt !== undefined && Date.now() >= cfg.deadlineAt) {
      throw new Error(`completion abandoned at deadline (attempt ${attempt}): ${lastErr || 'no attempt made'}`)
    }
    const perCallTimeout =
      cfg.deadlineAt !== undefined ? Math.max(1, Math.min(cfg.timeoutMs, cfg.deadlineAt - Date.now())) : cfg.timeoutMs
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), perCallTimeout)
    try {
      const result = await runBenchRouterTurn(
        {
          routerBaseUrl: cfg.base,
          routerKey: cfg.key,
          profile: withBenchProfile(profile, {
            ...(typeof temperature === 'number' ? { temperature } : {}),
            ...(typeof maxTokens === 'number' ? { maxTokens } : {}),
            ...(typedToolChoice ? { toolChoice: typedToolChoice } : {}),
            extraBody,
          }),
          tools: typedTools,
          signal: ctl.signal,
        },
        { messages: messages as Array<Record<string, unknown>> },
      )
      const toolCalls = result.toolCalls.map((call, index) => ({
        id: call.id ?? `call_${index}`,
        name: call.name,
        arguments: call.arguments,
      }))
      const message = {
        role: 'assistant',
        content: toolCalls.length > 0 && result.finalText === '' ? null : result.finalText,
        ...(toolCalls.length > 0
          ? {
              tool_calls: toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : {}),
      }
      if (toolCalls.length === 0 && result.finalText.trim() === '') {
        lastErr = 'empty content'
        continue
      }
      const finalEvent = result.events.at(-1)
      const finishReason =
        finalEvent?.type === 'final'
          ? finalEvent.reason
          : toolCalls.length > 0
            ? 'tool_calls'
            : 'stop'
      const json: Record<string, unknown> = {
        choices: [
          {
            message,
            finish_reason: finishReason,
          },
        ],
        ...(result.usage.tokensKnown !== false
          ? {
              usage: {
                prompt_tokens: result.usage.input,
                completion_tokens: result.usage.output,
              },
            }
          : {}),
      }
      return { json, attempts: attempt }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
      const status = Number(/router (\d+)/.exec(lastErr)?.[1])
      const transientStatus =
        Number.isFinite(status) &&
        (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500)
      const transientTransport =
        ctl.signal.aborted ||
        /fetch failed|network|socket|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|operation was aborted/i.test(
          lastErr,
        )
      if (!transientStatus && !transientTransport) throw e
      delayBase = status === 429 ? 60_000 : 2_000
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`completion failed after retries: ${lastErr}`)
}

// ---------- judge-separation guard ----------

/** Refuse any outbound request whose SYSTEM/USER messages (the strings the harness authors) carry
 *  hidden-judge content marks (gold patch / test patch lines). Assistant and tool messages are
 *  exempt by construction: they are the model's own text and reads of the visible base tree — a
 *  model that independently authors the gold line is a success, not a leak. Returns the number of
 *  messages checked; throws on contact. */
export function assertNoHiddenLeak(marks: readonly string[], msgs: ReadonlyArray<{ role?: string; content?: unknown }>): number {
  let checked = 0
  for (const m of msgs) {
    if (m.role !== 'system' && m.role !== 'user') continue
    const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')
    for (const mark of marks) {
      if (mark && c.includes(mark)) {
        throw new Error('REFUSED: hidden judge content (gold/test patch) leaked into a model message')
      }
    }
    checked += 1
  }
  return checked
}

// ---------- jailed python execution ----------

interface JailRun {
  code: number
  out: string
  timedOut: boolean
  infraError?: string
}

/** Echoed by the in-container shell after a successful `git apply` of the ride-along patch —
 *  unambiguously separates "patch failed to apply" (no sentinel, git's error in the output) from
 *  "patched code still fails" (sentinel present, the script's own nonzero exit). */
const APPLY_SENTINEL = '__PATCH_APPLIED__'

let runSeq = 0

/** All-READ-lines detector: models sometimes wrap their read requests in a python fence, which must
 *  NOT be mistaken for a script (observed live: a "script" of `READ: astropy/timeseries/core.py`
 *  reached the jail and crashed with NameError — measuring the parser, not the model). */
function asReadRequests(block: string): string[] | null {
  const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length > 0 && lines.length <= 3 && lines.every((l) => /^READ:\s*\S+$/.test(l))) {
    return lines.map((l) => l.replace(/^READ:\s*/, ''))
  }
  return null
}
