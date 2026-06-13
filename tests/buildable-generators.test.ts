import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AnalystFinding } from '@tangle-network/agent-eval'
import { gitWorktreeAdapter } from '@tangle-network/agent-eval/campaign'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { commandVerifier } from '../src/improvement/agentic-generator'
import { mcpGenerator, toolGenerator } from '../src/improvement/buildable-generators'
import type { LocalHarnessResult } from '../src/mcp/local-harness'

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

let repoRoot: string
beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'buildable-repo-'))
  git(['init', '-q', '-b', 'main'], repoRoot)
  git(['config', 'user.email', 'test@test.dev'], repoRoot)
  git(['config', 'user.name', 'Test'], repoRoot)
  const emptyHooks = join(repoRoot, '.empty-hooks')
  mkdirSync(emptyHooks)
  git(['config', 'core.hooksPath', emptyHooks], repoRoot)
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

const args = (worktreePath: string) => ({
  worktreePath,
  report: undefined,
  findings: FINDINGS,
  maxShots: 2,
  signal: new AbortController().signal,
})

describe('toolGenerator', () => {
  it('builds a tool, verifies with the injected command, ships on pass', async () => {
    const runHarness = vi.fn(async ({ cwd, taskPrompt }: { cwd: string; taskPrompt: string }) => {
      expect(taskPrompt).toContain('building a new TOOL')
      writeFileSync(join(cwd, 'tool.ts'), 'export const ok = true\n')
      return HARNESS_OK
    })
    const gen = toolGenerator({
      runHarness: runHarness as never,
      verify: commandVerifier('true'), // stands in for tsc/test
    })
    expect(gen.kind).toBe('build-tool:claude')

    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 't' })
    const out = await gen.generate(args(wt.path))
    expect(out.applied).toBe(true)
    expect(runHarness).toHaveBeenCalledTimes(1)
  })

  it('discards a tool whose verifier never passes', async () => {
    const runHarness = vi.fn(async ({ cwd }: { cwd: string }) => {
      writeFileSync(join(cwd, 'tool.ts'), 'broken\n')
      return HARNESS_OK
    })
    const gen = toolGenerator({
      runHarness: runHarness as never,
      verify: commandVerifier('false'), // always fails
    })
    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'tf' })
    const out = await gen.generate(args(wt.path))
    expect(out.applied).toBe(false)
    expect(runHarness).toHaveBeenCalledTimes(2) // retried with the failure
  })
})

describe('mcpGenerator', () => {
  const okServer = [
    'import { createInterface } from "node:readline"',
    'const rl = createInterface({ input: process.stdin })',
    'const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n")',
    'rl.on("line", (line) => { let m; try { m = JSON.parse(line) } catch { return }',
    '  if (m.method === "initialize") send({ jsonrpc:"2.0", id:m.id, result:{ protocolVersion:"2024-11-05", capabilities:{}, serverInfo:{name:"f",version:"0"} } })',
    '  else if (m.method === "tools/list") send({ jsonrpc:"2.0", id:m.id, result:{ tools:[{ name:"t", inputSchema:{type:"object"} }] } }) })',
  ].join('\n')

  it('builds an MCP server and ships it when boot-and-probe passes', async () => {
    const runHarness = vi.fn(async ({ cwd, taskPrompt }: { cwd: string; taskPrompt: string }) => {
      expect(taskPrompt).toContain('MCP SERVER')
      writeFileSync(join(cwd, 'server.mjs'), okServer)
      return HARNESS_OK
    })
    const gen = mcpGenerator({
      runHarness: runHarness as never,
      serve: { command: 'node', args: ['server.mjs'] },
    })
    expect(gen.kind).toBe('build-mcp:claude')

    const wt = await gitWorktreeAdapter({ repoRoot }).create({ baseRef: 'main', label: 'm' })
    const out = await gen.generate(args(wt.path))
    expect(out.applied).toBe(true)
  })

  it('throws when neither serve nor verify is supplied (unprobed MCP is not a candidate)', () => {
    expect(() => mcpGenerator({})).toThrow(/not probed|never probed|not a candidate/)
  })
})
