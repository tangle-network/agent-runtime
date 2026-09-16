import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { createExecutor } from '../../src/runtime/supervise/runtime'
import type { AgentSpec, UsageEvent } from '../../src/runtime/supervise/types'

const spec: AgentSpec = {
  profile: {
    name: 'shutdown-worker',
    harness: 'cli-base',
    model: { provider: 'offline', default: 'offline-test-model' },
  },
  harness: null,
}

async function drain(stream: AsyncIterable<UsageEvent>): Promise<void> {
  for await (const _event of stream) {
    /* consume execution through exit */
  }
}

async function awaitFile(path: string): Promise<void> {
  const deadline = Date.now() + 4_000
  while (Date.now() < deadline) {
    try {
      await access(path)
      return
    } catch {
      await delay(10)
    }
  }
  throw new Error(`child did not create ${path}`)
}

async function startChild(onTerm: string) {
  const root = await mkdtemp(join(tmpdir(), 'runtime-shutdown-'))
  const ready = join(root, 'ready')
  const terminated = join(root, 'terminated')
  const controller = new AbortController()
  const executor = createExecutor({
    backend: 'cli',
    bin: process.execPath,
    args: [
      '-e',
      `const fs = require('node:fs');
      process.on('SIGTERM', () => {
        fs.writeFileSync(process.env.TERM_PATH, 'SIGTERM');
        ${onTerm}
      });
      fs.writeFileSync(process.env.READY_PATH, String(process.pid));
      setInterval(() => {}, 1000);`,
    ],
    env: { READY_PATH: ready, TERM_PATH: terminated },
  })(spec, { signal: controller.signal, seams: {} })
  // Observe the rejection immediately: an intentional signal is not a clean CLI result.
  const result = drain(
    executor.execute('task', controller.signal) as AsyncIterable<UsageEvent>,
  ).then(
    () => ({ ok: true as const }),
    (error) => ({ ok: false as const, error }),
  )
  const cleanup = async () => {
    controller.abort()
    try {
      const pid = Number(await readFile(ready, 'utf8'))
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        /* already exited */
      }
    } catch {
      /* startup failed before a pid was written */
    }
    await result
    await rm(root, { recursive: true, force: true })
  }
  try {
    await awaitFile(ready)
  } catch (error) {
    await cleanup()
    throw error
  }
  return { executor, result, terminated, ready, cleanup }
}

describe('CLI shutdown acknowledgement', () => {
  it('honors graceful shutdown and retains output written while exiting', async () => {
    const child = await startChild(
      "setTimeout(() => { process.stdout.write('saved'); process.exit(0) }, 25)",
    )
    try {
      expect(await child.executor.teardown(1_000)).toEqual({ destroyed: true })
      expect(await readFile(child.terminated, 'utf8')).toBe('SIGTERM')
      expect(await child.result).toEqual({ ok: true })
      expect(child.executor.resultArtifact().out).toEqual({ content: 'saved' })
      expect(await child.executor.teardown('brutalKill')).toEqual({ destroyed: true })
    } finally {
      await child.cleanup()
    }
  })

  it('escalates an ignored SIGTERM and waits for actual process exit', async () => {
    const child = await startChild('')
    try {
      // The child must be scheduled to record SIGTERM before escalation; full-suite load can exceed 40 ms.
      expect(await child.executor.teardown(1_000)).toEqual({ destroyed: true })
      expect(await readFile(child.terminated, 'utf8')).toBe('SIGTERM')
      const pid = Number(await readFile(child.ready, 'utf8'))
      expect(() => process.kill(pid, 0)).toThrow()
      expect(await child.result).toMatchObject({ ok: false })
    } finally {
      await child.cleanup()
    }
  })

  it('reaps a failed spawn without waiting for an exit code that never exists', async () => {
    const controller = new AbortController()
    const executor = createExecutor({
      backend: 'cli',
      bin: '/nonexistent/runtime-test-executable',
    })(spec, { signal: controller.signal, seams: {} })
    await expect(
      drain(executor.execute('task', controller.signal) as AsyncIterable<UsageEvent>),
    ).rejects.toThrow(/spawn failed/)
    expect(await executor.teardown(20)).toEqual({ destroyed: true })
  })
})
