/**
 *
 * `createInProcessUiAuditClient` — a `SandboxClient` that drives a
 * Playwright browser in-process and delegates finding identification to a
 * consumer-supplied {@link UiJudge}.
 *
 * Why this exists: `runLoop` is built around a sandbox-SDK seam — each
 * iteration is `client.create() → box.streamPrompt() → box.delete()`.
 * For UI audit, spinning up a real container running a coding harness
 * per iteration is overkill: the work is one browser capture + one
 * vision LLM call. This client satisfies the kernel contract while
 * doing the audit in-process; no container, no sandbox-SDK backend.
 *
 * The client owns ONE browser for its lifetime and creates a fresh
 * context per iteration (isolated cookies/storage). Playwright is
 * dynamically imported so consumers who use a different `SandboxClient`
 * — e.g. a fleet executor that drives Playwright remotely — do not pay
 * the peer dep cost.
 *
 * Concurrency: each iteration's prompt carries a self-describing task
 * envelope (see `prompt.ts`), so concurrent fanout iterations do not race
 * over per-client side state.
 *
 * @experimental
 */

import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import type { SandboxClient } from '../../runtime/types'
import type { UiJudge } from './judge'
import { decodeAuditTaskEnvelope } from './prompt'
import { slugify } from './slugify'
import type { UiAuditCapture, UiAuditCaptureRequest } from './task'

// All synthetic events the auditor emits flow through this helper. Reason:
// `SandboxEvent.data` is a sandbox-SDK shape (effectively `Record<string,
// unknown>`) that our typed payloads (`UiAuditCapture`, `UiFinding`, …) do not
// satisfy structurally. The cast moves the type-system smell into a single,
// named, documented call site so the call sites in `runIteration` stay clean.
// The runtime contract — `{ type, data }` — is what the output adapter reads;
// the static type is what the kernel collects into `SandboxEvent[]`.
function asSandboxEvent<T>(type: string, data: T): SandboxEvent {
  return { type, data } as unknown as SandboxEvent
}

/** @experimental */
export interface InProcessUiAuditClientOptions {
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
   * `'strict'` (default) waits for `networkidle` and fails the iteration
   * if the page does not settle. `'spa'` waits for `domcontentloaded` —
   * use for single-page apps that hold open long-poll/websocket
   * connections and never settle.
   */
  navPolicy?: 'strict' | 'spa'
  /**
   * Browser launch override. Default: chromium headless via Playwright.
   * Consumers pass a custom factory to target a remote browser, a
   * different channel, or a fleet adapter.
   */
  launchBrowser?: () => Promise<BrowserHandle>
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

async function defaultLaunch(): Promise<BrowserHandle> {
  const mod = (await import('playwright')) as unknown as {
    chromium?: { launch(options?: { headless?: boolean }): Promise<BrowserHandle> }
  }
  if (!mod?.chromium || typeof mod.chromium.launch !== 'function') {
    throw new Error(
      'ui-auditor: playwright is not installed. Install `playwright` (and run `playwright install chromium`) or pass a custom `launchBrowser` to createInProcessUiAuditClient.',
    )
  }
  return mod.chromium.launch({ headless: true })
}

function nowStamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  // Millisecond resolution so parallel fanout iterations capturing the same
  // route/viewport/label within the same second don't collide on filename and
  // silently overwrite each other.
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}` +
    `-${String(d.getUTCMilliseconds()).padStart(3, '0')}`
  )
}

function viewportOf(req: UiAuditCaptureRequest): { width: number; height: number } {
  return req.viewport ?? DEFAULT_VIEWPORT
}

function captureFilename(req: UiAuditCaptureRequest): string {
  const vp = viewportOf(req)
  const labelPart = req.label ? `--${slugify(req.label, 'label')}` : ''
  return `${slugify(req.route, 'route')}--${vp.width}x${vp.height}${labelPart}--${nowStamp()}.png`
}

function assertHttpUrl(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`ui-auditor: capture url is not parseable (got ${JSON.stringify(url)})`)
  }
  // SSRF defense at the client boundary. The MCP tool already restricts to
  // http(s), but `createInProcessUiAuditClient` is exported and can be wired
  // up directly by consumers (the example does this). A crafted task envelope
  // could otherwise navigate Playwright to `file://`, `data:`, `javascript:`
  // and read local files or execute inline content.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `ui-auditor: capture url must use http or https (got ${parsed.protocol} in ${JSON.stringify(url)})`,
    )
  }
}

