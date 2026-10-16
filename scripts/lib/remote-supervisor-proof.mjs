// Packed-consumer integration: real Scope, HTTP MCP, credentials and Node subprocesses.
// Provider peer-mail delivery and model output require separate live qualification.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

export async function verifyRemoteSupervisorConsumer(kernel) {
const { connectRemoteSupervisor, createInMemoryRunContext, createSupervisor, serveCoordinationMcp, workerFromBackend } = kernel
const connectHttpMcp = async ({ url, protectedHeaders }) => {
  const client = new Client({ name: 'packed-runtime-proof', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: protectedHeaders } }))
  return {
    tools: (await client.listTools()).tools,
    callTool: async (name, args) => {
      const result = await client.callTool({ name, arguments: args })
      const text = result.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
      return result.isError ? `ERROR: ${text}` : text
    },
    close: () => client.close(),
  }
}

const root = await mkdtemp(join(tmpdir(), 'runtime-remote-consumer-'))
const context = createInMemoryRunContext()
const budget = { maxIterations: 100, maxTokens: 10000, deadlineMs: 20000 }
const releasePath = join(root, "release")
const release = () => writeFile(releasePath, "released")
const connections = []
const result = await createSupervisor().run({
  name: 'remote-consumer',
  async act(_, scope) {
    const handle = await serveCoordinationMcp({
      scope, blobs: context.blobs, authentication: true,
      perWorker: { maxIterations: 10, maxTokens: 100 },
      toolNames: ['spawn_worker', 'observe_agent', 'read_journal'],
      makeWorkerAgent: (profile, spawn) => workerFromBackend({
        backend: 'cli', bin: process.execPath,
        args: ['--input-type=module', '-e', `
          import { writeFile, access } from 'node:fs/promises';
          let text = ''; for await (const chunk of process.stdin) text += chunk;
          await writeFile(process.argv[1], text);
          while (true) { try { await access(process.argv[2]); break } catch { await new Promise(r => setTimeout(r, 20)) } }
          console.log('process-completed');
        `, join(root, profile.name), releasePath],
      })(profile, spawn),
    })
    const connect = async (url, protectedHeaders) => {
      const client = await connectHttpMcp({ url, protectedHeaders })
      connections.push(client)
      return client
    }
    const call = async (client, name, args) => {
      const text = await client.callTool(name, args)
      assert.ok(!text.startsWith('ERROR:'), text)
      const result = JSON.parse(text)
      assert.ok(!result.error, JSON.stringify(result))
      return result
    }
    try {
      const manager = await connect(handle.url, { ...handle.headers })
      const ids = []
      for (const name of ['alpha', 'beta']) {
        const spawned = await call(manager, 'spawn_worker', { profile: { name, harness: 'cli-base', model: { provider: 'local-process', default: 'node-process' } }, task: `written-by-${name}` })
        assert.ok(spawned.workerId ?? spawned.id, JSON.stringify(spawned))
        ids.push(spawned.workerId ?? spawned.id)
      }
      const access = handle.readOnly
      const reader = await connectRemoteSupervisor({ url: access.url, protectedHeaders: { ...access.headers } })
      connections.push(reader)
      const tree = await reader.tree()
      assert.equal(tree.nodes.length, 2)
      for (const node of tree.nodes) assert.equal(node.parent, tree.root)
      const observed = await reader.observe(ids[0])
      assert.equal(observed.agent.id, ids[0])
      assert.equal(observed.events.status, 'available')
      assert.deepEqual(observed.events.entries, [], 'raw CLI has no normalized text progress')
      await assert.rejects(() => reader.observe('foreign-worker'))
      const readMcp = await connect(access.url, { ...access.headers })
      assert.deepEqual(readMcp.tools.map((tool) => tool.name).sort(), ['observe_agent', 'read_journal'])
      await assert.rejects(() => readMcp.callTool('spawn_worker', { profile: { name: 'forbidden' }, task: {} }), error => error.code === -32601 && error.message.includes('unknown tool: spawn_worker'))
      assert.equal((await reader.tree()).nodes.length, 2)
      const escalation = await fetch(handle.url, {
        method: 'POST', headers: { ...access.headers, 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      })
      assert.equal(escalation.status, 401)
      handle.rotateCredential()
      await assert.rejects(() => reader.tree())
      await release()
      for (;;) { const settled = await scope.next(); if (!settled) break; assert.equal(settled.kind, 'done', JSON.stringify(settled)) }
      for (const name of ['alpha', 'beta']) assert.equal(await readFile(join(root, name), 'utf8'), `written-by-${name}`)
      return { tree: true, readerCannotControl: true, readerCannotEscalate: true, rotationRevokesReader: true, files: true, subprocesses: 2, modelCalls: 0, providerPeerMail: 'separate-live-qualification' }
    } finally {
      await release()
      await Promise.allSettled(connections.map((client) => client.close()))
      await handle.close()
    }
  },
}, {}, { ...context, budget, runId: 'remote-consumer-proof' })
try {
  assert.equal(result.kind, 'winner', JSON.stringify(result))
  console.log(JSON.stringify({ remoteSupervisorConsumer: result.out }))
} finally { await rm(root, { recursive: true, force: true }) }

}
