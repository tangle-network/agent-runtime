// Public consumer integration over actual Scope, HTTP MCP, file-writing code workers and mail.
// No model/provider is simulated. Provider peer-mail delivery requires live qualification.
import assert from 'node:assert/strict'
import { appendFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

async function connect(url, protectedHeaders) {
  const client = new Client({ name: 'packed-runtime-proof', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: protectedHeaders },
  }))
  return client
}

async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args })
  assert.ok(!result.isError, JSON.stringify(result))
  const text = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
  const value = JSON.parse(text)
  assert.ok(!value.error, JSON.stringify(value))
  return value
}

export async function verifyRemoteSupervisorConsumer(kernel) {
  const { connectRemoteSupervisor, createInMemoryRunContext, createSupervisor, serveCoordinationMcp } = kernel
  const root = await mkdtemp(join(tmpdir(), 'runtime-remote-consumer-'))
  const context = createInMemoryRunContext()
  const peers = new Map()
  const connections = []
  let release
  const released = new Promise(resolve => { release = resolve })
  try {
    const result = await createSupervisor().run({
      name: 'remote-consumer',
      async act(_, scope) {
        const handle = await serveCoordinationMcp({
          scope, blobs: context.blobs, authentication: true, peerMail: true,
          perWorker: { maxIterations: 10, maxTokens: 100 },
          toolNames: ['spawn_worker', 'observe_agent', 'read_journal'],
          makeWorkerAgent: (profile, spawn) => {
            peers.set(profile.name, spawn.peerMailUrl)
            let artifact
            // These are real code workers through the public BYO Executor contract. They write
            // their tasks and delivered mail to disk. There is no inference or usage estimate.
            const begin = async task => {
              const began = Date.now()
              await writeFile(join(root, profile.name), task)
              return began
            }
            const finish = async (task, began) => {
              await released
              artifact = {
                outRef: `file:${profile.name}`, out: task,
                spent: { iterations: 1, tokens: { input: 0, output: 0 }, usd: 0, ms: Date.now() - began },
              }
              return artifact
            }
            const executor = {
              runtime: 'inline',
              execute: profile.name === 'alpha' ? async function* (task) {
                const began = await begin(task)
                yield { kind: 'progress', progress: { kind: 'text_delta', text: await readFile(join(root, profile.name), 'utf8') } }
                await finish(task, began)
              } : async task => finish(task, await begin(task)),
              deliver(message) {
                appendFileSync(join(root, `${profile.name}.mail`), JSON.stringify(message) + '\n')
                return true
              },
              async teardown() { release(); return { destroyed: true } },
              resultArtifact() { assert.ok(artifact); return artifact },
            }
            return { name: profile.name, act: async () => { throw new Error('Scope must use the executor') },
              executorSpec: { profile, harness: null, executor } }
          },
        })
        const attach = async (url, headers) => {
          const client = await connect(url, headers)
          connections.push(client)
          return client
        }
        try {
          const manager = await attach(handle.url, { ...handle.headers })
          const ids = []
          for (const name of ['alpha', 'beta']) {
            const spawned = await call(manager, 'spawn_worker', { profile: { name }, task: `written-by-${name}` })
            assert.equal(typeof spawned.workerId, 'string', JSON.stringify(spawned))
            ids.push(spawned.workerId)
          }
          const access = handle.readOnly
          const reader = await connectRemoteSupervisor({ url: access.url, protectedHeaders: { ...access.headers } })
          connections.push(reader)
          const tree = await reader.tree()
          assert.equal(tree.nodes.length, 2)
          for (const node of tree.nodes) assert.equal(node.parent, tree.root)
          let observed
          const until = Date.now() + 3000
          do {
            observed = await reader.observe(ids[0])
            if (observed.events.status === 'available' && observed.events.entries.length > 0) break
            await new Promise(resolve => setTimeout(resolve, 10))
          } while (Date.now() < until)
          assert.equal(observed.agent.id, ids[0])
          assert.equal(observed.events.status, 'available')
          assert.deepEqual(observed.events.entries.map(entry => entry.event), [{ kind: 'text_delta', text: 'written-by-alpha' }])
          const next = await reader.observe(ids[0], observed.events.cursor)
          assert.equal(next.events.status, 'available')
          assert.deepEqual(next.events.entries, [])
          const reset = await reader.observe(ids[0], { epoch: 'previous-process', next: 0 })
          assert.equal(reset.events.reset, true)
          assert.equal((await reader.observe(ids[1])).events.status, 'unavailable', 'one-shot code does not invent live events')
          await assert.rejects(() => reader.observe('foreign-worker'))
          const readMcp = await attach(access.url, { ...access.headers })
          assert.deepEqual((await readMcp.listTools()).tools.map(tool => tool.name).sort(), ['observe_agent', 'read_journal'])
          await assert.rejects(() => call(readMcp, 'spawn_worker', { profile: { name: 'forbidden' }, task: {} }),
            error => error.code === -32601 && error.message.includes('unknown tool: spawn_worker'))
          assert.equal((await reader.tree()).nodes.length, 2)
          const escalation = await fetch(handle.url, {
            method: 'POST', headers: { ...access.headers, 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
          })
          assert.equal(escalation.status, 401)
          const first = await attach(peers.get('alpha'))
          const second = await attach(peers.get('beta'))
          const marker = 'peer-transport-received'
          const sent = await call(first, 'send_mail', { kind: 'ask', to: ids[1], subject: 'Transport proof', body: marker })
          assert.equal(sent.delivered, true, JSON.stringify(sent))
          assert.ok(JSON.stringify(await call(second, 'read_mail', {})).includes(marker))
          assert.ok((await readFile(join(root, 'beta.mail'), 'utf8')).includes(marker))
          handle.rotateCredential()
          await assert.rejects(() => reader.tree())
          release()
          for (;;) {
            const settled = await scope.next()
            if (!settled) break
            assert.equal(settled.kind, 'done', JSON.stringify(settled))
          }
          for (const name of ['alpha', 'beta']) assert.equal(await readFile(join(root, name), 'utf8'), `written-by-${name}`)
          return { tree: true, readerCannotControl: true, readerCannotEscalate: true,
            rotationRevokesReader: true, streamEvents: true, cursors: true, peerMail: true, files: true, modelCalls: 0,
            providerPeerMail: 'separate-live-qualification' }
        } finally {
          release()
          await Promise.allSettled(connections.map(client => client.close()))
          await handle.close()
        }
      },
    }, {}, { ...context, budget: { maxIterations: 100, maxTokens: 10000, deadlineMs: 20000 }, runId: 'remote-consumer-proof' })
    assert.equal(result.kind, 'winner', JSON.stringify(result))
    console.log(JSON.stringify({ remoteSupervisorConsumer: result.out }))
  } finally { await rm(root, { recursive: true, force: true }) }
}
