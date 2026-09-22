/**
 * In-process UI audit environment provider.
 *
 * One browser is reused for the provider lifetime. Each environment turn gets
 * a fresh browser context so cookies and storage never cross turns.
 *
 * @experimental
 */

import { randomUUID } from 'node:crypto'
import {
  type AgentProfile,
  type AgentProfileValidationResult,
  renderInputPartsAsText,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  AgentEnvironmentStatus,
  AgentProfileRef,
  AgentTurnInput,
  CreateAgentEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'
import type { UiJudge } from './judge'
import { decodeAuditTaskEnvelope } from './prompt'
import { slugify } from './slugify'
import type { UiAuditCapture, UiAuditCaptureRequest } from './task'

/** @experimental */
export interface InProcessUiAuditEnvironmentProviderOptions {
  /**
   * Absolute path under which screenshots are written. Each capture lands
   * at `<workspaceDir>/screenshots/<filename>`; finding screenshot paths
   * are workspace-relative (`screenshots/<filename>`).
   */
  workspaceDir: string
  /** The vision judge that turns captures into findings. */
  judge: UiJudge
  /**
   * Navigation policy.
   *
   * `strict` waits for `networkidle`. `spa` waits for `domcontentloaded`
   * so pages with long-lived connections can complete.
   */
  navPolicy?: 'strict' | 'spa'
  /** Override browser launch for remote browsers, channels, or tests. */
  launchBrowser?: () => Promise<BrowserHandle>
}

/** Official provider with explicit shared-browser shutdown. @experimental */
export interface InProcessUiAuditEnvironmentProvider extends AgentEnvironmentProvider {
  /** Close the shared browser and stop every active environment. Idempotent. */
  close(): Promise<void>
}

/** @experimental */
export interface BrowserHandle {
  newContext(options?: {
    viewport?: { width: number; height: number }
  }): Promise<BrowserContextHandle>
  close(): Promise<void>
}

/** @experimental */
export interface BrowserContextHandle {
  newPage(): Promise<PageHandle>
  close(): Promise<void>
}

/** @experimental */
export interface PageHandle {
  setViewportSize(size: { width: number; height: number }): Promise<void>
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>
  waitForTimeout(ms: number): Promise<void>
  screenshot(options: { path: string; fullPage?: boolean }): Promise<void>
  locator(selector: string): {
    first(): { screenshot(options: { path: string }): Promise<void> }
  }
}

const DEFAULT_VIEWPORT = { width: 1280, height: 800 } as const
const NAV_TIMEOUT_MS = 30_000
const PROVIDER_NAME = 'in-process-ui-audit'

async function defaultLaunch(): Promise<BrowserHandle> {
  const mod = (await import('playwright')) as unknown as {
    chromium?: { launch(options?: { headless?: boolean }): Promise<BrowserHandle> }
  }
  if (!mod?.chromium || typeof mod.chromium.launch !== 'function') {
    throw new Error(
      'ui-auditor: playwright is not installed. Install `playwright` and run `playwright install chromium`, or pass `launchBrowser` to createInProcessUiAuditEnvironmentProvider.',
    )
  }
  return mod.chromium.launch({ headless: true })
}

function nowStamp(): string {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}` +
    `-${String(date.getUTCMilliseconds()).padStart(3, '0')}`
  )
}

function viewportOf(request: UiAuditCaptureRequest): { width: number; height: number } {
  return request.viewport ?? DEFAULT_VIEWPORT
}

function captureFilename(request: UiAuditCaptureRequest): string {
  const viewport = viewportOf(request)
  const label = request.label ? `--${slugify(request.label, 'label')}` : ''
  return `${slugify(request.route, 'route')}--${viewport.width}x${viewport.height}${label}--${nowStamp()}.png`
}

function assertHttpUrl(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`ui-auditor: capture url is not parseable (got ${JSON.stringify(url)})`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `ui-auditor: capture url must use http or https (got ${parsed.protocol} in ${JSON.stringify(url)})`,
    )
  }
}

async function captureOne(
  page: PageHandle,
  request: UiAuditCaptureRequest,
  outputPath: string,
  signal: AbortSignal,
  navPolicy: 'strict' | 'spa',
): Promise<void> {
  signal.throwIfAborted()
  assertHttpUrl(request.url)
  await page.setViewportSize(viewportOf(request))
  await page.goto(request.url, {
    waitUntil: navPolicy === 'spa' ? 'domcontentloaded' : 'networkidle',
    timeout: NAV_TIMEOUT_MS,
  })
  if (request.waitFor) {
    await page.waitForSelector(request.waitFor, { timeout: 15_000 })
  }
  const waitMs = request.waitMs ?? 500
  if (waitMs > 0) await page.waitForTimeout(waitMs)
  signal.throwIfAborted()
  if (request.elementSelector) {
    await page.locator(request.elementSelector).first().screenshot({ path: outputPath })
  } else {
    await page.screenshot({ path: outputPath, fullPage: request.fullPage === true })
  }
}

function event(type: string, data: unknown): AgentEnvironmentEvent {
  return { type, data: data as Record<string, unknown> }
}

function profileValidation(profile: AgentProfileRef): AgentProfileValidationResult {
  if (typeof profile === 'string') {
    return {
      ok: false,
      issues: [
        {
          level: 'error',
          code: 'named_profile_unsupported',
          message: `${PROVIDER_NAME}: named profiles require a provider catalog`,
        },
      ],
    }
  }
  return { ok: true, issues: [], normalizedProfile: profile }
}

function validatedProfile(profile: AgentProfileRef): AgentProfile {
  const validation = profileValidation(profile)
  if (!validation.ok || typeof profile === 'string') {
    const reason = validation.issues.map((issue) => issue.message).join('; ')
    throw new Error(`${PROVIDER_NAME}: profile validation failed: ${reason}`)
  }
  return validation.normalizedProfile ?? profile
}

function capabilities(): AgentEnvironmentCapabilities {
  return {
    profile: {
      namedProfiles: false,
      systemPrompt: false,
      instructions: false,
      tools: false,
      permissions: false,
      mcp: false,
      subagents: false,
      resources: {
        files: false,
        instructions: false,
        tools: false,
        skills: false,
        agents: false,
        commands: false,
      },
      hooks: false,
      modes: false,
      runtimeUpdate: false,
      validation: true,
    },
    streaming: { live: true, replay: false, detach: false, turnIdempotency: false },
    sessions: { continue: false, list: false, messages: false },
    workspace: {
      read: false,
      write: false,
      exec: false,
      git: false,
      upload: false,
      download: false,
    },
    branching: { checkpoint: false, fork: false },
    placement: true,
    usage: true,
    confidential: false,
  }
}

/**
 * Create a local Playwright UI-audit provider.
 *
 * Environments own cancellation and status. The provider owns the shared
 * browser and must be closed after all turns finish.
 *
 * @experimental
 */
export function createInProcessUiAuditEnvironmentProvider(
  options: InProcessUiAuditEnvironmentProviderOptions,
): InProcessUiAuditEnvironmentProvider {
  const launch = options.launchBrowser ?? defaultLaunch
  const navPolicy = options.navPolicy ?? 'strict'
  const environments = new Map<string, AgentEnvironment>()
  let browserPromise: Promise<BrowserHandle> | undefined
  let closePromise: Promise<void> | undefined
  let closed = false

  async function getBrowser(): Promise<BrowserHandle> {
    if (closed) {
      throw new Error('ui-auditor: provider is closed; create a new provider to run another turn')
    }
    if (!browserPromise) browserPromise = launch()
    return browserPromise
  }

  async function* runTurn(
    prompt: string,
    signal: AbortSignal,
  ): AsyncIterable<AgentEnvironmentEvent> {
    const task = decodeAuditTaskEnvelope(prompt)
    if (!task) {
      throw new Error(
        'ui-auditor: prompt is missing a UI_AUDIT_TASK envelope. Use uiAuditorProfile().taskToPrompt to format prompts, or pass an envelope-prefixed prompt manually.',
      )
    }
    if (task.captures.length === 0) {
      throw new Error('ui-auditor: task has zero captures; nothing to audit.')
    }

    yield event('audit.lens', { lens: task.lens })

    const browser = await getBrowser()
    const context = await browser.newContext({ viewport: DEFAULT_VIEWPORT })
    let primaryError: unknown
    let closeError: unknown
    try {
      const page = await context.newPage()
      const captures: UiAuditCapture[] = []
      const fs = await import('node:fs/promises')
      const path = await import('node:path')
      const screenshotsDir = path.join(options.workspaceDir, 'screenshots')
      await fs.mkdir(screenshotsDir, { recursive: true })

      for (const request of task.captures) {
        signal.throwIfAborted()
        const filename = captureFilename(request)
        const absolutePath = path.join(screenshotsDir, filename)
        const relativePath = `screenshots/${filename}`
        await captureOne(page, request, absolutePath, signal, navPolicy)
        const viewport = viewportOf(request)
        const capture: UiAuditCapture = {
          path: relativePath,
          viewport: `${viewport.width}x${viewport.height}`,
          fullPage: request.fullPage === true,
          route: request.route,
          url: request.url,
          capturedAt: new Date().toISOString(),
        }
        if (request.elementSelector) capture.elementSelector = request.elementSelector
        if (request.label) capture.label = request.label
        captures.push(capture)
        yield event('audit.capture', capture)
      }

      const output = await options.judge({
        lens: task.lens,
        captures,
        productContext: task.productContext,
        knownFindingIds: task.knownFindingIds,
        promptText: prompt,
        signal,
      })
      signal.throwIfAborted()

      for (const finding of output.findings) {
        yield event('audit.finding', finding)
      }
      if (output.notes && output.notes.trim().length > 0) {
        yield event('audit.notes', { notes: output.notes })
      }

      const usage = output.tokenUsage ?? { input: 0, output: 0 }
      const totalCostUsd = output.costUsd ?? 0
      yield {
        ...event('done', {
          tokenUsage: {
            inputTokens: usage.input,
            outputTokens: usage.output,
          },
          totalCostUsd,
        }),
        usage: {
          inputTokens: usage.input,
          outputTokens: usage.output,
          totalTokens: usage.input + usage.output,
          cost: totalCostUsd,
        },
      }
    } catch (error) {
      primaryError = error
    } finally {
      try {
        await context.close()
      } catch (error) {
        closeError = error
      }
    }

    if (primaryError !== undefined && closeError !== undefined) {
      throw new AggregateError(
        [primaryError, closeError],
        'ui-auditor: turn failed and context.close() failed; both errors attached.',
      )
    }
    if (primaryError !== undefined) throw primaryError
    if (closeError !== undefined) throw closeError
  }

  const provider: InProcessUiAuditEnvironmentProvider = {
    name: PROVIDER_NAME,
    capabilities,
    validateProfile: profileValidation,
    async create(input: CreateAgentEnvironmentInput): Promise<AgentEnvironment> {
      if (closed) {
        throw new Error('ui-auditor: provider is closed; create a new provider')
      }
      input.signal?.throwIfAborted()
      validatedProfile(input.profile)

      const id = `ui-audit-${randomUUID()}`
      const environmentController = new AbortController()
      let destroyed = false

      const destroy = async (): Promise<void> => {
        if (destroyed) return
        destroyed = true
        environmentController.abort()
        input.signal?.removeEventListener('abort', onCreateAbort)
        environments.delete(id)
      }
      const onCreateAbort = () => {
        environmentController.abort(input.signal?.reason)
        void destroy()
      }
      if (input.signal) {
        input.signal.addEventListener('abort', onCreateAbort, { once: true })
        if (input.signal.aborted) {
          await destroy()
          input.signal.throwIfAborted()
        }
      }

      const environment: AgentEnvironment = {
        id,
        provider: PROVIDER_NAME,
        ...(input.name ? { name: input.name } : {}),
        async status(): Promise<AgentEnvironmentStatus> {
          return destroyed ? 'stopped' : 'running'
        },
        async *stream(turn: AgentTurnInput): AsyncIterable<AgentEnvironmentEvent> {
          if (destroyed) {
            throw new Error('ui-auditor: environment has been destroyed')
          }
          const signal = turn.signal
            ? AbortSignal.any([environmentController.signal, turn.signal])
            : environmentController.signal
          const prompt = turn.prompt ?? (turn.parts ? renderInputPartsAsText(turn.parts) : '')
          yield* runTurn(prompt, signal)
        },
        async placement() {
          return {
            kind: 'local',
            providerMetadata: { browser: 'playwright', mode: 'in-process' },
          }
        },
        destroy,
      }

      environments.set(id, environment)
      return environment
    },
    async get(id) {
      return environments.get(id) ?? null
    },
    async list() {
      return Array.from(environments.values(), (environment) => ({
        id: environment.id,
        provider: environment.provider,
        ...(environment.name ? { name: environment.name } : {}),
        status: 'running' as const,
      }))
    },
    close() {
      if (!closePromise) {
        closePromise = (async () => {
          closed = true
          await Promise.all(
            Array.from(environments.values(), (environment) => environment.destroy?.()),
          )
          environments.clear()
          if (browserPromise) {
            await (await browserPromise).close()
          }
        })()
      }
      return closePromise
    },
  }

  return provider
}
