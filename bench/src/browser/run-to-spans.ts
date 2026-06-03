/**
 * Pure converter: a neutral `BrowserRun` (from any `BrowserAgentAdapter`) → a
 * `Span[]` trace run-capsule renders into a navigation film. One `kind:'tool'`
 * span per `BrowserStep` (`browser.<action>`); when a step carries a
 * `screenshotPath`, the file is read and inlined as a base64 `data:` URI on
 * `attributes.screenshot` — run-capsule renders from the inline blob, NOT a path,
 * so a raw path would silently render nothing.
 *
 * Kept pure + spawn-free (the adapter already ran the browser) so the mapping is
 * unit-testable against a fixture without launching Chromium. Timestamps are
 * synthesized monotonically from `opts.startTs` (default 0) — deterministic for
 * the verify; the live caller passes `Date.now()`.
 */

import { readFile } from 'node:fs/promises'
import type { Span } from '@tangle-network/agent-eval'
import type { BrowserRun } from './agent-adapter'

export interface BrowserRunToSpansOptions {
  /** Base timestamp; each emitted span advances by 1ms. Default 0 (deterministic). */
  startTs?: number
  /** Cap on inlined screenshot bytes before base64 (skip oversized frames). Default 8 MiB. */
  maxScreenshotBytes?: number
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47])
const JPG = Buffer.from([0xff, 0xd8, 0xff])

/** Sniff the on-disk image mime from magic bytes; default png. */
function imageMime(buf: Buffer): string {
  if (buf.subarray(0, 4).equals(PNG)) return 'image/png'
  if (buf.subarray(0, 3).equals(JPG)) return 'image/jpeg'
  return 'image/png'
}

/** Read a per-step screenshot into an inline `data:` URI, or undefined when the
 *  path is unset / unreadable / oversized. Fail-soft: a missing frame drops that
 *  step's image, never the span (the navigation step still belongs in the film). */
async function inlineScreenshot(path: string | undefined, maxBytes: number): Promise<string | undefined> {
  if (!path) return undefined
  const buf = await readFile(path).catch(() => undefined)
  if (!buf || buf.length === 0 || buf.length > maxBytes) return undefined
  return `data:${imageMime(buf)};base64,${buf.toString('base64')}`
}

/**
 * Map a `BrowserRun` to a run-capsule-ready `Span[]`. Async because it reads the
 * step screenshots off disk. The returned trace is ordered by step index; the
 * agent's final answer (extraction tasks) becomes a trailing generic span so the
 * film closes on the result.
 */
export async function browserRunToSpans(
  run: BrowserRun,
  opts: BrowserRunToSpansOptions = {},
): Promise<Span[]> {
  const maxBytes = opts.maxScreenshotBytes ?? 8 * 1024 * 1024
  let ts = opts.startTs ?? 0
  const tick = (): number => (ts += 1)
  const runId = `browser-${run.taskId}`

  const spans: Span[] = []
  for (const step of run.steps) {
    const action = step.action || 'navigate'
    const screenshot = await inlineScreenshot(step.screenshotPath, maxBytes)
    const startedAt = tick()
    spans.push({
      spanId: `s-${step.index}`,
      runId,
      kind: 'tool',
      name: `browser ${action}`,
      toolName: `browser.${action}`,
      args: { url: step.url, target: step.target, reasoning: step.reasoning },
      startedAt,
      endedAt: tick(),
      status: 'ok',
      // attributes is the run-capsule contract: inline base64 screenshot + the
      // action box for a replay cursor overlay. Only set keys that are present.
      attributes: {
        ...(screenshot ? { screenshot } : {}),
        ...(step.actionBounds ? { actionBounds: step.actionBounds } : {}),
      },
    } as Span)
  }

  if (run.answer) {
    const startedAt = tick()
    spans.push({
      spanId: 's-answer',
      runId,
      kind: 'custom',
      name: 'final answer',
      startedAt,
      endedAt: tick(),
      status: 'ok',
      attributes: { answer: run.answer, finalUrl: run.finalUrl },
    } as Span)
  }

  return spans
}
