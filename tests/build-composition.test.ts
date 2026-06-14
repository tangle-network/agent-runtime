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
import type { AnalystFinding } from '@tangle-network/agent-eval'
import { gitWorktreeAdapter } from '@tangle-network/agent-eval/campaign'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agenticGenerator, commandVerifier } from '../src/improvement/agentic-generator'
import { mcpBuildPrompt, toolBuildPrompt } from '../src/improvement/build-prompts'
import { mcpServeVerifier } from '../src/improvement/mcp-serve-verifier'
import type { LocalHarnessResult } from '../src/mcp/local-harness'

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
  {
    schema_version: '1.0.0',
    finding_id: 'f1',
    analyst_id: 'a1',
    produced_at: '2026-01-01',
    severity: 'high',
    area: 'capability',
    claim: 'the agent needs a ledger-lookup tool',
    recommended_action: 'build it',
    evidence_refs: [],
    confidence: 0.9,
  },
] as unknown as AnalystFinding[]

const HARNESS_OK: LocalHarnessResult = {
  exitCode: 0,
  stdout: 'done',
  stderr: '',
  killedBySignal: null,
  durationMs: 10,
  timedOut: false,
}

const gen = (worktreePath: string) => ({
  worktreePath,
  report: undefined,
  findings: FINDINGS,
  maxShots: 2,
  signal: new AbortController().signal,
})

it('build a tool: agenticGenerator + toolBuildPrompt + commandVerifier', async () => {
  const runHarness = vi.fn(async ({ cwd, taskPrompt }: { cwd: string; taskPrompt: string }) => {
    expect(taskPrompt).toContain('building a new TOOL')
    writeFileSync(join(cwd, 'tool.ts'), 'export const ok = true\n')
    return HARNESS_OK
  })
  const g = agenticGenerator({
    runHarness: runHarness as never,
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
  const runHarness = vi.fn(async ({ cwd, taskPrompt }: { cwd: string; taskPrompt: string }) => {
    expect(taskPrompt).toContain('MCP SERVER')
    writeFileSync(join(cwd, 'server.mjs'), server)
    return HARNESS_OK
  })
  const g = agenticGenerator({
    runHarness: runHarness as never,
    buildPrompt: mcpBuildPrompt,
    verify: mcpServeVerifier({ command: 'node', args: ['server.mjs'] }),
  })
  const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'm' })
  expect((await g.generate(gen(wt.path))).applied).toBe(true)
})
