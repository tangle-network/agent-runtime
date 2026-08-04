import { afterEach, describe, expect, it, vi } from 'vitest'
import { runBenchmark } from './run-benchmark'
import {
  type AgenticOptions,
  type AgenticSurface,
  type AgenticTask,
  defineStrategy,
} from './strategy'

interface ChatRequest {
  model?: string
  messages?: Array<{ role?: string; content?: string }>
  temperature?: number
  max_tokens?: number
  reasoning_effort?: string
}

const task: AgenticTask = {
  id: 'task-1',
  userPrompt: 'Complete the task.',
}

const worker: AgenticOptions = {
  routerBaseUrl: 'http://router.test/v1',
  routerKey: 'test-key',
  workerProfile: {
    name: 'worker',
    harness: 'cli-base',
    model: {
      provider: 'tangle-router',
      default: 'worker-model',
      reasoningEffort: 'none',
      metadata: { maxTokens: 8, temperature: 0.2 },
    },
    prompt: { systemPrompt: 'Use the test surface.' },
    tools: {},
  },
}

const oneShot = defineStrategy('one-shot', async ({ shot }) => {
  const out = await shot()
  return {
    score: out?.score ?? 0,
    resolved: out?.score === 1,
    completions: out?.completions ?? 0,
    progression: out ? [out.score] : [],
    shots: 1,
  }
})

function surface(events: string[]): AgenticSurface {
  let sequence = 0
  return {
    name: 'test',
    async open() {
      events.push('open')
      sequence += 1
      return { id: `handle-${sequence}`, surface: 'test' }
    },
    async tools() {
      return []
    },
    async call() {
      return 'ok'
    },
    async score() {
      return { passes: 1, total: 1, errored: 0 }
    },
    async close() {},
  }
}

function okResponse(model = 'worker-model'): Response {
  return Response.json({
    model,
    choices: [{ message: { content: 'DONE' } }],
    usage: { prompt_tokens: 2, completion_tokens: 1 },
  })
}

function stubRouter(
  requests: ChatRequest[],
  events: string[],
  respond: (request: ChatRequest, index: number) => Response = (request) =>
    okResponse(request.model),
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body ?? '{}')) as ChatRequest
      requests.push(request)
      events.push(`request:${request.model}:${request.max_tokens ?? 'default'}`)
      return respond(request, requests.length - 1)
    }),
  )
}

