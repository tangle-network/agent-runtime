import type { RunRecord } from '@tangle-network/agent-eval'
import { describe, expect, it } from 'vitest'
import {
  type AgentAdapter,
  type AgentBackendInput,
  type AgentExecutionBackend,
  type AgentTaskSpec,
  applyRunRecordDefaults,
  type ControlEvalResult,
  createIterableBackend,
  createOpenAICompatibleBackend,
  createRuntimeEventCollector,
  createRuntimeStreamEventCollector,
  createSandboxPromptBackend,
  decideKnowledgeReadiness,
  InMemoryRuntimeSessionStore,
  type KnowledgeRequirement,
  type RuntimeStreamEvent,
  readinessServerSentEvent,
  runAgentTask,
  runAgentTaskStream,
  sanitizeAgentRuntimeEvent,
  sanitizeRuntimeStreamEvent,
} from '../src/index'

interface State {
  count: number
}

type Action = { type: 'increment' }

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
  evidenceIds: ['page:build'],
  fallbackPolicy: 'block',
}

function adapter(): AgentAdapter<State, Action, State, ControlEvalResult> {
  let current: State = { count: 0 }
  return {
    observe: () => current,
    validate: ({ state }) => [
      {
        id: 'count-ready',
        passed: state.count >= 1,
        score: state.count >= 1 ? 1 : 0,
        severity: 'info',
        objective: true,
      },
    ],
    decide: ({ state }) =>
      state.count >= 1
        ? { type: 'stop', pass: true, score: 1, reason: 'done' }
        : { type: 'continue', action: { type: 'increment' }, reason: 'need one step' },
    act: () => {
      current = { count: 1 }
      return current
    },
    shouldStop: ({ state }) => ({
      stop: state.count >= 1,
      pass: state.count >= 1,
      score: state.count >= 1 ? 1 : 0,
      reason: state.count >= 1 ? 'done' : 'continue',
    }),
  }
}

