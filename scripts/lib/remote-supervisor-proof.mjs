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
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: protectedHeaders },
    }))
    return client
  } catch (error) {
    await client.close().catch(() => {})
    throw error
  }
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
          await assert.rejects(() => connect(handle.url, { ...access.headers }),
            error => error.code === 401, 'read credentials cannot initialize a manager connection')
          const first = await attach(peers.get('alpha'))
          const second = await attach(peers.get('beta'))
          const marker = 'peer-transport-received'
          const sent = await call(first, 'send_mail', { to: ids[1], subject: 'Transport proof', body: marker })
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

/** Opt-in live qualification. The caller owns the real provider, seat and public route. */
export async function verifyRemoteSupervisorProvider(kernel, { provider, profile, coordination, budget, defaults }) {
  const { connectRemoteSupervisor, createInMemoryRunContext, createSupervisor, serveCoordinationMcp, workerFromBackend } = kernel
  const context = createInMemoryRunContext()
  const nonce = `peer-proof-${Date.now()}`
  const translated = kernel.providerAsSandboxClient(provider, { defaults: { profile } })
  for (const unsupported of [{ confidential: true }, { secrets: 'all' }, { backend: { profile, model: { model: 'conflicting-model' } } }]) {
    await assert.rejects(() => translated.create(unsupported), /Sandbox create controls require mapCreateOptions/)
  }
  const seen = new Map()
  const gaps = new Set()
  const settledWorkers = []
  let finalTree
  let mail
  const result = await createSupervisor().run({
    name: 'remote-provider-consumer',
    async act(_, scope) {
      const handle = await serveCoordinationMcp({
        ...coordination, scope, blobs: context.blobs, authentication: true, peerMail: true,
        perWorker: budget.perWorker,
        toolNames: ['spawn_worker', 'observe_agent', 'read_journal'],
        makeWorkerAgent: workerFromBackend({ backend: 'provider', provider, ...(defaults ? { defaults } : {}) }),
      })
      const manager = await connect(handle.url, { ...handle.headers })
      const access = handle.readOnly
      const reader = await connectRemoteSupervisor({ url: access.url, protectedHeaders: { ...access.headers } })
      let finished = false
      try {
        const ids = []
        for (const name of ['alpha', 'beta']) {
          const marker = `${nonce}-${name}`
          const task = [
            'This task checks the available peer-mail MCP tools. Never print environment variables, tokens or credential files.',
            'Call read_mail to find your sibling. If none is visible yet, wait briefly and read again.',
            `Send the sibling one ask with subject "Peer proof" and body exactly "${marker}". Require delivered=true.`,
            `Then read your own mailbox until a message whose body begins "${nonce}-" arrives from the sibling.`,
            `After observing it, reply with "${marker}" and the received body. Do not finish before reading that message.`,
          ].join('\n')
          const spawned = await call(manager, 'spawn_worker', { profile: { ...profile, name: `remote-peer-${name}` }, task })
          assert.equal(typeof spawned.workerId, 'string', JSON.stringify(spawned))
          ids.push(spawned.workerId)
          seen.set(spawned.workerId, [])
        }
        const cursors = new Map()
        const observe = async () => {
          while (!finished) {
            const tree = await reader.tree()
            assert.equal(tree.nodes.length, 2)
            for (const node of tree.nodes) assert.equal(node.parent, tree.root)
            finalTree = tree
            for (const id of ids) {
              const observed = await reader.observe(id, cursors.get(id))
              if (observed.events.status !== 'available') continue
              if (observed.events.historyExpired || observed.events.reset) gaps.add(id)
              seen.get(id).push(...observed.events.entries)
              cursors.set(id, observed.events.cursor)
            }
            if (!finished) await new Promise(resolve => setTimeout(resolve, 1000))
          }
        }
        const work = async () => {
          try {
            for (;;) {
              const settled = await scope.next()
              if (!settled) break
              settledWorkers.push({ id: settled.handle.id, kind: settled.kind, ...(settled.kind === 'done' ? { out: settled.out, trace: settled.trace } : { reason: settled.reason }) })
              assert.equal(settled.kind, 'done', JSON.stringify(settled))
            }
          } finally { finished = true }
        }
        await Promise.all([work(), observe()])
        assert.equal(settledWorkers.length, 2)
        mail = handle.mailHistory()
        for (const id of ids) {
          assert.ok(mail.some(entry => entry.delivered && entry.envelope.from === id && entry.envelope.body.startsWith(nonce)), 'worker did not send its actual peer message')
          assert.ok(mail.some(entry => entry.delivered && entry.envelope.to === id), 'worker mailbox did not receive a peer message')
          assert.ok(seen.get(id).some(entry => entry.event?.kind === 'tool_call' && entry.event.toolName.includes('read_mail')), 'remote worker did not expose its actual mailbox read')
        }
        return { workers: settledWorkers, tree: finalTree, liveEventCounts: ids.map(id => ({ id, count: seen.get(id).length, explicitGap: gaps.has(id) })),
          mail: mail.map(entry => ({ from: entry.envelope.from, to: entry.envelope.to, delivered: entry.delivered, outcome: entry.outcome, body: entry.envelope.body })) }
      } finally {
        finished = true
        await Promise.allSettled([manager.close(), reader.close()])
        await handle.close()
      }
    },
  }, {}, { ...context, budget: budget.total, runId: nonce })
  const journal = await context.journal.loadTree(nonce)
  const failures = (journal ?? []).filter(event => event.kind === 'settled' && event.status === 'down')
    .map(event => ({ id: event.id, reason: event.reason, infra: event.infra }))
  assert.equal(result.kind, 'winner', JSON.stringify({ result, failures, settledWorkers, mail, observedEvents: [...seen].map(([id, entries]) => ({ id, events: entries.slice(-32).map(entry => ({ kind: entry.event?.kind, toolName: entry.event?.toolName })) })) }))
  assert.equal(result.teardownUnconfirmed?.length ?? 0, 0, JSON.stringify(result.teardownUnconfirmed))
  return { ...result.out, providerModel: result.providerModel, spentTotal: result.spentTotal }
}
