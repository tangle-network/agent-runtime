import { supervisorRunsRoot } from '../runtime/supervise/run-layout'
import {
  aggregateSnapshot,
  numberValue,
  parseSpend,
  parseTime,
  type SupervisorView,
  type TopSnapshot,
  totalSpend,
  type WorkerView,
} from './top-snapshot'

export interface RenderOptions {
  readonly width?: number
  readonly height?: number
  readonly color?: boolean
  readonly selectedSupervisorId?: string
  readonly selectedWorkerId?: string
  readonly focus?: 'supervisors' | 'workers'
  readonly mode?: 'overview' | 'detail' | 'log'
  readonly notice?: string
  readonly steerInput?: {
    readonly active: boolean
    readonly value: string
    readonly workerLabel?: string
  }
}

export interface RenderTarget {
  readonly row: number
  readonly kind: 'supervisor' | 'worker'
  readonly id: string
  readonly supervisorId?: string
}

export interface RenderedTopFrame {
  readonly frame: string
  readonly targets: RenderTarget[]
}
// Width accounting depends on stripping SGR sequences, which begin with a literal ESC. Matching
// the control character is the point of an ANSI-aware renderer, not an accident.
// biome-ignore lint/suspicious/noControlCharactersInRegex: SGR sequences begin with ESC
const ansiPattern = /\x1b\[[0-9;?]*[ -/]*[@-~]/g

const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  inverse: '\x1b[7m',
}

/** Render one snapshot to an ANSI frame. Use this when nothing needs to be clickable. */
export function renderTopFrame(snapshot: TopSnapshot, options: RenderOptions = {}): string {
  return renderTopFrameWithLayout(snapshot, options).frame
}

/**
 * Render one snapshot, returning the frame together with the row→entity map a mouse click resolves
 * against. The layout is the only thing that knows which row is which run or worker, so emitting it
 * alongside the text is what keeps click handling out of the renderer.
 */
