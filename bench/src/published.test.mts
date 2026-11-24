/**
 * AutomationBench through its publisher's own runner and grader, at the registry's pinned commit, through `runPublished`.
 * A local OpenAI-compatible endpoint stands in for the target model: it plays the gold tool call for
 * `simple.email_sf_contact_phone_update` (update contact 003001's phone to +1-555-0101) or answers with no tool call. The
 * `limited_zapier` toolset offers the task's own tools directly (`zapier` puts them behind search and execute meta-tools).
 * The publisher's grader must pass the first and fail the second. Needs uv and network for the publisher's checkout.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createInterface } from 'node:readline'
import type { Readable } from 'node:stream'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { runPublished, PUBLISHED_BENCHMARKS } from './published'

const TASK = 'simple.email_sf_contact_phone_update'
let uv = true
try { execFileSync('uv', ['--version'], { stdio: 'ignore' }) } catch { uv = false }

/** One chat-completions answer: the gold tool call first, then a closing message; or a closing message alone. */
function standIn(gold: boolean) {
  const requests: Array<{ tools: number; messages: number }> = []
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw || '{}') as { model?: string; stream?: boolean; tools?: unknown[]; messages?: Array<{ role: string }> }
    requests.push({ tools: body.tools?.length ?? 0, messages: body.messages?.length ?? 0 })
    const answered = body.messages?.some((message) => message.role === 'tool') ?? false
    const message = gold && !answered
      ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_gold_1', type: 'function',
          function: { name: 'salesforce_contact_update', arguments: JSON.stringify({ id: '003001', phone: '+1-555-0101' }) } }] }
      : { role: 'assistant', content: 'Done.' }
    const choice = { index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const delta = message.tool_calls
        ? { role: 'assistant', tool_calls: message.tool_calls.map((call, index) => ({ index, ...call })) }
        : { role: 'assistant', content: message.content }
      res.write(`data: ${JSON.stringify({ id: 'chatcmpl-stand-in', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
      res.write(`data: ${JSON.stringify({ id: 'chatcmpl-stand-in', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason }], usage })}\n\n`)
      res.end('data: [DONE]\n\n')
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ id: 'chatcmpl-stand-in', object: 'chat.completion', created: 0, model: body.model, choices: [choice], usage }))
  })
  return { server, requests }
}

async function run(gold: boolean, cacheDir: string) {
  const { server, requests } = standIn(gold)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const out = await mkdtemp(path.join(tmpdir(), 'agent-bench-automationbench-'))
  try {
    const result = await runPublished('automationbench', 'model:stand-in-model', {
      taskIds: [TASK], out, cacheDir,
      args: ['--domains', 'simple', '--toolset', 'limited_zapier', '--input-cost', '0', '--output-cost', '0'],
      env: { AGENT_BENCH_ROUTER_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, TANGLE_API_KEY: 'local-stand-in' },
    })
    return { result, requests, record: JSON.parse(await readFile(path.join(out, 'automationbench-run.json'), 'utf8')) }
  } finally {
    server.close()
    await rm(out, { recursive: true, force: true })
  }
}

test('AutomationBench: the publisher\'s grader passes the gold tool call and fails an answer with none', { skip: uv ? false : 'uv is not installed', timeout: 15 * 60_000 }, async () => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'agent-bench-published-cache-'))
  try {
    const gold = await run(true, cacheDir)
    assert.equal(gold.result.tasks, 1)
    assert.deepEqual(gold.result.taskScores, [{ id: TASK, resolved: true, score: 1 }])
    assert.equal(gold.result.measured, 'model-shaped')
    assert.equal(gold.result.official, true)
    assert.equal(gold.result.ref, PUBLISHED_BENCHMARKS.automationbench!.ref)
    assert.ok(gold.requests.some((request) => request.tools > 0), 'the publisher runner offered its tools to the endpoint')
    assert.equal(gold.record.passed, 1)

    const none = await run(false, cacheDir)
    assert.equal(none.result.tasks, 1)
    assert.equal(none.result.passed, 0)
    assert.equal(none.result.taskScores[0]!.resolved, false)
  } finally {
    await rm(cacheDir, { recursive: true, force: true })
  }
})

test('agent-bench run refuses an app target and names the fronts that do not forward tools', () => {
  const cli = path.join(path.dirname(new URL(import.meta.url).pathname), 'cli.ts')
  let failure: { status: number | null; stderr: string } | undefined
  try {
    execFileSync(process.execPath, ['--import', 'tsx', cli, 'run', 'automationbench', '--target', 'app:legal-agent'], { stdio: 'pipe', env: { ...process.env, TANGLE_API_KEY: 'unused' } })
  } catch (error) {
    failure = { status: (error as { status: number | null }).status, stderr: String((error as { stderr: Buffer }).stderr) }
  }
  assert.equal(failure?.status, 1)
  assert.match(failure!.stderr, /do not forward the caller's tools/)
})

/** The CLI Bridge commit that serves caller-executed tools (drewstone/cli-bridge#397). */
const BRIDGE_REF = '3a81c8f651c93a89d997e2652a863ef687edbb69'

/** A stand-in `claude`: it calls the gold tool through the Bridge's caller MCP server, then finishes the turn. */
const standInHarness = String.raw`#!/usr/bin/env node
const fs = require('node:fs')
if (process.argv.includes('--version')) { console.log('own-loop-peer 1.0'); process.exit(0) }
async function main() {
  const argv = process.argv.slice(2)
  const caller = JSON.parse(fs.readFileSync(argv[argv.indexOf('--mcp-config') + 1], 'utf8')).mcpServers.caller
  const rpc = async (id, method, params) => (await (await fetch(caller.url, { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) })).json()).result
  console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'own-loop-peer' }))
  await rpc(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'peer', version: '1' } })
  const tools = (await rpc(2, 'tools/list', {})).tools.map((tool) => tool.name)
  if (!tools.includes('salesforce_contact_update')) throw new Error('the benchmark tools were not offered: ' + tools.join(','))
  const result = await rpc(3, 'tools/call', { name: 'salesforce_contact_update', arguments: { id: '003001', phone: '+1-555-0101' } })
  console.log(JSON.stringify({ type: 'assistant', message: { id: 'msg_done', content: [{ type: 'text', text: 'Updated: ' + result.content[0].text.slice(0, 80) }] } }))
  console.log(JSON.stringify({ type: 'result', subtype: 'success', session_id: 'own-loop-peer', usage: { input_tokens: 0, output_tokens: 0 }, total_cost_usd: 0 }))
}
main().catch((error) => { console.error('own-loop peer failed: ' + error.message); process.exitCode = 1 })
`

async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const { port } = probe.address() as AddressInfo
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}

async function waitForBridge(stdout: Readable): Promise<string> {
  const lines = createInterface({ input: stdout, signal: AbortSignal.timeout(60_000) })
  try {
    for await (const line of lines) {
      const ready = /^\[cli-bridge\] listening on (http:\/\/127\.0\.0\.1:\d+) /.exec(line)
      if (ready) return ready[1]
    }
    throw new Error('CLI Bridge closed its output before announcing the loopback listener')
  } finally {
    lines.close()
    stdout.resume()
  }
}

test('AutomationBench on a profile target: its runner drives a harness loop through a CLI Bridge, and the publisher\'s grader passes the gold tool call', { skip: uv ? false : 'uv is not installed', timeout: 20 * 60_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'agent-bench-profile-'))
  const bridge = path.join(root, 'cli-bridge')
  execFileSync('git', ['clone', '--quiet', '--filter=blob:none', '--no-checkout', 'https://github.com/drewstone/cli-bridge.git', bridge])
  execFileSync('git', ['checkout', '--quiet', '--detach', BRIDGE_REF], { cwd: bridge })
  execFileSync('pnpm', ['install', '--frozen-lockfile', '--silent'], { cwd: bridge, stdio: 'inherit' })
  const claude = path.join(root, 'claude')
  await writeFile(claude, standInHarness)
  await chmod(claude, 0o755)
  const port = await freePort()
  const server = spawn('pnpm', ['exec', 'tsx', 'src/server.ts'], { cwd: bridge, stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env,
    BRIDGE_HOST: '127.0.0.1', BRIDGE_PORT: String(port), BRIDGE_DATA_DIR: path.join(root, 'state'), BRIDGE_BACKENDS: 'claude', BRIDGE_JAIL_MODE: 'off', CLAUDE_BIN: claude } })
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'agent-bench-published-cache-'))
  const out = await mkdtemp(path.join(tmpdir(), 'agent-bench-profile-out-'))
  try {
    const bridgeUrl = await waitForBridge(server.stdout)
    const result = await runPublished('automationbench', 'profile:claude-code/own-loop-peer', {
      taskIds: [TASK], out, cacheDir,
      args: ['--domains', 'simple', '--toolset', 'limited_zapier', '--input-cost', '0', '--output-cost', '0'],
      env: { AGENT_BENCH_BRIDGE_URL: `${bridgeUrl}/v1`, AGENT_BENCH_BRIDGE_KEY: 'loopback' },
    })
    assert.equal(result.measured, 'own-loop')
    assert.deepEqual(result.taskScores, [{ id: TASK, resolved: true, score: 1 }])
  } finally {
    server.kill('SIGTERM')
    await rm(root, { recursive: true, force: true })
    await rm(cacheDir, { recursive: true, force: true })
    await rm(out, { recursive: true, force: true })
  }
})
