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
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { validateRunRecord } from '@tangle-network/agent-eval'
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
    const runRecords = (await readFile(result.runRecords, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
    return { result, requests, record: JSON.parse(await readFile(path.join(out, 'automationbench-run.json'), 'utf8')), runRecords }
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
    assert.deepEqual(gold.result.taskScores, [{ id: TASK, passed: true, score: 1 }])
    assert.equal(gold.result.measured, 'model-shaped')
    assert.equal(gold.result.official, true)
    assert.equal(gold.result.ref, PUBLISHED_BENCHMARKS.automationbench!.ref)
    assert.ok(gold.requests.some((request) => request.tools > 0), 'the publisher runner offered its tools to the endpoint')
    assert.equal(gold.record.passed, 1)
    // One agent-eval RunRecord per task, valid by agent-eval's own validator. The stand-in reports no served snapshot,
    // so the row records the model as unknown rather than inventing one, and keeps the target as its candidate.
    assert.equal(gold.runRecords.length, 1)
    const row = validateRunRecord(gold.runRecords[0])
    assert.equal(row.scenarioId, `automationbench:${TASK}`)
    assert.equal(row.outcome.holdoutScore, 1)
    assert.equal(row.outcome.raw.passed, 1)
    assert.equal(row.candidateId, 'model:stand-in-model')
    assert.deepEqual([row.model, row.terminalOutcome, row.costUsd], ['unknown', 'unknown', null])

    const none = await run(false, cacheDir)
    assert.equal(none.result.tasks, 1)
    assert.equal(none.result.passed, 0)
    assert.equal(none.result.taskScores[0]!.passed, false)
  } finally {
    await rm(cacheDir, { recursive: true, force: true })
  }
})

test('agent-bench run refuses an app target without the harness that runs its profile', () => {
  const cli = path.join(path.dirname(new URL(import.meta.url).pathname), 'cli.ts')
  let failure: { status: number | null; stderr: string } | undefined
  try {
    execFileSync(process.execPath, ['--import', 'tsx', cli, 'run', 'automationbench', '--target', 'app:gtm-agent'], { stdio: 'pipe', env: { ...process.env, AGENT_BENCH_BRIDGE_KEY: 'unused' } })
  } catch (error) {
    failure = { status: (error as { status: number | null }).status, stderr: String((error as { stderr: Buffer }).stderr) }
  }
  assert.equal(failure?.status, 1)
  assert.match(failure!.stderr, /app:gtm-agent needs @<harness\/model>/)
})

/** The CLI Bridge commit that serves caller-executed tools (#397) and cataloged profiles at /profiles/<id>/v1 (#408, #410). */
const BRIDGE_REF = '857673f6e36cb53b353d0d1c8006bef812669eec'

/**
 * A stand-in `claude`: it calls the gold tool through the Bridge's caller MCP server, then finishes the turn. Started as
 * `app-peer`, it first requires the system prompt the app serves, so an app run passes only when the app's profile ran.
 */
