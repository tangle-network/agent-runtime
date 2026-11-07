/**
 * The `agent-runtime-mcp` bin serving the `events_*` tools over a REAL durable
 * observer journal file: subscribe from sequence 0, page the recorded events,
 * acknowledge, and resume by key — all through the stdio wire the bin speaks.
 */
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { FileObserverJournal } from '../../src/durable/observer-journal'
import { createRootStreamSink } from '../../src/runtime/supervise/root-stream'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const stores: string[] = []

afterEach(async () => {
  await Promise.all(
    stores.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

interface RpcResponse {
  id: number | string | null
  result?: Record<string, unknown>
  error?: { message?: string }
}

/** Minimal stdio client: one line per JSON-RPC request, one line back. */
class BinClient {
  private sequence = 0
  private buffer = ''
  private readonly pending = new Map<number, { resolve: (value: RpcResponse) => void }>()
  private readonly lines: RpcResponse[] = []

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk
      let newline: number
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, newline).trim()
        this.buffer = this.buffer.slice(newline + 1)
        if (!line) continue
        const message = JSON.parse(line) as RpcResponse
        if (message.id !== null && message.id !== undefined) {
          const waiter = this.pending.get(Number(message.id))
          if (waiter) {
            this.pending.delete(Number(message.id))
            waiter.resolve(message)
          }
        }
        this.lines.push(message)
      }
    })
  }

  async call(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const id = ++this.sequence
    const response = new Promise<RpcResponse>((resolve) => this.pending.set(id, { resolve }))
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    const reply = await response
    if (reply.error) throw new Error(reply.error.message ?? 'rpc error')
    return reply.result ?? {}
  }

  exit() {
    this.child.stdin.end()
  }
}

