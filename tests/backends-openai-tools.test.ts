import { describe, expect, it } from 'vitest'
import {
  createOpenAICompatibleBackend,
  type KnowledgeRequirement,
  type OpenAIChatTool,
  type RuntimeStreamEvent,
  runAgentTaskStream,
} from '../src/index'

const readyReq: KnowledgeRequirement = {
  id: 'build-command',
  description: 'Build command',
  requiredFor: ['test'],
  category: 'codebase_specific',
  acquisitionMode: 'inspect_repo',
  importance: 'blocking',
  freshness: 'weekly',
  sensitivity: 'public',
  confidenceNeeded: 0.8,
  currentConfidence: 0.9,
}

async function collect(iter: AsyncIterable<RuntimeStreamEvent>): Promise<RuntimeStreamEvent[]> {
  const out: RuntimeStreamEvent[] = []
  for await (const e of iter) out.push(e)
  return out
}

const delegateResearchTool: OpenAIChatTool = {
  type: 'function',
  function: {
    name: 'delegate_research',
    description: 'Spin up a long-running researcher loop and return a taskId for polling.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        namespace: { type: 'string' },
      },
      required: ['question'],
    },
  },
}

const delegateCodeTool: OpenAIChatTool = {
  type: 'function',
  function: {
    name: 'delegate_code',
    description: 'Spin up a coder iteration and return a taskId.',
    parameters: {
      type: 'object',
      properties: { goal: { type: 'string' }, repoRoot: { type: 'string' } },
      required: ['goal'],
    },
  },
}

describe('createOpenAICompatibleBackend — tools[] request shape', () => {
  it('omits tools/tool_choice from the body when no tools option is set', async () => {
    let captured: Record<string, unknown> | undefined
    const backend = createOpenAICompatibleBackend({
      apiKey: 'sk-test',
      baseUrl: 'https://router.tangle.tools/v1',
      model: 'gpt-4.1-mini',
      fetchImpl: async (_url, init) => {
        captured = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>
        return new Response('data: [DONE]\n\n', { status: 200 })
      },
    })
    await collect(
      runAgentTaskStream({
        task: { id: 'no-tools', intent: 'hi', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'hi' },
      }),
    )
    expect(captured).toBeDefined()
    expect(captured?.tools).toBeUndefined()
    expect(captured?.tool_choice).toBeUndefined()
  })

  it('includes the tools[] array verbatim when configured', async () => {
    let captured: Record<string, unknown> | undefined
    const backend = createOpenAICompatibleBackend({
      apiKey: 'sk-test',
      baseUrl: 'https://router.tangle.tools/v1',
      model: 'claude-sonnet-4-6',
      tools: [delegateResearchTool, delegateCodeTool],
      fetchImpl: async (_url, init) => {
        captured = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>
        return new Response('data: [DONE]\n\n', { status: 200 })
      },
    })
    await collect(
      runAgentTaskStream({
        task: { id: 'with-tools', intent: 'hi', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'hi' },
      }),
    )
    expect(captured?.tools).toEqual([delegateResearchTool, delegateCodeTool])
    // tool_choice defaults to omitted — provider falls back to its own default
    // (typically 'auto') so callers can keep the wire shape minimal.
    expect(captured?.tool_choice).toBeUndefined()
  })

  it('includes response_format verbatim when configured', async () => {
    let captured: Record<string, unknown> | undefined
    const backend = createOpenAICompatibleBackend({
      apiKey: 'sk-test',
      baseUrl: 'https://router.tangle.tools/v1',
      model: 'gpt-4.1-mini',
      responseFormat: { type: 'json_object' },
      fetchImpl: async (_url, init) => {
        captured = JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>
        return new Response('data: [DONE]\n\n', { status: 200 })
      },
    })
    await collect(
      runAgentTaskStream({
        task: { id: 'json-response', intent: 'return JSON', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'hi' },
      }),
    )
    expect(captured).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
      response_format: { type: 'json_object' },
    })
  })

  it('honors an explicit tool_choice value (auto / none / required / pin)', async () => {
    const captures: Record<string, unknown>[] = []
    const make = (toolChoice: Parameters<typeof createOpenAICompatibleBackend>[0]['toolChoice']) =>
      createOpenAICompatibleBackend({
        apiKey: 'sk-test',
        baseUrl: 'https://router.tangle.tools/v1',
        model: 'gpt-4.1-mini',
        tools: [delegateResearchTool],
        toolChoice,
        fetchImpl: async (_url, init) => {
          captures.push(JSON.parse((init?.body as string) ?? '{}') as Record<string, unknown>)
          return new Response('data: [DONE]\n\n', { status: 200 })
        },
      })

    for (const tc of [
      'auto' as const,
      'none' as const,
      'required' as const,
      { type: 'function' as const, function: { name: 'delegate_research' } },
    ]) {
      await collect(
        runAgentTaskStream({
          task: { id: `choice-${JSON.stringify(tc)}`, intent: 'hi', requiredKnowledge: [readyReq] },
          backend: make(tc),
          input: { message: 'hi' },
        }),
      )
    }
    expect(captures.map((c) => c.tool_choice)).toEqual([
      'auto',
      'none',
      'required',
      { type: 'function', function: { name: 'delegate_research' } },
    ])
  })
})

