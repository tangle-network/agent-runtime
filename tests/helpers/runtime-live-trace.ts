import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OtlpTraceExport } from '@tangle-network/agent-trace-contract/otlp'
import { FileSpawnJournal } from '../../src/durable/spawn-journal/journal-store'
import type { SpawnEvent } from '../../src/runtime/supervise/types'

function barrier() {
  let release!: () => void
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  return { wait, release }
}

export async function waitFor(label: string, promise: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`fixture never reached ${label}`)), 5000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function createLiveTraceFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'runtime-live-trace-'))
  const sentinel = 'private-prompt-tool-error-steer-sentinel-7391'
  const modelEntered = barrier()
  const modelReply = barrier()
  const admissionEntered = barrier()
  const admissionAck = barrier()
  const collectorReply = barrier()
  const workFinished = barrier()
  const rootReply = barrier()
  const bodies: OtlpTraceExport[] = []
  let modelCalls = 0
  let collectorAcknowledgements = 0
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      if (request.url === '/v1/traces') {
        bodies.push(JSON.parse(Buffer.concat(chunks).toString()))
        await collectorReply.wait
        collectorAcknowledgements++
        response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
      } else if (request.url === '/journal-ack') {
        admissionEntered.release()
        await admissionAck.wait
        response.end('acknowledged')
      } else if (request.url === '/tool') {
        response.writeHead(503).end(sentinel)
      } else if (request.url === '/v1/chat/completions') {
        const first = modelCalls++ === 0
        if (first) {
          modelEntered.release()
          await modelReply.wait
        }
        response.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            model: 'offline-test-model',
            choices: [
              {
                message: {
                  content: sentinel,
                  ...(first
                    ? {
                        tool_calls: [
                          {
                            id: 'remote-1',
                            type: 'function',
                            function: {
                              name: 'remote',
                              arguments: JSON.stringify({ value: sentinel }),
                            },
                          },
                        ],
                      }
                    : {}),
                },
              },
            ],
            usage: { prompt_tokens: 3, completion_tokens: 2, cost: 0.01 },
          }),
        )
      } else response.writeHead(404).end()
    } catch (error) {
      response.destroy(error as Error)
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('HTTP fixture did not bind')
  const endpoint = `http://127.0.0.1:${address.port}`
  class AcknowledgedJournal extends FileSpawnJournal {
    override async appendEvent(root: string, event: SpawnEvent): Promise<void> {
      await super.appendEvent(root, event)
      if (event.kind === 'execution-admitted' && event.admission.phase === 'dispatched') {
        const acknowledged = await fetch(`${endpoint}/journal-ack`, {
          method: 'POST',
          signal: AbortSignal.timeout(5000),
        })
        if (!acknowledged.ok) throw new Error('journal acknowledgement refused')
      }
    }
  }
  const journal = new AcknowledgedJournal(join(directory, 'spawn-journal.jsonl'))
  const release = () => {
    for (const gate of [
      modelEntered,
      modelReply,
      admissionEntered,
      admissionAck,
      collectorReply,
      workFinished,
      rootReply,
    ])
      gate.release()
  }
  return {
    directory,
    sentinel,
    modelEntered,
    modelReply,
    admissionEntered,
    admissionAck,
    collectorReply,
    workFinished,
    rootReply,
    bodies,
    endpoint,
    journal,
    release,
    get modelCalls() {
      return modelCalls
    },
    get collectorAcknowledgements() {
      return collectorAcknowledgements
    },
    async close() {
      release()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(directory, { recursive: true, force: true })
    },
  }
}
