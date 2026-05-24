#!/usr/bin/env node

/**
 * @experimental
 *
 * `agent-runtime-mcp` — stdio MCP server entry point.
 *
 * Spins up a server with the default coder delegate (wired against the
 * real `@tangle-network/sandbox` client) and, when the optional
 * `@tangle-network/agent-knowledge` peer is installed, a researcher
 * delegate against `multiHarnessResearcherFanout`.
 *
 * Environment variables:
 *   TANGLE_SANDBOX_API_KEY           required (sandbox-scope: sk_sb_* or orch_prod_*)
 *   TANGLE_API_KEY                   fallback — accepted but expected to be a router key in product envs
 *   SANDBOX_BASE_URL                 optional — sandbox-SDK base URL override
 *   MCP_MAX_CONCURRENT_SANDBOXES     default 4 — kernel maxConcurrency cap
 *   MCP_CODER_FANOUT_HARNESSES       comma-separated harness ids to use for variants > 1
 *   MCP_DISABLE_CODER                set to `1` to omit `delegate_code`
 *   MCP_DISABLE_RESEARCHER           set to `1` to omit `delegate_research` even when peer is present
 */

import type { LoopSandboxClient } from '../loops'
import { runLoop } from '../loops'
import { createDefaultCoderDelegate, type ResearcherDelegate } from './delegates'
import { createMcpServer } from './server'
import type { ResearchOutputShape } from './types'

async function main(): Promise<void> {
  const fanoutHarnesses = parseHarnesses(process.env.MCP_CODER_FANOUT_HARNESSES)
  const maxConcurrency = parseConcurrency(process.env.MCP_MAX_CONCURRENT_SANDBOXES)
  const wantCoder = !process.env.MCP_DISABLE_CODER
  const wantResearcher = !process.env.MCP_DISABLE_RESEARCHER

  // Skip the sandbox client load entirely when no profile delegate needs it —
  // the feedback + status + history tools are queue-bound and require no
  // sandbox. Useful for tooling that mounts the MCP server purely for
  // self-introspection.
  const needsSandbox = wantCoder || wantResearcher
  let sandboxClient: LoopSandboxClient | undefined
  if (needsSandbox) {
    // TANGLE_SANDBOX_API_KEY is the canonical sandbox-scope key. TANGLE_API_KEY
    // is accepted as a fallback for parity with products that already export it
    // — but in product environments TANGLE_API_KEY typically means the router
    // key (sk-tan-*), which sandbox.create() will REJECT. Operators mounting
    // the MCP server inside a product should set TANGLE_SANDBOX_API_KEY
    // explicitly (sk_sb_* or orch_prod_*).
    const apiKey = process.env.TANGLE_SANDBOX_API_KEY ?? process.env.TANGLE_API_KEY
    if (!apiKey && !process.env.AGENT_RUNTIME_MCP_ALLOW_NO_KEY) {
      process.stderr.write(
        'agent-runtime-mcp: TANGLE_SANDBOX_API_KEY is required (sandbox-scope key — sk_sb_* or orch_prod_*). TANGLE_API_KEY is accepted as a fallback. Set AGENT_RUNTIME_MCP_ALLOW_NO_KEY=1 to run without it for diagnostics, or MCP_DISABLE_CODER=1 MCP_DISABLE_RESEARCHER=1 to run the queue-only subset.\n',
      )
      process.exit(2)
    }
    sandboxClient = await loadSandboxClient(apiKey)
  }

  const coderDelegate =
    wantCoder && sandboxClient
      ? createDefaultCoderDelegate({
          sandboxClient,
          fanoutHarnesses,
          maxConcurrency,
        })
      : undefined

  const researcherDelegate =
    wantResearcher && sandboxClient
      ? await loadResearcherDelegate(sandboxClient, maxConcurrency)
      : undefined

  const server = createMcpServer({ coderDelegate, researcherDelegate })

  process.on('SIGINT', () => {
    server.stop()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    server.stop()
    process.exit(0)
  })

  await server.serve()
}

async function loadSandboxClient(apiKey: string | undefined): Promise<LoopSandboxClient> {
  // Diagnostic mode: AGENT_RUNTIME_MCP_ALLOW_NO_KEY=1 enables tools/list + the
  // queue-bound tools (status / history / feedback) without sandbox creds.
  // Coder + researcher delegations require a real client; the stub fails loud
  // at create() so the agent observes the cause instead of silent success.
  if (!apiKey) {
    return {
      async create() {
        throw new Error(
          'agent-runtime-mcp: no sandbox-scope key set; coder/researcher delegations are disabled in diagnostic mode. Set TANGLE_SANDBOX_API_KEY (sk_sb_* or orch_prod_*) or TANGLE_API_KEY as a fallback, or use MCP_DISABLE_CODER=1 MCP_DISABLE_RESEARCHER=1 to remove the unsupported tools from the tool list.',
        )
      },
    } satisfies LoopSandboxClient
  }
  // Dynamic import keeps the bin importable in environments that haven't
  // installed `@tangle-network/sandbox` yet (the runtime package lists it
  // as a peer dep, not a hard dep).
  const mod = await import('@tangle-network/sandbox').catch((err) => {
    process.stderr.write(
      `agent-runtime-mcp: failed to load @tangle-network/sandbox (${err.message}); install the peer dependency\n`,
    )
    process.exit(2)
  })
  const SandboxCtor = (mod as { Sandbox?: new (config: unknown) => LoopSandboxClient }).Sandbox
  if (!SandboxCtor) {
    process.stderr.write(
      'agent-runtime-mcp: @tangle-network/sandbox does not export Sandbox; cannot construct client\n',
    )
    process.exit(2)
  }
  const baseUrl = process.env.SANDBOX_BASE_URL
  return new SandboxCtor({
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
  })
}

