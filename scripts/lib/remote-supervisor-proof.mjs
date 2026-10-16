// Packed-consumer integration: real Scope, HTTP MCP, separate credentials, peer transport and files.
// This verifies the inline execution and transport path. Live provider qualification is separate.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

export async function verifyRemoteSupervisorConsumer(kernel) {
const { connectRemoteSupervisor, createInMemoryRunContext, createSupervisor, serveCoordinationMcp } = kernel
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
const budget = { maxIterations: 100, maxTokens: 10000 }
const peers = new Map()
let release
const released = new Promise((resolve) => { release = resolve })
const connections = []
const result = await createSupervisor().run({
  name: 'remote-consumer',
  async act(_, scope) {
    const handle = await serveCoordinationMcp({
      scope, blobs: context.blobs, authentication: true, peerMail: true,
      perWorker: { maxIterations: 10, maxTokens: 100 },
      toolNames: ['spawn_worker', 'observe_agent', 'read_journal'],
      makeWorkerAgent: (profile, spawn) => {
        peers.set(profile.name, spawn.peerMailUrl)
        return { name: profile.name, async act(task) {
          await writeFile(join(root, profile.name), task.text)
          await released
          return task.text
        } }
      },
    })
    const connect = async (url, protectedHeaders) => {
      const client = await connectHttpMcp({ url, protectedHeaders })
      connections.push(client)
      return client
    }
    const call = async (client, name, args) => {
      const text = await client.callTool(name, args)
      assert.ok(!text.startsWith('ERROR:'), text)
      return JSON.parse(text)
    }
    try {
      const manager = await connect(handle.url, { ...handle.headers })
      const ids = []
      for (const name of ['alpha', 'beta']) {
        const spawned = await call(manager, 'spawn_worker', { profile: { name }, task: { text: `written-by-${name}` } })
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
      assert.equal(observed.events.status, 'unavailable', 'inline work does not invent a live transcript')
      const readMcp = await connect(access.url, { ...access.headers })
      assert.deepEqual(readMcp.tools.map((tool) => tool.name).sort(), ['observe_agent', 'read_journal'])
      assert.match(await readMcp.callTool('spawn_worker', { profile: { name: 'forbidden' }, task: {} }), /^ERROR:/)
      const escalation = await fetch(handle.url, {
        method: 'POST', headers: { ...access.headers, 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      })
      assert.equal(escalation.status, 401)
      const first = await connect(peers.get('alpha'))
      const second = await connect(peers.get('beta'))
      const marker = 'peer-transport-received'
      const sent = await call(first, 'send_mail', { kind: 'tell', to: [ids[1]], body: marker })
      assert.ok(!sent.error, JSON.stringify(sent))
      const inbox = await call(second, 'read_mail', {})
      assert.ok(JSON.stringify(inbox).includes(marker))
      handle.rotateCredential()
      await assert.rejects(() => reader.tree())
      release()
      while (await scope.next()) { /* drain actual completed workers */ }
      for (const name of ['alpha', 'beta']) assert.equal(await readFile(join(root, name), 'utf8'), `written-by-${name}`)
      return { tree: true, readerCannotControl: true, readerCannotEscalate: true, rotationRevokesReader: true, peerMail: true, files: true, modelCalls: 0 }
    } finally {
      release()
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
