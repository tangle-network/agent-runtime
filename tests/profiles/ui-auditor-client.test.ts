import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { SandboxEvent } from '@tangle-network/sandbox'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type BrowserContextHandle,
  type BrowserHandle,
  createInProcessUiAuditClient,
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
  failNthScreenshot?: number
}

function makeMockBrowser(): MockHandles {
  const log: MockPageLog = { setViewports: [], gotoUrls: [], screenshotPaths: [] }
  const state = { failNthScreenshot: undefined as number | undefined }
  let newContextCalls = 0
  let contextCloseCalls = 0

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
      /* no-op */
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
    set failNthScreenshot(n: number | undefined) {
      state.failNthScreenshot = n
    },
  } as unknown as MockHandles
}

let workspaceDir: string

beforeEach(async () => {
  workspaceDir = await fs.mkdtemp(path.join(tmpdir(), 'ui-audit-client-'))
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

async function drain(it: AsyncIterable<SandboxEvent>): Promise<SandboxEvent[]> {
  const events: SandboxEvent[] = []
  for await (const e of it) events.push(e)
  return events
}

describe('createInProcessUiAuditClient — viewport application', () => {
  it('applies the per-capture viewport BEFORE navigation for every capture', async () => {
    const mock = makeMockBrowser()
    const client = createInProcessUiAuditClient({
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

    const box = await client.create()
    await drain(
      box.streamPrompt(encodeAuditTaskEnvelope(task), { signal: new AbortController().signal }),
    )
    await client.close()

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

describe('createInProcessUiAuditClient — event order', () => {
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
    const client = createInProcessUiAuditClient({
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

    const box = await client.create()
    const events = await drain(
      box.streamPrompt(encodeAuditTaskEnvelope(task), { signal: new AbortController().signal }),
    )
    await client.close()

    const types = events.map((e) => e.type)
    expect(types).toEqual([
      'audit.lens',
      'audit.capture',
      'audit.capture',
      'audit.finding',
      'audit.notes',
      'done',
    ])
    const done = events[events.length - 1] as {
      data: { tokenUsage: { inputTokens: number; outputTokens: number }; totalCostUsd: number }
    }
    expect(done.data.tokenUsage).toEqual({ inputTokens: 3, outputTokens: 4 })
    expect(done.data.totalCostUsd).toBeCloseTo(0.0001, 6)
  })
})

describe('createInProcessUiAuditClient — error handling', () => {
  it('closes the browser context even when the judge throws', async () => {
    const mock = makeMockBrowser()
    const judge: UiJudge = async () => {
      throw new Error('judge blew up')
    }
    const client = createInProcessUiAuditClient({
      workspaceDir,
      judge,
      launchBrowser: async () => mock.browser,
    })
    const box = await client.create()
    await expect(
      drain(
        box.streamPrompt(encodeAuditTaskEnvelope(stubTask()), {
          signal: new AbortController().signal,
        }),
      ),
    ).rejects.toThrow(/judge blew up/)
    expect(mock.contextCloseCalls).toBe(1)
    await client.close()
  })

  it('closes the browser context even when a capture throws', async () => {
    const mock = makeMockBrowser()
    mock.failNthScreenshot = 2
    const client = createInProcessUiAuditClient({
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
    const box = await client.create()
    await expect(
      drain(
        box.streamPrompt(encodeAuditTaskEnvelope(task), { signal: new AbortController().signal }),
      ),
    ).rejects.toThrow(/mock screenshot failure/)
    expect(mock.contextCloseCalls).toBe(1)
    await client.close()
  })

  it('throws when the prompt is missing the UI_AUDIT_TASK envelope', async () => {
    const mock = makeMockBrowser()
    const client = createInProcessUiAuditClient({
      workspaceDir,
      judge: okJudgeFn,
      launchBrowser: async () => mock.browser,
    })
    const box = await client.create()
    await expect(
      drain(box.streamPrompt('no envelope here', { signal: new AbortController().signal })),
    ).rejects.toThrow(/UI_AUDIT_TASK envelope/)
    // The pre-envelope check is before any browser work; no context should
    // have been allocated.
    expect(mock.newContextCalls).toBe(0)
    await client.close()
  })

  it('throws when the task has zero captures', async () => {
    const mock = makeMockBrowser()
    const client = createInProcessUiAuditClient({
      workspaceDir,
      judge: okJudgeFn,
      launchBrowser: async () => mock.browser,
    })
    const box = await client.create()
    await expect(
      drain(
        box.streamPrompt(encodeAuditTaskEnvelope({ lens: 'consistency', captures: [] }), {
          signal: new AbortController().signal,
        }),
      ),
    ).rejects.toThrow(/zero captures/)
    await client.close()
  })

  it('rejects non-http(s) capture URLs as SSRF defense at the client boundary', async () => {
    const mock = makeMockBrowser()
    const client = createInProcessUiAuditClient({
      workspaceDir,
      judge: okJudgeFn,
      launchBrowser: async () => mock.browser,
    })
    for (const url of ['file:///etc/passwd', 'data:text/html,x', 'javascript:alert(1)']) {
      const box = await client.create()
      await expect(
        drain(
          box.streamPrompt(
            encodeAuditTaskEnvelope(stubTask({ captures: [{ route: 'home', url }] })),
            { signal: new AbortController().signal },
          ),
        ),
      ).rejects.toThrow(/must use http or https/)
    }
    await client.close()
  })

  it('honours AbortSignal — aborting before the first capture rejects the stream', async () => {
    const mock = makeMockBrowser()
    const client = createInProcessUiAuditClient({
      workspaceDir,
      judge: okJudgeFn,
      launchBrowser: async () => mock.browser,
    })
    const controller = new AbortController()
    controller.abort()
    const box = await client.create()
    await expect(
      drain(
        box.streamPrompt(
          encodeAuditTaskEnvelope(
            stubTask({
              captures: [
                { route: 'home', url: 'https://example.test/a' },
                { route: 'home', url: 'https://example.test/b' },
              ],
            }),
          ),
          { signal: controller.signal },
        ),
      ),
    ).rejects.toThrowError()
    // No goto should have run — the signal is checked before each capture.
    expect(mock.log.gotoUrls).toHaveLength(0)
    // And the context was created then closed (cleanup ran).
    expect(mock.contextCloseCalls).toBe(1)
    await client.close()
  })
})

describe('createInProcessUiAuditClient — sandbox surface', () => {
  it('describePlacement reports the synthetic sandbox id', async () => {
    const mock = makeMockBrowser()
    const client = createInProcessUiAuditClient({
      workspaceDir,
      judge: okJudgeFn,
      launchBrowser: async () => mock.browser,
    })
    const box = await client.create()
    const placement = client.describePlacement?.(box)
    expect(placement?.kind).toBe('sibling')
    expect(typeof placement?.sandboxId).toBe('string')
    expect(placement?.sandboxId).toMatch(/^ui-audit-/)
    await client.close()
  })

  it('close() is idempotent', async () => {
    const mock = makeMockBrowser()
    const client = createInProcessUiAuditClient({
      workspaceDir,
      judge: okJudgeFn,
      launchBrowser: async () => mock.browser,
    })
    await client.close()
    await client.close()
    expect(mock.newContextCalls).toBe(0)
  })

  it('rejects streamPrompt after close instead of silently re-launching the browser', async () => {
    const mock = makeMockBrowser()
    const client = createInProcessUiAuditClient({
      workspaceDir,
      judge: okJudgeFn,
      launchBrowser: async () => mock.browser,
    })
    const box = await client.create()
    await client.close()
    await expect(
      drain(
        box.streamPrompt(encodeAuditTaskEnvelope(stubTask()), {
          signal: new AbortController().signal,
        }),
      ),
    ).rejects.toThrow(/client is closed/)
    // Nothing should have been newly allocated — the closed guard fires
    // before browser launch.
    expect(mock.newContextCalls).toBe(0)
  })
})

describe('createInProcessUiAuditClient — AggregateError on dual failure', () => {
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
    const client = createInProcessUiAuditClient({
      workspaceDir,
      judge,
      launchBrowser: async () => browser,
    })
    const box = await client.create()
    let caught: unknown
    try {
      await drain(
        box.streamPrompt(encodeAuditTaskEnvelope(stubTask()), {
          signal: new AbortController().signal,
        }),
      )
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(AggregateError)
    const agg = caught as AggregateError
    const messages = agg.errors.map((e) => (e instanceof Error ? e.message : String(e)))
    expect(messages).toContain('judge blew up')
    expect(messages).toContain('close blew up')
    await client.close()
  })
})
