/**
 * Client for the persistent vectorbt scoring worker (python/vbt-worker.py).
 *
 * One worker is spawned per campaign (cold numba JIT is paid once, at the
 * `ready` handshake) and every scoring call is a JSONL request/response over
 * stdin/stdout. The worker is the OFFICIAL scorer; the TS engine
 * (backtest.ts) remains as contract prefilter + leak-audit substrate only.
 *
 * Crash discipline (the ledger-orphan posture, applied to in-flight work):
 * if the worker dies, every pending request settles IMMEDIATELY with a
 * `VbtWorkerCrashError` — nothing is left orphaned awaiting a dead process.
 * The next request lazily respawns the worker, and `score()` retries a
 * request exactly once if the crash happened while it was in flight. A
 * second crash on the same request propagates — fail loud, not retry-loop.
 *
 * Environment: pinned by python/pyproject.toml + python/uv.lock and launched
 * through `uv run --frozen`, so the scoring stack is byte-reproducible.
 */

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Bar, Signal } from './types.ts'

export const VBT_PYTHON_DIR = fileURLToPath(new URL('./python', import.meta.url))

export interface VbtWindowStats {
  totalReturn: number
  /** Positive convention (0.12 = a 12% peak-to-trough drawdown). */
  maxDD: number
  /** Annualized, sample-std, 252 trading days — same formula as backtest.ts. */
  sharpe: number
  trades: number
}

export interface VbtScore {
  windows: VbtWindowStats[]
  full: VbtWindowStats
  /** Group equity per day, close-marked, equity[0] = 1. */
  equity: number[]
}

export interface VbtScoreRequest {
  /** T x N fill prices (next-open model). */
  openPrices: number[][]
  /** T x N valuation prices. */
  closePrices: number[][]
  /** One row per day: the decision made at that day's close, or null. */
  weights: Array<number[] | null>
  costBps: number
  slippageBps: number
  /** [start, end) day-index ranges to score. */
  windows: Array<[number, number]>
}

export class VbtWorkerCrashError extends Error {
  constructor(detail: string) {
    super(`vbt worker crashed: ${detail}`)
    this.name = 'VbtWorkerCrashError'
  }
}

interface Pending {
  resolve: (value: Record<string, unknown>) => void
  reject: (error: Error) => void
}

export interface VbtWorkerOptions {
  pythonDir?: string
  /** Covers spawn + cold numba JIT on first start. */
  readyTimeoutMs?: number
  requestTimeoutMs?: number
}

export class VbtWorker {
  private readonly pythonDir: string
  private readonly readyTimeoutMs: number
  private readonly requestTimeoutMs: number
  private child: ChildProcessWithoutNullStreams | null = null
  private ready: Promise<void> | null = null
  private pending = new Map<number, Pending>()
  private nextId = 1
  private closed = false
  private stderrTail: string[] = []

  constructor(options: VbtWorkerOptions = {}) {
    this.pythonDir = options.pythonDir ?? VBT_PYTHON_DIR
    this.readyTimeoutMs = options.readyTimeoutMs ?? 180_000
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120_000
  }

  /** True when the pinned worker environment can be launched here: `uv` on
   *  PATH and the lockfile present. Tests use this to skip-with-reason. */
  static isAvailable(pythonDir = VBT_PYTHON_DIR): boolean {
    if (!existsSync(join(pythonDir, 'uv.lock'))) return false
    const probe = spawnSync('uv', ['--version'], { stdio: 'ignore' })
    return probe.status === 0
  }

  private start(): Promise<void> {
    if (this.ready !== null) return this.ready
    if (this.closed) return Promise.reject(new Error('vbt worker: client closed'))
    const workerPath = join(this.pythonDir, 'vbt-worker.py')
    const child = spawn('uv', ['run', '--frozen', '--project', this.pythonDir, 'python', workerPath], {
      cwd: this.pythonDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child
    this.stderrTail = []
    // EPIPE on a dying worker's stdin is handled by the exit path (settle +
    // respawn) — a stream 'error' event must not crash the host process.
    child.stdin.on('error', () => {})
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      this.stderrTail.push(chunk)
      if (this.stderrTail.length > 40) this.stderrTail.shift()
    })

    this.ready = new Promise<void>((resolveReady, rejectReady) => {
      let isReady = false
      const readyTimer = setTimeout(() => {
        if (!isReady) {
          rejectReady(new Error(`vbt worker: no ready handshake within ${this.readyTimeoutMs}ms`))
          child.kill('SIGKILL')
        }
      }, this.readyTimeoutMs)

      const lines = createInterface({ input: child.stdout })
      lines.on('line', (line) => {
        let parsed: Record<string, unknown>
        try {
          parsed = JSON.parse(line) as Record<string, unknown>
        } catch {
          return // non-protocol noise on stdout is ignored, never fatal
        }
        if (parsed.ready === true) {
          isReady = true
          clearTimeout(readyTimer)
          resolveReady()
          return
        }
        const id = parsed.id
        if (typeof id === 'number') {
          const waiter = this.pending.get(id)
          if (waiter !== undefined) {
            this.pending.delete(id)
            waiter.resolve(parsed)
          }
        }
      })

      child.on('exit', (code, signal) => {
        clearTimeout(readyTimer)
        const detail = `exit code=${code} signal=${signal} stderr: ${this.stderrTail.join('').slice(-800)}`
        if (!isReady) rejectReady(new VbtWorkerCrashError(detail))
        this.settleAllPending(new VbtWorkerCrashError(detail))
        this.child = null
        this.ready = null // next request respawns
      })
      child.on('error', (cause) => {
        clearTimeout(readyTimer)
        if (!isReady) rejectReady(new VbtWorkerCrashError(String(cause)))
        this.settleAllPending(new VbtWorkerCrashError(String(cause)))
        this.child = null
        this.ready = null
      })
    })
    return this.ready
  }

