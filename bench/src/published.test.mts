/**
 * AutomationBench through its publisher's own runner and grader, at the registry's pinned commit, through `runPublished`.
 * A local OpenAI-compatible endpoint stands in for the target model: it plays the gold tool call for
 * `simple.email_sf_contact_phone_update` (update contact 003001's phone to +1-555-0101) or answers with no tool call.
 * The publisher's grader must pass the first and fail the second. Needs uv and network for the publisher's checkout.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
      args: ['--domains', 'simple', '--toolset', 'zapier', '--input-cost', '0', '--output-cost', '0'],
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

test('agent-bench run refuses an app target for a model-shaped benchmark and names the missing front', () => {
  const cli = path.join(path.dirname(new URL(import.meta.url).pathname), 'cli.ts')
  let failure: { status: number | null; stderr: string } | undefined
  try {
    execFileSync(process.execPath, ['--import', 'tsx', cli, 'run', 'automationbench', '--target', 'app:legal-agent'], { stdio: 'pipe', env: { ...process.env, TANGLE_API_KEY: 'unused' } })
  } catch (error) {
    failure = { status: (error as { status: number | null }).status, stderr: String((error as { stderr: Buffer }).stderr) }
  }
  assert.equal(failure?.status, 1)
  assert.match(failure!.stderr, /agent-gateway takes chat messages only/)
})
