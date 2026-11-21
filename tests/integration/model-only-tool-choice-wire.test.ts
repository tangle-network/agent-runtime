import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { expect, it } from 'vitest'
import { profileChatClient, profileOptimizerModelCall } from '../../src/runtime/profile-chat-client'
import type { ToolSpec } from '../../src/runtime/router-request-body'

function bounded<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms)
  })
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer))
}

interface CapturedWire {
  url: string
  body: Record<string, unknown>
}

/**
 * One disposable loopback Router answering real HTTP: buffered JSON for plain completions and
 * SSE frames for `stream: true` requests. Every request body is captured for wire assertions.
 */
async function startLoopbackRouter(model: string): Promise<{
  baseUrl: string
  wires: CapturedWire[]
  close: () => Promise<void>
}> {
  const wires: CapturedWire[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
      wires.push({ url: request.url ?? '', body })
      if (body.stream === true) {
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        for (const frame of [
          { model, choices: [{ delta: { content: 'text only' }, finish_reason: 'stop' }] },
          { model, choices: [], usage: { prompt_tokens: 4, completion_tokens: 2 } },
        ]) {
          response.write(`data: ${JSON.stringify(frame)}\n\n`)
        }
        response.end('data: [DONE]\n\n')
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          model,
          choices: [{ message: { content: 'text only' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 4, completion_tokens: 2 },
        }),
      )
    })
  })
  await bounded(
    new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    }),
    1_000,
    'loopback router startup',
  )
  const { port } = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    wires,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

const MODEL = 'model-only-wire-model'

function modelOnlyProfile(stream: boolean): AgentProfile {
  return {
    name: 'model-only-observer',
    harness: 'cli-base',
    model: {
      provider: 'tangle-router',
      default: MODEL,
      // The one declaration under proof: a text-only completion with no tool set.
      metadata: { toolChoice: 'none', ...(stream ? { stream: true } : {}) },
    },
  }
}

function executor(baseUrl: string) {
  return {
    backend: 'router' as const,
    routerBaseUrl: baseUrl,
    routerKey: 'loopback-only',
  }
}

it('carries an explicit toolChoice none on the buffered and streamed wires from profileChatClient', async () => {
  const router = await startLoopbackRouter(MODEL)
  try {
    const buffered = profileChatClient({
      profile: modelOnlyProfile(false),
      context: 'buffered none',
      executor: executor(router.baseUrl),
    })
    const response = await bounded(
      buffered.chat({ messages: [{ role: 'user', content: 'describe the wire' }] }),
      5_000,
      'buffered profile chat',
    )
    expect(response.content).toBe('text only')
    expect(response.finishReason).toBe('stop')

    const streamed = profileChatClient({
      profile: modelOnlyProfile(true),
      context: 'streamed none',
      executor: executor(router.baseUrl),
    })
    const streamedResponse = await bounded(
      streamed.chat({ messages: [{ role: 'user', content: 'describe the wire' }] }),
      5_000,
      'streamed profile chat',
    )
    expect(streamedResponse.content).toBe('text only')

    expect(router.wires).toHaveLength(2)
    const [bufferedWire, streamedWire] = router.wires
    expect(bufferedWire?.url).toBe('/chat/completions')
    expect(bufferedWire?.body).toMatchObject({ model: MODEL, tool_choice: 'none' })
    expect(bufferedWire?.body).not.toHaveProperty('tools')
    expect(bufferedWire?.body).not.toHaveProperty('stream')
    expect(streamedWire?.body).toMatchObject({
      model: MODEL,
      tool_choice: 'none',
      stream: true,
    })
    expect(streamedWire?.body).not.toHaveProperty('tools')
  } finally {
    await router.close()
  }
})

it('carries an explicit toolChoice none on the buffered and streamed wires from profileOptimizerModelCall', async () => {
  const router = await startLoopbackRouter(MODEL)
  try {
    const bufferedCall = profileOptimizerModelCall({
      profile: modelOnlyProfile(false),
      context: 'optimizer buffered none',
      executor: executor(router.baseUrl),
    })
    const buffered = await bounded(
      bufferedCall({
        callId: 'optimizer-none-buffered',
        request: { messages: [{ role: 'user', content: 'score this' }] },
        endpointFormat: 'chat-completions',
        signal: new AbortController().signal,
      }),
      5_000,
      'buffered optimizer call',
    )
    if (!buffered.succeeded) throw new Error(buffered.error)
    expect(buffered.response.content).toBe('text only')
    expect(buffered.execution.executed).toBe(true)

    const streamedCall = profileOptimizerModelCall({
      profile: modelOnlyProfile(true),
      context: 'optimizer streamed none',
      executor: executor(router.baseUrl),
    })
    const streamed = await bounded(
      streamedCall({
        callId: 'optimizer-none-streamed',
        request: { messages: [{ role: 'user', content: 'score this' }] },
        endpointFormat: 'chat-completions',
        signal: new AbortController().signal,
      }),
      5_000,
      'streamed optimizer call',
    )
    if (!streamed.succeeded) throw new Error(streamed.error)
    expect(streamed.response.content).toBe('text only')

    expect(router.wires).toHaveLength(2)
    const [bufferedWire, streamedWire] = router.wires
    expect(bufferedWire?.body).toMatchObject({ model: MODEL, tool_choice: 'none' })
    expect(bufferedWire?.body).not.toHaveProperty('tools')
    expect(streamedWire?.body).toMatchObject({ model: MODEL, tool_choice: 'none', stream: true })
    expect(streamedWire?.body).not.toHaveProperty('tools')
  } finally {
    await router.close()
  }
})

