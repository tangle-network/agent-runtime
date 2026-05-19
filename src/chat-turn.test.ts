import type { AgentProfile, AgentSubagentProfile } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { ChatTurnError, composeTurnProfile, runChatTurn } from './chat-turn'

const baseProfile: AgentProfile = {
  name: 'test-agent',
  description: 'A test agent for chat-turn',
  version: '1.0.0',
  prompt: { systemPrompt: 'Base partner-quality system prompt.' },
  subagents: {
    a: {
      description: `subagent a — for tests${' '.padEnd(40, '.')}`,
      prompt: 'A prompt',
    } as AgentSubagentProfile,
  },
} as AgentProfile

describe('composeTurnProfile — per-turn AgentProfile via mergeAgentProfiles', () => {
  it('returns the base profile when no overlay provided', () => {
    const out = composeTurnProfile(baseProfile, {})
    expect(out.prompt?.systemPrompt).toBe(baseProfile.prompt?.systemPrompt)
  })

  it('merges promptOverlay onto base prompt', () => {
    const out = composeTurnProfile(baseProfile, {
      promptOverlay: { instructions: ['Per-turn dynamic advisor context here.'] },
    })
    // base systemPrompt preserved
    expect(out.prompt?.systemPrompt).toBe(baseProfile.prompt?.systemPrompt)
    // overlay merged in
    expect(out.prompt?.instructions).toEqual(['Per-turn dynamic advisor context here.'])
  })

  it('merges resources overlay (new mounts) onto base resources', () => {
    const out = composeTurnProfile(baseProfile, {
      resourcesOverlay: {
        files: [
          {
            path: '/tmp/per-turn-context.md',
            resource: { kind: 'inline', name: 'turn-ctx', content: 'volatile' },
          },
        ],
      },
    })
    expect(out.resources?.files?.length).toBeGreaterThan(0)
  })

  it('merges subagents overlay onto base subagents', () => {
    const out = composeTurnProfile(baseProfile, {
      subagentsOverlay: {
        b: {
          description: `b subagent ${' '.padEnd(40, '.')}`,
          prompt: 'B prompt',
        } as AgentSubagentProfile,
      },
    })
    expect(Object.keys(out.subagents ?? {})).toContain('a')
    expect(Object.keys(out.subagents ?? {})).toContain('b')
  })
})

describe('runChatTurn — POSTs full AgentProfile to sandbox runtime stream', () => {
  it('throws ChatTurnError on non-2xx response', async () => {
    const fakeFetch = async () =>
      new Response('upstream failure body', {
        status: 500,
        statusText: 'Internal',
      }) as unknown as Response
    const iter = runChatTurn({
      profile: baseProfile,
      message: 'hello',
      priorMessages: [],
      sandbox: { id: 'sb1', runtimeUrl: 'https://sandbox.example/v1/sandboxes/sb1' },
      fetch: fakeFetch as unknown as typeof fetch,
    })
    await expect(async () => {
      for await (const _ of iter) {
        // pump
      }
    }).rejects.toThrow(ChatTurnError)
  })

  it('sends the canonical wire shape: backend.profile = full AgentProfile', async () => {
    let captured: { url: string; body: string } | null = null
    const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), body: String(init?.body ?? '') }
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"type":"task_complete"}\n'))
          controller.close()
        },
      })
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }) as unknown as Response
    }
    const events: unknown[] = []
    for await (const ev of runChatTurn({
      profile: baseProfile,
      overlay: { promptOverlay: { instructions: ['turn 1 context'] } },
      message: 'hello world',
      priorMessages: [{ role: 'user', content: 'prior' }],
      sandbox: { id: 'sb1', runtimeUrl: 'https://sandbox.example/v1/sandboxes/sb1' },
      fetch: fakeFetch as unknown as typeof fetch,
    })) {
      events.push(ev)
    }
    expect(captured).not.toBeNull()
    expect(captured!.url).toBe('https://sandbox.example/v1/sandboxes/sb1/runtime/agents/run/stream')
    const body = JSON.parse(captured!.body) as {
      backend: { profile: { prompt?: { systemPrompt?: string; instructions?: string[] } } }
      messages: unknown[]
    }
    // FULL profile reaches the sandbox — not a stub
    expect(body.backend.profile.prompt?.systemPrompt).toBe(baseProfile.prompt?.systemPrompt)
    expect(body.backend.profile.prompt?.instructions).toEqual(['turn 1 context'])
    // Messages threaded through
    expect(body.messages).toHaveLength(2)
    expect((body.messages[0] as { role: string }).role).toBe('user')
    expect((body.messages[1] as { content: string }).content).toBe('hello world')
    // Events parsed
    expect(events).toHaveLength(1)
  })

  it('parses SSE data: prefixes and skips [DONE] sentinels', async () => {
    const fakeFetch = async () => {
      const body = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder()
          controller.enqueue(enc.encode('data: {"type":"task_start","task":"a"}\n'))
          controller.enqueue(enc.encode('data: {"type":"message","content":"hi"}\n'))
          controller.enqueue(enc.encode('data: [DONE]\n'))
          controller.close()
        },
      })
      return new Response(body, { status: 200 }) as unknown as Response
    }
    const events: { type: string }[] = []
    for await (const ev of runChatTurn({
      profile: baseProfile,
      message: 'x',
      priorMessages: [],
      sandbox: { id: 'sb1', runtimeUrl: 'https://sandbox.example/v1/sandboxes/sb1' },
      fetch: fakeFetch as unknown as typeof fetch,
    })) {
      events.push(ev as unknown as { type: string })
    }
    expect(events.map((e) => e.type)).toEqual(['task_start', 'message'])
  })

  it('attaches custom auth header when sandbox.authHeader is set', async () => {
    let capturedHeaders: Record<string, string> | undefined
    const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined
      capturedHeaders = headers ? { ...headers } : undefined
      const body = new ReadableStream({
        start(c) {
          c.close()
        },
      })
      return new Response(body, { status: 200 }) as unknown as Response
    }
    for await (const _ of runChatTurn({
      profile: baseProfile,
      message: 'x',
      priorMessages: [],
      sandbox: {
        id: 'sb1',
        runtimeUrl: 'https://sandbox.example/v1/sandboxes/sb1',
        authHeader: { name: 'X-Tangle-Token', value: 'secret-1' },
      },
      fetch: fakeFetch as unknown as typeof fetch,
    })) {
      // pump
    }
    expect(capturedHeaders?.['X-Tangle-Token']).toBe('secret-1')
  })
})