const standInHarness = (appPrompt: string) => String.raw`#!/usr/bin/env node
const fs = require('node:fs')
if (process.argv.includes('--version')) { console.log('own-loop-peer 1.0'); process.exit(0) }
async function main() {
  const argv = process.argv.slice(2)
  const prompt = argv.includes('--system-prompt') ? argv[argv.indexOf('--system-prompt') + 1] : ''
  if (argv[argv.indexOf('--model') + 1] === 'app-peer' && !prompt.startsWith(${JSON.stringify(appPrompt)})) throw new Error('the app profile did not reach the harness')
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

test('AutomationBench on profile and app targets: its runner drives a harness loop through a CLI Bridge, and the publisher\'s grader passes the gold tool call', { skip: uv ? false : 'uv is not installed', timeout: 20 * 60_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'agent-bench-profile-'))
  const bridge = path.join(root, 'cli-bridge')
  execFileSync('git', ['clone', '--quiet', '--filter=blob:none', '--no-checkout', 'https://github.com/drewstone/cli-bridge.git', bridge])
  execFileSync('git', ['checkout', '--quiet', '--detach', BRIDGE_REF], { cwd: bridge })
  execFileSync('pnpm', ['install', '--frozen-lockfile', '--silent'], { cwd: bridge, stdio: 'inherit' })
  // A stand-in app deployment serving its AgentProfile the way gtm-agent does (/api/tools/profile?definition): a Router
  // model and an MCP server of its own, which an app target records and leaves out, and a skill it keeps.
  const appPrompt = 'You are the bench app, a revenue operations agent.'
  const served = {
    name: 'bench-app', version: '1.0.0', model: { default: 'gemini-3.7-flash' }, prompt: { systemPrompt: `${appPrompt} Keep CRM records exact.` },
    mcp: { 'crm-sync': { transport: 'stdio', command: 'node', args: ['./scripts/mcp/crm-sync.mjs'] } },
    resources: { skills: [{ kind: 'inline', name: 'crm-hygiene', content: '---\nname: crm-hygiene\ndescription: Keep CRM fields exact\n---\nCheck ids before updating.\n' }] },
  }
  const appServer = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(served)) })
  await new Promise<void>((resolve) => appServer.listen(0, '127.0.0.1', resolve))
  const claude = path.join(root, 'claude')
  await writeFile(claude, standInHarness(appPrompt))
  await chmod(claude, 0o755)
  const profiles = path.join(root, 'profiles')
  const port = await freePort()
  // Its own process group, so the whole pnpm -> tsx -> node chain stops with it; no pipe keeps this test's process alive.
  const server = spawn('pnpm', ['exec', 'tsx', 'src/server.ts'], { cwd: bridge, detached: true, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env,
    TSX_TSCONFIG_PATH: path.join(bridge, 'tsconfig.json'), SANDBOX_PROFILES_DIR: profiles,
    BRIDGE_HOST: '127.0.0.1', BRIDGE_PORT: String(port), BRIDGE_DATA_DIR: path.join(root, 'state'), BRIDGE_BACKENDS: 'claude', BRIDGE_JAIL_MODE: 'off', CLAUDE_BIN: claude } })
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'agent-bench-published-cache-'))
  const out = await mkdtemp(path.join(tmpdir(), 'agent-bench-profile-out-'))
  try {
    for (let ready = false, attempt = 0; !ready; attempt++) {
      assert.ok(attempt < 120, 'the CLI Bridge did not answer /health within 60 s')
      ready = await fetch(`http://127.0.0.1:${port}/health`).then((response) => response.ok, () => false)
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 500))
    }
    const options = {
      taskIds: [TASK], cacheDir,
      args: ['--domains', 'simple', '--toolset', 'limited_zapier', '--input-cost', '0', '--output-cost', '0'],
      env: { AGENT_BENCH_BRIDGE_URL: `http://127.0.0.1:${port}/v1`, AGENT_BENCH_BRIDGE_KEY: 'loopback', AGENT_BENCH_BRIDGE_PROFILES_DIR: profiles },
    }
    const result = await runPublished('automationbench', 'profile:claude-code/own-loop-peer', { ...options, out: path.join(out, 'profile') })
    assert.equal(result.measured, 'own-loop')
    assert.deepEqual(result.taskScores, [{ id: TASK, passed: true, score: 1 }])

    const apps = JSON.stringify({ 'bench-app': `http://127.0.0.1:${(appServer.address() as AddressInfo).port}/api/tools/profile?definition` })
    const app = await runPublished('automationbench', 'app:bench-app@claude-code/app-peer', { ...options, env: { ...options.env, AGENT_BENCH_APPS: apps }, out: path.join(out, 'app') })
    assert.equal(app.measured, 'own-loop')
    assert.deepEqual(app.taskScores, [{ id: TASK, passed: true, score: 1 }])
    assert.equal(app.model, 'claude-code/app-peer')
    assert.equal(app.app?.app, 'bench-app')
    assert.equal(app.app?.profileVersion, '1.0.0')
    assert.deepEqual(app.app?.productionModel, served.model)
    assert.deepEqual(app.app?.omittedMcp, ['crm-sync'])
    assert.match(app.app!.profileDigest, /^sha256:[0-9a-f]{64}$/)

    // The same profile from a file (an export from a checkout, or an optimizer's candidate) runs as the same profile.
    const file = path.join(root, 'bench-app-profile.json')
    await writeFile(file, JSON.stringify(served))
    const fromFile = await runPublished('automationbench', 'app:bench-app@claude-code/app-peer', { ...options, env: { ...options.env, AGENT_BENCH_APPS: JSON.stringify({ 'bench-app': file }) }, out: path.join(out, 'app-file') })
    assert.deepEqual(fromFile.taskScores, [{ id: TASK, passed: true, score: 1 }])
    assert.equal(fromFile.app?.profileDigest, app.app?.profileDigest)
    assert.equal(fromFile.app?.profileUrl, file)
  } finally {
    appServer.close()
    const exited = new Promise((resolve) => server.once('exit', resolve))
    try { process.kill(-server.pid!, 'SIGTERM') } catch { /* already gone */ }
    const stopped = await Promise.race([exited.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 10_000))])
    if (!stopped) try { process.kill(-server.pid!, 'SIGKILL') } catch { /* already gone */ }
    server.unref()
    await rm(root, { recursive: true, force: true })
    await rm(cacheDir, { recursive: true, force: true })
    await rm(out, { recursive: true, force: true })
  }
})

