import { spawn } from 'node:child_process'

/** Finite, single-process Node fixtures finish on close, or join after caller cancellation. */
export function runFixtureProcess(options: { args: string[]; cwd: string; signal?: AbortSignal }) {
  options.signal?.throwIfAborted()
  return new Promise<{ exitCode: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, options.args, {
        cwd: options.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = '',
        stderr = ''
      const abort = () => {
        child.kill('SIGKILL')
      }
      options.signal?.addEventListener('abort', abort, { once: true })
      if (options.signal?.aborted) abort()
      child.stdout.on('data', (chunk) => {
        stdout += chunk
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk
      })
      child.once('error', reject)
      child.once('close', (exitCode) => {
        options.signal?.removeEventListener('abort', abort)
        if (options.signal?.aborted) reject(options.signal.reason)
        else resolve({ exitCode, stdout, stderr })
      })
    },
  )
}
