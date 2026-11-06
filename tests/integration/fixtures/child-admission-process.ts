import { spawn } from 'node:child_process'

/** A ready offline worker: admission measures dispatched work, not Node's cold startup. */
export async function readyAdmissionProcess(cwd: string) {
  const child = spawn(
    process.execPath,
    [
      '-e',
      `
    process.once('message', ({ marker, output, delay }) => {
      require('node:fs').writeFileSync(marker, 'started');
      setTimeout(() => process.stdout.write(output, () => process.disconnect()), delay);
    });
    process.send('ready');
  `,
    ],
    { cwd, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
  )
  let stdout = '',
    stderr = '',
    spawnError: unknown
  child.stdout.on('data', (data) => {
    stdout += String(data)
  })
  child.stderr.on('data', (data) => {
    stderr += String(data)
  })
  child.on('error', (error) => {
    spawnError = error
  })
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        child.once('message', (message) =>
          message === 'ready' ? resolve() : reject(new Error('invalid worker readiness')),
        )
        timer = setTimeout(() => reject(new Error('worker startup exceeded 5000ms')), 5000)
      }),
      closed.then((exit) => {
        throw new Error(
          `worker exited before readiness: ${JSON.stringify({ ...exit, spawnError: String(spawnError), stderr })}`,
        )
      }),
    ])
  } catch (error) {
    child.kill('SIGKILL')
    await closed
    throw error
  } finally {
    clearTimeout(timer)
  }
  return {
    async run(marker: string, output: string, delay: number, signal: AbortSignal) {
      signal.throwIfAborted()
      const abort = () => {
        child.kill('SIGTERM')
      }
      signal.addEventListener('abort', abort, { once: true })
      let timedOut = false
      const watchdog = setTimeout(() => {
        timedOut = true
        child.kill('SIGKILL')
      }, 5000)
      try {
        child.send({ marker, output, delay }, (error) => {
          if (error) {
            spawnError = error
            child.kill('SIGKILL')
          }
        })
        const exit = await closed
        if (!timedOut) signal.throwIfAborted()
        if (timedOut || exit.code !== 0 || exit.signal || spawnError)
          throw new Error(
            `worker did not exit naturally: ${JSON.stringify({ ...exit, timedOut, spawnError: String(spawnError), stderr })}`,
          )
        return stdout
      } finally {
        clearTimeout(watchdog)
        signal.removeEventListener('abort', abort)
      }
    },
    async close() {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await closed
    },
  }
}
