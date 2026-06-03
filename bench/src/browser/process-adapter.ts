/**
 * Language-agnostic browser-agent adapter over a process boundary.
 *
 * This is how we avoid overfitting to our own driver: ANY browser agent becomes a
 * `BrowserAgentAdapter` by speaking one JSON protocol over stdio — no shared SDK,
 * no TypeScript requirement. A Python `browser-use` runner, our TS `bad` CLI, or a
 * hosted service all plug in identically.
 *
 * Protocol (stdio):
 *   - The harness spawns `cmd ...args`, writes a BrowserTask as one JSON line to
 *     the child's stdin, and closes stdin.
 *   - The child runs its agent and writes EXACTLY one JSON object — a BrowserRun —
 *     to stdout (anything on stderr is logged, ignored for parsing).
 *   - Non-zero exit, no JSON, or a malformed run → throw (fail loud; a driver that
 *     can't conform is not silently scored zero).
 *
 * The child is responsible only for producing a faithful trajectory + final state.
 * The VERDICT is never the child's to give — `judgeBrowserRun` derives it from the
 * benchmark's deterministic SuccessSpec against the returned final state.
 */

import { spawn } from 'node:child_process'
import type { BrowserAgentAdapter, BrowserRun, BrowserStep, BrowserTask } from './agent-adapter'

export interface ProcessAdapterOptions {
  /** Attribution id for head-to-head (e.g. 'browser-use', 'bad'). */
  id: string
  /** Executable to spawn (e.g. 'python', 'node', 'bad'). */
  cmd: string
  /** Fixed args before the per-task protocol (e.g. ['runners/browser_use_runner.py']). */
  args?: string[]
  /** Extra env for the child (model keys, etc.). Merged over process.env. */
  env?: Record<string, string>
  /** Hard ceiling per task in ms (default 300_000). */
  timeoutMs?: number
  /** Working directory for the child. */
  cwd?: string
}

/** Build a BrowserAgentAdapter that delegates to an external process speaking the
 *  JSON protocol above. */
export function processBrowserAdapter(opts: ProcessAdapterOptions): BrowserAgentAdapter {
  const timeoutMs = opts.timeoutMs ?? 300_000
  return {
    id: opts.id,
    async run(task: BrowserTask): Promise<BrowserRun> {
      const stdout = await runChild(opts, JSON.stringify(task), timeoutMs)
      const run = parseRun(stdout, task, opts.id)
      return run
    },
  }
}

function runChild(opts: ProcessAdapterOptions, input: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(opts.cmd, opts.args ?? [], {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`browser adapter '${opts.id}' timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout.on('data', (d) => (out += d.toString()))
    child.stderr.on('data', (d) => (err += d.toString()))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`browser adapter '${opts.id}' failed to spawn ${opts.cmd}: ${e.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`browser adapter '${opts.id}' exited ${code}: ${err.slice(-400) || out.slice(-400)}`))
        return
      }
      resolve(out)
    })
    child.stdin.write(input)
    child.stdin.end()
  })
}

/** Parse + validate the child's BrowserRun. The last complete JSON object on stdout
 *  is the result (drivers may print progress lines before it). Fail loud on a shape
 *  that the judge cannot trust. */
function parseRun(stdout: string, task: BrowserTask, driverId: string): BrowserRun {
  const obj = lastJsonObject(stdout)
  if (!obj) throw new Error(`browser adapter '${driverId}' produced no JSON BrowserRun for task ${task.id}`)
  if (typeof obj.finalUrl !== 'string' || !Array.isArray(obj.steps)) {
    throw new Error(`browser adapter '${driverId}' BrowserRun missing finalUrl/steps for task ${task.id}`)
  }
  const steps: BrowserStep[] = (obj.steps as unknown[]).map((s, i) => {
    const o = (s ?? {}) as Record<string, unknown>
    return {
      index: typeof o.index === 'number' ? o.index : i,
      url: typeof o.url === 'string' ? o.url : '',
      action: typeof o.action === 'string' ? o.action : 'step',
      target: typeof o.target === 'string' ? o.target : undefined,
      reasoning: typeof o.reasoning === 'string' ? o.reasoning : undefined,
      screenshotPath: typeof o.screenshotPath === 'string' ? o.screenshotPath : undefined,
      actionBounds: isBounds(o.actionBounds) ? (o.actionBounds as BrowserStep['actionBounds']) : undefined,
    }
  })
  const usage =
    obj.usage && typeof obj.usage === 'object'
      ? {
          input: Number((obj.usage as Record<string, unknown>).input) || 0,
          output: Number((obj.usage as Record<string, unknown>).output) || 0,
        }
      : undefined
  return {
    taskId: task.id,
    steps,
    finalUrl: obj.finalUrl as string,
    finalDom: typeof obj.finalDom === 'string' ? obj.finalDom : undefined,
    answer: typeof obj.answer === 'string' ? obj.answer : undefined,
    selfReportedSuccess: typeof obj.selfReportedSuccess === 'boolean' ? obj.selfReportedSuccess : undefined,
    usage,
    costUsd: typeof obj.costUsd === 'number' ? obj.costUsd : undefined,
    driverId,
  }
}

function isBounds(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return ['x', 'y', 'width', 'height'].every((k) => typeof o[k] === 'number')
}

/** Find the last top-level JSON object in mixed stdout (progress lines + result). */
function lastJsonObject(s: string): Record<string, unknown> | null {
  for (let i = s.lastIndexOf('{'); i >= 0; i = s.lastIndexOf('{', i - 1)) {
    const slice = s.slice(i)
    try {
      const parsed = JSON.parse(slice)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch {
      // keep scanning earlier '{'
    }
    if (i === 0) break
  }
  return null
}