describe('createOpenAICompatibleBackend — OpenAI-shape tool_call streaming', () => {
  it('emits a single tool_call event after a finish_reason: tool_calls chunk', async () => {
    // OpenAI streams tool calls as fragmented deltas — the model emits the
    // call id once, the function name once, and the arguments JSON in
    // arbitrary-sized chunks. We must accumulate until finish_reason fires.
    const sse =
      'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":null,"tool_calls":[{"index":0,"id":"call_42","type":"function","function":{"name":"delegate_research","arguments":""}}]}}],"model":"gpt-4.1-mini"}\n\n' +
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"que"}}]}}]}\n\n' +
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"stion\\":\\""}}]}}]}\n\n' +
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"competitor scan\\"}"}}]}}]}\n\n' +
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"model":"gpt-4.1-mini"}\n\n' +
      'data: {"choices":[],"model":"gpt-4.1-mini","usage":{"prompt_tokens":50,"completion_tokens":12}}\n\n' +
      'data: [DONE]\n\n'
    const backend = createOpenAICompatibleBackend({
      apiKey: 'sk-test',
      baseUrl: 'https://router.tangle.tools/v1',
      model: 'gpt-4.1-mini',
      tools: [delegateResearchTool],
      fetchImpl: async () => new Response(sse, { status: 200 }),
    })
    const events = await collect(
      runAgentTaskStream({
        task: { id: 'tc-stream', intent: 'go', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'find competitor pricing' },
      }),
    )
    const toolCalls = events.filter((e) => e.type === 'tool_call')
    expect(toolCalls).toHaveLength(1)
    const call = toolCalls[0]
    if (call.type !== 'tool_call') throw new Error('expected tool_call')
    expect(call.toolName).toBe('delegate_research')
    expect(call.toolCallId).toBe('call_42')
    expect(call.args).toEqual({ question: 'competitor scan' })
    // Usage still flows.
    const usage = events.find((e) => e.type === 'llm_call')
    expect(usage).toBeDefined()
    if (!usage || usage.type !== 'llm_call') throw new Error('expected llm_call')
    expect(usage.tokensIn).toBe(50)
    expect(usage.tokensOut).toBe(12)
  })

  it('emits multiple tool_call events when the model fires parallel tool calls', async () => {
    // Parallel-tool-call SSE: deltas for index 0 and index 1 interleave; the
    // single finish_reason:tool_calls flushes both.
    const sse =
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_a","type":"function","function":{"name":"delegate_research","arguments":"{\\"question\\":\\"a\\"}"}}]}}]}\n\n' +
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"call_b","type":"function","function":{"name":"delegate_code","arguments":"{\\"goal\\":\\"b\\"}"}}]}}]}\n\n' +
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n' +
      'data: [DONE]\n\n'
    const backend = createOpenAICompatibleBackend({
      apiKey: 'sk-test',
      baseUrl: 'https://router.tangle.tools/v1',
      model: 'gpt-4.1-mini',
      tools: [delegateResearchTool, delegateCodeTool],
      fetchImpl: async () => new Response(sse, { status: 200 }),
    })
    const events = await collect(
      runAgentTaskStream({
        task: { id: 'tc-parallel', intent: 'go', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'do both' },
      }),
    )
    const toolCalls = events.filter((e) => e.type === 'tool_call')
    expect(toolCalls).toHaveLength(2)
    const names = toolCalls.map((e) => (e.type === 'tool_call' ? e.toolName : ''))
    expect(names.sort()).toEqual(['delegate_code', 'delegate_research'])
    const byName = Object.fromEntries(
      toolCalls.map((e) => (e.type === 'tool_call' ? [e.toolName, e] : ['', e])),
    )
    expect(byName.delegate_research?.type === 'tool_call' && byName.delegate_research.args).toEqual(
      { question: 'a' },
    )
    expect(byName.delegate_code?.type === 'tool_call' && byName.delegate_code.args).toEqual({
      goal: 'b',
    })
  })

  it('falls back to raw string args when the streamed JSON fragments are malformed', async () => {
    // Reality: provider proxies occasionally truncate the last arguments
    // chunk. We surface the raw concatenation instead of dropping the call so
    // the dispatcher can attempt repair.
    const sse =
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_x","type":"function","function":{"name":"delegate_research","arguments":"{\\"question\\":\\"unfini"}}]}}]}\n\n' +
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n' +
      'data: [DONE]\n\n'
    const backend = createOpenAICompatibleBackend({
      apiKey: 'sk-test',
      baseUrl: 'https://router.tangle.tools/v1',
      model: 'gpt-4.1-mini',
      tools: [delegateResearchTool],
      fetchImpl: async () => new Response(sse, { status: 200 }),
    })
    const events = await collect(
      runAgentTaskStream({
        task: { id: 'tc-trunc', intent: 'go', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'go' },
      }),
    )
    const calls = events.filter((e) => e.type === 'tool_call')
    expect(calls).toHaveLength(1)
    if (calls[0].type !== 'tool_call') throw new Error('expected tool_call')
    expect(typeof calls[0].args).toBe('string')
    expect(calls[0].args).toBe('{"question":"unfini')
  })

  it('flushes a tool_call that never received an explicit finish_reason', async () => {
    // Some routers drop the terminal choice chunk and go straight to [DONE].
    // The pending call must still surface — dropping it silently is the same
    // class of bug as the 402 swallow.
    const sse =
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_z","type":"function","function":{"name":"delegate_code","arguments":"{\\"goal\\":\\"ship\\"}"}}]}}]}\n\n' +
      'data: [DONE]\n\n'
    const backend = createOpenAICompatibleBackend({
      apiKey: 'sk-test',
      baseUrl: 'https://router.tangle.tools/v1',
      model: 'gpt-4.1-mini',
      tools: [delegateCodeTool],
      fetchImpl: async () => new Response(sse, { status: 200 }),
    })
    const events = await collect(
      runAgentTaskStream({
        task: { id: 'tc-flush', intent: 'go', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'go' },
      }),
    )
    const calls = events.filter((e) => e.type === 'tool_call')
    expect(calls).toHaveLength(1)
    if (calls[0].type !== 'tool_call') throw new Error('expected tool_call')
    expect(calls[0].toolName).toBe('delegate_code')
    expect(calls[0].args).toEqual({ goal: 'ship' })
  })

  it('emits tool_call events alongside text deltas in mixed-content streams', async () => {
    const sse =
      'data: {"choices":[{"index":0,"delta":{"content":"Sure, "}}]}\n\n' +
      'data: {"choices":[{"index":0,"delta":{"content":"delegating now."}}]}\n\n' +
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_m","type":"function","function":{"name":"delegate_research","arguments":"{\\"question\\":\\"q\\"}"}}]}}]}\n\n' +
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n' +
      'data: [DONE]\n\n'
    const backend = createOpenAICompatibleBackend({
      apiKey: 'sk-test',
      baseUrl: 'https://router.tangle.tools/v1',
      model: 'gpt-4.1-mini',
      tools: [delegateResearchTool],
      fetchImpl: async () => new Response(sse, { status: 200 }),
    })
    const events = await collect(
      runAgentTaskStream({
        task: { id: 'tc-mixed', intent: 'go', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'go' },
      }),
    )
    const text = events
      .filter((e) => e.type === 'text_delta')
      .map((e) => (e.type === 'text_delta' ? e.text : ''))
      .join('')
    expect(text).toBe('Sure, delegating now.')
    expect(events.filter((e) => e.type === 'tool_call')).toHaveLength(1)
  })

  it('handles non-streamed message.tool_calls (single-chunk completion)', async () => {
    // Some providers (and the router fallback path for non-stream upstreams)
    // collapse the whole assistant turn into one chunk with `message.tool_calls`.
    const sse =
      'data: {"choices":[{"index":0,"message":{"role":"assistant","content":null,"tool_calls":[{"id":"call_q","type":"function","function":{"name":"delegate_research","arguments":"{\\"question\\":\\"x\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n' +
      'data: [DONE]\n\n'
    const backend = createOpenAICompatibleBackend({
      apiKey: 'sk-test',
      baseUrl: 'https://router.tangle.tools/v1',
      model: 'gpt-4.1-mini',
      tools: [delegateResearchTool],
      fetchImpl: async () => new Response(sse, { status: 200 }),
    })
    const events = await collect(
      runAgentTaskStream({
        task: { id: 'tc-single', intent: 'go', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'go' },
      }),
    )
    const calls = events.filter((e) => e.type === 'tool_call')
    expect(calls).toHaveLength(1)
    if (calls[0].type !== 'tool_call') throw new Error('expected tool_call')
    expect(calls[0].toolName).toBe('delegate_research')
    expect(calls[0].toolCallId).toBe('call_q')
    expect(calls[0].args).toEqual({ question: 'x' })
  })

  /**
   * The Tangle router's Gemini lane is OpenAI-COMPATIBLE but not OpenAI-exact:
   * it emits every parallel tool call COMPLETE inside a single delta and puts
   * NO `index` on the entries (the one `"index":0` in the frame is the CHOICE
   * index). Keying those on `index ?? 0` collapsed all of them into one
   * accumulator and concatenated their `arguments` JSON, which then failed to
   * parse and surfaced as a raw string — a six-deliverable turn produced none,
   * silently. Frames below are the captured shape from
   * router.tangle.tools/v1 + gemini-2.5-flash-lite.
   */
  it('keeps parallel calls distinct when a compat gateway omits per-call index', async () => {
    const sse =
      'data: {"choices":[{"delta":{"role":"assistant","tool_calls":[' +
      '{"function":{"arguments":"{\\"question\\":\\"first\\"}","name":"delegate_research"},"id":"function-call-1","type":"function"},' +
      '{"function":{"arguments":"{\\"goal\\":\\"second\\"}","name":"delegate_code"},"id":"function-call-2","type":"function"},' +
      '{"function":{"arguments":"{\\"question\\":\\"third\\"}","name":"delegate_research"},"id":"function-call-3","type":"function"}' +
      ']},"finish_reason":"tool_calls","index":0}],"model":"gemini-2.5-flash-lite"}\n\n' +
      'data: [DONE]\n\n'
    const backend = createOpenAICompatibleBackend({
      apiKey: 'sk-test',
      baseUrl: 'https://router.tangle.tools/v1',
      model: 'gemini-2.5-flash-lite',
      tools: [delegateResearchTool, delegateCodeTool],
      fetchImpl: async () => new Response(sse, { status: 200 }),
    })
    const events = await collect(
      runAgentTaskStream({
        task: { id: 'tc-noindex', intent: 'go', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'do three things' },
      }),
    )
    const calls = events.filter((e) => e.type === 'tool_call')
    expect(calls).toHaveLength(3)
    expect(calls.map((c) => (c.type === 'tool_call' ? c.toolCallId : undefined))).toEqual([
      'function-call-1',
      'function-call-2',
      'function-call-3',
    ])
    expect(calls.map((c) => (c.type === 'tool_call' ? c.toolName : undefined))).toEqual([
      'delegate_research',
      'delegate_code',
      'delegate_research',
    ])
    // Every args payload is a parsed object, never the concatenated raw string.
    expect(calls.map((c) => (c.type === 'tool_call' ? c.args : undefined))).toEqual([
      { question: 'first' },
      { goal: 'second' },
      { question: 'third' },
    ])
  })

  /**
   * An index-less gateway may still fragment: the first frame carries the id +
   * name, later frames carry arguments only. Those continuations must append to
   * the call they belong to, not open a new one.
   */
  it('appends index-less argument-only fragments to the open call', async () => {
    const sse =
      'data: {"choices":[{"delta":{"tool_calls":[{"id":"fc-1","type":"function","function":{"name":"delegate_research","arguments":"{\\"question\\":"}}]}}]}\n\n' +
      'data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"\\"split arg\\"}"}}]}}]}\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n' +
      'data: [DONE]\n\n'
    const backend = createOpenAICompatibleBackend({
      apiKey: 'sk-test',
      baseUrl: 'https://router.tangle.tools/v1',
      model: 'gemini-2.5-flash-lite',
      tools: [delegateResearchTool],
      fetchImpl: async () => new Response(sse, { status: 200 }),
    })
    const events = await collect(
      runAgentTaskStream({
        task: { id: 'tc-noindex-frag', intent: 'go', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'go' },
      }),
    )
    const calls = events.filter((e) => e.type === 'tool_call')
    expect(calls).toHaveLength(1)
    if (calls[0].type !== 'tool_call') throw new Error('expected tool_call')
    expect(calls[0].toolCallId).toBe('fc-1')
    expect(calls[0].args).toEqual({ question: 'split arg' })
  })
})

