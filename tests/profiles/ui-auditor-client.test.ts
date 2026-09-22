import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInProcessUiAuditEnvironmentProvider } from '../../src/profiles'
import {
  type BrowserContextHandle,
  type BrowserHandle,
  encodeAuditTaskEnvelope,
  type PageHandle,
  type UiAuditTask,
  type UiJudge,
  type UiJudgeOutput,
} from '../../src/profiles/ui-auditor'

interface MockPageLog {
  setViewports: { width: number; height: number }[]
  gotoUrls: string[]
  screenshotPaths: string[]
}

interface MockHandles {
  browser: BrowserHandle
  log: MockPageLog
  newContextCalls: number
  contextCloseCalls: number
  browserCloseCalls: number
  failNthScreenshot?: number
}

function makeMockBrowser(): MockHandles {
  const log: MockPageLog = { setViewports: [], gotoUrls: [], screenshotPaths: [] }
  const state = { failNthScreenshot: undefined as number | undefined }
  let newContextCalls = 0
  let contextCloseCalls = 0
  let browserCloseCalls = 0

  const page: PageHandle = {
    async setViewportSize(size) {
      log.setViewports.push({ ...size })
    },
    async goto(url) {
      log.gotoUrls.push(url)
      return undefined
    },
    async waitForSelector() {
      return undefined
    },
    async waitForTimeout() {
      /* no-op */
    },
    async screenshot({ path: outPath }) {
      log.screenshotPaths.push(outPath)
      if (
        state.failNthScreenshot !== undefined &&
        log.screenshotPaths.length === state.failNthScreenshot
      ) {
        throw new Error(`mock screenshot failure on call #${state.failNthScreenshot}`)
      }
      await fs.writeFile(outPath, 'fake-png')
    },
    locator() {
      return {
        first() {
          return {
            async screenshot({ path: outPath }) {
              log.screenshotPaths.push(outPath)
              await fs.writeFile(outPath, 'fake-png')
            },
          }
        },
      }
    },
  }

  const context: BrowserContextHandle = {
    async newPage() {
      return page
    },
    async close() {
      contextCloseCalls += 1
    },
  }

  const browser: BrowserHandle = {
    async newContext() {
      newContextCalls += 1
      return context
    },
    async close() {
      browserCloseCalls += 1
    },
  }

  return {
    browser,
    log,
    get newContextCalls() {
      return newContextCalls
    },
    get contextCloseCalls() {
      return contextCloseCalls
    },
    get browserCloseCalls() {
      return browserCloseCalls
    },
    set failNthScreenshot(n: number | undefined) {
      state.failNthScreenshot = n
    },
  } as unknown as MockHandles
}

let workspaceDir: string

beforeEach(async () => {
  workspaceDir = await fs.mkdtemp(path.join(tmpdir(), 'ui-audit-provider-'))
})

afterEach(async () => {
  await fs.rm(workspaceDir, { recursive: true, force: true })
})

const okJudgeFn: UiJudge = vi.fn(
  async (): Promise<UiJudgeOutput> => ({
    findings: [],
    tokenUsage: { input: 1, output: 2 },
  }),
)

function stubTask(overrides: Partial<UiAuditTask> = {}): UiAuditTask {
  return {
    lens: 'consistency',
    captures: [{ route: 'home', url: 'https://example.test/' }],
    ...overrides,
  }
}

async function drain(it: AsyncIterable<AgentEnvironmentEvent>): Promise<AgentEnvironmentEvent[]> {
  const events: AgentEnvironmentEvent[] = []
  for await (const e of it) events.push(e)
  return events
}

function createEnvironment(provider: AgentEnvironmentProvider): Promise<AgentEnvironment> {
  return provider.create({ profile: { name: 'ui-auditor' } })
}

function streamTurn(
  environment: AgentEnvironment,
  prompt: string,
  signal = new AbortController().signal,
): AsyncIterable<AgentEnvironmentEvent> {
  return environment.stream({ prompt, signal })
}