describe('runAgentTask', () => {
  it('runs a ready task through the shared control lifecycle', async () => {
    const task: AgentTaskSpec = {
      id: 'task-1',
      intent: 'increment once',
      domain: 'test',
      requiredKnowledge: [readyReq],
      budget: { maxSteps: 3 },
    }

    const result = await runAgentTask({ task, adapter: adapter() })

    expect(result.knowledge.readinessScore).toBe(1)
    expect(result.control.pass).toBe(true)
    expect(result.control.steps).toHaveLength(1)
    expect(result.control.finalState?.count).toBe(1)
  })

  it('blocks before action when required knowledge is missing', async () => {
    const task: AgentTaskSpec = {
      id: 'task-2',
      intent: 'deploy',
      domain: 'legal',
      requiredKnowledge: [
        {
          ...readyReq,
          id: 'customer-secret',
          description: 'Customer credential',
          category: 'credential_or_secret',
          acquisitionMode: 'ask_user',
          sensitivity: 'secret',
          currentConfidence: 0,
        },
      ],
      budget: { maxSteps: 3 },
    }
    let acted = false

    const events: string[] = []
    const result = await runAgentTask({
      task,
      onEvent: (event) => {
        events.push(event.type)
      },
      adapter: {
        ...adapter(),
        act: () => {
          acted = true
          return { count: 1 }
        },
      },
    })

    expect(acted).toBe(false)
    expect(result.status).toBe('blocked')
    expect(result.control.pass).toBe(false)
    expect(result.control.reason).toContain('knowledge readiness blocked')
    expect(result.questions[0]?.answerType).toBe('credential')
    expect(result.acquisitionPlans[0]?.mode).toBe('ask_user')
    expect(events).toContain('task_start')
    expect(events).toContain('readiness_end')
    expect(events).toContain('control_start')
    expect(events).toContain('task_end')
  })

  it('lets adapters convert knowledge blocks into domain actions', async () => {
    const task: AgentTaskSpec = {
      id: 'task-3',
      intent: 'ask for missing info',
      requiredKnowledge: [{ ...readyReq, currentConfidence: 0, acquisitionMode: 'ask_user' }],
      budget: { maxSteps: 1 },
    }

    const result = await runAgentTask({
      task,
      adapter: {
        ...adapter(),
        onKnowledgeBlocked: ({ questions }) => ({
          type: 'stop',
          pass: false,
          reason: `ask: ${questions[0]?.question}`,
        }),
      },
    })

    expect(result.control.reason).toContain('ask:')
    expect(result.control.reason).toContain('Build command')
  })

  it('runs knowledge question/acquisition hooks and refreshes readiness before control', async () => {
    const task: AgentTaskSpec = {
      id: 'task-4',
      intent: 'collect missing context then run',
      requiredKnowledge: [{ ...readyReq, currentConfidence: 0, acquisitionMode: 'ask_user' }],
      budget: { maxSteps: 3 },
    }
    const events: string[] = []

    const result = await runAgentTask({
      task,
      adapter: adapter(),
      onEvent: (event) => events.push(event.type),
      knowledge: {
        answerQuestions: () => ({ question_build: 'Use pnpm typecheck.' }),
        executeAcquisitionPlans: () => ['page:build'],
        refreshReadiness: ({ previous }) => ({
          ...previous,
          readinessScore: 1,
          blockingMissingRequirements: [],
          nonBlockingGaps: [],
          reason: 'Knowledge was collected during preflight.',
          severity: 'info',
          recommendedAction: 'run_agent',
          bundle: {
            ...previous.bundle,
            readinessScore: 1,
            missing: [],
            evidenceIds: ['page:build'],
            userAnswers: { question_build: 'Use pnpm typecheck.' },
          },
        }),
      },
    })

    expect(result.status).toBe('completed')
    expect(result.userAnswers.question_build).toContain('pnpm')
    expect(result.acquiredEvidenceIds).toEqual(['page:build'])
    expect(result.knowledge.readinessScore).toBe(1)
    expect(events).toEqual(
      expect.arrayContaining([
        'questions_start',
        'questions_end',
        'acquisition_start',
        'acquisition_end',
        'control_step',
      ]),
    )
    expect(events.filter((event) => event === 'questions_end')).toHaveLength(1)
  })

  it('summarizes runs without exposing task inputs or user answers', async () => {
    const task: AgentTaskSpec = {
      id: 'task-5',
      intent: 'collect secret then run',
      domain: 'test',
      inputs: { apiKey: 'sk-secret' },
      requiredKnowledge: [
        {
          ...readyReq,
          id: 'api-key',
          description: 'Customer API key',
          category: 'credential_or_secret',
          acquisitionMode: 'ask_user',
          sensitivity: 'secret',
          currentConfidence: 0,
        },
      ],
      budget: { maxSteps: 3 },
    }
    const collector = createRuntimeEventCollector()

    const result = await runAgentTask({
      task,
      adapter: adapter(),
      onEvent: collector.onEvent,
      knowledge: {
        answerQuestions: () => ({ question_api_key: 'sk-real-secret' }),
        refreshReadiness: ({ previous }) => ({
          ...previous,
          readinessScore: 1,
          blockingMissingRequirements: [],
          nonBlockingGaps: [],
          reason: 'Secret was supplied.',
          severity: 'info',
          recommendedAction: 'run_agent',
          bundle: {
            ...previous.bundle,
            readinessScore: 1,
            missing: [],
            userAnswers: { question_api_key: 'sk-real-secret' },
          },
        }),
      },
    })

    const serializedEvents = JSON.stringify(collector.events)

    expect(result.status).toBe('completed')
    expect(decideKnowledgeReadiness(result.knowledge).status).toBe('ready')
    expect(result.knowledge.blockingMissingRequirements).toEqual([])
    expect(result.questions).toHaveLength(1)
    expect(serializedEvents).not.toContain('sk-secret')
    expect(serializedEvents).not.toContain('sk-real-secret')
    expect(serializedEvents).not.toContain('Customer API key')
    expect(serializedEvents).toContain('[redacted]')
  })

  it('can opt into richer sanitized telemetry for private diagnostics', () => {
    const event = {
      type: 'questions_end' as const,
      task: {
        id: 'task-6',
        intent: 'diagnose',
        inputs: { customer: 'Acme' },
        requiredKnowledge: [readyReq],
      },
      questions: [
        {
          id: 'q1',
          question: 'Please provide: Build command',
          reason: 'Required for test.',
          requirementId: 'build-command',
          importance: 'blocking' as const,
          answerType: 'free_text' as const,
          impactIfUnknown: 'The agent should not run until this is known.',
        },
      ],
      userAnswers: { q1: 'pnpm test' },
    }

    const sanitized = sanitizeAgentRuntimeEvent(event, {
      includeInputs: true,
      includeRequirementDescriptions: true,
      includeUserAnswers: true,
      includeEvidenceIds: true,
    })
    const serialized = JSON.stringify(sanitized)

    expect(serialized).toContain('Acme')
    expect(serialized).toContain('Build command')
    expect(serialized).toContain('pnpm test')
    expect(serialized).toContain('page:build')
  })

  it('returns a stable readiness decision for ready, blocked, and caveat states', async () => {
    const readyTask: AgentTaskSpec = {
      id: 'task-7',
      intent: 'ready',
      requiredKnowledge: [readyReq],
    }
    const blockedTask: AgentTaskSpec = {
      id: 'task-8',
      intent: 'blocked',
      requiredKnowledge: [{ ...readyReq, currentConfidence: 0, fallbackPolicy: 'block' }],
    }
    const caveatTask: AgentTaskSpec = {
      id: 'task-9',
      intent: 'caveat',
      requiredKnowledge: [
        {
          ...readyReq,
          importance: 'medium',
          currentConfidence: 0.2,
          fallbackPolicy: 'continue_with_caveat',
        },
      ],
    }

    const ready = await runAgentTask({ task: readyTask, adapter: adapter() })
    const blocked = await runAgentTask({ task: blockedTask, adapter: adapter() })
    const caveat = await runAgentTask({
      task: caveatTask,
      adapter: adapter(),
      minimumReadinessScore: 0,
    })

    expect(decideKnowledgeReadiness(ready.knowledge).status).toBe('ready')
    expect(decideKnowledgeReadiness(blocked.knowledge).status).toBe('blocked')
    expect(decideKnowledgeReadiness(caveat.knowledge, { minimumScore: 0.9 }).status).toBe('caveat')
  })

  it('encodes sanitized readiness SSE payloads', async () => {
    const result = await runAgentTask({
      task: {
        id: 'task-10',
        intent: 'blocked',
        requiredKnowledge: [{ ...readyReq, currentConfidence: 0 }],
      },
      adapter: adapter(),
    })
    const event = readinessServerSentEvent(result.knowledge, {
      includeRequirementDescriptions: true,
    })
    const namedEvent = readinessServerSentEvent(result.knowledge, { event: 'readiness' })

    expect(event).not.toContain('event:')
    expect(event).toContain('"type":"readiness"')
    expect(event).toContain('"readinessScore":0')
    expect(event).toContain('Build command')
    expect(namedEvent).toContain('event: readiness')
  })

  it('blocks streaming backend execution when readiness is missing', async () => {
    let streamed = false
    const backend: AgentExecutionBackend = {
      kind: 'test-backend',
      async *stream() {
        streamed = true
        yield { type: 'text_delta', text: 'should not run' }
      },
    }
    const events: RuntimeStreamEvent[] = []
    for await (const event of runAgentTaskStream({
      task: {
        id: 'stream-blocked',
        intent: 'run',
        requiredKnowledge: [{ ...readyReq, currentConfidence: 0 }],
      },
      backend,
    })) {
      events.push(event)
    }

    expect(streamed).toBe(false)
    expect(events.map((event) => event.type)).toEqual([
      'task_start',
      'readiness_start',
      'readiness_end',
      'task_end',
      'final',
    ])
    expect(events.at(-1)).toMatchObject({ type: 'final', status: 'blocked' })
  })

  it('streams through a backend, persists events, and resumes sessions', async () => {
    const store = new InMemoryRuntimeSessionStore()
    const sessions: string[] = []
    const backend: AgentExecutionBackend<AgentBackendInput> = {
      kind: 'coding-harness',
      start: (_input, ctx) => ({
        id: ctx.requestedSessionId ?? 'session-1',
        backend: 'coding-harness',
        status: 'active',
        resumeToken: 'resume-1',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      }),
      resume: (session) => {
        sessions.push(session.id)
        return { ...session, status: 'active' }
      },
      async *stream(input) {
        yield { type: 'text_delta', text: input.message ?? '' }
        yield { type: 'tool_call', toolName: 'edit', args: { path: 'secret.ts' } }
        yield { type: 'tool_result', toolName: 'edit', result: { ok: true } }
      },
    }
    const task = { id: 'stream-ready', intent: 'continue coding', requiredKnowledge: [readyReq] }

    const first = await collect(
      runAgentTaskStream({
        task,
        backend,
        input: { message: 'hello' },
        sessionStore: store,
        sessionId: 'session-1',
      }),
    )
    const second = await collect(
      runAgentTaskStream({
        task,
        backend,
        input: { message: ' again' },
        sessionStore: store,
        sessionId: 'session-1',
        resume: true,
      }),
    )

    expect(first.find((event) => event.type === 'session_created')).toBeDefined()
    expect(second.find((event) => event.type === 'session_resumed')).toBeDefined()
    expect(sessions).toEqual(['session-1'])
    expect(store.get('session-1')?.status).toBe('completed')
    expect(store.listEvents('session-1').some((event) => event.type === 'tool_call')).toBe(true)

    const toolCall = first.find((event) => event.type === 'tool_call')!
    expect(JSON.stringify(sanitizeRuntimeStreamEvent(toolCall))).not.toContain('secret.ts')
    expect(
      JSON.stringify(sanitizeRuntimeStreamEvent(toolCall, { includeControlPayloads: true })),
    ).toContain('secret.ts')
  })

  it('maps sandbox prompt events into runtime stream events', async () => {
    const backend = createSandboxPromptBackend({
      getBox: () => ({ id: 'box-1' }),
      getSessionId: (box) => box.id,
      async *streamPrompt() {
        yield { type: 'message.part.updated', data: { text: 'hi' } }
        yield { type: 'tool_call', data: { name: 'Read', input: { path: '/tmp/a' } } }
        yield { type: 'tool_result', data: { name: 'Read', output: 'ok' } }
      },
    })
    const events = await collect(
      runAgentTaskStream({
        task: { id: 'sandbox-task', intent: 'inspect', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'go' },
      }),
    )

    expect(events.find((event) => event.type === 'session_created')).toMatchObject({
      type: 'session_created',
      session: { id: 'box-1', backend: 'sandbox' },
    })
    expect(
      events.filter((event) => event.type === 'text_delta').map((event) => event.text),
    ).toEqual(['hi'])
    expect(events.find((event) => event.type === 'tool_call')).toMatchObject({
      type: 'tool_call',
      toolName: 'Read',
    })
  })

  it('unwraps the @tangle-network/sandbox `data.part.text` shape natively (no mapEvent shim needed)', async () => {
    // The sandbox SDK emits `message.part.updated` with the text nested
    // under `data.part.text` (the canonical sandbox-SDK shape). Before
    // this fix, the default mapper looked at `data.text`/`data.delta`
    // only and silently dropped every part-text event — forcing every
    // sandbox-SDK consumer to ship a `mapEvent` shim (see blueprint-
    // agent#1758, tangle-network/agent-runtime#35). This test pins the
    // native unwrap so a regression here breaks the entire sandbox-SDK
    // → agent-runtime chat-engine path.
    const backend = createSandboxPromptBackend({
      getBox: () => ({ id: 'box-sandbox-sdk' }),
      getSessionId: (box) => box.id,
      async *streamPrompt() {
        yield { type: 'message.part.updated', data: { part: { type: 'text', text: 'hello' } } }
        yield { type: 'message.part.updated', data: { part: { type: 'text', text: ' world' } } }
        // A part of a non-text kind should NOT produce a text_delta —
        // those are handled by the `tool_call`/`tool_result` branches
        // when the consumer streams the matching event types.
        yield { type: 'message.part.updated', data: { part: { type: 'tool', name: 'bash' } } }
      },
    })
    const events = await collect(
      runAgentTaskStream({
        task: { id: 'sandbox-sdk-shape', intent: 'inspect', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'go' },
      }),
    )

    expect(
      events.filter((event) => event.type === 'text_delta').map((event) => event.text),
    ).toEqual(['hello', ' world'])
  })

  it('prefers explicit `data.text` when both `data.text` and `data.part.text` are present (back-compat)', async () => {
    // If a consumer happens to send both shapes (mixed bag), the flat
    // `data.text` wins — preserves the pre-existing behaviour for any
    // call site that was passing `{ data: { text } }` directly.
    const backend = createSandboxPromptBackend({
      getBox: () => ({ id: 'box-1' }),
      async *streamPrompt() {
        yield {
          type: 'message.part.updated',
          data: { text: 'flat-wins', part: { type: 'text', text: 'should-not-win' } },
        }
      },
    })
    const events = await collect(
      runAgentTaskStream({
        task: { id: 'precedence', intent: 'inspect', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'go' },
      }),
    )
    expect(
      events.filter((event) => event.type === 'text_delta').map((event) => event.text),
    ).toEqual(['flat-wins'])
  })

  it('parses OpenAI-compatible streamed chat completions', async () => {
    const backend = createOpenAICompatibleBackend({
      apiKey: 'sk-test',
      baseUrl: 'https://router.example/v1',
      model: 'model-a',
      fetchImpl: async () =>
        new Response(
          'data: {"choices":[{"delta":{"content":"hel"}}]}\n\n' +
            'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' +
            'data: [DONE]\n\n',
          { status: 200 },
        ),
    })
    const events = await collect(
      runAgentTaskStream({
        task: { id: 'chat-task', intent: 'say hello', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'hello' },
      }),
    )

    expect(
      events
        .filter((event) => event.type === 'text_delta')
        .map((event) => event.text)
        .join(''),
    ).toBe('hello')
    expect(events.at(-1)).toMatchObject({ type: 'final', status: 'completed', text: 'hello' })
  })

  it('ignores SSE comment frames from OpenAI-compatible streams', async () => {
    const backend = createOpenAICompatibleBackend({
      apiKey: 'sk-test',
      baseUrl: 'https://router.example/v1',
      model: 'model-a',
      fetchImpl: async () =>
        new Response(
          ': connected\n\n' +
            ': keepalive\n\n' +
            'data: {"choices":[{"delta":{"content":"clean"}}]}\n\n' +
            ': keepalive\n\n' +
            'data: [DONE]\n\n',
          { status: 200 },
        ),
    })
    const events = await collect(
      runAgentTaskStream({
        task: { id: 'chat-comments', intent: 'say clean', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'hello' },
      }),
    )

    expect(
      events
        .filter((event) => event.type === 'text_delta')
        .map((event) => event.text)
        .join(''),
    ).toBe('clean')
    expect(events.at(-1)).toMatchObject({ type: 'final', status: 'completed', text: 'clean' })
  })

  it('maps wire artifact and proposal events from a streamed backend', async () => {
    const backend = createOpenAICompatibleBackend({
      apiKey: 'sk-test',
      baseUrl: 'https://router.example/v1',
      model: 'model-a',
      fetchImpl: async () =>
        new Response(
          'data: {"type":"artifact","artifactId":"art-9","name":"brief.md","mimeType":"text/markdown","content":"# Brief body"}\n\n' +
            'data: {"type":"proposal_created","proposalId":"prop-9","title":"File amendment","status":"pending"}\n\n' +
            'data: [DONE]\n\n',
          { status: 200 },
        ),
    })
    const events = await collect(
      runAgentTaskStream({
        task: { id: 'wire-task', intent: 'produce a brief', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'go' },
      }),
    )
    const artifact = events.find((event) => event.type === 'artifact')
    expect(artifact).toMatchObject({
      type: 'artifact',
      artifactId: 'art-9',
      name: 'brief.md',
      mimeType: 'text/markdown',
      content: '# Brief body',
    })
    const proposal = events.find((event) => event.type === 'proposal_created')
    expect(proposal).toMatchObject({
      type: 'proposal_created',
      proposalId: 'prop-9',
      title: 'File amendment',
      status: 'pending',
    })
  })

  it('retries a thrown fetch error and succeeds on a later attempt', async () => {
    let calls = 0
    const backend = createOpenAICompatibleBackend({
      apiKey: 'sk-test',
      baseUrl: 'https://router.example/v1',
      model: 'model-a',
      retry: { initialBackoffMs: 1, maxBackoffMs: 2 },
      fetchImpl: async () => {
        calls += 1
        // First two attempts throw a network error (the `fetch failed`
        // shape); the third returns a real stream.
        if (calls < 3) throw new TypeError('fetch failed')
        return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
          status: 200,
        })
      },
    })
    const events = await collect(
      runAgentTaskStream({
        task: { id: 'retry-task', intent: 'go', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'hi' },
      }),
    )
    expect(calls).toBe(3)
    expect(events.at(-1)).toMatchObject({ type: 'final', status: 'completed', text: 'ok' })
  })

  it('aborts a hung attempt via the per-attempt timeout, then retries', async () => {
    let calls = 0
    const backend = createOpenAICompatibleBackend({
      apiKey: 'sk-test',
      baseUrl: 'https://router.example/v1',
      model: 'model-a',
      retry: { initialBackoffMs: 1, maxBackoffMs: 2, requestTimeoutMs: 30 },
      fetchImpl: (_url, init) => {
        calls += 1
        // First attempt hangs until its per-attempt signal aborts; the
        // second returns immediately.
        if (calls === 1) {
          return new Promise((_resolve, reject) => {
            const signal = (init as RequestInit | undefined)?.signal
            signal?.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')))
          })
        }
        return Promise.resolve(
          new Response(
            'data: {"choices":[{"delta":{"content":"recovered"}}]}\n\ndata: [DONE]\n\n',
            {
              status: 200,
            },
          ),
        )
      },
    })
    const events = await collect(
      runAgentTaskStream({
        task: { id: 'timeout-task', intent: 'go', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'hi' },
      }),
    )
    expect(calls).toBe(2)
    expect(events.at(-1)).toMatchObject({ type: 'final', status: 'completed', text: 'recovered' })
  })

  it('throws BackendTransportError when every attempt throws', async () => {
    const backend = createOpenAICompatibleBackend({
      apiKey: 'sk-test',
      baseUrl: 'https://router.example/v1',
      model: 'model-a',
      retry: { maxAttempts: 2, initialBackoffMs: 1, maxBackoffMs: 2 },
      fetchImpl: async () => {
        throw new TypeError('fetch failed')
      },
    })
    const events = await collect(
      runAgentTaskStream({
        task: { id: 'dead-task', intent: 'go', requiredKnowledge: [readyReq] },
        backend,
        input: { message: 'hi' },
      }),
    )
    const final = events.at(-1)
    expect(final).toMatchObject({ type: 'final' })
    expect(final?.type === 'final' && final.status).not.toBe('completed')
  })

  it('stops a backend and emits failed final event when streaming throws', async () => {
    const store = new InMemoryRuntimeSessionStore()
    const stopped: string[] = []
    const backend: AgentExecutionBackend = {
      kind: 'failing-harness',
      stop: (_session, reason) => {
        stopped.push(reason)
      },
      async *stream() {
        yield { type: 'text_delta', text: 'partial' }
        throw new Error('sandbox lost')
      },
    }
    const events = await collect(
      runAgentTaskStream({
        task: { id: 'failing-task', intent: 'run', requiredKnowledge: [readyReq] },
        backend,
        sessionStore: store,
        sessionId: 'failing-session',
      }),
    )

    expect(stopped).toEqual(['sandbox lost'])
    expect(store.get('failing-session')?.status).toBe('failed')
    expect(store.listEvents('failing-session').at(-1)).toMatchObject({
      type: 'final',
      status: 'failed',
    })
    expect(events.find((event) => event.type === 'backend_error')).toMatchObject({
      type: 'backend_error',
      backend: 'failing-harness',
      message: 'sandbox lost',
      recoverable: true,
    })
    expect(events.at(-1)).toMatchObject({ type: 'final', status: 'failed', text: 'partial' })
  })

  it('createRuntimeStreamEventCollector redacts payloads, evidence ids, user answers, and metadata by default', async () => {
    const collector = createRuntimeStreamEventCollector()
    const backend = createIterableBackend<AgentBackendInput>({
      kind: 'fake-stream',
      async *stream(_input, ctx) {
        yield {
          type: 'tool_call',
          task: ctx.task,
          session: ctx.session,
          toolName: 'shell',
          args: { cmd: 'rm -rf /etc/secret.txt' },
          timestamp: '2026-05-10T00:00:00.000Z',
        }
        yield {
          type: 'tool_result',
          task: ctx.task,
          session: ctx.session,
          toolName: 'shell',
          result: { stdout: 'sk-leaked' },
          timestamp: '2026-05-10T00:00:00.000Z',
        }
        yield {
          type: 'artifact',
          task: ctx.task,
          session: ctx.session,
          artifactId: 'a1',
          name: 'report.json',
          mimeType: 'application/json',
          uri: 's3://internal/secret-bucket/key',
          content: 'confidential-deliverable-body',
          metadata: { customerId: 'cust-99' },
          timestamp: '2026-05-10T00:00:00.000Z',
        }
        yield {
          type: 'proposal_created',
          task: ctx.task,
          session: ctx.session,
          proposalId: 'p1',
          title: 'confidential-proposal-title',
          status: 'pending',
          timestamp: '2026-05-10T00:00:00.000Z',
        }
        yield {
          type: 'text_delta',
          task: ctx.task,
          session: ctx.session,
          text: 'hi from agent',
          timestamp: '2026-05-10T00:00:00.000Z',
        }
      },
    })
    const task: AgentTaskSpec = {
      id: 'redact-stream',
      // Fixed operation kind — not user input. Real consumers MUST keep this static.
      intent: 'Run a sandbox shell turn',
      inputs: { command: 'cat /etc/secret.txt' },
      metadata: { customerId: 'cust-99', email: 'redact@example.com' },
      requiredKnowledge: [readyReq],
    }
    for await (const event of runAgentTaskStream({ task, backend, input: { message: 'go' } })) {
      collector.onEvent(event)
    }

    const serialized = JSON.stringify(collector.events)
    // The load-bearing assertion: nothing user-controlled escapes by default.
    expect(serialized).not.toContain('rm -rf')
    expect(serialized).not.toContain('sk-leaked')
    expect(serialized).not.toContain('cat /etc/secret.txt')
    expect(serialized).not.toContain('secret-bucket')
    expect(serialized).not.toContain('cust-99')
    expect(serialized).not.toContain('redact@example.com')
    // Produced artifact body and proposal title are payloads — redacted by default.
    expect(serialized).not.toContain('confidential-deliverable-body')
    expect(serialized).not.toContain('confidential-proposal-title')
    // The collector still records each event by `type` so consumers can act on the stream.
    expect(collector.summary().eventCountsByType.tool_call).toBe(1)
    expect(collector.summary().eventCountsByType.tool_result).toBe(1)
    expect(collector.summary().eventCountsByType.artifact).toBe(1)
    expect(collector.summary().eventCountsByType.proposal_created).toBe(1)
    expect(collector.summary().finalStatus).toBe('completed')
    expect(collector.summary().finalText).toBe('hi from agent')
  })

  it('createRuntimeStreamEventCollector exposes specific fields when opted in via RuntimeTelemetryOptions', async () => {
    const collector = createRuntimeStreamEventCollector({
      includeInputs: true,
      includeControlPayloads: true,
      includeEvidenceIds: true,
      includeMetadata: true,
    })
    const backend = createIterableBackend<AgentBackendInput>({
      kind: 'fake-stream',
      async *stream(_input, ctx) {
        yield {
          type: 'tool_call',
          task: ctx.task,
          session: ctx.session,
          toolName: 'shell',
          args: { cmd: 'pnpm test' },
          timestamp: '2026-05-10T00:00:00.000Z',
        }
        yield {
          type: 'artifact',
          task: ctx.task,
          session: ctx.session,
          artifactId: 'a1',
          name: 'r.json',
          uri: 's3://bucket/key',
          content: 'the produced deliverable body',
          metadata: { customerId: 'cust-1' },
          timestamp: '2026-05-10T00:00:00.000Z',
        }
        yield {
          type: 'proposal_created',
          task: ctx.task,
          session: ctx.session,
          proposalId: 'prop-1',
          title: 'Amend filing X for cust-1',
          status: 'pending',
          timestamp: '2026-05-10T00:00:00.000Z',
        }
      },
    })
    const task: AgentTaskSpec = {
      id: 'verbose-stream',
      intent: 'Run a sandbox shell turn',
      inputs: { command: 'pnpm test' },
      metadata: { customerId: 'cust-1' },
      requiredKnowledge: [readyReq],
    }
    for await (const event of runAgentTaskStream({ task, backend, input: { message: 'go' } })) {
      collector.onEvent(event)
    }
    const serialized = JSON.stringify(collector.events)
    expect(serialized).toContain('pnpm test')
    expect(serialized).toContain('s3://bucket/key')
    expect(serialized).toContain('cust-1')
    // includeControlPayloads exposes the produced artifact body and proposal title.
    expect(serialized).toContain('the produced deliverable body')
    expect(serialized).toContain('Amend filing X for cust-1')
    expect(collector.summary().eventCountsByType.artifact).toBe(1)
    expect(collector.summary().eventCountsByType.proposal_created).toBe(1)
    const proposal = collector.events.find((e) => e.type === 'proposal_created')
    expect(proposal).toMatchObject({ proposalId: 'prop-1', status: 'pending' })
  })

  it('createRuntimeStreamEventCollector summary tracks session ids and final reason', async () => {
    const collector = createRuntimeStreamEventCollector()
    const backend = createIterableBackend<AgentBackendInput>({
      kind: 'fake-stream',
      async *stream(_input, ctx) {
        yield {
          type: 'text_delta',
          task: ctx.task,
          session: ctx.session,
          text: 'partial',
          timestamp: '2026-05-10T00:00:00.000Z',
        }
      },
    })
    for await (const event of runAgentTaskStream({
      task: { id: 'summary-stream', intent: 'Run a sandbox turn', requiredKnowledge: [readyReq] },
      backend,
      sessionId: 'sess-xyz',
      input: { message: 'hi' },
    })) {
      collector.onEvent(event)
    }
    const summary = collector.summary()
    expect(summary.firstSessionId).toBe('sess-xyz')
    expect(summary.finalStatus).toBe('completed')
    expect(summary.finalReason).toBe('backend completed')
    expect(summary.finalText).toBe('partial')
    expect(summary.eventCount).toBeGreaterThan(0)
    // Sanity: summary's event totals reconcile with the collected events array.
    const totalFromTypes = Object.values(summary.eventCountsByType).reduce((a, b) => a + b, 0)
    expect(totalFromTypes).toBe(summary.eventCount)
  })

  it('preserves the stream failure when backend cleanup also fails', async () => {
    const backend: AgentExecutionBackend = {
      kind: 'cleanup-fails',
      stop: () => {
        throw new Error('cleanup refused')
      },
      // Regression test: a stream generator that throws before any yield
      // exercises the runtime's empty-event cleanup path (backend_error /
      // task_end / final must still flow).
      // biome-ignore lint/correctness/useYield: see comment above
      async *stream() {
        throw new Error('primary stream failure')
      },
    }
    const events = await collect(
      runAgentTaskStream({
        task: { id: 'cleanup-failure-task', intent: 'run', requiredKnowledge: [readyReq] },
        backend,
      }),
    )

    expect(events.find((event) => event.type === 'backend_error')).toMatchObject({
      type: 'backend_error',
      message: 'primary stream failure; backend stop failed: cleanup refused',
    })
    expect(events.at(-1)).toMatchObject({
      type: 'final',
      status: 'failed',
      reason: 'primary stream failure',
    })
  })
})