it('keeps an ordinary completion wire free of tool_choice, buffered and streamed', async () => {
  const router = await startLoopbackRouter(MODEL)
  try {
    const ordinary: AgentProfile = {
      name: 'ordinary-agent',
      harness: 'cli-base',
      model: {
        provider: 'tangle-router',
        default: MODEL,
        metadata: { retry: { maxAttempts: 1, requestTimeoutMs: 0 } },
      },
    }
    const buffered = profileChatClient({
      profile: ordinary,
      context: 'ordinary buffered',
      executor: executor(router.baseUrl),
    })
    await bounded(
      buffered.chat({ messages: [{ role: 'user', content: 'hi' }] }),
      5_000,
      'ordinary buffered chat',
    )
    const streamed = profileChatClient({
      profile: {
        ...ordinary,
        model: {
          ...ordinary.model,
          metadata: { stream: true, retry: { maxAttempts: 1, requestTimeoutMs: 0 } },
        },
      },
      context: 'ordinary streamed',
      executor: executor(router.baseUrl),
    })
    await bounded(
      streamed.chat({ messages: [{ role: 'user', content: 'hi' }] }),
      5_000,
      'ordinary streamed chat',
    )

    expect(router.wires).toHaveLength(2)
    for (const wire of router.wires) {
      expect(wire.body).not.toHaveProperty('tool_choice')
      expect(wire.body).not.toHaveProperty('tools')
    }
  } finally {
    await router.close()
  }
})

it('keeps a raw metadata.extraBody tool_choice none on the buffered and streamed public wires', async () => {
  const router = await startLoopbackRouter(MODEL)
  try {
    // The pre-typed-policy escape hatch: an explicitly tool-free caller declaring the raw provider
    // field with no typed toolChoice must keep it on the wire in both modes.
    const rawExtraProfile = (stream: boolean): AgentProfile => ({
      name: 'raw-extra-tool-free',
      harness: 'cli-base',
      model: {
        provider: 'tangle-router',
        default: MODEL,
        metadata: { extraBody: { tool_choice: 'none' }, ...(stream ? { stream: true } : {}) },
      },
    })
    const buffered = profileChatClient({
      profile: rawExtraProfile(false),
      context: 'raw extra buffered',
      executor: executor(router.baseUrl),
    })
    await bounded(
      buffered.chat({ messages: [{ role: 'user', content: 'text only' }] }),
      5_000,
      'raw extra buffered chat',
    )
    const streamed = profileChatClient({
      profile: rawExtraProfile(true),
      context: 'raw extra streamed',
      executor: executor(router.baseUrl),
    })
    await bounded(
      streamed.chat({ messages: [{ role: 'user', content: 'text only' }] }),
      5_000,
      'raw extra streamed chat',
    )

    expect(router.wires).toHaveLength(2)
    for (const wire of router.wires) {
      expect(wire.body.tool_choice).toBe('none')
      expect(wire.body).not.toHaveProperty('tools')
    }
    expect(router.wires[1]?.body.stream).toBe(true)
  } finally {
    await router.close()
  }
})

it('keeps the typed none authoritative over a conflicting raw extraBody tool_choice on the public wire', async () => {
  const router = await startLoopbackRouter(MODEL)
  try {
    const client = profileChatClient({
      profile: {
        ...modelOnlyProfile(false),
        model: {
          ...modelOnlyProfile(false).model,
          metadata: {
            toolChoice: 'none',
            extraBody: { tool_choice: 'auto' },
          },
        },
      },
      context: 'typed none beats raw auto',
      executor: executor(router.baseUrl),
    })
    await bounded(
      client.chat({ messages: [{ role: 'user', content: 'text only' }] }),
      5_000,
      'typed-none-over-raw-auto chat',
    )

    expect(router.wires).toHaveLength(1)
    expect(router.wires[0]?.body.tool_choice).toBe('none')
  } finally {
    await router.close()
  }
})

it('keeps the native tool turn wire: tool_choice none over a declared tool array', async () => {
  const router = await startLoopbackRouter(MODEL)
  try {
    const inspect: ToolSpec = {
      type: 'function',
      function: {
        name: 'inspect',
        description: 'inspect the trace',
        parameters: { type: 'object', properties: {} },
      },
    }
    const client = profileChatClient({
      profile: {
        ...modelOnlyProfile(false),
        tools: { inspect: true },
      },
      context: 'native tool turn',
      executor: { ...executor(router.baseUrl), tools: [inspect] },
    })
    const response = await bounded(
      client.chat({
        messages: [{ role: 'user', content: 'inspect the trace' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'inspect',
              description: 'inspect the trace',
              parameters: { type: 'object', properties: {} },
            },
          },
        ],
        toolChoice: 'none',
      }),
      5_000,
      'native tool turn chat',
    )
    expect(response.content).toBe('text only')

    expect(router.wires).toHaveLength(1)
    const wire = router.wires[0]
    expect(wire?.body.tool_choice).toBe('none')
    expect(wire?.body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'inspect',
          description: 'inspect the trace',
          parameters: { type: 'object', properties: {} },
        },
      },
    ])
  } finally {
    await router.close()
  }
})
