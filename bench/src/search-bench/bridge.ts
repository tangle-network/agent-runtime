/**
 * CLI Bridge provider wiring for the search comparison.
 *
 * Same arms, same deterministic oracle, same export. The only difference from
 * the sandbox path is HOW the harness runs: a single OpenAI-compatible chat call
 * to the local cli-bridge (`/v1/chat/completions`) with an `agent_profile` that
 * (a) disables native web tools via `metadata.disallowedTools` and (b) adds the
 * provider search MCP via `mcp` — both PROVEN to work on the bridge. Native arm
 * leaves the harness untouched.
 *
 * The bridge model id selects the harness (for example `claude-code/sonnet` or
 * `opencode/zai-coding-plan/glm-5.1`), so `harness` here is only the result label.
 */
import { createCliBridgeProvider } from '@tangle-network/agent-provider-cli-bridge'
import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  type AgentEnvironmentEvent,
  collectAgentTurn,
  extractLlmCallEvent,
  streamAgentTurn,
  sumEnvironmentUsage,
} from '@tangle-network/agent-runtime/loops'
import { answerOutput } from '../environment-run'
import type { SearchArm } from './profiles'
import { armLabel } from './profiles'
import type { SearchCellResult } from './run.mts'
import { type SearchTask, scoreTask, taskToPrompt } from './tasks'

const nativeWebDisallowed = ['WebSearch', 'WebFetch', 'web_search', 'web_fetch', 'websearch', 'webfetch', 'fetch']

/** Build the cli-bridge `agent_profile` for one arm (bridge dialect: disable via
 *  `metadata.disallowedTools`, search MCP via `mcp.<name>.transport:'http'`). */
function bridgeProfile(
  arm: SearchArm,
  routerSearchMcp: string,
  tangleApiKey: string,
  label: string,
): AgentProfile {
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

function toolNamesOf(events: ReadonlyArray<AgentEnvironmentEvent>): string[] {
  const calls = new Map<string, string>()
  for (const event of events) {
    const part = event.data.part
    if (!part || typeof part !== 'object') continue
    const record = part as Record<string, unknown>
    if (record.type !== 'tool' || typeof record.tool !== 'string') continue
    const callId =
      typeof record.callID === 'string'
        ? record.callID
        : typeof record.id === 'string'
          ? record.id
          : `${calls.size}`
    calls.set(callId, record.tool)
  }
  return [...calls.values()]
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
    const provider = createCliBridgeProvider({
      baseUrl: cfg.bridgeUrl,
      bearerToken: cfg.bridgeBearer,
      defaultModel: cfg.bridgeModels[harness] ?? harness,
    })
    const events: AgentEnvironmentEvent[] = []
    const turn = await collectAgentTurn(
      streamAgentTurn(
        {
          kind: 'provider',
          provider,
          profile: bridgeProfile(
            arm,
            cfg.routerSearchMcp,
            cfg.tangleApiKey,
            `${harness}-${armId}`,
          ),
        },
        taskToPrompt(task),
        {
          signal: controller.signal,
          onRawEvent: (event) => events.push(event),
        },
      ),
    )
    if (turn.status !== 'completed') {
      throw new Error(turn.error?.message ?? `bridge turn ${turn.status}`)
    }
    const usage = sumEnvironmentUsage(events, base.model)
    const calls = events
      .map((event) => extractLlmCallEvent(event, base.model))
      .filter((call) => call !== undefined)
    const costKnown = calls.length > 0 && calls.every((call) => call.costUsd !== undefined)
    const answer = answerOutput.parse(events)
    const names = toolNamesOf(events)
    const { score, reasons } = scoreTask(task, answer)
    return {
      ...base,
      score,
      reasons,
      ...(costKnown ? { costUsd: usage.costUsd } : {}),
      ...(usage.input ? { tokensIn: usage.input } : {}),
      ...(usage.output ? { tokensOut: usage.output } : {}),
      wallMs: Date.now() - startedAt,
      toolCalls: names.length,
      toolNames: [...new Set(names)],
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