/** teams/oracle: an audio call from James Wilson to Alice Johnson, and a 'Project Updates' channel; two SQL state verifiers. */
const EOG_TASK = 'task_20251121_134729_533_464ee3e0_2dcf2712'
let docker = true
try { execFileSync('docker', ['info'], { stdio: 'ignore' }) } catch { docker = false }

/** The gold calls one at a time (create_call, then create_channel), named from the tools the runner offers; or no tool call. */
function gymStandIn(gold: boolean) {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw || '{}') as { model?: string; tools?: Array<{ function?: { name?: string } }>; messages?: Array<{ role: string }> }
    const names = (body.tools ?? []).map((tool) => tool.function?.name ?? '')
    const done = body.messages?.filter((message) => message.role === 'tool').length ?? 0
    const step = gold ? [
      { name: names.find((name) => name.endsWith('create_call')), args: { callbackUri: 'https://example.com/callback', requestedModalities: ['audio'],
        mediaConfig: { _odata_type: '#microsoft.graph.serviceHostedMediaConfig' }, targets: [{ identity: { user: { id: 'alice.johnson', displayName: 'Alice Johnson' } } }],
        // The gym stores `source` as given (null when omitted); its seeded calls name the caller as a user identity.
        source: { identity: { user: { id: 'james.wilson', displayName: 'James Wilson' } } } } },
      { name: names.find((name) => name.endsWith('create_channel')), args: { teamId: 'team_techcorp_001', displayName: 'Project Updates', membershipType: 'standard' } },
    ][done] : undefined
    const message = step?.name
      ? { role: 'assistant', content: null, tool_calls: [{ id: `call_gold_${done}`, type: 'function', function: { name: step.name, arguments: JSON.stringify(step.args) } }] }
      : { role: 'assistant', content: 'Done.' }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ id: 'chatcmpl-gym', object: 'chat.completion', created: 0, model: body.model,
      choices: [{ index: 0, message, finish_reason: 'tool_calls' in message ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }))
  })
  return server
}

