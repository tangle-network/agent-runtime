import { describe, expect, it, vi } from 'vitest'

import { type ChatStreamEvent, handleChatTurn } from '../chat-engine'

async function drain(body: ReadableStream<Uint8Array>): Promise<ChatStreamEvent[]> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const events: ChatStreamEvent[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    for (;;) {
      const nl = buffer.indexOf('\n')
      if (nl === -1) break
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (line) events.push(JSON.parse(line) as ChatStreamEvent)
    }
  }
  if (buffer.trim()) events.push(JSON.parse(buffer.trim()) as ChatStreamEvent)
  return events
}

function textProducer(text: string, onConstruct?: () => void) {
  return () => {
    onConstruct?.()
    async function* stream(): AsyncGenerator<ChatStreamEvent, void, unknown> {
      yield { type: 'message.part.updated', data: { part: { type: 'text' }, delta: text } }
      yield { type: 'result', data: { finalText: text } }
    }
    return { stream: stream(), finalText: () => text }
  }
}

const IDENTITY = { tenantId: 'ws-1', sessionId: 'thread-1', userId: 'user-1', turnIndex: 0 }

describe('handleChatTurn', () => {
  // intentionally exercises the public function via the same name used by
  // consumers
  it('wraps the turn in the session.run.* lifecycle envelope', async () => {
    const persisted: string[] = []
    const { body, contentType } = handleChatTurn({
      identity: IDENTITY,
      hooks: {
        produce: textProducer('Hi there.'),
        persistAssistantMessage: async ({ finalText }) => {
          persisted.push(finalText)
        },
      },
    })
    expect(contentType).toBe('application/x-ndjson')
    const events = await drain(body)

    expect(events[0]?.type).toBe('session.run.started')
    expect(events.at(-1)?.type).toBe('session.run.completed')
    expect(events.some((e) => e.type === 'message.part.updated')).toBe(true)
    expect(events.some((e) => e.type === 'result')).toBe(true)
    expect(persisted).toEqual(['Hi there.'])
  })

  it('runs hooks in order: persist → onTurnComplete, after the stream', async () => {
    const order: string[] = []
    const { body } = handleChatTurn({
      identity: IDENTITY,
      hooks: {
        produce: textProducer('answer'),
        persistAssistantMessage: async () => {
          order.push('persist')
        },
        onTurnComplete: async () => {
          order.push('postProcess')
        },
      },
    })
    await drain(body)
    expect(order).toEqual(['persist', 'postProcess'])
  })

  it('a producer failure becomes error + session.run.failed, stream still closes', async () => {
    const { body } = handleChatTurn({
      identity: IDENTITY,
      log: () => undefined, // silence the default console.error in tests
      hooks: {
        produce: () => {
          async function* stream(): AsyncGenerator<ChatStreamEvent, void, unknown> {
            yield { type: 'message.part.updated', data: { delta: 'partial' } }
            throw new Error('backend exploded')
          }
          return { stream: stream(), finalText: () => '' }
        },
        persistAssistantMessage: async () => undefined,
      },
    })
    const events = await drain(body)
    expect(events[0]?.type).toBe('session.run.started')
    const err = events.find((e) => e.type === 'error')
    expect(err?.data?.message).toBe('backend exploded')
    expect(events.at(-1)?.type).toBe('session.run.failed')
  })

  it('preserves the status and safe message from a thrown Response', async () => {
    const { body } = handleChatTurn({
      identity: IDENTITY,
      log: () => undefined,
      hooks: {
        produce: () => {
          async function* stream(): AsyncGenerator<ChatStreamEvent, void, unknown> {
            yield { type: 'message.part.updated', data: { delta: 'partial' } }
            throw Response.json(
              { error: { code: 'delegation_failed', message: 'Platform rejected the child key' } },
              { status: 503 },
            )
          }
          return { stream: stream(), finalText: () => '' }
        },
        persistAssistantMessage: async () => undefined,
      },
    })

    const events = await drain(body)
    expect(events.find((e) => e.type === 'error')?.data?.message).toBe(
      'HTTP 503: Platform rejected the child key',
    )
    expect(events.at(-1)?.type).toBe('session.run.failed')
  })

  it.each([
    { name: 'an error', events: [{ type: 'error' }] },
    { name: 'a terminal failure', events: [{ type: 'session.run.failed' }] },
    {
      name: 'an error followed by completion',
      events: [{ type: 'error' }, { type: 'session.run.completed' }],
    },
    {
      name: 'an error followed by an empty terminal failure',
      events: [{ type: 'error' }, { type: 'session.run.failed' }],
    },
  ] satisfies { name: string; events: ChatStreamEvent[] }[])(
    'retains $name through persistence and settlement',
    async ({ events: sourceEvents }) => {
      const message = 'Sandbox create recovery is in progress'
      const order: string[] = []
      const { body } = handleChatTurn({
        identity: IDENTITY,
        hooks: {
          produce: () => ({
            stream: (async function* () {
              for (const [index, event] of sourceEvents.entries()) {
                yield index === 0 ? { ...event, data: { message } } : event
              }
            })(),
            finalText: () => 'The sandbox is still recovering.',
          }),
          persistAssistantMessage: async ({ finalText }) => {
            expect(finalText).toBe('The sandbox is still recovering.')
            order.push('persist')
          },
          onTurnComplete: async () => {
            order.push('settle')
          },
          onEvent: (event) => {
            if (event.type === 'session.run.failed') order.push('terminal')
          },
        },
      })
      const events = await drain(body)
      expect(events.filter((event) => event.type === 'session.run.completed')).toEqual([])
      expect(events.filter((event) => event.type === 'session.run.failed')).toEqual([
        { type: 'session.run.failed', data: { sessionId: IDENTITY.sessionId, message } },
      ])
      expect(events.filter((event) => event.type === 'error')).toHaveLength(1)
      expect(order).toEqual(['persist', 'settle', 'terminal'])
    },
  )

  it.each([false, true])(
    'settles upstream completion after persistence (persistence fails: %s)',
    async (failPersistence) => {
      const order: string[] = []
      const { body } = handleChatTurn({
        identity: IDENTITY,
        log: () => undefined,
        hooks: {
          produce: () => ({
            stream: (async function* () {
              yield { type: 'session.run.completed' }
            })(),
            finalText: () => 'answer',
          }),
          persistAssistantMessage: async () => {
            order.push('persist')
            if (failPersistence) throw new Error('db down')
          },
          onEvent: (event) => {
            if (event.type === 'session.run.completed' || event.type === 'session.run.failed')
              order.push(event.type)
          },
        },
      })
      const events = await drain(body)
      const terminalType = failPersistence ? 'session.run.failed' : 'session.run.completed'
      expect(
        events.filter(
          (event) => event.type === 'session.run.completed' || event.type === 'session.run.failed',
        ),
      ).toHaveLength(1)
      expect(order).toEqual(['persist', terminalType])
    },
  )

  it('allows a handled tool failure without failing the turn', async () => {
    const { body } = handleChatTurn({
      identity: IDENTITY,
      hooks: {
        produce: () => ({
          stream: (async function* () {
            yield { type: 'tool.error', data: { message: 'File not found' } }
            yield { type: 'message.part.updated', data: { delta: 'I found the renamed file.' } }
          })(),
          finalText: () => 'I found the renamed file.',
        }),
        persistAssistantMessage: async () => undefined,
      },
    })
    const events = await drain(body)
    expect(events.at(-1)?.type).toBe('session.run.completed')
    expect(events.some((event) => event.type === 'tool.error')).toBe(true)
  })

  it('onEvent side channel receives every emitted event', async () => {
    const broadcast: string[] = []
    const { body } = handleChatTurn({
      identity: IDENTITY,
      hooks: {
        produce: textProducer('x'),
        persistAssistantMessage: async () => undefined,
        onEvent: (event) => {
          broadcast.push(event.type)
        },
      },
    })
    const events = await drain(body)
    expect(broadcast).toEqual(events.map((e) => e.type))
  })

  it('transformFinalText alters what is persisted, not the live stream', async () => {
    let persisted = ''
    const { body } = handleChatTurn({
      identity: IDENTITY,
      hooks: {
        produce: textProducer('SSN 123-45-6789'),
        transformFinalText: (t) => t.replace(/\d{3}-\d{2}-\d{4}/, '[REDACTED]'),
        persistAssistantMessage: async ({ finalText }) => {
          persisted = finalText
        },
      },
    })
    const events = await drain(body)
    const result = events.find((e) => e.type === 'result')
    expect(result?.data?.finalText).toBe('SSN 123-45-6789')
    expect(persisted).toBe('SSN [REDACTED]')
  })

  it('a throwing persist hook fails the turn before completion', async () => {
    const { body } = handleChatTurn({
      identity: IDENTITY,
      log: () => undefined,
      hooks: {
        produce: textProducer('ok'),
        persistAssistantMessage: async () => {
          throw new Error('db down')
        },
      },
    })
    const events = await drain(body)
    expect(events.find((e) => e.type === 'session.run.completed')).toBeUndefined()
    const err = events.find((e) => e.type === 'error')
    expect(err?.data?.message).toBe('db down')
    expect(events.at(-1)?.type).toBe('session.run.failed')
  })

  it('traceFlush is handed to waitUntil so the worker isolate survives the POST', async () => {
    let flushAwaited = false
    let waitUntilCalled = false
    const { body } = handleChatTurn({
      identity: IDENTITY,
      waitUntil: (p) => {
        waitUntilCalled = true
        void p.then(() => {
          flushAwaited = true
        })
      },
      hooks: {
        produce: textProducer('ok'),
        persistAssistantMessage: async () => undefined,
        traceFlush: async () => {
          flushAwaited = true
        },
      },
    })
    await drain(body)
    expect(waitUntilCalled).toBe(true)
    expect(flushAwaited).toBe(true)
  })

  it('persist hook errors are logged as turn failures by default', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const { body } = handleChatTurn({
        identity: IDENTITY,
        hooks: {
          produce: textProducer('ok'),
          persistAssistantMessage: async () => {
            throw new Error('db down')
          },
        },
      })
      await drain(body)
      expect(spy).toHaveBeenCalled()
      const messages = spy.mock.calls.map((c) => c[0])
      expect(messages.some((m) => String(m).includes('turn failed'))).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })
})
