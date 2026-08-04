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
import { createExecutor } from '@tangle-network/agent-runtime/kernel'
import {
  defineAgentProfileSecretRef,
  harnessProviders,
  type AgentProfile,
  type HarnessType,
} from '@tangle-network/agent-interface'
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
  harness: HarnessType,
  wireModel: string,
): AgentProfile {
  const prefix = `${harness}/`
  if (!wireModel.startsWith(prefix)) {
    throw new Error(
      `bridgeProfile: wire model '${wireModel}' must start with harness '${prefix}'`,
    )
  }
  const modelPath = wireModel.slice(prefix.length)
  const segments = modelPath.split('/').filter(Boolean)
  if (segments.length === 0) {
    throw new Error(`bridgeProfile: wire model '${wireModel}' has no model id`)
  }
  let provider: string
  let model: string
  if (segments.length === 1) {
    const providers = harnessProviders(harness)
    if (providers?.length !== 1) {
      throw new Error(
        `bridgeProfile: wire model '${wireModel}' must include a provider for harness '${harness}'`,
      )
    }
    provider = providers[0]!
    model = segments[0]!
  } else {
    provider = segments[0]!
    model = segments.slice(1).join('/')
  }
  const identity: AgentProfile = {
    name: `search-bench-${label}`,
    harness,
    model: { provider, default: model },
  }
  if (arm === 'native') return identity
  const base: AgentProfile = {
    ...identity,
    metadata: { disallowedTools: nativeWebDisallowed },
  }
  if (arm === 'off') return base
  if (!tangleApiKey) {
    throw new Error(`bridgeProfile: provider arm requires TANGLE_API_KEY`)
  }
  return {
    ...base,
    mcp: {
      tangle_search: {
        transport: 'http',
        url: `${routerSearchMcp}?provider=${encodeURIComponent(arm.provider)}`,
        headers: {
          Authorization: defineAgentProfileSecretRef('TANGLE_API_KEY', 'bearer'),
        },
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
  harness: HarnessType,
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
    // One harness turn through the unified bridge executor — same backend the
    // loop path uses; this cell scorer just adds oracle scoring + citations.
    const profile = bridgeProfile(
      arm,
      cfg.routerSearchMcp,
      cfg.tangleApiKey,
      `${harness}-${armId}`,
      harness,
      cfg.bridgeModels[harness] ?? harness,
    )
    const exec = createExecutor({
      backend: 'bridge',
      bridgeUrl: cfg.bridgeUrl,
      bridgeBearer: cfg.bridgeBearer,
      timeoutMs: cfg.timeoutMs ?? 300_000,
    })({ profile, harness: null }, { signal: controller.signal, seams: {} })
    // bridgeExecutor is one-shot (async execute resolves an ExecutorResult).
    const artifact = (await exec.execute(taskToPrompt(task), controller.signal)) as {
      out: unknown
      spent: { tokens: { input: number; output: number }; usd: number }
    }
    const out = artifact.out as { content?: string; toolCalls?: string[] }
    const answer = out.content ?? ''
    const names = out.toolCalls ?? []
    const { score, reasons } = scoreTask(task, answer)
    return {
      ...base,
      score,
      reasons,
      ...(artifact.spent.usd ? { costUsd: artifact.spent.usd } : {}),
      ...(artifact.spent.tokens.input ? { tokensIn: artifact.spent.tokens.input } : {}),
      ...(artifact.spent.tokens.output ? { tokensOut: artifact.spent.tokens.output } : {}),
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
