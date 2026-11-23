/**
 * A `continuity: 'resume'` route continues the earlier worker's harness conversation on the
 * provider backend, the local CLI's path (#2755). The resumed worker gets a new retained
 * environment, because its earlier one is torn down when that node settles, and dispatches its
 * first turn in the earlier worker's session. cli-bridge keys the native conversation by that
 * session id (`claude --resume`, `codex exec resume`), so the loopback peer here keeps one
 * conversation per `session_id` the same way, and answers from all of it. A harness that opens a
 * new conversation every turn is refused when the graph loads, before any node runs.
 */
import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createCliBridgeProvider,
  defaultCliBridgeCapabilities,
} from '@tangle-network/agent-provider-cli-bridge'
import { describe, expect, it } from 'vitest'
import { FileResultBlobStore, workerFromBackend } from '../../src/runtime/index'
import { runGraph } from '../../src/runtime/supervise/graph'
import { loadGraphFile } from '../../src/runtime/supervise/graph-file'
import { graphFromStored } from '../../src/runtime/supervise/graph-registry'

const MARKER_PATTERN = /resume-marker-[0-9a-f]{16}/u

interface Dispatch {
  readonly node: string
  readonly sessionId: string
  readonly environmentId: string
  readonly prompt: string
  readonly answer: Record<string, unknown>
}

interface BridgeRun {
  readonly headers: Record<string, string>
  readonly snapshot: Record<string, string>
  readonly frames: string[]
  status: 'running' | 'done'
  readonly waiters: Set<() => void>
}