function isModelCheck(request: ChatRequest): boolean {
  return request.messages?.some((message) => message.content === 'Reply OK.') ?? false
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runBenchmark model availability', () => {
  it('checks every unique model once before opening any task', async () => {
    const requests: ChatRequest[] = []
    const events: string[] = []
    stubRouter(requests, events)

    await runBenchmark({
      environment: surface(events),
      tasks: [task, { ...task, id: 'task-2' }],
      worker: {
        ...worker,
        analystProfile: {
          name: 'analyst',
          harness: 'cli-base',
          model: {
            provider: 'tangle-router',
            default: 'analyst-model',
            reasoningEffort: 'none',
            metadata: { maxTokens: 8, temperature: 0.2 },
          },
        },
      },
      strategies: [oneShot],
      budget: 1,
      concurrency: 2,
    })

    const checks = requests.filter(isModelCheck)
    expect(checks.map((request) => request.model).sort()).toEqual(['analyst-model', 'worker-model'])
    expect(checks.every((request) => request.max_tokens === 8)).toBe(true)
    expect(checks.every((request) => request.reasoning_effort === 'none')).toBe(true)
    expect(events.indexOf('open')).toBe(2)
  })

  it('deduplicates identical worker and analyst models', async () => {
    const checked: string[] = []
    const events: string[] = []

    await runBenchmark({
      environment: surface(events),
      tasks: [task],
      worker: {
        ...worker,
        analystProfile: worker.workerProfile,
        complete: async () => okResponse().json(),
      },
      strategies: [oneShot],
      budget: 1,
      modelPreflight: async (model) => {
        checked.push(model)
      },
    })

    expect(checked).toEqual(['worker-model'])
  })

  it('rejects an unavailable model before task dispatch', async () => {
    const requests: ChatRequest[] = []
    const events: string[] = []
    const onTask = vi.fn()
    stubRouter(requests, events, () => new Response('model has been deprecated', { status: 404 }))

    await expect(
      runBenchmark({
        environment: surface(events),
        tasks: [task],
        worker,
        strategies: [oneShot],
        budget: 1,
        onTask,
      }),
    ).rejects.toThrow(
      'Benchmark model "worker-model" preflight failed: runBenchmark model preflight (worker-model) failed: routerInlineExecutor: transport failed: router 404: model has been deprecated',
    )

    expect(requests).toHaveLength(1)
    expect(events).not.toContain('open')
    expect(onTask).not.toHaveBeenCalled()
  })

  it('reports every unavailable model in one failure', async () => {
    const events: string[] = []

    await expect(
      runBenchmark({
        environment: surface(events),
        tasks: [task],
        worker: {
          ...worker,
          analystProfile: {
            name: 'analyst',
            harness: 'cli-base',
            model: {
              provider: 'tangle-router',
              default: 'analyst-model',
              reasoningEffort: 'none',
            },
          },
        },
        strategies: [oneShot],
        budget: 1,
        modelPreflight: async (model) => {
          throw new Error(`${model} is unavailable`)
        },
      }),
    ).rejects.toThrow(
      'Benchmark model "worker-model" preflight failed: worker-model is unavailable; ' +
        'Benchmark model "analyst-model" preflight failed: analyst-model is unavailable',
    )

    expect(events).not.toContain('open')
  })

  it('bounds a model check that never settles', async () => {
    const events: string[] = []

    await expect(
      runBenchmark({
        environment: surface(events),
        tasks: [task],
        worker,
        strategies: [oneShot],
        budget: 1,
        modelPreflightTimeoutMs: 5,
        modelPreflight: async (_model, _worker, signal) =>
          new Promise<void>((_, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          }),
      }),
    ).rejects.toThrow('Benchmark model "worker-model" preflight failed: timed out after 5 ms')

    expect(events).not.toContain('open')
  })

  it('skips the check for an injected completion transport', async () => {
    const requests: ChatRequest[] = []
    const events: string[] = []
    const complete = vi.fn(async (body: Record<string, unknown>) => {
      requests.push(body as ChatRequest)
      events.push('complete')
      return okResponse().json()
    })

    await runBenchmark({
      environment: surface(events),
      tasks: [task],
      worker: { ...worker, complete },
      strategies: [oneShot],
      budget: 1,
    })

    expect(complete).toHaveBeenCalledTimes(1)
    expect(requests.some(isModelCheck)).toBe(false)
    expect(events[0]).toBe('open')
  })

  it('allows the live check to be disabled explicitly', async () => {
    const requests: ChatRequest[] = []
    const events: string[] = []
    stubRouter(requests, events)

    await runBenchmark({
      environment: surface(events),
      tasks: [task],
      worker,
      strategies: [oneShot],
      budget: 1,
      modelPreflight: false,
    })

    expect(requests.some(isModelCheck)).toBe(false)
    expect(events[0]).toBe('open')
  })

  it('runs a custom check for injected transports', async () => {
    const events: string[] = []
    const checked: string[] = []

    await runBenchmark({
      environment: surface(events),
      tasks: [task],
      worker: {
        ...worker,
        analystProfile: {
          name: 'analyst',
          harness: 'cli-base',
          model: {
            provider: 'tangle-router',
            default: 'analyst-model',
            reasoningEffort: 'none',
          },
        },
        complete: async () => okResponse().json(),
      },
      strategies: [oneShot],
      budget: 1,
      modelPreflight: async (model) => {
        events.push(`check:${model}`)
        checked.push(model)
      },
    })

    expect(checked.sort()).toEqual(['analyst-model', 'worker-model'])
    expect(events.indexOf('open')).toBe(2)
  })

  it('does not change the profile temperature when the provider rejects it', async () => {
    const requests: ChatRequest[] = []
    const events: string[] = []
    stubRouter(requests, events, (_request, index) =>
      index === 0
        ? new Response('only temperature 1 is allowed for this model', { status: 400 })
        : okResponse(),
    )

    await expect(
      runBenchmark({
        environment: surface(events),
        tasks: [task],
        worker,
        strategies: [oneShot],
        budget: 1,
      }),
    ).rejects.toThrow('router 400: only temperature 1 is allowed for this model')

    expect(requests.map((request) => request.temperature)).toEqual([0.2])
    expect(events).not.toContain('open')
  })
})