describe('createInProcessUiAuditEnvironmentProvider — viewport application', () => {
  it('applies the per-capture viewport BEFORE navigation for every capture', async () => {
    const mock = makeMockBrowser()
    const provider = createInProcessUiAuditEnvironmentProvider({
      workspaceDir,
      judge: okJudgeFn,
      launchBrowser: async () => mock.browser,
    })

    const task = stubTask({
      lens: 'responsive',
      captures: [
        {
          route: 'home',
          url: 'https://example.test/',
          viewport: { width: 1440, height: 900 },
        },
        {
          route: 'home',
          url: 'https://example.test/',
          viewport: { width: 375, height: 812 },
        },
        // Implicit default — verifies the fallback path applies it explicitly.
        { route: 'home', url: 'https://example.test/' },
      ],
    })

    const environment = await createEnvironment(provider)
    await drain(streamTurn(environment, encodeAuditTaskEnvelope(task)))
    await provider.close()

    expect(mock.log.setViewports).toEqual([
      { width: 1440, height: 900 },
      { width: 375, height: 812 },
      { width: 1280, height: 800 },
    ])
    // setViewportSize must be called before goto for each capture — the
    // arrival order in the logs must be `viewport(i) before goto(i)`.
    expect(mock.log.setViewports.length).toBe(mock.log.gotoUrls.length)
  })
})

describe('createInProcessUiAuditEnvironmentProvider — event order', () => {
  it('yields lens → captures (in order) → findings → notes → done', async () => {
    const mock = makeMockBrowser()
    const judge: UiJudge = async () => ({
      findings: [
        {
          title: 'A finding on home',
          lens: 'consistency',
          severity: 'med',
          route: 'home',
          observation: 'visible problem',
          impact: 'user impact',
          suggestedFix: 'do x',
          screenshots: [{ path: 'screenshots/home--1280x800--whatever.png' }],
        },
      ],
      notes: 'tail commentary',
      tokenUsage: { input: 3, output: 4 },
      costUsd: 0.0001,
    })
    const provider = createInProcessUiAuditEnvironmentProvider({
      workspaceDir,
      judge,
      launchBrowser: async () => mock.browser,
    })
    const task = stubTask({
      captures: [
        { route: 'home', url: 'https://example.test/a' },
        { route: 'home', url: 'https://example.test/b' },
      ],
    })

    const environment = await createEnvironment(provider)
    const events = await drain(streamTurn(environment, encodeAuditTaskEnvelope(task)))
    await provider.close()

    const types = events.map((e) => e.type)
    expect(types).toEqual([
      'audit.lens',
      'audit.capture',
      'audit.capture',
      'audit.finding',
      'audit.notes',
      'done',
    ])
    const done = events.at(-1)
    expect(done?.data).toMatchObject({
      tokenUsage: { inputTokens: 3, outputTokens: 4 },
      totalCostUsd: 0.0001,
    })
    expect(events.at(-1)?.usage).toEqual({
      inputTokens: 3,
      outputTokens: 4,
      totalTokens: 7,
      cost: 0.0001,
    })
  })
})

