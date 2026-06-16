/**
 * createWaterfallCollector — 100% trajectory observability from the lifecycle stream:
 * every spawn/settle (shots, analysts, nested agents) becomes one timed, billed span.
 * The sum of spans IS the run's cost story — what each step cost in dollars, tokens,
 * and wall-clock, rendered as a text waterfall or exported as structured rows for any
 * chart. Attach the collector's `hooks` to `runAgentic`/`runBenchmark`; spans accumulate
 * across every task the hooks observe.
 */
import type { RuntimeHookEvent, RuntimeHooks } from '../runtime-hooks'

export interface WaterfallSpan {
  id: string
  /** The spawn label (`shot:0`, `analyst:1`, a nested agent's label) — the row name. */
  label: string
  runId: string
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
  /** Wall-clock of the observed window (first spawn → last settle). */
  totalMs: number
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
  score?: number
  spent?: { usd?: number; tokens?: { input?: number; output?: number } }
}

export interface WaterfallCollector {
  /** Attach these to RunAgenticOptions.hooks / BenchmarkConfig.hooks. */
  hooks: RuntimeHooks
  report(): WaterfallReport
  /** The text waterfall — one row per span, bars scaled to the observed window. */
  render(opts?: { width?: number; maxRows?: number }): string
  reset(): void
}

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

  const report = (): WaterfallReport => {
    const all = [...spans.values()].sort((a, b) => a.startMs - b.startMs)
    const start = all[0]?.startMs ?? 0
    const end = Math.max(start, ...all.map((s) => s.endMs ?? s.startMs))
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
      k.ms += (s.endMs ?? s.startMs) - s.startMs
      k.usd += s.usd
      k.tokens.input += s.tokens.input
      k.tokens.output += s.tokens.output
    }
    return { spans: all, totalMs: end - start, totalUsd, totalTokens, byKind }
  }

  const render = (opts?: { width?: number; maxRows?: number }): string => {
    const { spans: all, totalMs, totalUsd, byKind } = report()
    if (all.length === 0) return '(no spans observed)'
    const width = opts?.width ?? 48
    const maxRows = opts?.maxRows ?? 60
    const start = all[0]?.startMs ?? 0
    const scale = totalMs > 0 ? width / totalMs : 0
    const lines: string[] = []
    const labelWidth = Math.min(24, Math.max(...all.map((s) => s.label.length)) + 1)
    for (const s of all.slice(0, maxRows)) {
      const offset = Math.round((s.startMs - start) * scale)
      const dur = (s.endMs ?? s.startMs) - s.startMs
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