test('EnterpriseOps-Gym: the publisher\'s SQL verifiers pass the gold calls and fail an answer with none', { skip: uv && docker ? false : 'uv and docker are required', timeout: 40 * 60_000 }, async () => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'agent-bench-published-cache-'))
  try {
    for (const gold of [true, false]) {
      const server = gymStandIn(gold)
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const out = await mkdtemp(path.join(tmpdir(), 'agent-bench-eog-'))
      try {
        const result = await runPublished('enterpriseops-gym', 'model:stand-in-model', {
          taskIds: [EOG_TASK], out, cacheDir, args: ['--domain', 'teams', '--mode', 'oracle', '--concurrency', '1'],
          env: { AGENT_BENCH_ROUTER_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, TANGLE_API_KEY: 'local-stand-in' },
        })
        assert.equal(result.tasks, 1, JSON.stringify(result.taskScores))
        assert.equal(result.taskScores[0]!.id, EOG_TASK)
        assert.equal(result.taskScores[0]!.passed, gold, JSON.stringify(result.taskScores[0]))
        assert.equal(result.measured, 'model-shaped')
      } finally {
        server.closeAllConnections()
        server.close()
        await rm(out, { recursive: true, force: true })
      }
    }
  } finally {
    await rm(cacheDir, { recursive: true, force: true })
  }
})

/** firm-knowledge/tasks/012: one criterion, graded by the judge on the agent's response.md. */
const HARVEY_TASK = 'firm-knowledge/tasks/012'
const HARVEY_ANSWER = 'The firm has not done a financing with a springing lien.'

/**
 * One local endpoint plays the target and the substituted judge. A request offering tools is the target in Harvey's agent
 * loop: with `gold` it writes response.md through Harvey's `write` tool, then calls `finish`; without, it finishes at once.
 * A request with no tools is the judge (bridge/stand-in-judge): it passes the criterion only when the publisher's grader
 * put the agent's answer into its prompt.
 */