async function captureOne(
  page: PageHandle,
  req: UiAuditCaptureRequest,
  outAbsPath: string,
  signal: AbortSignal,
  navPolicy: 'strict' | 'spa',
): Promise<void> {
  signal.throwIfAborted()
  assertHttpUrl(req.url)
  // Apply the per-capture viewport before navigation. The capture metadata
  // and filename both encode this viewport; the rendered page must match.
  await page.setViewportSize(viewportOf(req))
  const waitUntil = navPolicy === 'spa' ? 'domcontentloaded' : 'networkidle'
  await page.goto(req.url, { waitUntil, timeout: NAV_TIMEOUT_MS })
  if (req.waitFor) {
    await page.waitForSelector(req.waitFor, { timeout: 15_000 })
  }
  const extra = req.waitMs ?? 500
  if (extra > 0) await page.waitForTimeout(extra)
  signal.throwIfAborted()
  if (req.elementSelector) {
    await page.locator(req.elementSelector).first().screenshot({ path: outAbsPath })
  } else {
    await page.screenshot({ path: outAbsPath, fullPage: req.fullPage === true })
  }
}

interface SyntheticSandbox extends SandboxInstance {}

function makeSandboxId(): string {
  const rand = () => Math.random().toString(16).slice(2, 10)
  return `ui-audit-${rand()}${rand()}`
}