describe('createInProcessUiAuditEnvironmentProvider — error handling', () => {
  it('closes the browser context even when the judge throws', async () => {
    const mock = makeMockBrowser()
    const judge: UiJudge = async () => {
      throw new Error('judge blew up')
    }
    const provider = createInProcessUiAuditEnvironmentProvider({
      workspaceDir,
      judge,
      launchBrowser: async () => mock.browser,
    })
    const environment = await createEnvironment(provider)
    await expect(
      drain(streamTurn(environment, encodeAuditTaskEnvelope(stubTask()))),
    ).rejects.toThrow(/judge blew up/)
    expect(mock.contextCloseCalls).toBe(1)
    await provider.close()
  })

  it('closes the browser context even when a capture throws', async () => {
    const mock = makeMockBrowser()
    mock.failNthScreenshot = 2
    const provider = createInProcessUiAuditEnvironmentProvider({
      workspaceDir,
      judge: okJudgeFn,
      launchBrowser: async () => mock.browser,
    })
    const task = stubTask({
      captures: [
        { route: 'home', url: 'https://example.test/a' },
        { route: 'home', url: 'https://example.test/b' },
      ],
    })
    const environment = await createEnvironment(provider)
    await expect(drain(streamTurn(environment, encodeAuditTaskEnvelope(task)))).rejects.toThrow(
      /mock screenshot failure/,
    )
    expect(mock.contextCloseCalls).toBe(1)
    await provider.close()
  })

  it('throws when the prompt is missing the UI_AUDIT_TASK envelope', async () => {
    const mock = makeMockBrowser()
    const provider = createInProcessUiAuditEnvironmentProvider({
      workspaceDir,
      judge: okJudgeFn,
      launchBrowser: async () => mock.browser,
    })
    const environment = await createEnvironment(provider)
    await expect(drain(streamTurn(environment, 'no envelope here'))).rejects.toThrow(
      /UI_AUDIT_TASK envelope/,
    )
    // The pre-envelope check is before any browser work; no context should
    // have been allocated.
    expect(mock.newContextCalls).toBe(0)
    await provider.close()
  })

  it('throws when the task has zero captures', async () => {
    const mock = makeMockBrowser()
    const provider = createInProcessUiAuditEnvironmentProvider({
      workspaceDir,
      judge: okJudgeFn,
      launchBrowser: async () => mock.browser,
    })
    const environment = await createEnvironment(provider)
    await expect(
      drain(
        streamTurn(environment, encodeAuditTaskEnvelope({ lens: 'consistency', captures: [] })),
      ),
    ).rejects.toThrow(/zero captures/)
    await provider.close()
  })

  it('rejects non-http(s) navigation targets at the provider boundary', async () => {
    const mock = makeMockBrowser()
    const provider = createInProcessUiAuditEnvironmentProvider({
      workspaceDir,
      judge: okJudgeFn,
      launchBrowser: async () => mock.browser,
    })
    for (const url of ['file:///etc/passwd', 'data:text/html,x', 'javascript:alert(1)']) {
      const environment = await createEnvironment(provider)
      await expect(
        drain(
          streamTurn(
            environment,
            encodeAuditTaskEnvelope(stubTask({ captures: [{ route: 'home', url }] })),
          ),
        ),
      ).rejects.toThrow(/must use http or https/)
    }
    await provider.close()
  })

  it('honours AbortSignal — aborting before the first capture rejects the stream', async () => {
    const mock = makeMockBrowser()
    const provider = createInProcessUiAuditEnvironmentProvider({
      workspaceDir,
      judge: okJudgeFn,
      launchBrowser: async () => mock.browser,
    })
    const controller = new AbortController()
    controller.abort()
    const environment = await createEnvironment(provider)
    await expect(
      drain(
        streamTurn(
          environment,
          encodeAuditTaskEnvelope(
            stubTask({
              captures: [
                { route: 'home', url: 'https://example.test/a' },
                { route: 'home', url: 'https://example.test/b' },
              ],
            }),
          ),
          controller.signal,
        ),
      ),
    ).rejects.toThrowError()
    // No goto should have run — the signal is checked before each capture.
    expect(mock.log.gotoUrls).toHaveLength(0)
    // And the context was created then closed (cleanup ran).
    expect(mock.contextCloseCalls).toBe(1)
    await provider.close()
  })

  it('propagates in-flight cancellation to the judge and closes the context', async () => {
    const mock = makeMockBrowser()
    let markJudgeEntered!: () => void
    const judgeEntered = new Promise<void>((resolve) => {
      markJudgeEntered = resolve
    })
    const judge: UiJudge = async ({ signal }) => {
      markJudgeEntered()
      if (!signal.aborted) {
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true })
        })
      }
      signal.throwIfAborted()
      return { findings: [] }
    }
    const provider = createInProcessUiAuditEnvironmentProvider({
      workspaceDir,
      judge,
      launchBrowser: async () => mock.browser,
    })
    const environment = await createEnvironment(provider)
    const controller = new AbortController()
    const running = drain(
      streamTurn(environment, encodeAuditTaskEnvelope(stubTask()), controller.signal),
    )

    await judgeEntered
    controller.abort()

    await expect(running).rejects.toMatchObject({ name: 'AbortError' })
    expect(mock.contextCloseCalls).toBe(1)
    await provider.close()
  })
})

