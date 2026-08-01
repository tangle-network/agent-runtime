/**
 * The interactive side of the supervisor-run TUI: a keypress/mouse loop over the frames
 * `./top-model` renders, plus the two operator controls that write back to the run — steer a live
 * worker, and request cancellation of a run.
 *
 * Both controls go through the owned run layout: steers via `writeWorkerSteer` (the durable inbox
 * append), cancellation via a file inside the run directory the snapshot reported. Nothing here
 * joins a path from the workspace root.
 *
 * Extracted from the `loops` repo (`src/top.ts`). The module-level singletons are the origin's
 * shape and are kept: this drives one terminal, and `runTopApp` is its one entry point.
 *
 * @experimental
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { emitKeypressEvents } from 'node:readline'
import { writeWorkerSteer } from '../runtime/supervise/run-layout'
import {
  loadTopSnapshot,
  type RenderTarget,
  renderTopFrameWithLayout,
  type TopSnapshot,
} from './top-model'

interface UiState {
  root: string
  color: boolean
  focus: 'supervisors' | 'workers'
  mode: 'overview' | 'detail' | 'log'
  selectedSupervisorId: string | undefined
  selectedWorkerId: string | undefined
  notice: string | undefined
  steerInput: {
    active: boolean
    value: string
  }
}

/** @experimental How the app was invoked. Defaults read `process.argv` / `process.cwd()`. */
export interface TopAppOptions {
  readonly argv?: readonly string[]
  readonly cwd?: string
}

let state: UiState = initialState([], process.cwd())
let snapshot: TopSnapshot = { root: state.root, generatedAt: 0, supervisors: [] }
let targets: RenderTarget[] = []
let timer: NodeJS.Timeout | undefined

/**
 * Render exactly one frame and return it. This is the non-interactive path — `--once`, a pipe, a
 * test — so it never touches raw mode, the alternate screen, or `process.exit`.
 */
export function renderTopOnce(options: TopAppOptions = {}): string {
  const args = [...(options.argv ?? process.argv.slice(2))]
  state = initialState(args, options.cwd ?? process.cwd())
  snapshot = loadTopSnapshot(state.root)
  clampSelection()
  return renderTopFrameWithLayout(snapshot, {
    color: state.color,
    width: process.stdout.columns ?? 128,
    focus: state.focus,
    mode: state.mode,
    ...(state.selectedSupervisorId ? { selectedSupervisorId: state.selectedSupervisorId } : {}),
    ...(state.selectedWorkerId ? { selectedWorkerId: state.selectedWorkerId } : {}),
    steerInput: renderSteerInputState(),
  }).frame
}

/**
 * Run the TUI. With a TTY on both ends and no `--once` this takes over the terminal until `q`;
 * otherwise it writes a single frame to stdout and returns.
 */
export function runTopApp(options: TopAppOptions = {}): void {
  const args = [...(options.argv ?? process.argv.slice(2))]
  if (!process.stdout.isTTY || !process.stdin.isTTY || args.includes('--once')) {
    process.stdout.write(renderTopOnce(options))
    return
  }
  state = initialState(args, options.cwd ?? process.cwd())
  snapshot = loadTopSnapshot(state.root)
  start()
}

function initialState(args: readonly string[], cwd: string): UiState {
  const rootArg = args.find((arg) => !arg.startsWith('-'))
  return {
    root: resolve(rootArg ?? cwd),
    color: Boolean(process.stdout.isTTY) && !args.includes('--no-color'),
    focus: args.includes('--detail') ? 'workers' : 'supervisors',
    mode: args.includes('--log') ? 'log' : args.includes('--detail') ? 'detail' : 'overview',
    selectedSupervisorId: undefined,
    selectedWorkerId: undefined,
    notice: undefined,
    steerInput: { active: false, value: '' },
  }
}

function start(): void {
  process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h')
  emitKeypressEvents(process.stdin)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.on('keypress', onKey)
  process.stdin.on('data', onData)
  process.on('SIGINT', stop)
  draw()
  timer = setInterval(draw, 1000)
}

function stop(): void {
  if (timer) clearInterval(timer)
  process.stdin.setRawMode(false)
  process.stdout.write('\x1b[?1000l\x1b[?1006l\x1b[?25h\x1b[?1049l')
  process.exit(0)
}

function pauseUi(): void {
  if (timer) {
    clearInterval(timer)
    timer = undefined
  }
  process.stdin.setRawMode(false)
  process.stdin.pause()
  process.stdout.write('\x1b[?1000l\x1b[?1006l\x1b[?25h\x1b[?1049l')
}

