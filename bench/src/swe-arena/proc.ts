/**
 * Process helpers shared by the swe-arena execution path (materialize /
 * calibrate / arms / serialized-judge). One place owns spawn semantics so
 * every port of a bash script gets identical rc/timeout behavior:
 *
 *  - `run` never throws on a nonzero exit — the bash scripts branched on `$?`,
 *    so callers get `{ code, stdout, stderr, timedOut }` and decide.
 *  - timeouts SIGKILL the whole process GROUP (detached spawn), because the
 *    arm commands are `dotenvx → bash -c → opencode/node` chains; killing only
 *    the leader would orphan the model call exactly like a dropped `timeout`.
 *  - `code` is 124 on timeout, mirroring coreutils `timeout` so ledger rc
 *    fields keep the bash experiment's encoding.
 */

import { spawn } from 'node:child_process'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
  timedOut: boolean
}

export interface RunOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** 0 / undefined = no timeout. On expiry the process group is SIGKILLed. */
  timeoutMs?: number
  /** Cap captured stdout/stderr (bytes); beyond it output is dropped, not buffered. */
  maxBuffer?: number
  /** Piped to the child's stdin, then stdin is closed. */
  stdin?: string
}

const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024

/** coreutils `timeout` exit code — kept so ledger rc columns stay comparable. */
export const TIMEOUT_RC = 124

export function run(bin: string, argv: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, argv, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const cap = opts.maxBuffer ?? DEFAULT_MAX_BUFFER
    let stdout = ''
    let stderr = ''
    let outBytes = 0
    let errBytes = 0
    let timedOut = false
    let timer: NodeJS.Timeout | undefined
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true
        // Negative pid = the whole group. The child may already be gone; ignore.
        try {
          process.kill(-child.pid!, 'SIGKILL')
        } catch {
          try {
            child.kill('SIGKILL')
          } catch {
            /* already dead */
          }
        }
      }, opts.timeoutMs)
    }
    child.stdout.on('data', (c: Buffer) => {
      outBytes += c.length
      if (outBytes <= cap) stdout += c.toString('utf8')
    })
    child.stderr.on('data', (c: Buffer) => {
      errBytes += c.length
      if (errBytes <= cap) stderr += c.toString('utf8')
    })
    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer)
      resolve({
        code: timedOut ? TIMEOUT_RC : (code ?? (signal ? 1 : 0)),
        stdout,
        stderr,
        timedOut,
      })
    })
    if (opts.stdin !== undefined) child.stdin.end(opts.stdin)
    else child.stdin.end()
  })
}

/** `run` that throws (with captured stderr) on nonzero exit — for steps the bash aborted on. */
export async function runOk(bin: string, argv: string[], opts: RunOptions = {}): Promise<RunResult> {
  const res = await run(bin, argv, opts)
  if (res.code !== 0) {
    const detail = (res.stderr || res.stdout).slice(0, 1500)
    throw new Error(`${bin} ${argv.join(' ')} exited ${res.code}${res.timedOut ? ' (timeout)' : ''}: ${detail}`)
  }
  return res
}

/** Single-quote shell escaping — identical to the quoting the bash scripts relied on. */
export function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