function harveyStandIn(gold: boolean) {
  const seen = { target: 0, judge: 0, answerJudged: false }
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw || '{}') as { model?: string; tools?: Array<{ function?: { name?: string } }>; messages?: Array<{ role: string; content?: unknown }> }
    let message: Record<string, unknown>
    if (body.tools?.length) {
      seen.target++
      const done = body.messages?.filter((entry) => entry.role === 'tool').length ?? 0
      const calls = gold ? [['write', { file_path: 'response.md', content: HARVEY_ANSWER }], ['finish', { summary: 'answered', deliverables: ['response.md'] }]] : [['finish', { summary: 'no answer' }]]
      const [name, args] = calls[Math.min(done, calls.length - 1)]!
      message = { role: 'assistant', content: null, tool_calls: [{ id: `call_${done}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }
    } else {
      seen.judge++
      const prompt = JSON.stringify(body.messages ?? [])
      seen.answerJudged ||= prompt.includes(HARVEY_ANSWER)
      message = { role: 'assistant', content: JSON.stringify({ reasoning: 'stand-in judge', verdict: prompt.includes(HARVEY_ANSWER) ? 'pass' : 'fail' }) }
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ id: 'chatcmpl-harvey', object: 'chat.completion', created: 0, model: body.model,
      choices: [{ index: 0, message, finish_reason: 'tool_calls' in message ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }))
  })
  return { server, seen }
}

// The publisher checkout is about 5 GB with its sandbox image, so this test uses the shared cache (~/.cache/agent-bench/published).
test('Harvey LAB: the publisher\'s harness and rubric grader, with a substituted judge, pass the written answer and fail none', { skip: uv && docker ? false : 'uv and docker are required', timeout: 40 * 60_000 }, async () => {
  for (const gold of [true, false]) {
    const { server, seen } = harveyStandIn(gold)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const out = await mkdtemp(path.join(tmpdir(), 'agent-bench-harvey-'))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
    try {
      const result = await runPublished('harvey-lab', 'model:stand-in-model', {
        taskIds: [HARVEY_TASK], out, judge: 'bridge/stand-in-judge', args: ['--max-turns', '5'],
        env: { AGENT_BENCH_ROUTER_URL: url, TANGLE_API_KEY: 'local-stand-in', AGENT_BENCH_JUDGE_URL: url },
      })
      assert.equal(result.tasks, 1, JSON.stringify(result.taskScores))
      assert.equal(result.taskScores[0]!.id, HARVEY_TASK)
      assert.equal(result.taskScores[0]!.passed, gold, JSON.stringify(result.taskScores[0]))
      assert.equal(result.official, false)
      assert.equal(result.judge, 'bridge/stand-in-judge')
      assert.equal(result.publisherJudge, PUBLISHED_BENCHMARKS['harvey-lab']!.judge)
      // Without a deliverable the grader may fail the criterion before any judge call.
      assert.ok(seen.target > 0 && (!gold || seen.judge > 0), JSON.stringify(seen))
      assert.equal(seen.answerJudged, gold, 'the judge saw the agent\'s answer only when the agent wrote one')
      // The publisher's per-criterion verdict reaches the run's raw detail and its RunRecord (what an optimizer reads).
      assert.equal(result.taskScores[0]!.raw?.['crit.C-001'], gold ? 1 : 0)
      const row = validateRunRecord(JSON.parse((await readFile(result.runRecords, 'utf8')).trim()))
      assert.equal(row.outcome.raw['crit.C-001'], gold ? 1 : 0)
    } finally {
      server.closeAllConnections()
      server.close()
      await rm(out, { recursive: true, force: true })
    }
  }
})

/**
 * PRBench: one local Responses API endpoint plays the target (stand-in-model) and the substituted judge (stand-in-judge).
 * The target answers the first legal task with a marked answer, or with none; the judge, called once per rubric criterion
 * by the publisher's grader, meets a criterion only when the conversation it grades holds the marked answer.
 */
const PRBENCH_ANSWER = 'AGENT-BENCH-PRBENCH-ANSWER: the analysis the client asked for.'

function prbenchStandIn(answered: boolean) {
  const seen = { target: 0, judge: 0 }
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw || '{}') as { model?: string; input?: unknown }
    let text: string
    if (body.model === 'stand-in-judge') {
      seen.judge++
      text = `{"explanation": "stand-in judge", "criteria_met": ${JSON.stringify(body.input).includes('AGENT-BENCH-PRBENCH-ANSWER')}}`
    } else {
      seen.target++
      text = answered ? PRBENCH_ANSWER : 'I cannot help with that.'
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ id: 'resp_stand_in', object: 'response', created_at: 0, model: body.model, status: 'completed',
      output: [{ type: 'message', id: 'msg_stand_in', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }))
  })
  return { server, seen }
}

test('PRBench: the publisher\'s rubric grader, with a substituted judge, scores the answered task above zero and the unanswered at zero', { skip: uv ? false : 'uv is not installed', timeout: 30 * 60_000 }, async () => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), 'agent-bench-published-cache-'))
  try {
    const scores: number[] = []
    for (const answered of [true, false]) {
      const { server, seen } = prbenchStandIn(answered)
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const out = await mkdtemp(path.join(tmpdir(), 'agent-bench-prbench-'))
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
      try {
        const result = await runPublished('prbench', 'model:stand-in-model', {
          tasks: 1, out, cacheDir, judge: 'bridge/stand-in-judge', args: ['--split', 'legal', '--concurrency', '2'],
          env: { AGENT_BENCH_ROUTER_URL: url, TANGLE_API_KEY: 'local-stand-in', AGENT_BENCH_JUDGE_URL: url },
        })
        assert.equal(result.tasks, 1, JSON.stringify(result.taskScores))
        assert.equal(result.official, false)
        assert.equal(result.publisherJudge, PUBLISHED_BENCHMARKS.prbench!.judge)
        assert.ok(seen.target === 1 && seen.judge > 1, JSON.stringify(seen))
        scores.push(result.taskScores[0]!.score)
      } finally {
        server.closeAllConnections()
        server.close()
        await rm(out, { recursive: true, force: true })
      }
    }
    assert.ok(scores[0]! > 0, `the answered task scored ${scores[0]}`)
    assert.equal(scores[1], 0)
  } finally {
    await rm(cacheDir, { recursive: true, force: true })
  }
})