async function collect(iterable: AsyncIterable<RuntimeStreamEvent>): Promise<RuntimeStreamEvent[]> {
  const events: RuntimeStreamEvent[] = []
  for await (const event of iterable) events.push(event)
  return events
}

describe('applyRunRecordDefaults — canonical failureClass propagation', () => {
  function rec(overrides: Partial<RunRecord> = {}): RunRecord {
    return {
      runId: 'run-1',
      experimentId: 'exp-1',
      candidateId: 'cand-1',
      seed: 0,
      model: 'm@v',
      promptHash: 'sha256:p',
      configHash: 'sha256:c',
      commitSha: 'abc',
      wallMs: 10,
      costUsd: 0,
      tokenUsage: { input: 0, output: 0 },
      outcome: { holdoutScore: 0, raw: {} },
      splitTag: 'holdout',
      ...overrides,
    }
  }

  it('promotes a canonical control failureClass onto records that lack one', () => {
    const out = applyRunRecordDefaults([rec()], 'scn-1', 'tool_recovery_failure')
    expect(out[0]?.failureClass).toBe('tool_recovery_failure')
    expect(out[0]?.scenarioId).toBe('scn-1')
  })

  it('never overrides a failureClass the adapter set explicitly', () => {
    const out = applyRunRecordDefaults(
      [rec({ failureClass: 'hallucination', scenarioId: 'kept' })],
      'scn-1',
      'tool_recovery_failure',
    )
    expect(out[0]?.failureClass).toBe('hallucination')
    expect(out[0]?.scenarioId).toBe('kept')
  })

  it('does NOT promote a non-taxonomy control string (stays unclassified)', () => {
    // agent-builder's ad-hoc "forge_build_unsatisfied" is not a FailureClass —
    // it must not pollute the canonical cross-agent key.
    const out = applyRunRecordDefaults([rec()], 'scn-1', 'forge_build_unsatisfied')
    expect(out[0]?.failureClass).toBeUndefined()
  })

  it('is a no-op on failureClass when the control did not fail', () => {
    const out = applyRunRecordDefaults([rec()], 'scn-1', undefined)
    expect(out[0]?.failureClass).toBeUndefined()
    expect(out[0]?.scenarioId).toBe('scn-1')
  })
})