function resumeUi(): void {
  process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h')
  process.stdin.setRawMode(true)
  process.stdin.resume()
  draw()
  timer = setInterval(draw, 1000)
}

function draw(): void {
  snapshot = loadTopSnapshot(state.root)
  clampSelection()
  const rendered = renderTopFrameWithLayout(snapshot, {
    width: process.stdout.columns ?? 128,
    height: process.stdout.rows ?? 42,
    color: state.color,
    focus: state.focus,
    mode: state.mode,
    ...(state.notice ? { notice: state.notice } : {}),
    ...(state.selectedSupervisorId ? { selectedSupervisorId: state.selectedSupervisorId } : {}),
    ...(state.selectedWorkerId ? { selectedWorkerId: state.selectedWorkerId } : {}),
    steerInput: renderSteerInputState(),
  })
  targets = rendered.targets
  process.stdout.write(`\x1b[2J\x1b[H${rendered.frame}`)
}

function onKey(str: string, key: { name?: string; ctrl?: boolean }): void {
  state.notice = undefined
  if (key.ctrl && key.name === 'c') stop()
  if (state.steerInput.active) {
    handleSteerInput(str, key)
    draw()
    return
  }
  if (key.name === 'q' || key.name === 'escape') stop()
  if (key.name === 'tab') {
    state.focus = state.focus === 'supervisors' ? 'workers' : 'supervisors'
  } else if (key.name === 'up') {
    moveSelection(-1)
  } else if (key.name === 'down') {
    moveSelection(1)
  } else if (key.name === 'left') {
    moveSupervisor(-1)
  } else if (key.name === 'right') {
    moveSupervisor(1)
  } else if (key.name === 'return') {
    state.mode = 'detail'
    state.focus = 'workers'
  } else if (key.name === 'o') {
    state.mode = 'overview'
  } else if (key.name === 'l') {
    state.mode = 'log'
  } else if (key.name === 's') {
    startSteerInput()
  } else if (key.name === 'a') {
    state.mode = 'detail'
    openWorkerShell()
  } else if (key.name === 'c') {
    requestCancel()
  }
  draw()
}

function handleSteerInput(str: string, key: { name?: string; ctrl?: boolean }): void {
  if (key.name === 'escape') {
    state.steerInput = { active: false, value: '' }
    return
  }
  if (key.name === 'return') {
    submitSteerInput()
    return
  }
  if (key.name === 'backspace') {
    state.steerInput.value = state.steerInput.value.slice(0, -1)
    return
  }
  if (key.ctrl && key.name === 'u') {
    state.steerInput.value = ''
    return
  }
  if (
    key.ctrl ||
    key.name === 'tab' ||
    key.name === 'up' ||
    key.name === 'down' ||
    key.name === 'left' ||
    key.name === 'right'
  ) {
    return
  }
  if (!str || str === '\r' || str === '\n') return
  if ([...str].every((char) => char >= ' ' && char !== '\x7f')) state.steerInput.value += str
}

function onData(data: Buffer): void {
  const click = parseMouse(data.toString('utf8'))
  if (!click) return
  const target = targets.find((candidate) => candidate.row === click.row)
  if (!target) return
  state.notice = undefined
  if (target.kind === 'supervisor') {
    state.focus = 'supervisors'
    state.selectedSupervisorId = target.id
    state.selectedWorkerId = undefined
  } else {
    state.focus = 'workers'
    state.mode = 'detail'
    state.selectedSupervisorId = target.supervisorId
    state.selectedWorkerId = target.id
  }
  draw()
}

function startSteerInput(): void {
  state.mode = 'detail'
  state.focus = 'workers'
  if (!selectedSupervisor()) {
    state.notice = 'no supervisor selected'
    return
  }
  if (!selectedWorker()) {
    state.notice = 'no worker selected'
    return
  }
  state.steerInput = { active: true, value: '' }
}

function submitSteerInput(): void {
  const supervisor = selectedSupervisor()
  const worker = selectedWorker()
  const message = state.steerInput.value
  state.steerInput = { active: false, value: '' }
  if (!supervisor) {
    state.notice = 'no supervisor selected'
    return
  }
  if (!worker) {
    state.notice = 'no worker selected'
    return
  }
  try {
    // The snapshot already carries the worker LABEL the layout keys inboxes by, so this is the
    // direct durable append with no id-to-label resolution step in between.
    const written = writeWorkerSteer(state.root, supervisor.id, worker.label, message, 'human')
    state.notice = `steer queued for ${supervisor.id}/${written.worker}`
  } catch (err) {
    state.notice = `steer failed: ${err instanceof Error ? err.message : String(err)}`
  }
}