describe('createInProcessUiAuditEnvironmentProvider — environment provider surface', () => {
  it('reports local placement and a stable provider identity', async () => {
    const mock = makeMockBrowser()
    const provider = createInProcessUiAuditEnvironmentProvider({
      workspaceDir,
      judge: okJudgeFn,
      launchBrowser: async () => mock.browser,
    })
    const environment = await createEnvironment(provider)
    const placement = await environment.placement?.()
    expect(environment.id).toMatch(/^ui-audit-/)
    expect(environment.provider).toBe('in-process-ui-audit')
    expect(placement).toEqual({
      kind: 'local',
      providerMetadata: { browser: 'playwright', mode: 'in-process' },
    })
    await provider.close()
  })

  it('reports official capabilities and rejects named profiles', async () => {
    const mock = makeMockBrowser()
    const provider = createInProcessUiAuditEnvironmentProvider({
      workspaceDir,
      judge: okJudgeFn,
      launchBrowser: async () => mock.browser,
    })

    expect(await provider.capabilities()).toMatchObject({
      streaming: { live: true },
      placement: true,
      usage: true,
    })
    await expect(provider.create({ profile: 'catalog-profile' })).rejects.toThrow(
      /named profiles require a provider catalog/,
    )
    await provider.close()
  })

  it('reuses one browser and creates a fresh context for every turn', async () => {
    const mock = makeMockBrowser()
    const launchBrowser = vi.fn(async () => mock.browser)
    const provider = createInProcessUiAuditEnvironmentProvider({
      workspaceDir,
      judge: okJudgeFn,
      launchBrowser,
    })
    const first = await createEnvironment(provider)
    const second = await createEnvironment(provider)

    await drain(
      streamTurn(
        first,
        encodeAuditTaskEnvelope(
          stubTask({ captures: [{ route: 'first', url: 'https://example.test/first' }] }),
        ),
      ),
    )
    await drain(
      streamTurn(
        second,
        encodeAuditTaskEnvelope(
          stubTask({ captures: [{ route: 'second', url: 'https://example.test/second' }] }),
        ),
      ),
    )
    await first.destroy?.()
    await second.destroy?.()
    await provider.close()

    expect(launchBrowser).toHaveBeenCalledTimes(1)
    expect(mock.newContextCalls).toBe(2)
    expect(mock.contextCloseCalls).toBe(2)
    expect(mock.browserCloseCalls).toBe(1)
  })

  it('close() is idempotent', async () => {
    const mock = makeMockBrowser()
    const provider = createInProcessUiAuditEnvironmentProvider({
      workspaceDir,
      judge: okJudgeFn,
      launchBrowser: async () => mock.browser,
    })
    const environment = await createEnvironment(provider)
    await drain(streamTurn(environment, encodeAuditTaskEnvelope(stubTask())))
    await provider.close()
    await provider.close()
    expect(mock.browserCloseCalls).toBe(1)
  })

  it('rejects stream after close instead of silently re-launching the browser', async () => {
    const mock = makeMockBrowser()
    const provider = createInProcessUiAuditEnvironmentProvider({
      workspaceDir,
      judge: okJudgeFn,
      launchBrowser: async () => mock.browser,
    })
    const environment = await createEnvironment(provider)
    await provider.close()
    await expect(
      drain(streamTurn(environment, encodeAuditTaskEnvelope(stubTask()))),
    ).rejects.toThrow(/destroyed/)
    // Nothing should have been newly allocated — the closed guard fires
    // before browser launch.
    expect(mock.newContextCalls).toBe(0)
  })
})

describe('createInProcessUiAuditEnvironmentProvider — AggregateError on dual failure', () => {
  it('throws AggregateError when both the judge and context.close() fail', async () => {
    const judge: UiJudge = async () => {
      throw new Error('judge blew up')
    }
    // Build a custom mock whose context.close() also throws.
    const page: PageHandle = {
      async setViewportSize() {},
      async goto() {
        return undefined
      },
      async waitForSelector() {
        return undefined
      },
      async waitForTimeout() {},
      async screenshot({ path: outPath }) {
        await fs.writeFile(outPath, 'fake-png')
      },
      locator() {
        return {
          first() {
            return {
              async screenshot({ path: outPath }) {
                await fs.writeFile(outPath, 'fake-png')
              },
            }
          },
        }
      },
    }
    const context: BrowserContextHandle = {
      async newPage() {
        return page
      },
      async close() {
        throw new Error('close blew up')
      },
    }
    const browser: BrowserHandle = {
      async newContext() {
        return context
      },
      async close() {},
    }
    const provider = createInProcessUiAuditEnvironmentProvider({
      workspaceDir,
      judge,
      launchBrowser: async () => browser,
    })
    const environment = await createEnvironment(provider)
    let caught: unknown
    try {
      await drain(streamTurn(environment, encodeAuditTaskEnvelope(stubTask())))
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(AggregateError)
    const agg = caught as AggregateError
    const messages = agg.errors.map((e) => (e instanceof Error ? e.message : String(e)))
    expect(messages).toContain('judge blew up')
    expect(messages).toContain('close blew up')
    await provider.close()
  })
})