function chunk(delta: Record<string, unknown>, finishReason: string | null): string {
  return JSON.stringify({
    id: 'chatcmpl-resume-fixture',
    object: 'chat.completion.chunk',
    model: 'claude-code/anthropic/fixture-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })
}

/**
 * The Bridge's retained HTTP protocol (dispatch, replayable run events, exact run status and
 * exact cancellation), with one conversation per `session_id`. A `build` turn answers with the
 * marker its conversation holds, whichever turn of that conversation carried it; a `review` turn
 * asks for one more pass the first time and accepts the second.
 */
async function startConversationBridge() {
  const runs = new Map<string, BridgeRun>()
  const conversations = new Map<string, string[]>()
  const dispatches: Dispatch[] = []
  let reviews = 0
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  const notify = (run: BridgeRun) => {
    for (const waiter of [...run.waiters]) waiter()
  }
  const answerFor = (node: string, conversation: readonly string[]): Record<string, unknown> => {
    if (node === 'build') {
      const marker = conversation.join('\n').match(MARKER_PATTERN)?.[0] ?? null
      return { marker }
    }
    reviews += 1
    return { verdict: reviews === 1 ? 'concerns' : 'ok' }
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://bridge.local')
    if (req.method === 'GET' && url.pathname === '/v1/capabilities')
      return json(res, 200, defaultCliBridgeCapabilities('claude-code'))
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      const chunks: Buffer[] = []
      for await (const part of req) chunks.push(Buffer.from(part))
      const raw = Buffer.concat(chunks)
      const body = JSON.parse(raw.toString('utf8')) as {
        run_id: string
        provider: string
        environment_id: string
        session_id: string
        execution_id: string
        messages: unknown
        agent_profile?: { name?: string }
      }
      const node = body.agent_profile?.name ?? 'unnamed'
      const prompt = JSON.stringify(body.messages)
      const conversation = [...(conversations.get(body.session_id) ?? []), prompt]
      conversations.set(body.session_id, conversation)
      const answer = answerFor(node, conversation)
      dispatches.push({
        node,
        sessionId: body.session_id,
        environmentId: body.environment_id,
        prompt,
        answer,
      })
      const requestDigest = `sha256:${createHash('sha256').update(raw).digest('hex')}`
      const run: BridgeRun = {
        headers: {
          'x-run-id': body.run_id,
          'x-run-request-digest': requestDigest,
          'x-run-provider': body.provider,
          'x-run-environment-id': body.environment_id,
          'x-run-session-id': body.session_id,
          'x-run-execution-id': body.execution_id,
        },
        snapshot: {
          id: body.run_id,
          requestDigest,
          provider: body.provider,
          environmentId: body.environment_id,
          sessionId: body.session_id,
          executionId: body.execution_id,
        },
        frames: [
          chunk({ role: 'assistant', content: JSON.stringify(answer) }, null),
          chunk({}, 'stop'),
        ],
        status: 'done',
        waiters: new Set(),
      }
      runs.set(body.run_id, run)
      res.writeHead(200, { ...run.headers, 'content-type': 'text/event-stream' })
      res.flushHeaders()
      return
    }
    const events = url.pathname.match(/^\/v1\/runs\/([^/]+)\/events$/u)?.[1]
    if (req.method === 'GET' && events !== undefined) {
      const run = runs.get(decodeURIComponent(events))
      if (!run) return json(res, 404, { error: { message: 'run not found' } })
      res.writeHead(200, { ...run.headers, 'content-type': 'text/event-stream' })
      let sent = Number(req.headers['last-event-id'] ?? 0)
      const flush = () => {
        while (sent < run.frames.length) {
          sent += 1
          res.write(`id: ${sent}\ndata: ${run.frames[sent - 1]}\n\n`)
        }
        if (run.status === 'running') return
        run.waiters.delete(flush)
        res.end('data: [DONE]\n\n')
      }
      run.waiters.add(flush)
      res.on('close', () => run.waiters.delete(flush))
      flush()
      return
    }
    const cancel = url.pathname.match(/^\/v1\/runs\/([^/]+)\/cancel$/u)?.[1]
    if (req.method === 'POST' && cancel !== undefined) {
      const chunks: Buffer[] = []
      for await (const part of req) chunks.push(Buffer.from(part))
      const request = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
      const run = runs.get(decodeURIComponent(cancel))
      if (!run) return json(res, 404, { error: { message: 'run not found' } })
      // Every fixture turn has settled by the time its environment is torn down.
      return json(res, 200, {
        operationId: request.operationId,
        requestDigest: request.requestDigest,
        run: request.run,
        status: 'accepted',
        effect: 'not_live',
      })
    }
    const status = url.pathname.match(/^\/v1\/runs\/([^/]+)$/u)?.[1]
    if (req.method === 'GET' && status !== undefined) {
      const run = runs.get(decodeURIComponent(status))
      if (!run) return json(res, 404, { error: { message: 'run not found' } })
      notify(run)
      return json(res, 200, { ...run.snapshot, status: run.status, terminal: true })
    }
    json(res, 404, { error: { message: `no route ${req.method} ${url.pathname}` } })
  }

  const server = createServer((req, res) => {
    void route(req, res).catch((error: unknown) => {
      if (!res.headersSent) res.writeHead(500)
      res.end(String(error))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    dispatches,
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

const brief = { surface: 'delegates/worker-brief', version: 1 }

/** build gets the marker once; review sends it back, resumed, and the run ends on review's ok. */
function repairGraph(options: {
  readonly marker: string
  readonly buildHarness: string
  readonly continuity: 'resume' | 'fresh'
}) {
  const profile = (id: string, harness: string) => ({
    name: id,
    harness,
    model: { provider: 'anthropic', default: 'fixture-model' },
  })
  return JSON.stringify({
    graph: 'provider-resume-route',
    nodes: [
      { id: 'build', profile: profile('build', options.buildHarness) },
      { id: 'review', profile: profile('review', 'claude-code') },
    ],
    entry: [{ node: 'build', task: { marker: options.marker } }],
    edges: [
      { kind: 'routes', from: 'build', to: 'review', directive: brief, evidence: ['build'] },
      {
        kind: 'routes',
        from: 'review',
        to: 'build',
        when: { pointer: '/verdict', equals: 'concerns' },
        continuity: options.continuity,
        maxTraversals: 1,
        directive: brief,
        evidence: ['review'],
      },
      { kind: 'routes', from: 'review', to: { finish: 'reviewed' }, directive: brief },
    ],
    budget: { maxIterations: 8, maxTokens: 100_000 },
    check: {
      describe: 'review accepted the build',
      all: [
        { node: 'review', pointer: '/verdict', equals: 'ok' },
        { node: 'build', pointer: '/marker', exists: true },
      ],
    },
  })
}

describe('a continuity: resume route on the provider backend', () => {
  it('continues the earlier worker conversation in a new environment, first attempt', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'provider-resume-route-'))
    const bridge = await startConversationBridge()
    const marker = `resume-marker-${randomBytes(8).toString('hex')}`
    try {
      const loaded = await loadGraphFile(join(directory, 'repair.graph.json'), {
        source: repairGraph({ marker, buildHarness: 'claude-code', continuity: 'resume' }),
      })
      const provider = createCliBridgeProvider({ baseUrl: bridge.url })
      const result = await runGraph(graphFromStored(loaded.graph, { trigger: {} }), {
        makeLeafAgent: workerFromBackend({ backend: 'provider', provider, outputFormat: 'json' }),
        runDir: join(directory, 'run'),
        runId: 'provider-resume-route',
        perWorker: { maxIterations: 1, maxTokens: 10_000 },
        driverRetry: { enabled: false },
      })
      expect(result.result.kind, JSON.stringify(result.result)).toBe('winner')

      // One dispatch per node visit: nothing was retried.
      expect(bridge.dispatches.map((dispatch) => dispatch.node)).toEqual([
        'build',
        'review',
        'build',
        'review',
      ])
      const [first, , resumed] = bridge.dispatches
      // The resumed turn is the earlier build conversation, in an environment of its own.
      expect(resumed!.sessionId).toBe(first!.sessionId)
      expect(resumed!.environmentId).not.toBe(first!.environmentId)
      expect(first!.prompt).toContain(marker)
      expect(resumed!.prompt).not.toContain(marker)
      expect(resumed!.answer).toEqual({ marker })
      // Every review starts its own conversation.
      const sessions = bridge.dispatches.map((dispatch) => dispatch.sessionId)
      expect(new Set(sessions).size).toBe(3)

      // Runtime settled both build visits with the marker the conversation held.
      const blobs = new FileResultBlobStore(join(directory, 'run', 'blobs'))
      const outputs = await Promise.all(
        result.result.tree.nodes.flatMap((node) => (node.outRef ? [blobs.get(node.outRef)] : [])),
      )
      expect(
        outputs.flatMap((out) =>
          out !== null && typeof out === 'object' && 'marker' in out ? [out.marker] : [],
        ),
      ).toEqual([marker, marker])
    } finally {
      await bridge.close()
      await rm(directory, { recursive: true, force: true })
    }
  }, 60_000)

  it('refuses at load a resume route to a harness that opens a conversation per turn', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'provider-resume-refusal-'))
    try {
      const file = join(directory, 'repair.graph.json')
      const marker = 'resume-marker-0000000000000000'
      await expect(
        loadGraphFile(file, {
          source: repairGraph({ marker, buildHarness: 'hermes', continuity: 'resume' }),
        }),
      ).rejects.toThrow(
        /the routes edge from review resumes build, but hermes starts every turn in a new conversation; give build a seat on claude-code, codex, .*or route it with continuity: fresh/u,
      )
      // The same graph routed fresh loads: only the resume is refused.
      const fresh = await loadGraphFile(file, {
        source: repairGraph({ marker, buildHarness: 'hermes', continuity: 'fresh' }),
      })
      expect(fresh.graph.nodes.map((node) => node.profile.harness)).toEqual([
        'hermes',
        'claude-code',
      ])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
