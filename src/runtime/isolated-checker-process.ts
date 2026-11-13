import { spawn } from 'node:child_process'
import type { Writable } from 'node:stream'
import type { acquireIsolatedCheckCpu } from './isolated-check-cpu'
import type { IsolatedCheckResult } from './isolated-checker'
import { armDeadlineTimer } from './supervise/deadline'

export function executeIsolatedCheckProcess(
  args: string[],
  timeoutMs: number,
  limit: number,
  signal?: AbortSignal,
  cpu?: Awaited<ReturnType<typeof acquireIsolatedCheckCpu>>,
): Promise<IsolatedCheckResult> {
  return new Promise((done) => {
    const began = performance.now()
    // No exec or fork precedes the explicit permit; EOF aborts this trusted launcher.
    // Descendants, including Bubblewrap's namespaces, are born in the owned cgroup.
    const gatedExec =
      'import os,sys; os.write(3,b"R\\n"); permit=os.read(4,1); os.close(4); (os.execve(sys.argv[1],sys.argv[1:],{}) if permit==b"1" else os._exit(125))'
    const argv = [
      '/usr/bin/bwrap',
      '--json-status-fd',
      '3',
      ...(cpu ? ['--unshare-user', '--disable-userns'] : []),
      ...args,
    ]
    const child = spawn(
      cpu ? '/usr/bin/python3' : argv[0]!,
      cpu ? ['-I', '-c', gatedExec, ...argv] : argv.slice(1),
      {
        env: {},
        stdio: cpu
          ? ['ignore', 'pipe', 'pipe', 'pipe', 'pipe']
          : ['ignore', 'pipe', 'pipe', 'pipe'],
        detached: true,
      },
    )
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let bytes = 0
    let status = ''
    let failure: 'timeout' | 'cancelled' | 'output-limit' | 'refused' | undefined
    let cpuError: string | undefined
    let cpuStarting: Promise<void> | undefined
    let cpuStopping: Promise<void> | undefined
    const release = cpu ? (child.stdio[4] as Writable) : undefined
    const killProcessGroup = () => {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill('SIGKILL')
        }
      }
    }
    const stop = (reason: typeof failure) => {
      failure ??= reason
      if (!cpu) return killProcessGroup()
      // Do not reap/reuse the blocked launcher's PID during its membership write.
      cpuStopping ??= (async () => {
        await cpuStarting
        try {
          await cpu.kill()
        } catch (error) {
          cpuError ??= String(error)
        } finally {
          killProcessGroup()
        }
      })()
    }
    const clearTimer = armDeadlineTimer(timeoutMs, () => stop('timeout'), true)
    const cancel = () => stop('cancelled')
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) cancel()
    const capture = (target: Buffer[]) => (chunk: Buffer) => {
      const remaining = Math.max(0, limit - bytes)
      bytes += chunk.length
      if (remaining) target.push(chunk.subarray(0, remaining))
      if (bytes > limit) stop('output-limit')
    }
    child.stdio[3]?.on('data', (chunk: Buffer) => {
      if (status.length + chunk.length > 16_384) {
        stop('output-limit')
        return
      }
      status += chunk.toString()
      if (cpu && !cpuStarting && !failure && child.pid && status.startsWith('R\n')) {
        cpuStarting = (async () => {
          try {
            await cpu.start([child.pid!])
            if (!failure && child.exitCode === null && child.signalCode === null) release?.end('1')
          } catch (error) {
            cpuError = String(error)
            stop('refused')
          }
        })()
      }
    })
    release?.on('error', (error) => {
      cpuError = String(error)
      stop('refused')
    })
    // EOF aborts before exec; cancellation kills the owned cgroup after membership.
    child.once('exit', () => release?.destroy())
    child.stdout!.on('data', capture(stdout))
    child.stderr!.on('data', capture(stderr))
    let spawnError: Error | undefined
    child.on('error', (error) => {
      spawnError = error
    })
    child.on('close', async (code) => {
      const cpuCommandWallMs = cpu ? performance.now() - began : undefined
      await cpuStarting
      await cpuStopping
      const cpuEvidence = await cpu?.finish(timeoutMs - (performance.now() - began))
      clearTimer()
      signal?.removeEventListener('abort', cancel)
      const outBytes = Buffer.concat(stdout)
      const errBytes = Buffer.concat(stderr)
      const out = outBytes.toString()
      const err = errBytes.toString()
      const command = {
        wallMs: cpuCommandWallMs ?? performance.now() - began,
        stdoutBase64: outBytes.toString('base64'),
        stderrBase64: errBytes.toString('base64'),
        outputComplete: bytes <= limit,
        ...(cpuEvidence ? { cpu: cpuEvidence } : {}),
      }
      const evidence = { stdout: out, stderr: err, exitCode: code, command }
      // Only Bubblewrap writes this private pipe; command stderr cannot forge setup status.
      const executed = status.split('\n').some((line) => {
        try {
          const record: unknown = JSON.parse(line)
          return (
            record !== null &&
            typeof record === 'object' &&
            'exit-code' in record &&
            typeof record['exit-code'] === 'number' &&
            record['exit-code'] === code
          )
        } catch {
          return false
        }
      })
      if (failure)
        done({
          succeeded: false,
          reason: failure,
          diagnostic: cpuError || err || failure,
          ...evidence,
        })
      else if (spawnError)
        done({ succeeded: false, reason: 'refused', diagnostic: String(spawnError), ...evidence })
      else if (!executed)
        done({
          succeeded: false,
          reason: 'refused',
          diagnostic: err || 'Bubblewrap did not confirm command execution',
          ...evidence,
        })
      else if (code !== 0)
        done({
          succeeded: false,
          reason: 'failed',
          diagnostic: err || out || `Check exited ${code}`,
          ...evidence,
        })
      else done({ succeeded: true, value: { stdout: out, stderr: err }, command })
    })
  })
}