export function renderTopFrameWithLayout(
  snapshot: TopSnapshot,
  options: RenderOptions = {},
): RenderedTopFrame {
  const width = Math.max(88, options.width ?? 128)
  const height = Math.max(24, options.height ?? 42)
  const color = options.color ?? false
  const focus = options.focus ?? 'supervisors'
  const mode = options.mode ?? 'overview'
  const selectedSupervisor = selectSupervisor(snapshot, options.selectedSupervisorId)
  const selectedWorker = selectedSupervisor
    ? selectWorker(selectedSupervisor, options.selectedWorkerId)
    : undefined
  const targets: RenderTarget[] = []
  const lines: string[] = []

  const push = (line = '', target?: Omit<RenderTarget, 'row'>) => {
    if (lines.length >= height) return
    if (target) targets.push({ row: lines.length, ...target })
    lines.push(fitAnsi(line, width))
  }

  const aggregate = aggregateSnapshot(snapshot)
  push(
    `${paint('SUPERVISOR TOP', 'bold', color)} ${paint(snapshot.root, 'dim', color)}  ` +
      `runs ${aggregate.supervisors}  workers ${aggregate.workers}  live ${aggregate.running}  ` +
      `done ${aggregate.done}  down ${aggregate.down}  ` +
      `${formatMoney(aggregate.usd)}  tok ${formatTokens(aggregate.tokensInput)}/${formatTokens(aggregate.tokensOutput)}`,
  )
  push(
    `${paint('keys', 'dim', color)} up/down select  left/right run  tab focus  enter detail  o overview  l log  s steer  c cancel  mouse  q quit`,
  )
  if (options.notice) push(paint(options.notice, 'yellow', color))
  if (snapshot.completeness === 'partial')
    push(
      paint(
        `partial snapshot: ${snapshot.diagnostics.length} source${
          snapshot.diagnostics.length === 1 ? '' : 's'
        } skipped or truncated; runs loaded ${snapshot.loaded}/${snapshot.discovered}`,
        'yellow',
        color,
      ),
    )
  if (options.steerInput?.active) push(renderSteerInput(options.steerInput, width, color))
  push(rule(width, color))

  if (snapshot.supervisors.length === 0) {
    if (snapshot.discovered > 0) {
      push(paint('NO READABLE SUPERVISORS', 'yellow', color))
      push(
        `${snapshot.discovered} run director${snapshot.discovered === 1 ? 'y' : 'ies'} found under ${supervisorRunsRoot(snapshot.root)}, none readable`,
      )
    } else {
      push(paint('NO SUPERVISORS', 'yellow', color))
      push(`No run state under ${supervisorRunsRoot(snapshot.root)}`)
    }
    push(
      `A run appears here once its driver writes state.json; re-point with: agent-runtime-top <root>`,
    )
    return { frame: `${lines.join('\n')}\n`, targets }
  }

  push(sectionTitle('SUPERVISORS', focus === 'supervisors', color))
  push(
    `  id                    status       workers       spend        tok in/out       latency      task`,
  )
  for (const supervisor of snapshot.supervisors.slice(0, 9)) {
    const selected = supervisor.id === selectedSupervisor?.id
    const status = statusText(supervisor.status, color)
    const pointer = selected ? paint('>', 'cyan', color) : ' '
    const rowFocus = selected && focus === 'supervisors' ? 'inverse' : undefined
    const workerSummary = `${supervisor.totals.running}/${supervisor.totals.workers} live`
    const task = compact(supervisor.task, 34)
    const line =
      `${pointer} ${pad(supervisor.id, 21)} ${pad(status, 12)} ${pad(workerSummary, 13)} ` +
      `${pad(formatMoney(supervisor.totals.usd), 12)} ` +
      `${pad(`${formatTokens(supervisor.totals.tokensInput)}/${formatTokens(supervisor.totals.tokensOutput)}`, 16)} ` +
      `${pad(formatDuration(supervisor.totals.latencyMs), 12)} ${task}`
    push(rowFocus ? paint(line, rowFocus, color) : line, { kind: 'supervisor', id: supervisor.id })
  }

  if (!selectedSupervisor) return { frame: `${lines.join('\n')}\n`, targets }

  push()
  push(sectionTitle(`WORKERS ${selectedSupervisor.id}`, focus === 'workers', color))
  push(
    `  id           state        runtime    latency      cost        tok in/out       score     detail`,
  )
  for (const worker of selectedSupervisor.workers.slice(0, 12)) {
    const selected = worker.id === selectedWorker?.id
    const pointer = selected ? paint('>', 'cyan', color) : ' '
    const rowFocus = selected && focus === 'workers' ? 'inverse' : undefined
    const score = worker.verdict ?? (worker.status === 'done' ? 'done' : worker.status)
    const detail = worker.reason ?? worker.outRef ?? worker.parent ?? ''
    const spend = totalSpend(worker)
    const line =
      `${pointer} ${pad(worker.label, 12)} ${pad(statusText(worker.status, color), 12)} ` +
      `${pad(worker.runtime ?? '-', 10)} ${pad(formatDuration(worker.latencyMs), 12)} ` +
      `${pad(formatMoney(spend.usd), 11)} ` +
      `${pad(`${formatTokens(spend.tokensInput)}/${formatTokens(spend.tokensOutput)}`, 16)} ` +
      `${pad(compact(score, 9), 10)} ${compact(detail, 30)}`
    push(rowFocus ? paint(line, rowFocus, color) : line, {
      kind: 'worker',
      id: worker.id,
      supervisorId: selectedSupervisor.id,
    })
  }
  if (selectedSupervisor.workers.length === 0) push('  no workers spawned yet')

  push()
  push(sectionTitle('OBSERVABILITY', false, color))
  for (const line of renderStatusBars(selectedSupervisor, width, color)) push(line)
  push()
  for (const line of renderCostBars(selectedSupervisor, width, color)) push(line)
  push()
  for (const line of renderTokenBars(selectedSupervisor, width, color)) push(line)
  push()
  for (const line of renderLatencyHistogram(selectedSupervisor, width, color)) push(line)

  push()
  if (mode === 'log') {
    push(sectionTitle('JOURNAL TAIL', false, color))
    for (const line of renderJournalTail(selectedSupervisor, width, color)) push(line)
  } else {
    push(sectionTitle(mode === 'detail' ? 'DETAIL' : 'RUN SUMMARY', false, color))
    for (const line of renderDetail(selectedSupervisor, selectedWorker, mode, width, color))
      push(line)
  }

  return { frame: `${lines.join('\n')}\n`, targets }
}

