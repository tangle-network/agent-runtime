import { type FileHandle, mkdtemp, open, readFile, rm, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { expect, it } from 'vitest'
import { type AgenticSurface, runAgentic } from '../../src/runtime'

const model = 'strategy-protocol-model'
const content = 'persisted by the worker tool\n'
const profile: AgentProfile = {
  name: 'filesystem-strategy-worker',
  harness: 'cli-base',
  model: {
    provider: 'tangle-router',
    default: model,
    metadata: { stream: true, maxTurns: 3 },
  },
  tools: { write_file: true, read_file: true },
  prompt: { systemPrompt: 'Write the requested bytes, read them back, then reply DONE.' },
}

interface CompletionRequest {
  model: string
  stream: boolean
  messages: Array<{ role: string; content?: unknown; tool_call_id?: string }>
  tools: Array<{ function: { name: string } }>
}

// A loopback protocol fixture supplies SSE; fetch, the worker, tools, scorer and Supervisor run normally.
it.each([false, true])(
  'runs a filesystem strategy over HTTP/SSE (one usage receipt omitted=%s)',
  async (omitUsage) => {
    const directory = await mkdtemp(join(tmpdir(), 'strategy-http-'))
    const path = join(directory, 'result.txt')
    let file: FileHandle | undefined
    const requests: CompletionRequest[] = []
    const protocolErrors: string[] = []
    const spawned: unknown[] = []
    const settled: unknown[] = []
    const server = createServer(async (request, response) => {
      try {
        if (request.method !== 'POST' || request.url !== '/v1/chat/completions')
          throw new Error(`unexpected request ${request.method} ${request.url}`)
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as CompletionRequest
        requests.push(body)
        const turn = requests.length - 1
        expect(body.model).toBe(model)
        expect(body.stream).toBe(true)
        expect(body.tools.map((tool) => tool.function.name).sort()).toEqual([
          'read_file',
          'write_file',
        ])
        if (turn === 1)
          expect(body.messages.at(-1)).toMatchObject({
            role: 'tool',
            tool_call_id: 'write-1',
            content: String(Buffer.byteLength(content)),
          })
        if (turn === 2)
          expect(body.messages.at(-1)).toMatchObject({
            role: 'tool',
            tool_call_id: 'read-1',
            content,
          })
        if (turn > 2) throw new Error('worker requested a turn after DONE')
        const delta =
          turn === 2
            ? { content: 'DONE' }
            : {
                tool_calls: [
                  {
                    index: 0,
                    id: turn === 0 ? 'write-1' : 'read-1',
                    type: 'function',
                    function: {
                      name: turn === 0 ? 'write_file' : 'read_file',
                      arguments: turn === 0 ? JSON.stringify({ content }) : '{}',
                    },
                  },
                ],
              }
        const frames: unknown[] = [
          { model, choices: [{ index: 0, delta }] },
          {
            model,
            choices: [{ index: 0, delta: {}, finish_reason: turn === 2 ? 'stop' : 'tool_calls' }],
          },
        ]
        if (!omitUsage || turn !== 1)
          frames.push({
            model,
            choices: [],
            usage: { prompt_tokens: 11, completion_tokens: 3, cost_usd: 0.25 },
          })
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end(
          `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')}data: [DONE]\n\n`,
        )
      } catch (error) {
        protocolErrors.push(error instanceof Error ? error.message : String(error))
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ error: protocolErrors.at(-1) }))
      }
    })
    const surface: AgenticSurface = {
      name: 'filesystem',
      async open() {
        file = await open(path, 'w+')
        return { id: path, surface: 'filesystem', ctx: file }
      },
      async tools() {
        return [
          {
            type: 'function',
            function: {
              name: 'write_file',
              parameters: {
                type: 'object',
                properties: { content: { type: 'string' } },
                required: ['content'],
              },
            },
          },
          { type: 'function', function: { name: 'read_file', parameters: { type: 'object' } } },
        ]
      },
      async call(handle, name, args) {
        if (name === 'write_file') {
          if (typeof args.content !== 'string') throw new Error('write_file needs content')
          await (handle.ctx as FileHandle).writeFile(args.content, 'utf8')
          return String((await stat(handle.id)).size)
        }
        if (name === 'read_file') return readFile(handle.id, 'utf8')
        throw new Error(`unknown tool ${name}`)
      },
      async score(_task, handle) {
        return {
          passes: (await readFile(handle.id, 'utf8')) === content ? 1 : 0,
          total: 1,
          errored: 0,
        }
      },
      async close(handle) {
        await (handle.ctx as FileHandle).close()
      },
    }
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('HTTP fixture did not bind')
      const result = await runAgentic({
        routerBaseUrl: `http://127.0.0.1:${address.port}/v1`,
        routerKey: 'local-protocol-fixture',
        workerProfile: profile,
        mode: 'breadth',
        budget: 1,
        surface,
        task: {
          id: 'filesystem-tool-turn',
          userPrompt: `Write and read these exact bytes: ${content}`,
        },
        hooks: {
          onEvent(event) {
            if (event.target === 'agent.spawn' && event.phase === 'after')
              spawned.push(event.payload)
            if (event.target === 'agent.child' && event.phase === 'after')
              settled.push(event.payload)
          },
        },
      })
      expect(protocolErrors).toEqual([])
      expect(requests).toHaveLength(3)
      expect(spawned).toContainEqual(
        expect.objectContaining({
          runtime: 'agentic-shot',
          agent: expect.objectContaining({ model }),
        }),
      )
      expect(settled).toContainEqual(
        expect.objectContaining({ status: 'done', score: 1, valid: true }),
      )
      expect(result).toMatchObject({
        mode: 'breadth',
        score: 1,
        resolved: true,
        shots: 1,
        completions: 3,
        progression: [1],
        tokens: { input: omitUsage ? 22 : 33, output: omitUsage ? 6 : 9 },
        tokensKnown: !omitUsage,
        usdKnown: !omitUsage,
      })
      if (!omitUsage) expect(result.usd).toBe(0.75)
      expect(await readFile(path, 'utf8')).toBe(content)
      expect(file).toBeDefined()
      await expect(file!.stat()).rejects.toMatchObject({ code: 'EBADF' })
    } finally {
      const closed = server.listening
        ? new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()))
          })
        : Promise.resolve()
      server.closeAllConnections()
      await Promise.all([
        closed,
        (async () => {
          try {
            await file?.close()
          } finally {
            await rm(directory, { recursive: true, force: true })
          }
        })(),
      ])
    }
    await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(server.listening).toBe(false)
  },
  30_000,
)
