/**
 * cli-bridge cell executor — the unblocked path to the head-to-head numbers
 * while the sandbox sidecar image is pending #1810.
 *
 * Same arms, same deterministic oracle, same export. The only difference from
 * the sandbox path is HOW the harness runs: a single OpenAI-compatible chat call
 * to the local cli-bridge (`/v1/chat/completions`) with an `agent_profile` that
 * (a) disables native web tools via `metadata.disallowedTools` and (b) adds the
 * provider search MCP via `mcp` — both PROVEN to work on the bridge. Native arm
 * leaves the harness untouched.
 *
 * The bridge model id IS the harness selector (e.g. `claude-code/sonnet`,
 * `opencode/zai-coding-plan/glm-5.1`), so `harness` here is just the label.
 */
import type { SearchArm } from './profiles'
import { armLabel } from './profiles'
import type { SearchCellResult } from './run.mts'
import { type SearchTask, scoreTask, taskToPrompt } from './tasks'

const nativeWebDisallowed = ['WebSearch', 'WebFetch', 'web_search', 'web_fetch', 'websearch', 'webfetch', 'fetch']

/** Build the cli-bridge `agent_profile` for one arm (bridge dialect: disable via
 *  `metadata.disallowedTools`, search MCP via `mcp.<name>.transport:'http'`). */
function bridgeProfile(arm: SearchArm, routerSearchMcp: string, tangleApiKey: string, label: string): Record<string, unknown> {
  if (arm === 'native') return { name: `search-bench-${label}` }
  const base = { name: `search-bench-${label}`, metadata: { disallowedTools: nativeWebDisallowed } }
  if (arm === 'off') return base
  return {
    ...base,
    mcp: {
      tangle_search: {
        transport: 'http',
        url: `${routerSearchMcp}?provider=${encodeURIComponent(arm.provider)}`,
        headers: { Authorization: `Bearer ${tangleApiKey}` },
        enabled: true,
      },
    },
  }
}

const urlRe = /https?:\/\/[^\s)\]}"'<>]+/gi
function citationsOf(answer: string): string[] {
  return [...new Set((answer.match(urlRe) ?? []).map((u) => u.replace(/[.,;]+$/, '')))]
}

export interface BridgeCfg {
  bridgeUrl: string
  bridgeBearer: string
  tangleApiKey: string
  /** Router search-MCP endpoint, e.g. https://router.tangle.tools/v1/search/mcp */
  routerSearchMcp: string
  /** harness label → cli-bridge model id (the harness selector). */
  bridgeModels: Record<string, string>
  timeoutMs?: number
}

export async function runBridgeCell(
  cfg: BridgeCfg,
  task: SearchTask,
  harness: string,
  arm: SearchArm,
): Promise<SearchCellResult> {
  const startedAt = Date.now()
  const armId = armLabel(arm)
  const base = {
    taskId: task.id,
    domain: task.domain,
    harness,
    arm: armId,
    model: cfg.bridgeModels[harness] ?? harness,
    ts: new Date(startedAt).toISOString(),
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 300_000)
  try {
    const body = {
      model: cfg.bridgeModels[harness] ?? harness,
      stream: false,
      agent_profile: bridgeProfile(arm, cfg.routerSearchMcp, cfg.tangleApiKey, `${harness}-${armId}`),
      messages: [{ role: 'user', content: taskToPrompt(task) }],
    }
    const res = await fetch(`${cfg.bridgeUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.bridgeBearer}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`bridge ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ function?: { name?: string } }> } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }
    }
    const msg = data.choices?.[0]?.message ?? {}
    const answer = msg.content ?? ''
    const { score, reasons } = scoreTask(task, answer)
    const names = [...new Set((msg.tool_calls ?? []).map((t) => t.function?.name ?? 'unknown'))]
    return {
      ...base,
      score,
      reasons,
      ...(typeof data.usage?.cost === 'number' ? { costUsd: data.usage.cost } : {}),
      ...(typeof data.usage?.prompt_tokens === 'number' ? { tokensIn: data.usage.prompt_tokens } : {}),
      ...(typeof data.usage?.completion_tokens === 'number' ? { tokensOut: data.usage.completion_tokens } : {}),
      wallMs: Date.now() - startedAt,
      toolCalls: (msg.tool_calls ?? []).length,
      toolNames: names,
      citations: citationsOf(answer),
      answer,
    }
  } catch (err) {
    return {
      ...base,
      score: null,
      reasons: [],
      wallMs: Date.now() - startedAt,
      toolCalls: 0,
      toolNames: [],
      citations: [],
      answer: '',
      infraError: err instanceof Error ? err.message : String(err),
    }
  } finally {
    clearTimeout(timer)
  }
}
