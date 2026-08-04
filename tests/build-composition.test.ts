/**
 * The buildable-artifact factory is `agenticGenerator` + a verifier — the
 * model docs/artifact-lifecycle-frontier.md endorses (no wrapper generators).
 * These tests exercise that composition directly for the two types, so the
 * documented path is the tested path.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeProposalFinding } from '@tangle-network/agent-eval'
import { gitWorktreeAdapter } from '@tangle-network/agent-eval/campaign'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  type AgenticGeneratorExecutorForWorktree,
  agenticGenerator,
  commandVerifier,
} from '../src/improvement/agentic-generator'
import { mcpBuildPrompt, toolBuildPrompt } from '../src/improvement/build-prompts'
import { mcpServeVerifier } from '../src/improvement/mcp-serve-verifier'

function git(a: string[], cwd: string): string {
  return execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()
}

let repoRoot: string
beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'build-comp-'))
  git(['init', '-q', '-b', 'main'], repoRoot)
  git(['config', 'user.email', 't@t.dev'], repoRoot)
  git(['config', 'user.name', 'T'], repoRoot)
  const h = join(repoRoot, '.h')
  mkdirSync(h)
  git(['config', 'core.hooksPath', h], repoRoot)
  writeFileSync(join(repoRoot, 'seed.txt'), 'seed\n')
  git(['add', '-A'], repoRoot)
  git(['commit', '-q', '-m', 'init'], repoRoot)
})
afterEach(() => rmSync(repoRoot, { recursive: true, force: true }))

const FINDINGS = [
  makeProposalFinding({
    analyst_id: 'a1',
    severity: 'high',
    area: 'capability',
    claim: 'the agent needs a ledger-lookup tool',
    recommended_action: 'build it',
    evidence_refs: [],
    confidence: 0.9,
    proposal_origin: 'production',
    produced_at: '2026-01-01',
  }),
]

const PROFILE: AgentProfile = {
  name: 'artifact-author',
  harness: 'cli-base',
  model: { provider: 'offline', default: 'deterministic-author' },
  prompt: { systemPrompt: 'Build the requested artifact in this worktree.' },
}

function executorFor(
  run: (input: { cwd: string; taskPrompt: string }) => void | Promise<void>,
): AgenticGeneratorExecutorForWorktree {
  return (cwd) => ({
    backend: 'router',
    routerBaseUrl: 'https://offline.invalid/v1',
    routerKey: 'test',
    complete: async (body) => {
      const messages = body.messages as Array<{ role?: string; content?: unknown }>
      const taskPrompt = String(
        messages.findLast((message) => message.role === 'user')?.content ?? '',
      )
      await run({ cwd, taskPrompt })
      return {
        model: body.model,
        choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 2, cost_usd: 0.001 },
      }
    },
  })
}

const gen = (worktreePath: string) => ({
  worktreePath,
  findings: FINDINGS,
  maxShots: 2,
  signal: new AbortController().signal,
})

it('build a tool: agenticGenerator + toolBuildPrompt + commandVerifier', async () => {
  const run = vi.fn(async ({ cwd, taskPrompt }: { cwd: string; taskPrompt: string }) => {
    expect(taskPrompt).toContain('building a new TOOL')
    writeFileSync(join(cwd, 'tool.ts'), 'export const ok = true\n')
  })
  const g = agenticGenerator({
    profile: PROFILE,
    executorForWorktree: executorFor(run),
    buildPrompt: toolBuildPrompt,
    verify: commandVerifier('true'),
  })
  const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 't' })
  expect((await g.generate(gen(wt.path))).applied).toBe(true)
})

it('build an MCP server: agenticGenerator + mcpBuildPrompt + mcpServeVerifier', async () => {
  const server = [
    'import { createInterface } from "node:readline"',
    'const rl = createInterface({ input: process.stdin })',
    'const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n")',
    'rl.on("line", (l) => { let m; try { m = JSON.parse(l) } catch { return }',
    '  if (m.method === "initialize") send({ jsonrpc:"2.0", id:m.id, result:{ protocolVersion:"2024-11-05", capabilities:{}, serverInfo:{name:"f",version:"0"} } })',
    '  else if (m.method === "tools/list") send({ jsonrpc:"2.0", id:m.id, result:{ tools:[{ name:"t", inputSchema:{type:"object"} }] } }) })',
  ].join('\n')
  const run = vi.fn(async ({ cwd, taskPrompt }: { cwd: string; taskPrompt: string }) => {
    expect(taskPrompt).toContain('MCP SERVER')
    writeFileSync(join(cwd, 'server.mjs'), server)
  })
  const g = agenticGenerator({
    profile: PROFILE,
    executorForWorktree: executorFor(run),
    buildPrompt: mcpBuildPrompt,
    verify: mcpServeVerifier({ command: 'node', args: ['server.mjs'] }),
  })
  const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'm' })
  expect((await g.generate(gen(wt.path))).applied).toBe(true)
})