function parseMouse(raw: string): { col: number; row: number } | undefined {
  // ESC is the literal first byte of an SGR mouse report; matching the control character IS the
  // parse, so the control-character rule does not apply to a terminal escape decoder.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: SGR mouse reports begin with ESC
  const match = /\x1b\[<(\d+);(\d+);(\d+)([mM])/.exec(raw)
  if (match?.[4] !== 'M') return undefined
  const col = Number(match[2])
  const row = Number(match[3])
  if (!Number.isFinite(col) || !Number.isFinite(row)) return undefined
  return { col: col - 1, row: row - 1 }
}

function moveSelection(delta: number): void {
  if (state.focus === 'supervisors') {
    moveSupervisor(delta)
    return
  }
  const supervisor = selectedSupervisor()
  if (!supervisor || supervisor.workers.length === 0) return
  const current = Math.max(
    0,
    supervisor.workers.findIndex((worker) => worker.id === state.selectedWorkerId),
  )
  const next = wrap(current + delta, supervisor.workers.length)
  const worker = supervisor.workers[next]
  if (worker) state.selectedWorkerId = worker.id
}

function moveSupervisor(delta: number): void {
  if (snapshot.supervisors.length === 0) return
  const current = Math.max(
    0,
    snapshot.supervisors.findIndex((supervisor) => supervisor.id === state.selectedSupervisorId),
  )
  const next = wrap(current + delta, snapshot.supervisors.length)
  const supervisor = snapshot.supervisors[next]
  if (!supervisor) return
  state.selectedSupervisorId = supervisor.id
  state.selectedWorkerId = supervisor.workers[0]?.id
}

function clampSelection(): void {
  if (snapshot.supervisors.length === 0) {
    state.selectedSupervisorId = undefined
    state.selectedWorkerId = undefined
    return
  }
  const supervisor = selectedSupervisor() ?? snapshot.supervisors[0]
  if (!supervisor) return
  state.selectedSupervisorId = supervisor.id
  const worker =
    supervisor.workers.find((candidate) => candidate.id === state.selectedWorkerId) ??
    supervisor.workers[0]
  state.selectedWorkerId = worker?.id
}

function selectedSupervisor(): TopSnapshot['supervisors'][number] | undefined {
  return snapshot.supervisors.find((supervisor) => supervisor.id === state.selectedSupervisorId)
}

function selectedWorker(): TopSnapshot['supervisors'][number]['workers'][number] | undefined {
  const supervisor = selectedSupervisor()
  return supervisor?.workers.find((worker) => worker.id === state.selectedWorkerId)
}

function renderSteerInputState(): { active: boolean; value: string; workerLabel?: string } {
  const worker = selectedWorker()
  return {
    active: state.steerInput.active,
    value: state.steerInput.value,
    ...(worker?.label ? { workerLabel: worker.label } : {}),
  }
}

function openWorkerShell(): void {
  const worker = selectedWorker()
  if (!worker?.cwd) {
    state.notice = 'no worker worktree recorded yet'
    return
  }
  if (!existsSync(worker.cwd)) {
    state.notice = `worker worktree is gone: ${worker.cwd}`
    return
  }
  const shell = process.env.SHELL ?? '/bin/bash'
  state.notice = `returned from ${worker.label}`
  pauseUi()
  spawnSync(shell, [], {
    cwd: worker.cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      AGENT_SUPERVISOR_ROOT: state.root,
      AGENT_SUPERVISOR_ID: state.selectedSupervisorId ?? '',
      AGENT_WORKER_ID: worker.id,
      AGENT_WORKER_LABEL: worker.label,
    },
  })
  resumeUi()
}

function requestCancel(): void {
  const supervisor = selectedSupervisor()
  if (!supervisor) {
    state.notice = 'no supervisor selected'
    return
  }
  if (supervisor.status !== 'running') {
    state.notice = `${supervisor.id} is ${supervisor.status}; no cancel request written`
    return
  }
  try {
    mkdirSync(supervisor.stateDir, { recursive: true })
    writeFileSync(
      join(supervisor.stateDir, 'cancel.request.json'),
      `${JSON.stringify(
        {
          at: new Date().toISOString(),
          source: 'agent-runtime-top',
          reason: 'operator requested cancel from TUI',
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
    state.notice = `cancel requested for ${supervisor.id}`
  } catch (err) {
    state.notice = `cancel request failed: ${err instanceof Error ? err.message : String(err)}`
  }
}

function wrap(value: number, size: number): number {
  return ((value % size) + size) % size
}