describe('createOpenAICompatibleBackend — Anthropic-shape tool_use streaming', () => {
  it('assembles a tool_call event from content_block_start/delta/stop sequence', async () => {
    // Router proxies Anthropic models with their native SSE shape. tool_use
    // blocks come through as: content_block_start (with id+name),
    // content_block_delta (input_json_delta chunks of partial_json), then
    // content_block_stop.
    const sse =
      'data: {"type":"message_start","message":{"id":"msg_1","model":"claude-sonnet-4-6","usage":{"input_tokens":120}}}\n\n' +
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_a","name":"delegate_research","input":{}}}\n\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"question\\":\\""}}\n\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"q1\\"}"}}\n\n' +
      'data: {"type":"content_block_stop","index":0}\n\n' +
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":15}}\n\n' +
      'data: {"type":"message_stop"}\n\n'
    const backend = createOpenAICompatibleBackend({
      apiKey: 'sk-test',
      baseUrl: 'https://router.tangle.tools/v1',
      model: 'claude-sonnet-4-6',
      tools: [delegateResearchTool],
      fetchImpl: async () => new Response(sse, { status: 200 }),
    })
    const events = await collect(
      runAgentTaskStream({
        task: { id: 'anthropic-tc', intent: 'go', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'go' },
      }),
    )
    const calls = events.filter((e) => e.type === 'tool_call')
    expect(calls).toHaveLength(1)
    if (calls[0].type !== 'tool_call') throw new Error('expected tool_call')
    expect(calls[0].toolName).toBe('delegate_research')
    expect(calls[0].toolCallId).toBe('toolu_a')
    expect(calls[0].args).toEqual({ question: 'q1' })
    // Anthropic stop_reason 'tool_use' must propagate.
    const usage = events.find((e) => e.type === 'llm_call')
    expect(usage?.type === 'llm_call' && usage.finishReason).toBe('tool_use')
  })

  it('interleaves text deltas and tool_use blocks correctly', async () => {
    const sse =
      'data: {"type":"message_start","message":{"id":"msg_2","model":"claude-sonnet-4-6","usage":{"input_tokens":50}}}\n\n' +
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"I will "}}\n\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"delegate."}}\n\n' +
      'data: {"type":"content_block_stop","index":0}\n\n' +
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_b","name":"delegate_code","input":{}}}\n\n' +
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"goal\\":\\"ship\\"}"}}\n\n' +
      'data: {"type":"content_block_stop","index":1}\n\n' +
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":8}}\n\n' +
      'data: {"type":"message_stop"}\n\n'
    const backend = createOpenAICompatibleBackend({
      apiKey: 'sk-test',
      baseUrl: 'https://router.tangle.tools/v1',
      model: 'claude-sonnet-4-6',
      tools: [delegateCodeTool],
      fetchImpl: async () => new Response(sse, { status: 200 }),
    })
    const events = await collect(
      runAgentTaskStream({
        task: { id: 'anthropic-mixed', intent: 'go', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'go' },
      }),
    )
    const text = events
      .filter((e) => e.type === 'text_delta')
      .map((e) => (e.type === 'text_delta' ? e.text : ''))
      .join('')
    expect(text).toBe('I will delegate.')
    const calls = events.filter((e) => e.type === 'tool_call')
    expect(calls).toHaveLength(1)
    if (calls[0].type !== 'tool_call') throw new Error('expected tool_call')
    expect(calls[0].toolName).toBe('delegate_code')
    expect(calls[0].args).toEqual({ goal: 'ship' })
  })
})