async function spawnEventsBin(
  journalPath: string,
  env: Record<string, string> = {},
): Promise<BinClient> {
  const child = spawn(process.execPath, [join(repoRoot, 'dist', 'mcp', 'bin.js')], {
    env: {
      ...process.env,
      MCP_ENABLE_EVENTS: '1',
      AGENT_RUNTIME_EVENTS_JOURNAL: journalPath,
      ...env,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stderr.setEncoding('utf8')
  const errors: string[] = []
  child.stderr.on('data', (chunk: string) => errors.push(chunk))
  const client = new BinClient(child)
  const initErrors = errors.join('')
  if (/requires AGENT_RUNTIME_EVENTS_JOURNAL/.test(initErrors)) {
    client.exit()
    throw new Error('bin refused the events configuration')
  }
  return client
}

describe('agent-runtime-mcp bin serving events over a real observer journal', () => {
  it('serves subscribe/fetch/ack/resume over the stdio wire from a durable journal file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'runtime-events-bin-'))
    stores.push(directory)
    const journalPath = join(directory, 'observer.jsonl')

    // A journal with no committed records is valid: the bin serves an empty journal.
    const emptyClient = await spawnEventsBin(journalPath)
    try {
      await emptyClient.call('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '0' },
      })
      const listed = (await emptyClient.call('tools/list')) as { tools: Array<{ name: string }> }
      expect(listed.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          'events_subscribe',
          'events_fetch',
          'events_ack',
          'events_unsubscribe',
        ]),
      )
      const subscribed = (await emptyClient.call('tools/call', {
        name: 'events_subscribe',
        arguments: { key: 'bin-empty', fromSequence: 0 },
      })) as { structuredContent: { subscriptionId: string; cursor: number } }
      expect(subscribed.structuredContent.cursor).toBe(0)
    } finally {
      emptyClient.exit()
    }

    // Append real records with the durable journal, then reopen the bin over the same file.
    const writer = new FileObserverJournal(journalPath, 'pursuit-bin-test')
    await writer.appendEvent({
      id: 'event-1',
      pursuitId: 'pursuit-bin-test',
      runId: 'run-1',
      target: 'agent.run',
      phase: 'before',
      timestamp: Date.now(),
      stepIndex: 0,
    })
    await writer.appendDecision({
      id: 'decision-1',
      pursuitId: 'pursuit-bin-test',
      runId: 'run-1',
      stepIndex: 0,
      kind: 'plan_adjustment',
      candidateActions: ['continue', 'stop'],
      evidence: [],
    })

    const client = await spawnEventsBin(journalPath)
    try {
      await client.call('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '0' },
      })
      const subscribed = (await client.call('tools/call', {
        name: 'events_subscribe',
        arguments: { key: 'bin-inbox', fromSequence: 0 },
      })) as { structuredContent: { subscriptionId: string; cursor: number } }
      const subscriptionId = subscribed.structuredContent.subscriptionId
      const page = (await client.call('tools/call', {
        name: 'events_fetch',
        arguments: { subscriptionId },
      })) as {
        structuredContent: {
          records: Array<{ sequence: number; kind: string }>
          highWatermark: number
        }
      }
      expect(page.structuredContent.records.map((record) => record.sequence)).toEqual([1, 2])
      expect(page.structuredContent.records.map((record) => record.kind)).toEqual([
        'event',
        'decision',
      ])
      expect(page.structuredContent.highWatermark).toBe(2)
      // At-least-once: the same page again until acknowledged.
      const again = (await client.call('tools/call', {
        name: 'events_fetch',
        arguments: { subscriptionId },
      })) as {
        structuredContent: { records: Array<{ sequence: number }> }
      }
      expect(again.structuredContent.records).toHaveLength(2)
      const acked = (await client.call('tools/call', {
        name: 'events_ack',
        arguments: { subscriptionId, sequence: 2 },
      })) as { structuredContent: { cursor: number } }
      expect(acked.structuredContent.cursor).toBe(2)
      const drained = (await client.call('tools/call', {
        name: 'events_fetch',
        arguments: { subscriptionId },
      })) as {
        structuredContent: { records: unknown[] }
      }
      expect(drained.structuredContent.records).toEqual([])
      // A reconnect with the same key resumes the same subscription and cursor.
      const resumed = (await client.call('tools/call', {
        name: 'events_subscribe',
        arguments: { key: 'bin-inbox' },
      })) as { structuredContent: { subscriptionId: string; cursor: number } }
      expect(resumed.structuredContent.subscriptionId).toBe(subscriptionId)
      expect(resumed.structuredContent.cursor).toBe(2)
    } finally {
      client.exit()
    }
  })

  // #1565: a run's committed root stream over the same wire, read while a later process of the
  // run continues the file; the acked cursor holds and only the continuation is delivered.
  it('serves a run directory root stream across a process continuation', async () => {
    const runDir = await mkdtemp(join(tmpdir(), 'runtime-events-root-'))
    stores.push(runDir)
    const write = async (texts: string[]) => {
      const sink = createRootStreamSink(runDir, Date.now)
      await sink.beginAttempt()
      for (const text of texts) sink.append({ kind: 'text_delta', text } as never)
      await sink.close()
    }
    await write(['first', 'second'])
    const client = await spawnEventsBin(join(runDir, 'unused.jsonl'), {
      AGENT_RUNTIME_EVENTS_ROOT_STREAM: runDir,
    })
    type Page = {
      structuredContent: {
        records: Array<{ sequence: number; payload: { event: { text: string } } }>
      }
    }
    const call = (name: string, args: Record<string, unknown>) =>
      client.call('tools/call', { name, arguments: args })
    try {
      await client.call('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '0' },
      })
      const subscribed = (await call('events_subscribe', { key: 'lab', fromSequence: 0 })) as {
        structuredContent: { subscriptionId: string }
      }
      const { subscriptionId } = subscribed.structuredContent
      const first = (await call('events_fetch', { subscriptionId })) as Page
      expect(
        first.structuredContent.records.map((r) => [r.sequence, r.payload.event.text]),
      ).toEqual([
        [1, 'first'],
        [2, 'second'],
      ])
      await call('events_ack', { subscriptionId, sequence: 2 })
      await write(['third'])
      const next = (await call('events_fetch', { subscriptionId })) as Page
      expect(next.structuredContent.records.map((r) => [r.sequence, r.payload.event.text])).toEqual(
        [[3, 'third']],
      )
    } finally {
      client.exit()
    }
  })
})
