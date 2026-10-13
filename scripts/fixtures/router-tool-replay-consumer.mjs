import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { collectAgentTurn, createExecutor, streamAgentTurn, supervise } from '@tangle-network/agent-runtime/kernel'

// Exercise the installed archive through real loopback HTTP. This fixture owns no real
// model or credentials; an invalid signature/result replay receives an actual HTTP 400.
let respond
const server = createServer(async (request, response) => {
  try {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const fixture = await respond(new URL(request.url, transport.routerBaseUrl).href, {
      body: Buffer.concat(chunks).toString('utf8'),
    })
    response.writeHead(fixture.status, Object.fromEntries(fixture.headers))
    for await (const chunk of fixture.body) {
      response.write(chunk)
      await new Promise(resolve => setImmediate(resolve))
    }
    response.end()
  } catch (error) {
    response.writeHead(400, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: error.message } }))
  }
})
await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
const address = server.address()
assert.ok(address && typeof address === 'object')
const transport = { routerBaseUrl: `http://127.0.0.1:${address.port}/v1`, routerKey: 'offline' }
const model = 'offline-model'
const tool = { type: 'function', function: { name: 'echo', parameters: {
  type: 'object', properties: { value: { type: 'integer' } }, required: ['value'],
} } }
const calls = [1, 2].map(value => ({
  id: `call-${value}`, type: 'function',
  function: { name: 'echo', arguments: JSON.stringify({ value }) },
  extra_content: { google: { thought_signature: `signature-${value}` } },
  provider_tag: `tag-${value}`,
}))
const results = [1, 2].map(value => ({
  role: 'tool', tool_call_id: `call-${value}`, content: JSON.stringify({ value }),
}))
const usage = { prompt_tokens: 7, completion_tokens: 3, cost: 0 }
const passed = []
try {
  for (const path of ['executor', 'supervisor']) {
    for (const stream of [false, true]) {
      for (const content of ['', null]) {
        const requests = []
        const executed = []
        respond = async (url, init) => {
          assert.equal(String(url), `${transport.routerBaseUrl}/chat/completions`)
          const body = JSON.parse(String(init.body))
          requests.push(body)
          assert.ok(requests.length <= 2, 'unexpected extra model turn')
          if (requests.length === 2) {
            assert.deepEqual(body.messages.find(message => message.role === 'assistant'), {
              role: 'assistant', content: '', tool_calls: calls,
            })
            assert.deepEqual(body.messages.filter(message => message.role === 'tool'), results)
          }
          const first = requests.length === 1
          const nextCalls = first ? calls : path === 'supervisor' ? [{
            id: 'submit-result', type: 'function',
            function: { name: 'submit_result', arguments: JSON.stringify({ result: { answer: 'done' } }) },
          }] : undefined
          if (!stream) return Response.json({ model, usage, choices: [{ message: {
            content: first ? content : 'done', ...(nextCalls ? { tool_calls: nextCalls } : {}),
          } }] })
          const deltas = first ? [
            { content },
            ...[1, 0].map(index => ({ tool_calls: [{
              index, id: calls[index].id, type: 'function',
              function: { name: 'echo', arguments: '{"value":' },
              provider_tag: calls[index].provider_tag,
              extra_content: { google: { thought_signature: 'replaced' }, stale: true },
            }] })),
            ...[0, 1].map(index => ({ tool_calls: [{
              index, function: { arguments: `${index + 1}}` }, extra_content: calls[index].extra_content,
            }] })),
          ] : [{ content: 'done', ...(nextCalls ? { tool_calls: nextCalls.map(call => ({ index: 0, ...call })) } : {}) }]
          const wire = deltas.map(delta => ({ model, choices: [{ delta }] })).concat({
            model, usage, choices: [{ delta: {}, finish_reason: nextCalls ? 'tool_calls' : 'stop' }],
          }).map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n'
          const bytes = new TextEncoder().encode(wire)
          return new Response(new ReadableStream({ start(controller) {
            for (let offset = 0; offset < bytes.length; offset += 17) controller.enqueue(bytes.slice(offset, offset + 17))
            controller.close()
          } }), { headers: { 'content-type': 'text/event-stream' } })
        }
        const execute = async (name, args) => { executed.push([name, args]); return JSON.stringify(args) }
        const profile = { name: 'packed-replay', harness: 'cli-base',
          model: { provider: 'tangle-router', default: model, metadata: { stream, maxTurns: 3 } },
        }
        if (path === 'executor') {
          const turn = await collectAgentTurn(streamAgentTurn({
            kind: 'executor', profile: { ...profile, tools: { echo: true } },
            factory: createExecutor({ backend: 'router-tools', ...transport, tools: [tool], executeToolCall: execute }),
          }, { prompt: 'Echo 1 and 2, then finish.' }))
          assert.equal(turn.status, 'completed')
          assert.equal(turn.finalText, 'done')
          assert.equal(turn.events.filter(event => event.type === 'final').length, 1)
        } else {
          const result = await supervise({ ...profile, tools: {
            agent_runtime_coordination_echo: true, agent_runtime_coordination_submit_result: true,
          } }, 'Echo 1 and 2, then finish.', {
            budget: { maxIterations: 20, maxTokens: 10_000, deadlineMs: 5_000 },
            router: transport, backend: { backend: 'router', ...transport },
            extraTools: [tool.function], executeExtraTool: execute,
            deliverable: { describe: 'the completed echoed answer', check: value => value?.answer === 'done' },
          })
          assert.equal(result.kind, 'winner')
          assert.deepEqual(result.out, { answer: 'done' })
        }
        assert.equal(requests.length, 2)
        assert.deepEqual(executed, [['echo', { value: 1 }], ['echo', { value: 2 }]])
        passed.push({ path, stream, content, requests: requests.length })
      }
    }
  }
} finally {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}
console.log(JSON.stringify({ kind: 'packed-router-tool-replay', transport: 'loopback-http', passed, realModelCalls: 0 }))