interface ResearcherProfilePreset {
  agentRunSpec: Parameters<typeof runLoop>[0]['agentRun'] extends infer T ? NonNullable<T> : never
  output: Parameters<typeof runLoop>[0]['output']
  validator: Parameters<typeof runLoop>[0]['validator']
}

interface ResearcherFanoutPreset {
  agentRuns: NonNullable<Parameters<typeof runLoop>[0]['agentRuns']>
  output: Parameters<typeof runLoop>[0]['output']
  validator: Parameters<typeof runLoop>[0]['validator']
  driver: Parameters<typeof runLoop>[0]['driver']
}

async function loadResearcherDelegate(
  sandboxClient: LoopSandboxClient,
  maxConcurrency: number,
): Promise<ResearcherDelegate | undefined> {
  // Optional peer — when `@tangle-network/agent-knowledge` isn't installed,
  // we silently omit the researcher tool from the advertisement. The
  // dynamic-import path is resolved at runtime; TypeScript cannot see the
  // peer, so we type the module structurally rather than via its own
  // declaration file.
  const profilesSpecifier = '@tangle-network/agent-knowledge/profiles'
  const mod = await import(profilesSpecifier).catch(() => undefined)
  if (!mod) return undefined
  type SingleFactory = (opts: { task: unknown }) => ResearcherProfilePreset
  type FanoutFactory = (opts: { task: unknown }) => ResearcherFanoutPreset
  const fanoutFactory = (mod as { multiHarnessResearcherFanout?: FanoutFactory })
    .multiHarnessResearcherFanout
  const singleFactory = (mod as { researcherProfile?: SingleFactory }).researcherProfile
  if (!fanoutFactory || !singleFactory) return undefined

  return async (args, ctx) => {
    const task = {
      question: args.question,
      knowledgeNamespace: args.namespace,
      scope: args.scope,
      sources: args.sources,
      recencyWindow: args.config?.recencyWindow
        ? {
            since: args.config.recencyWindow.since
              ? new Date(args.config.recencyWindow.since)
              : undefined,
            until: args.config.recencyWindow.until
              ? new Date(args.config.recencyWindow.until)
              : undefined,
          }
        : undefined,
      maxItems: args.config?.maxItems,
      minConfidence: args.config?.minConfidence,
    }
    const variants = Math.max(1, Math.trunc(args.variants ?? 1))
    ctx.report({ iteration: 0, phase: 'starting' })
    if (variants <= 1) {
      const preset = singleFactory({ task })
      const result = await runLoop({
        driver: {
          name: 'mcp-researcher-single',
          async plan(t, history) {
            return history.length === 0 ? [t] : []
          },
          decide(history) {
            return history.length > 0 ? 'pick-winner' : 'fail'
          },
        },
        agentRun: preset.agentRunSpec,
        output: preset.output,
        validator: preset.validator,
        task,
        ctx: { sandboxClient, signal: ctx.signal },
        maxIterations: 1,
        maxConcurrency,
      })
      const output = result.winner?.output
      if (!output) throw new Error('researcher delegate produced no winner')
      ctx.report({ iteration: 1, phase: 'completed' })
      return output as ResearchOutputShape
    }
    const fanout = fanoutFactory({ task })
    const result = await runLoop({
      driver: fanout.driver,
      agentRuns: fanout.agentRuns.slice(0, variants),
      output: fanout.output,
      validator: fanout.validator,
      task,
      ctx: { sandboxClient, signal: ctx.signal },
      maxIterations: variants,
      maxConcurrency: Math.min(maxConcurrency, variants),
    })
    const output = result.winner?.output
    if (!output) throw new Error('researcher delegate fanout produced no winner')
    ctx.report({ iteration: result.iterations.length, phase: 'completed' })
    return output as ResearchOutputShape
  }
}

function parseHarnesses(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined
  const list = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  return list.length > 0 ? list : undefined
}

function parseConcurrency(raw: string | undefined): number {
  if (!raw) return 4
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return 4
  return Math.min(Math.trunc(n), 32)
}

main().catch((err) => {
  process.stderr.write(`agent-runtime-mcp: ${err instanceof Error ? err.stack : String(err)}\n`)
  process.exit(1)
})