  /** Ledger-orphan discipline: a dead worker never leaves an unresolved
   *  request behind — everything in flight settles NOW. */
  private settleAllPending(error: Error): void {
    const waiters = [...this.pending.values()]
    this.pending.clear()
    for (const waiter of waiters) waiter.reject(error)
  }

  private async request(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.start()
    const child = this.child
    if (child === null) throw new VbtWorkerCrashError('worker exited during handshake')
    const id = this.nextId++
    const reply = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`vbt worker: request ${id} timed out after ${this.requestTimeoutMs}ms`))
        child.kill('SIGKILL')
      }, this.requestTimeoutMs)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      try {
        child.stdin.write(JSON.stringify({ id, ...payload }) + '\n')
      } catch {
        // A destroyed stdin means the worker is dying; the exit handler
        // settles this pending request with VbtWorkerCrashError.
      }
    })
    if (reply.ok !== true) {
      throw new Error(`vbt worker: request failed: ${String(reply.error ?? 'unknown error')}`)
    }
    return reply
  }

  async ping(): Promise<string> {
    const reply = await this.request({ op: 'ping' })
    return String(reply.vbt)
  }

  async score(req: VbtScoreRequest): Promise<VbtScore> {
    const payload = {
      op: 'score',
      open_prices: req.openPrices,
      close_prices: req.closePrices,
      weights: req.weights,
      cost_bps: req.costBps,
      slippage_bps: req.slippageBps,
      windows: req.windows,
    }
    let reply: Record<string, unknown>
    try {
      reply = await this.request(payload)
    } catch (cause) {
      if (!(cause instanceof VbtWorkerCrashError)) throw cause
      // One retry after a crash-respawn; a second crash propagates.
      reply = await this.request(payload)
    }
    return {
      windows: reply.windows as VbtWindowStats[],
      full: reply.full as VbtWindowStats,
      equity: reply.equity as number[],
    }
  }

  async close(): Promise<void> {
    this.closed = true
    const child = this.child
    this.child = null
    this.ready = null
    this.settleAllPending(new Error('vbt worker: client closed'))
    if (child !== null) {
      child.stdin.end()
      await new Promise<void>((resolve) => {
        const killTimer = setTimeout(() => {
          child.kill('SIGKILL')
          resolve()
        }, 3_000)
        child.on('exit', () => {
          clearTimeout(killTimer)
          resolve()
        })
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Adapters: aligned bars + Signal[] -> the worker's matrix protocol.
// ---------------------------------------------------------------------------

/** Row-major T x N open/close price matrices from aligned bar series. */
export function barsToPriceMatrices(bars: Bar[][]): { open: number[][]; close: number[][] } {
  const N = bars.length
  const T = bars[0]?.length ?? 0
  const open: number[][] = new Array(T)
  const close: number[][] = new Array(T)
  for (let t = 0; t < T; t++) {
    const openRow = new Array<number>(N)
    const closeRow = new Array<number>(N)
    for (let k = 0; k < N; k++) {
      openRow[k] = bars[k]![t]!.open
      closeRow[k] = bars[k]![t]!.close
    }
    open[t] = openRow
    close[t] = closeRow
  }
  return { open, close }
}

/** Decision rows for the worker: weights at each decision day, null rows on
 *  no-rebalance days (JSON's stand-in for the NaN convention). */
export function signalsToWeightRows(signals: Signal[], totalDays: number): Array<number[] | null> {
  const rows: Array<number[] | null> = new Array(totalDays).fill(null)
  for (const signal of signals) {
    if (!Number.isInteger(signal.t) || signal.t < 0 || signal.t >= totalDays) {
      throw new Error(`signalsToWeightRows: signal.t=${signal.t} outside [0, ${totalDays})`)
    }
    if (rows[signal.t] !== null) throw new Error(`signalsToWeightRows: two signals share t=${signal.t}`)
    rows[signal.t] = signal.weights
  }
  return rows
}

/** Score a decision record on the official vectorbt engine. */
export async function scoreSignals(
  worker: VbtWorker,
  bars: Bar[][],
  signals: Signal[],
  config: { costBps: number; slippageBps: number },
  windows: Array<[number, number]>,
): Promise<VbtScore> {
  const { open, close } = barsToPriceMatrices(bars)
  return worker.score({
    openPrices: open,
    closePrices: close,
    weights: signalsToWeightRows(signals, open.length),
    costBps: config.costBps,
    slippageBps: config.slippageBps,
    windows,
  })
}
