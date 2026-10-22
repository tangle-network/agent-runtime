/**
 * createWaterfallCollector records timed spans from the spawn/settle lifecycle stream.
 * Settlement receipts supply each span's cost and tokens; nested manager receipts can
 * include child work, and separately metered manager inference is not captured here.
 * Render the observed spans as a text waterfall or export structured rows for a chart. Attach the collector's `hooks` to `runAgentic`/`runBenchmark`; spans accumulate
 * across every task the hooks observe.
 */
import type { RuntimeHookEvent, RuntimeHooks } from '../runtime-hooks'

export interface WaterfallSpan {
  id: string
  /** The spawn label (`shot:0`, `analyst:1`, a nested agent's label) — the row name. */
  label: string
  runId: string
  /** Parent agent node identity, matching another span id when that parent is observed. */
  parentId?: string
  startMs: number
  endMs?: number
  status: 'running' | 'done' | 'down'
  usd: number
  tokens: { input: number; output: number }
  score?: number
}

export interface WaterfallReport {
  spans: WaterfallSpan[]
  /** Instant used to measure spans that are still running. */
  observedAtMs: number
  /** Wall-clock from first spawn to last settle, or observation time while running. */
  totalMs: number
  /** Sum of observed settlement receipts; nested receipts may include the same child work. */
  totalUsd: number
  totalTokens: { input: number; output: number }
  /** Rollup by label prefix (the part before ':') — shots vs analysts vs anything else. */
  byKind: Record<
    string,
    { count: number; ms: number; usd: number; tokens: { input: number; output: number } }
  >
}

interface SpawnPayload {
  childId?: string
  label?: string
}
interface SettlePayload {
  childId?: string
  status?: string
  retainedExecution?: string
  score?: number
  spent?: { usd?: number; tokens?: { input?: number; output?: number } }
}

export interface WaterfallCollector {
  /** Attach these to RunAgenticOptions.hooks / BenchmarkConfig.hooks. */
  hooks: RuntimeHooks
  /** Snapshot at the current clock, or an explicit observation instant for replay. */
  report(opts?: { nowMs?: number }): WaterfallReport
  /** The text waterfall — one row per span, bars scaled to the observed window. */
  render(opts?: { width?: number; maxRows?: number; nowMs?: number }): string
  reset(): void
}

/** Build a `WaterfallCollector` that records agent spans and renders them as an ASCII timeline. */
export function createWaterfallCollector(): WaterfallCollector {
  let spans = new Map<string, WaterfallSpan>()

  const onEvent = (event: RuntimeHookEvent): void => {
    if (event.target === 'agent.spawn') {
      const p = (event.payload ?? {}) as SpawnPayload
      const id = p.childId ?? event.id
      spans.set(id, {
        id,
        label: p.label ?? id,
        runId: event.runId,
        ...(event.parentId !== undefined ? { parentId: event.parentId } : {}),
        startMs: event.timestamp,
        status: 'running',
        usd: 0,
        tokens: { input: 0, output: 0 },
      })
      return
    }
    if (event.target === 'agent.child') {
      const p = (event.payload ?? {}) as SettlePayload
      const id = p.childId
      if (!id) return
      const span = spans.get(id)
      if (!span) return
      // The release event's timestamp is the release instant, not the settlement; without this
      // guard a released child's bar would stretch to root settlement.
      if (span.endMs !== undefined && p.retainedExecution === 'released') return
      span.endMs = event.timestamp
      span.status = p.status === 'down' ? 'down' : 'done'
      span.usd = p.spent?.usd ?? 0
      span.tokens = {
        input: p.spent?.tokens?.input ?? 0,
        output: p.spent?.tokens?.output ?? 0,
      }
      if (typeof p.score === 'number') span.score = p.score
    }
  }

  const report = (opts?: { nowMs?: number }): WaterfallReport => {
    const observedAtMs = opts?.nowMs ?? Date.now()
    const all = [...spans.values()]
      .map((span) => ({ ...span, tokens: { ...span.tokens } }))
      .sort((a, b) => a.startMs - b.startMs)
    const start = all[0]?.startMs ?? 0
    const end = Math.max(start, ...all.map((s) => s.endMs ?? Math.max(s.startMs, observedAtMs)))
    const byKind: WaterfallReport['byKind'] = {}
    let totalUsd = 0
    const totalTokens = { input: 0, output: 0 }
    for (const s of all) {
      totalUsd += s.usd
      totalTokens.input += s.tokens.input
      totalTokens.output += s.tokens.output
      const kind = s.label.includes(':') ? (s.label.split(':')[0] as string) : s.label
      let k = byKind[kind]
      if (!k) {
        k = { count: 0, ms: 0, usd: 0, tokens: { input: 0, output: 0 } }
        byKind[kind] = k
      }
      k.count += 1
      k.ms += (s.endMs ?? Math.max(s.startMs, observedAtMs)) - s.startMs
      k.usd += s.usd
      k.tokens.input += s.tokens.input
      k.tokens.output += s.tokens.output
    }
    return { spans: all, observedAtMs, totalMs: end - start, totalUsd, totalTokens, byKind }
  }

  const render = (opts?: { width?: number; maxRows?: number; nowMs?: number }): string => {
    const { spans: all, observedAtMs, totalMs, totalUsd, byKind } = report(opts)
    if (all.length === 0) return '(no spans observed)'
    const width = opts?.width ?? 48
    const maxRows = opts?.maxRows ?? 60
    const start = all[0]?.startMs ?? 0
    const scale = totalMs > 0 ? width / totalMs : 0
    const lines: string[] = []
    const labelWidth = Math.min(24, Math.max(...all.map((s) => s.label.length)) + 1)
    for (const s of all.slice(0, maxRows)) {
      const offset = Math.round((s.startMs - start) * scale)
      const dur = (s.endMs ?? Math.max(s.startMs, observedAtMs)) - s.startMs
      const len = Math.max(1, Math.round(dur * scale))
      const bar = `${' '.repeat(Math.min(offset, width))}${(s.status === 'down' ? '░' : '█').repeat(Math.max(1, Math.min(len, width - Math.min(offset, width) + 1)))}`
      const mark =
        s.status === 'down'
          ? ' DOWN'
          : s.score !== undefined
            ? ` ${(s.score * 100).toFixed(0)}%`
            : ''
      lines.push(
        `${s.label.padEnd(labelWidth)}|${bar.padEnd(width + 1)}| ${(dur / 1000).toFixed(1)}s $${s.usd.toFixed(4)} ${s.tokens.input}/${s.tokens.output}tok${mark}`,
      )
    }
    if (all.length > maxRows) lines.push(`… ${all.length - maxRows} more spans`)
    lines.push('—'.repeat(labelWidth + width + 2))
    for (const [kind, k] of Object.entries(byKind)) {
      lines.push(
        `${kind.padEnd(labelWidth)} ×${k.count}  ${(k.ms / 1000).toFixed(1)}s busy  $${k.usd.toFixed(4)}  ${k.tokens.input}/${k.tokens.output}tok`,
      )
    }
    lines.push(
      `TOTAL${' '.repeat(labelWidth - 5)} ${(totalMs / 1000).toFixed(1)}s wall  $${totalUsd.toFixed(4)}`,
    )
    return lines.join('\n')
  }

  return {
    hooks: { onEvent },
    report,
    render,
    reset: () => {
      spans = new Map()
    },
  }
}
