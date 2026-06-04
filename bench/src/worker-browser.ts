/**
 * Mind2Web browser worker: one shot = the model, under the candidate authoring
 * DIRECTIVE, reads the task + candidate elements and commits to a single next
 * action (ELEMENT / ACTION / VALUE). The artifact is scored by the deterministic
 * mind2web judge (element-match + op/value match); the produced trace carries the
 * step's REAL page screenshot so run-capsule's screen capsule turns the run into a
 * film — the actual page the agent acted on, not a re-rendered DOM.
 *
 * `directive` is the GEPA-optimizable surface: a minimal element-selection
 * instruction with headroom for the optimizer to learn the discrimination moves
 * (prefer the element whose role/label matches the goal step, disambiguate
 * look-alikes) that move the deterministic Step-SR gate.
 *
 * Reports REAL token usage so the campaign's backend-integrity guard sees a real
 * backend, never a fabricated zero.
 */

import { readFile } from 'node:fs/promises'
import type { Span } from '@tangle-network/agent-eval'
import type { BenchTask } from './benchmarks/types'
import { routerChatWithUsage } from './router-client'

export interface BrowserLocalConfig {
  routerBaseUrl: string
  routerKey: string
  model: string
  /** The element-selection directive (system prompt) — the GEPA-optimizable surface. */
  directive?: string
}

export interface BrowserShot {
  /** The ELEMENT/ACTION/VALUE the model produced — the artifact the judge scores. */
  artifact: string
  trace: Span[]
  usage?: { input: number; output: number }
  ok: boolean
  detail?: string
}

/**
 * The hand-written baseline element-selection directive — the SURFACE the GEPA
 * loop optimizes. Deliberately minimal: states the job and the output contract,
 * not HOW to discriminate the right element, leaving headroom for the optimizer.
 */
export const DEFAULT_MIND2WEB_DIRECTIVE =
  'You are a web agent choosing the NEXT UI action toward the task goal. Read the task and the candidate elements, then pick the single element that makes progress and the correct action (CLICK, or TYPE/SELECT with a value). Respond with ONLY the three required lines.'

interface Mind2WebMetaView {
  task?: string
  website?: string
  screenshotPath?: string
}

/**
 * One element-selection shot under `directive`. Returns the artifact, REAL token
 * usage, and a screenshot-rich trace (task → chosen action → a browser.<op> span
 * carrying the page screenshot) for run-capsule.
 */
export async function solveBrowserLocal(task: BenchTask, cfg: BrowserLocalConfig): Promise<BrowserShot> {
  const directive = cfg.directive ?? DEFAULT_MIND2WEB_DIRECTIVE
  const meta = (task.metadata ?? {}) as Mind2WebMetaView
  const runId = `m2w-${task.id}`
  let ts = Date.now()
  const tick = () => (ts += 1)
  const trace: Span[] = []
  const goal = meta.task ?? task.prompt

  trace.push({ spanId: 's-task', runId, kind: 'llm', name: 'web task', model: cfg.model, messages: [{ role: 'user', content: goal }], startedAt: tick(), endedAt: tick(), status: 'ok' } as Span)

  const { content, usage } = await routerChatWithUsage(cfg, [
    { role: 'system', content: directive },
    { role: 'user', content: task.prompt },
  ])
  const artifact = content.trim()

  const elementId = /ELEMENT:\s*\[?(\d+)\]?/i.exec(artifact)?.[1] ?? ''
  const op = (/ACTION:\s*(CLICK|TYPE|SELECT)/i.exec(artifact)?.[1] ?? 'CLICK').toUpperCase()
  const value = (/VALUE:\s*(.*)/i.exec(artifact)?.[1] ?? '').trim()

  trace.push({ spanId: 's-reply', runId, kind: 'llm', name: 'choose action', model: cfg.model, messages: [{ role: 'user', content: goal }], output: artifact.slice(0, 400), startedAt: tick(), endedAt: tick(), status: 'ok' } as Span)

  let screenshot: string | undefined
  if (typeof meta.screenshotPath === 'string' && meta.screenshotPath) {
    const buf = await readFile(meta.screenshotPath).catch(() => undefined)
    if (buf) screenshot = `data:image/jpeg;base64,${buf.toString('base64')}`
  }
  const label = `${op}${value ? ` "${value.slice(0, 40)}"` : ''} element #${elementId}`
  trace.push({
    spanId: 's-act',
    runId,
    kind: 'tool',
    name: `browser ${op.toLowerCase()}`,
    toolName: `browser.${op.toLowerCase()}`,
    args: { action: label, url: meta.website ? `https://${meta.website}` : undefined, selector: `[backend_node_id="${elementId}"]` },
    attributes: screenshot ? { screenshot } : {},
    startedAt: tick(),
    endedAt: tick(),
    status: 'ok',
  } as Span)

  return { artifact, trace, usage, ok: artifact.length > 0, detail: label }
}