/** Create a `SandboxClient` that drives a local Playwright browser for in-process UI audits. @experimental */
export function createInProcessUiAuditClient(
  options: InProcessUiAuditClientOptions,
): SandboxClient & {
  /**
   * Close the underlying browser. Idempotent.
   *
   * Contract: callers MUST ensure no iterations are in flight when this is
   * called. The kernel respects this — `runLoop` awaits every iteration
   * before returning, so `await runLoop(...); await client.close()` is the
   * intended pattern (see `examples/ui-audit`). If `close()` is invoked
   * concurrently with a running iteration, the browser teardown will race
   * against in-flight page operations; the iteration will surface an
   * AggregateError carrying both the iteration error and the close error,
   * but no work is lost silently.
   */
  close(): Promise<void>
} {
  const launch = options.launchBrowser ?? defaultLaunch
  const navPolicy = options.navPolicy ?? 'strict'
  let browserPromise: Promise<BrowserHandle> | undefined
  let closed = false

  async function getBrowser(): Promise<BrowserHandle> {
    if (closed) {
      throw new Error('ui-auditor: client is closed; create a new client to run another iteration')
    }
    if (!browserPromise) browserPromise = launch()
    return browserPromise
  }

  async function* runIteration(
    promptText: string,
    signal: AbortSignal,
  ): AsyncIterable<SandboxEvent> {
    const task = decodeAuditTaskEnvelope(promptText)
    if (!task) {
      throw new Error(
        'ui-auditor: prompt is missing a UI_AUDIT_TASK envelope. Use uiAuditorProfile().taskToPrompt to format prompts, or pass an envelope-prefixed prompt manually.',
      )
    }
    if (task.captures.length === 0) {
      throw new Error('ui-auditor: task has zero captures; nothing to audit.')
    }

    yield asSandboxEvent('audit.lens', { lens: task.lens })

    const browser = await getBrowser()
    const context = await browser.newContext({ viewport: DEFAULT_VIEWPORT })
    // Track both the primary iteration error and any context-close failure so
    // the cleanup path never silently swallows a leaked-context bug AND a
    // close failure never shadows the real iteration error. After the
    // try/catch/finally settles, we rethrow the primary if there was one,
    // otherwise we rethrow the close error.
    let primaryError: unknown
    let closeError: unknown
    try {
      const page = await context.newPage()
      const captures: UiAuditCapture[] = []
      const fs = await import('node:fs/promises')
      const path = await import('node:path')
      const shotsDir = path.join(options.workspaceDir, 'screenshots')
      await fs.mkdir(shotsDir, { recursive: true })

      for (const req of task.captures) {
        signal.throwIfAborted()
        const filename = captureFilename(req)
        const absPath = path.join(shotsDir, filename)
        const relPath = `screenshots/${filename}`
        await captureOne(page, req, absPath, signal, navPolicy)
        const vp = viewportOf(req)
        const cap: UiAuditCapture = {
          path: relPath,
          viewport: `${vp.width}x${vp.height}`,
          fullPage: req.fullPage === true,
          route: req.route,
          url: req.url,
          capturedAt: new Date().toISOString(),
        }
        if (req.elementSelector) cap.elementSelector = req.elementSelector
        if (req.label) cap.label = req.label
        captures.push(cap)
        yield asSandboxEvent('audit.capture', cap)
      }

      const judgeOut = await options.judge({
        lens: task.lens,
        captures,
        productContext: task.productContext,
        knownFindingIds: task.knownFindingIds,
        promptText,
        signal,
      })

      for (const finding of judgeOut.findings) {
        yield asSandboxEvent('audit.finding', finding)
      }
      if (judgeOut.notes && judgeOut.notes.trim().length > 0) {
        yield asSandboxEvent('audit.notes', { notes: judgeOut.notes })
      }

      const usage = judgeOut.tokenUsage ?? { input: 0, output: 0 }
      yield asSandboxEvent('done', {
        tokenUsage: {
          inputTokens: usage.input,
          outputTokens: usage.output,
        },
        totalCostUsd: judgeOut.costUsd ?? 0,
      })
    } catch (err) {
      primaryError = err
    } finally {
      try {
        await context.close()
      } catch (err) {
        closeError = err
      }
    }
    // When both the iteration and the cleanup fail, surface both via
    // AggregateError so a leaked context bug is not silently masked by an
    // earlier iteration failure (per the fail-loud doctrine).
    if (primaryError !== undefined && closeError !== undefined) {
      throw new AggregateError(
        [primaryError, closeError],
        'ui-auditor: iteration failed AND context.close() failed; both errors attached.',
      )
    }
    if (primaryError !== undefined) throw primaryError
    if (closeError !== undefined) throw closeError
  }

  function makeSyntheticSandbox(): SyntheticSandbox {
    const id = makeSandboxId()
    const instance = {
      id,
      streamPrompt(message: string, opts?: { signal?: AbortSignal }): AsyncIterable<SandboxEvent> {
        const signal = opts?.signal ?? new AbortController().signal
        return runIteration(message, signal)
      },
      async delete(): Promise<void> {
        // No per-sandbox resources to release; the browser is shared and
        // closed by `client.close()`. Intentionally a no-op so trace-time
        // `box.delete()` succeeds without doing surprising work.
      },
    }
    return instance as unknown as SyntheticSandbox
  }

  return {
    async create(_options?: CreateSandboxOptions) {
      return makeSyntheticSandbox()
    },
    describePlacement(box) {
      const id = (box as unknown as { id?: string }).id
      return { kind: 'sibling', sandboxId: typeof id === 'string' ? id : undefined }
    },
    async close() {
      closed = true
      const pending = browserPromise
      browserPromise = undefined
      if (pending) {
        const browser = await pending
        await browser.close()
      }
    },
  }
}
