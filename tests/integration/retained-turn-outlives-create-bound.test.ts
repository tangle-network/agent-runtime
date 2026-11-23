/**
 * The retained materialization bound covers `provider.create` and nothing after it (#2756). The
 * CLI Bridge provider keeps its create input, signal included, and folds that signal into every
 * later turn stream and event read, so a bound that outlives create aborts any longer turn.
 * Runtime and the published provider run unchanged against a loopback peer speaking the Bridge's
 * retained HTTP protocol: dispatch, replayable run events and exact run status.
 */
import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type {
  AgentEnvironmentProvider,
  CreateAgentEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'
import {
  createCliBridgeProvider,
  defaultCliBridgeCapabilities,
} from '@tangle-network/agent-provider-cli-bridge'
import { describe, expect, it } from 'vitest'
import { startRetainedRun } from '../../src/runtime/index'
import { RetainedMaterializationTimeoutError } from '../../src/runtime/retained-run-start'

const MODEL = 'claude-code/anthropic/fixture-model'
const profile = {
  name: 'long-turn-worker',
  harness: 'claude-code' as const,
  model: { provider: 'anthropic', default: 'fixture-model' },
  prompt: { systemPrompt: 'Run the long native turn fixture.' },
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
    id: 'chatcmpl-retained-fixture',
    object: 'chat.completion.chunk',
    model: MODEL,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })
}

/**
 * Each dispatch starts one native turn that settles `turnMs` later whether or not anyone reads
 * it, as a detached Bridge run does. With `holdCreateDiscovery`, every capability read after the
 * first never answers, so `provider.create` cannot settle.
 */