function renderStatusBars(supervisor: SupervisorView, width: number, color: boolean): string[] {
  const total = Math.max(1, supervisor.totals.workers)
  const barWidth = Math.max(12, Math.min(28, width - 58))
  return [
    `status  ` +
      `${pad('running', 9)} ${bar(supervisor.totals.running, total, barWidth, '#', color, 'yellow')} ${supervisor.totals.running}` +
      `   ${pad('done', 5)} ${bar(supervisor.totals.done, total, barWidth, '#', color, 'green')} ${supervisor.totals.done}` +
      `   ${pad('down', 5)} ${bar(supervisor.totals.down, total, barWidth, '#', color, 'red')} ${supervisor.totals.down}`,
  ]
}

function renderCostBars(supervisor: SupervisorView, width: number, color: boolean): string[] {
  const workers = supervisor.workers
    .map((worker) => ({ worker, spend: totalSpend(worker) }))
    .sort((a, b) => b.spend.usd - a.spend.usd)
    .slice(0, 6)
  const maxUsd = Math.max(
    0.000001,
    ...workers.map((row) => row.spend.usd),
    supervisor.driverSpend.usd,
  )
  const out = [
    `cost   total ${formatMoney(supervisor.totals.usd)}  driver ${formatMoney(supervisor.driverSpend.usd)}`,
  ]
  const barWidth = Math.max(18, Math.min(46, width - 38))
  for (const row of workers) {
    out.push(
      `  ${pad(row.worker.label, 12)} ${bar(row.spend.usd, maxUsd, barWidth, '$', color, 'magenta')} ${formatMoney(row.spend.usd)}`,
    )
  }
  if (workers.length === 0) out.push('  no worker cost yet')
  return out
}