async function startRetainedBridge(options: {
  readonly turnMs: number
  readonly holdCreateDiscovery?: boolean
}) {
  const runs = new Map<string, BridgeRun>()
  const dispatched: string[] = []
  const timers = new Set<NodeJS.Timeout>()
  let capabilityReads = 0
  const notify = (run: BridgeRun) => {
    for (const waiter of [...run.waiters]) waiter()
  }
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  const runSnapshot = (run: BridgeRun) => ({
    ...run.snapshot,
    status: run.status,
    terminal: run.status !== 'running',
  })

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://bridge.local')
    if (req.method === 'GET' && url.pathname === '/v1/capabilities') {
      capabilityReads += 1
      if (options.holdCreateDiscovery && capabilityReads > 1) return
      return json(res, 200, defaultCliBridgeCapabilities('claude-code'))
    }
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      const chunks: Buffer[] = []
      for await (const part of req) chunks.push(Buffer.from(part))
      const raw = Buffer.concat(chunks)
      const body = JSON.parse(raw.toString('utf8')) as Record<string, string>
      const requestDigest = `sha256:${createHash('sha256').update(raw).digest('hex')}`
      const run: BridgeRun = {
        headers: {
          'x-run-id': body.run_id!,
          'x-run-request-digest': requestDigest,
          'x-run-provider': body.provider!,
          'x-run-environment-id': body.environment_id!,
          'x-run-session-id': body.session_id!,
          'x-run-execution-id': body.execution_id!,
        },
        snapshot: {
          id: body.run_id!,
          requestDigest,
          provider: body.provider!,
          environmentId: body.environment_id!,
          sessionId: body.session_id!,
          executionId: body.execution_id!,
        },
        frames: [chunk({ role: 'assistant', content: 'native turn ' }, null)],
        status: 'running',
        waiters: new Set(),
      }
      runs.set(body.run_id!, run)
      dispatched.push(body.run_id!)
      const timer = setTimeout(() => {
        timers.delete(timer)
        run.frames.push(chunk({ content: 'settled after the bound' }, null), chunk({}, 'stop'))
        run.status = 'done'
        notify(run)
      }, options.turnMs)
      timers.add(timer)
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
    const status = url.pathname.match(/^\/v1\/runs\/([^/]+)$/u)?.[1]
    if (req.method === 'GET' && status !== undefined) {
      const run = runs.get(decodeURIComponent(status))
      if (!run) return json(res, 404, { error: { message: 'run not found' } })
      const waitMs = Number(url.searchParams.get('wait_ms') ?? 0)
      if (run.status === 'running' && waitMs > 0) {
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer)
            run.waiters.delete(done)
            resolve()
          }
          const timer = setTimeout(done, waitMs)
          run.waiters.add(done)
        })
      }
      return json(res, 200, runSnapshot(run))
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
    dispatched,
    async close() {
      for (const timer of timers) clearTimeout(timer)
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

/** The provider unchanged, with each signal Runtime handed to `create` kept for inspection. */
function recordCreateSignals(provider: AgentEnvironmentProvider) {
  const signals: AbortSignal[] = []
  const recorded: AgentEnvironmentProvider = {
    ...provider,
    create(input: CreateAgentEnvironmentInput) {
      if (input.signal) signals.push(input.signal)
      return provider.create(input)
    },
  }
  return { provider: recorded, signals }
}

describe('retained materialization bound', () => {
  it('settles a CLI Bridge turn longer than the bound on its first dispatch', async () => {
    const boundMs = 2_000
    const turnMs = 5_000
    const bridge = await startRetainedBridge({ turnMs })
    try {
      const { provider, signals } = recordCreateSignals(
        createCliBridgeProvider({ baseUrl: bridge.url, defaultModel: MODEL }),
      )
      const phases: string[] = []
      const started = Date.now()
      const handle = await startRetainedRun({
        provider,
        environment: { profile, idempotencyKey: 'retained-turn-outlives-bound' },
        turn: { prompt: 'Run past the bound.', turnId: 'retained-turn-outlives-bound:turn' },
        materializationTimeoutMs: boundMs,
        onAdmission: async (admission) => {
          phases.push(admission.phase)
        },
      })
      const result = await handle.result()
      const elapsed = Date.now() - started

      expect(elapsed).toBeGreaterThanOrEqual(turnMs - 100)
      expect(result).toMatchObject({
        success: true,
        text: 'native turn settled after the bound',
        sessionId: handle.controlRef.sessionId,
        metadata: {
          runId: handle.controlRef.runId,
          executionId: handle.controlRef.executionId,
          requestDigest: handle.controlRef.requestDigest,
          status: 'done',
        },
      })
      expect(phases).toEqual(['intent', 'environment', 'dispatched'])
      expect(bridge.dispatched).toEqual([handle.controlRef.runId])
      expect(signals).toHaveLength(1)
      expect(signals[0]!.aborted).toBe(false)
    } finally {
      await bridge.close()
    }
  }, 30_000)

  it('still cancels a CLI Bridge create that outlasts the bound', async () => {
    const boundMs = 1_000
    const bridge = await startRetainedBridge({ turnMs: 0, holdCreateDiscovery: true })
    try {
      const { provider, signals } = recordCreateSignals(
        createCliBridgeProvider({ baseUrl: bridge.url, defaultModel: MODEL }),
      )
      const phases: string[] = []
      const creating = startRetainedRun({
        provider,
        environment: { profile, idempotencyKey: 'retained-create-outlasts-bound' },
        turn: { prompt: 'Never dispatched.', turnId: 'retained-create-outlasts-bound:turn' },
        materializationTimeoutMs: boundMs,
        onAdmission: async (admission) => {
          phases.push(admission.phase)
        },
      })
      await expect(creating).rejects.toBeInstanceOf(RetainedMaterializationTimeoutError)
      await expect(creating).rejects.toHaveProperty('creates', 3)

      expect(phases).toEqual(['intent'])
      expect(bridge.dispatched).toEqual([])
      expect(signals).toHaveLength(3)
      for (const signal of signals) {
        expect(signal.aborted).toBe(true)
        expect((signal.reason as Error).name).toBe('TimeoutError')
      }
    } finally {
      await bridge.close()
    }
  }, 30_000)
})