function renderTokenBars(supervisor: SupervisorView, width: number, color: boolean): string[] {
  const rows = supervisor.workers
    .map((worker) => ({
      worker,
      spend: totalSpend(worker),
      total: totalSpend(worker).tokensInput + totalSpend(worker).tokensOutput,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6)
  const maxTokens = Math.max(
    1,
    ...rows.map((row) => row.total),
    supervisor.driverSpend.tokensInput + supervisor.driverSpend.tokensOutput,
  )
  const out = [
    `tokens total in ${formatTokens(supervisor.totals.tokensInput)} / out ${formatTokens(supervisor.totals.tokensOutput)}  ` +
      `driver ${formatTokens(supervisor.driverSpend.tokensInput)}/${formatTokens(supervisor.driverSpend.tokensOutput)}`,
  ]
  const barWidth = Math.max(18, Math.min(46, width - 44))
  for (const row of rows) {
    out.push(
      `  ${pad(row.worker.label, 12)} ${stackedTokenBar(row.spend.tokensInput, row.spend.tokensOutput, maxTokens, barWidth, color)} ` +
        `${formatTokens(row.spend.tokensInput)}/${formatTokens(row.spend.tokensOutput)}`,
    )
  }
  if (rows.length === 0) out.push('  no worker tokens yet')
  return out
}

function renderLatencyHistogram(
  supervisor: SupervisorView,
  width: number,
  color: boolean,
): string[] {
  const values = supervisor.workers.map((worker) => worker.latencyMs).filter((value) => value > 0)
  const summary = supervisor.totals.workerLatency
  const out = [
    `latency n=${summary.n}  min ${formatDuration(summary.min)}  p50 ${formatDuration(summary.median)}  ` +
      `p90 ${formatDuration(summary.p90)}  max ${formatDuration(summary.max)}`,
  ]
  if (values.length === 0) {
    out.push('  no latency samples yet')
    return out
  }
  const bins = histogram(values, 6)
  const maxCount = Math.max(1, ...bins.map((bin) => bin.count))
  const barWidth = Math.max(18, Math.min(48, width - 34))
  for (const bin of bins) {
    out.push(
      `  ${pad(`${formatDuration(bin.min)}-${formatDuration(bin.max)}`, 15)} ` +
        `${bar(bin.count, maxCount, barWidth, '#', color, 'blue')} ${bin.count}`,
    )
  }
  return out
}

function renderDetail(
  supervisor: SupervisorView,
  worker: WorkerView | undefined,
  mode: 'overview' | 'detail' | 'log',
  width: number,
  color: boolean,
): string[] {
  if (mode === 'detail' && worker) {
    const spend = totalSpend(worker)
    return [
      `worker ${paint(worker.label, 'bold', color)} (${worker.id})  ${statusText(worker.status, color)}  latency ${formatDuration(worker.latencyMs)}`,
      `tokens in/out ${formatTokens(spend.tokensInput)}/${formatTokens(spend.tokensOutput)}  cost ${formatMoney(spend.usd)}  iterations ${spend.iterations}`,
      `parent ${worker.parent ?? '-'}  runtime ${worker.runtime ?? '-'}  out ${worker.outRef ?? '-'}${worker.infra ? '  infra' : ''}`,
      `events ${compact(worker.eventFile ?? '-', width - 8)}`,
      ...(worker.reason ? [`reason ${compact(worker.reason, width - 7)}`] : []),
      ...renderWorkerTail(worker, width, color),
    ]
  }

  const caps = [
    supervisor.maxSandboxes !== undefined ? `boxes ${supervisor.maxSandboxes}` : undefined,
    supervisor.maxUsd !== undefined ? `max ${formatMoney(supervisor.maxUsd)}` : undefined,
    supervisor.maxDepth !== undefined ? `depth ${supervisor.maxDepth}` : undefined,
    supervisor.maxLifetimeSeconds !== undefined
      ? `ttl ${supervisor.maxLifetimeSeconds}s`
      : undefined,
  ].filter((value): value is string => value !== undefined)
  return [
    `task ${compact(supervisor.task, width - 7)}`,
    `workspace ${compact(supervisor.workspaceDir, width - 12)}`,
    `verify ${compact(supervisor.verifyCmd ?? '-', width - 9)}`,
    `models worker ${supervisor.workerModel ?? '-'} / driver ${supervisor.driverModel ?? '-'}  caps ${caps.join(' | ') || '-'}`,
    `progress ${compact(supervisor.progress ?? supervisor.verdict ?? supervisor.status, width - 10)}`,
  ]
}

function renderJournalTail(supervisor: SupervisorView, width: number, color: boolean): string[] {
  if (supervisor.journalTail.length === 0) return ['  no journal events yet']
  return supervisor.journalTail.map((event) => {
    const at = event.at ? formatClock(event.at) : '--:--:--'
    if (event.kind === 'spawned')
      return `  ${at} ${paint('spawn', 'yellow', color)}  ${pad(event.label ?? event.id, 16)} ${event.id}`
    if (event.kind === 'settled') {
      const spend = parseSpend(event.spent)
      return `  ${at} ${statusText(event.status ?? 'settled', color)} ${pad(event.id, 18)} ${formatMoney(spend.usd)} ${formatTokens(spend.tokensInput)}/${formatTokens(spend.tokensOutput)}`
    }
    if (event.kind === 'metered') {
      const spend = parseSpend(event.spend)
      return `  ${at} ${paint('meter', 'cyan', color)}  ${pad(event.id, 18)} ${formatMoney(spend.usd)} ${formatTokens(spend.tokensInput)}/${formatTokens(spend.tokensOutput)}`
    }
    if (event.kind === 'progress') {
      const spend = parseSpend(event.spend)
      return `  ${at} ${paint('live', 'blue', color)}   ${pad(event.id, 18)} ${formatMoney(spend.usd)} ${formatTokens(spend.tokensInput)}/${formatTokens(spend.tokensOutput)}`
    }
    return `  ${at} ${paint('cancel', 'red', color)} ${pad(event.id, 18)} ${compact(event.reason ?? '', width - 32)}`
  })
}

function renderWorkerTail(worker: WorkerView, width: number, color: boolean): string[] {
  if (worker.liveTail.length === 0) return ['live events: none recorded yet']
  return [
    'live events:',
    ...worker.liveTail
      .slice(-5)
      .map((line) => `  ${paint(compact(formatWorkerEvent(line), width - 2), 'dim', color)}`),
  ]
}

function renderSteerInput(
  input: NonNullable<RenderOptions['steerInput']>,
  width: number,
  color: boolean,
): string {
  const target = input.workerLabel ?? '-'
  const value = compact(input.value, Math.max(10, width - target.length - 14))
  return `${paint('steer', 'cyan', color)} ${target} > ${value}${paint('_', 'inverse', color)}`
}

function formatWorkerEvent(line: string): string {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>
    const at = typeof parsed.at === 'string' ? formatClock(parsed.at) : '--:--:--'
    const kind = typeof parsed.kind === 'string' ? parsed.kind : 'event'
    if (kind === 'progress')
      return `${at} progress iter ${numberValue(parsed.iteration)} ${String(parsed.phase ?? '')}`
    if (kind === 'message') {
      const state = parsed.queued === true ? 'queued' : 'sent'
      const source =
        typeof parsed.source === 'string' && parsed.source.length > 0 ? `${parsed.source} ` : ''
      const message =
        typeof parsed.message === 'string' && parsed.message.length > 0 ? ` ${parsed.message}` : ''
      return `${at} ${source}steer ${state} delivered=${String(parsed.delivered)}${message}`
    }
    if (kind === 'verify') {
      return `${at} verify passed=${String(parsed.passed)} exit=${String(parsed.exitCode ?? '-')}${evidenceSnippet(parsed.outputTail, 160)}`
    }
    if (kind === 'finished') {
      const branch = typeof parsed.branch === 'string' ? ` branch=${parsed.branch}` : ''
      const files = typeof parsed.filesChanged === 'number' ? ` files=${parsed.filesChanged}` : ''
      const tests =
        typeof parsed.testPassed === 'boolean' ? ` tests=${String(parsed.testPassed)}` : ''
      return `${at} finished passed=${String(parsed.passed)} patchBytes=${numberValue(parsed.patchBytes)}${files}${tests}${branch}${evidenceSnippet(parsed.evidence, 220)}`
    }
    if (kind === 'error') return `${at} error ${String(parsed.error ?? '')}`
    return `${at} ${kind}`
  } catch {
    return line
  }
}

/** One-line the settle evidence / verify tail a worker event carries so the
 *  failure is legible in the tail view (the full block stays in the ndjson). */
function evidenceSnippet(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const oneLine = value.replace(/\s+/g, ' ').trim()
  return oneLine ? ` :: ${compact(oneLine, max)}` : ''
}

function histogram(
  values: readonly number[],
  count: number,
): Array<{ min: number; max: number; count: number }> {
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (min === max) return [{ min, max, count: values.length }]
  const step = (max - min) / count
  return Array.from({ length: count }, (_, index) => {
    const low = min + step * index
    const high = index === count - 1 ? max : min + step * (index + 1)
    const binCount = values.filter(
      (value) => value >= low && (index === count - 1 ? value <= high : value < high),
    ).length
    return { min: low, max: high, count: binCount }
  }).filter((bin) => bin.count > 0)
}

function bar(
  value: number,
  max: number,
  width: number,
  ch: string,
  color: boolean,
  colorName: keyof typeof colors,
): string {
  const filled = Math.max(0, Math.min(width, Math.round((value / Math.max(max, 0.000001)) * width)))
  const text = ch.repeat(filled).padEnd(width, '.')
  return paint(text, colorName, color)
}

function stackedTokenBar(
  input: number,
  output: number,
  max: number,
  width: number,
  color: boolean,
): string {
  const inputWidth = Math.round((input / Math.max(max, 1)) * width)
  const outputWidth = Math.round((output / Math.max(max, 1)) * width)
  const clippedInput = Math.min(width, inputWidth)
  const clippedOutput = Math.min(width - clippedInput, outputWidth)
  const rest = Math.max(0, width - clippedInput - clippedOutput)
  return `${paint('#'.repeat(clippedInput), 'cyan', color)}${paint('+'.repeat(clippedOutput), 'green', color)}${'.'.repeat(rest)}`
}

function sectionTitle(title: string, focused: boolean, color: boolean): string {
  const text = focused ? `[${title}]` : title
  return paint(text, focused ? 'cyan' : 'bold', color)
}

function statusText(status: string, color: boolean): string {
  if (['completed', 'done', 'delivered', 'valid'].includes(status))
    return paint(status.toUpperCase(), 'green', color)
  if (['failed', 'down', 'cancelled', 'invalid', 'error'].includes(status))
    return paint(status.toUpperCase(), 'red', color)
  if (['running', 'spawned', 'settled'].includes(status))
    return paint(status.toUpperCase(), 'yellow', color)
  return paint(status.toUpperCase(), 'white', color)
}

function selectSupervisor(
  snapshot: TopSnapshot,
  requested: string | undefined,
): SupervisorView | undefined {
  if (requested) {
    const found = snapshot.supervisors.find((supervisor) => supervisor.id === requested)
    if (found) return found
  }
  return snapshot.supervisors[0]
}

function selectWorker(
  supervisor: SupervisorView,
  requested: string | undefined,
): WorkerView | undefined {
  if (requested) {
    const found = supervisor.workers.find((worker) => worker.id === requested)
    if (found) return found
  }
  return supervisor.workers[0]
}

function formatClock(value: string): string {
  const parsed = parseTime(value)
  if (parsed === undefined) return '--:--:--'
  return new Date(parsed).toISOString().slice(11, 19)
}

function formatMoney(value: number): string {
  if (value === 0) return '$0'
  if (Math.abs(value) < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return `${Math.round(value)}`
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`
  const minutes = seconds / 60
  if (minutes < 60) return `${minutes.toFixed(minutes < 10 ? 1 : 0)}m`
  return `${(minutes / 60).toFixed(1)}h`
}

function compact(value: string, width: number): string {
  if (width <= 1) return ''
  if (value.length <= width) return value
  return `${value.slice(0, width - 1)}~`
}

function pad(value: string, width: number): string {
  const visible = visibleLength(value)
  if (visible >= width) return fitAnsi(value, width)
  return `${value}${' '.repeat(width - visible)}`
}

function rule(width: number, color: boolean): string {
  return paint('-'.repeat(width), 'dim', color)
}

function paint(
  value: string,
  colorName: keyof typeof colors | undefined,
  enabled: boolean,
): string {
  if (!enabled || !colorName) return value
  return `${colors[colorName]}${value}${colors.reset}`
}

function visibleLength(value: string): number {
  return stripAnsi(value).length
}

function stripAnsi(value: string): string {
  return value.replace(ansiPattern, '')
}

function fitAnsi(value: string, width: number): string {
  if (visibleLength(value) <= width) return value
  let out = ''
  let visible = 0
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]
    if (ch === '\x1b') {
      const rest = value.slice(i)
      // An escape sequence must be copied whole and counted as zero visible columns; truncating
      // inside one would emit a half-sequence the terminal interprets against the next line.
      // biome-ignore lint/suspicious/noControlCharactersInRegex: SGR sequences begin with ESC
      const match = /^\x1b\[[0-9;?]*[ -/]*[@-~]/.exec(rest)
      if (match) {
        out += match[0]
        i += match[0].length - 1
        continue
      }
    }
    if (visible >= width - 1) {
      out += '~'
      break
    }
    out += ch
    visible += 1
  }
  if (out.includes('\x1b[') && !out.endsWith(colors.reset)) out += colors.reset
  return out
}
