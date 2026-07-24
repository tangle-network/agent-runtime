import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { runSupervisorShim, supervisorDriverKillGraceMs } from './arms.ts'
import { run, TIMEOUT_RC } from './proc.ts'

const dirs: string[] = []
const workerPids: number[] = []

afterAll(async () => {
  for (const pid of workerPids) {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      // The expected path already reaped the process group.
    }
  }
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('supervisor driver cancellation', () => {
  it('waits for worker cleanup before returning its deadline result', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'swe-driver-cancel-'))
    dirs.push(dir)
    const workspace = join(dir, 'workspace')
    const params = join(dir, 'params.json')
    const extension = join(dir, 'fake-extension.mjs')
    await mkdir(workspace)
    await writeFile(params, '{}')
    const workerScript = `const fs=require('node:fs'); const marker=process.argv[1]; process.on('SIGTERM',()=>setTimeout(()=>{fs.writeFileSync(marker,'clean'); process.exit(0)},30)); setInterval(()=>{},1000)`
    await writeFile(extension, `
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const id = 'sup-1-fake12'
const text = (value) => ({ content: [{ type: 'text', text: value }] })
let child

export default function fakeExtension(pi) {
  pi.registerTool({
    name: 'spawn_supervisor',
    async execute(_call, _params, _signal, _update, ctx) {
      const runDir = join(ctx.cwd, '.loops', 'supervisor', id)
      mkdirSync(runDir, { recursive: true })
      writeFileSync(join(runDir, 'state.json'), JSON.stringify({ status: 'running', progress: 'driving' }))
      appendFileSync(join(runDir, 'journal.jsonl'), JSON.stringify({ kind: 'spawned', id, label: 'root' }) + '\\n')
      appendFileSync(join(runDir, 'journal.jsonl'), JSON.stringify({ kind: 'spawned', id: id + ':s1', parent: id, label: 'w-0' }) + '\\n')
      child = spawn(process.execPath, ['-e', ${JSON.stringify(workerScript)}, join(ctx.cwd, 'worker-cleaned.txt')], {
        detached: true,
        stdio: 'ignore',
      })
      writeFileSync(join(ctx.cwd, 'worker.pid'), String(child.pid))
      return text('spawned supervisor ' + id)
    },
  })
  pi.registerTool({
    name: 'supervisor_cancel',
    async execute(_call, _params, _signal, _update, ctx) {
      appendFileSync(join(ctx.cwd, 'cancel-count.txt'), '1\\n')
      process.kill(-child.pid, 'SIGTERM')
      child.once('close', () => {
        const runDir = join(ctx.cwd, '.loops', 'supervisor', id)
        appendFileSync(join(runDir, 'journal.jsonl'), JSON.stringify({ kind: 'cancelled', id: id + ':s1', reason: 'test cancellation' }) + '\\n')
        writeFileSync(join(runDir, 'state.json'), JSON.stringify({ status: 'cancelled', progress: 'cancelled' }))
        writeFileSync(join(ctx.cwd, 'cancel-settled.txt'), 'settled')
      })
      return text('cancellation signalled before worker cleanup')
    },
  })
}
`)

    const result = await run(process.execPath, [
      '--import', 'tsx', runSupervisorShim, extension, workspace, params,
    ], {
      timeoutMs: 5_000,
      killGraceMs: 500,
      env: {
        ...process.env,
        DRIVER_DEADLINE_MS: '40',
        DRIVER_POLL_MS: '10',
        DRIVER_CANCEL_TIMEOUT_MS: '2000',
      },
    })
    const workerPid = Number(await readFile(join(workspace, 'worker.pid'), 'utf8'))
    workerPids.push(workerPid)

    expect(result.code, result.stdout + result.stderr).toBe(3)
    expect(result.timedOut).toBe(false)
    expect(await readFile(join(workspace, 'cancel-count.txt'), 'utf8')).toBe('1\n')
    expect(await readFile(join(workspace, 'worker-cleaned.txt'), 'utf8')).toBe('clean')
    expect(await readFile(join(workspace, 'cancel-settled.txt'), 'utf8')).toBe('settled')
    expect(JSON.parse(await readFile(join(workspace, '.loops', 'supervisor', 'sup-1-fake12', 'state.json'), 'utf8')))
      .toMatchObject({ status: 'cancelled' })
    await expect(access(`/proc/${workerPid}`)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('lets near-deadline cancellation settle after outer SIGTERM', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'swe-driver-outer-term-'))
    dirs.push(dir)
    const workspace = join(dir, 'workspace')
    const params = join(dir, 'params.json')
    const extension = join(dir, 'fake-extension.mjs')
    await mkdir(workspace)
    await writeFile(params, '{}')
    await writeFile(extension, `
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const id = 'sup-2-fake34'
const text = (value) => ({ content: [{ type: 'text', text: value }] })
export default function fakeExtension(pi) {
  pi.registerTool({
    name: 'spawn_supervisor',
    async execute(_call, _params, _signal, _update, ctx) {
      const runDir = join(ctx.cwd, '.loops', 'supervisor', id)
      mkdirSync(runDir, { recursive: true })
      writeFileSync(join(runDir, 'state.json'), JSON.stringify({ status: 'running' }))
      appendFileSync(join(runDir, 'journal.jsonl'), JSON.stringify({ kind: 'spawned', id, label: 'root' }) + '\\n')
      appendFileSync(join(runDir, 'journal.jsonl'), JSON.stringify({ kind: 'spawned', id: id + ':s1', parent: id, label: 'w-0' }) + '\\n')
      return text('spawned supervisor ' + id)
    },
  })
  pi.registerTool({
    name: 'supervisor_cancel',
    async execute(_call, _params, _signal, _update, ctx) {
      await new Promise((resolve) => setTimeout(resolve, 1200))
      const runDir = join(ctx.cwd, '.loops', 'supervisor', id)
      appendFileSync(join(runDir, 'journal.jsonl'), JSON.stringify({ kind: 'cancelled', id: id + ':s1' }) + '\\n')
      writeFileSync(join(runDir, 'state.json'), JSON.stringify({ status: 'cancelled' }))
      writeFileSync(join(ctx.cwd, 'outer-cancel-settled.txt'), 'settled')
      return text('cancellation settled')
    },
  })
}
`)

    const cancelTimeoutMs = 1_500
    const result = await run(process.execPath, [
      '--import', 'tsx', runSupervisorShim, extension, workspace, params,
    ], {
      timeoutMs: 1_000,
      killGraceMs: supervisorDriverKillGraceMs({
        DRIVER_CANCEL_TIMEOUT_MS: String(cancelTimeoutMs),
      }),
      env: {
        ...process.env,
        DRIVER_DEADLINE_MS: '60000',
        DRIVER_POLL_MS: '10',
        DRIVER_CANCEL_TIMEOUT_MS: String(cancelTimeoutMs),
      },
    })

    expect(result.code, result.stdout + result.stderr).toBe(TIMEOUT_RC)
    expect(result.timedOut).toBe(true)
    expect(await readFile(join(workspace, 'outer-cancel-settled.txt'), 'utf8')).toBe('settled')
    expect(JSON.parse(await readFile(join(workspace, '.loops', 'supervisor', 'sup-2-fake34', 'state.json'), 'utf8')))
      .toMatchObject({ status: 'cancelled' })
  }, 15_000)

  it('latches SIGTERM while spawn_supervisor is still returning and cancels its detached worker', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'swe-driver-signal-during-spawn-'))
    dirs.push(dir)
    const workspace = join(dir, 'workspace')
    const params = join(dir, 'params.json')
    const extension = join(dir, 'fake-extension.mjs')
    await mkdir(workspace)
    await writeFile(params, '{}')
    const workerScript = `const fs=require('node:fs'); const marker=process.argv[1]; process.on('SIGTERM',()=>setTimeout(()=>{fs.writeFileSync(marker,'clean'); process.exit(0)},30)); setInterval(()=>{},1000)`
    await writeFile(extension, `
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const id = 'sup-3-signal56'
const text = (value) => ({ content: [{ type: 'text', text: value }] })
let child
export default function fakeExtension(pi) {
  pi.registerTool({
    name: 'spawn_supervisor',
    async execute(_call, _params, _signal, _update, ctx) {
      const runDir = join(ctx.cwd, '.loops', 'supervisor', id)
      mkdirSync(runDir, { recursive: true })
      writeFileSync(join(runDir, 'state.json'), JSON.stringify({ status: 'running' }))
      appendFileSync(join(runDir, 'journal.jsonl'), JSON.stringify({ kind: 'spawned', id, label: 'root' }) + '\\n')
      appendFileSync(join(runDir, 'journal.jsonl'), JSON.stringify({ kind: 'spawned', id: id + ':s1', parent: id, label: 'w-0' }) + '\\n')
      child = spawn(process.execPath, ['-e', ${JSON.stringify(workerScript)}, join(ctx.cwd, 'signal-worker-cleaned.txt')], {
        detached: true,
        stdio: 'ignore',
      })
      writeFileSync(join(ctx.cwd, 'signal-worker.pid'), String(child.pid))
      writeFileSync(join(ctx.cwd, 'spawn-entered.txt'), 'entered')
      await new Promise((resolve) => setTimeout(resolve, 30_000))
      return text('spawned supervisor ' + id)
    },
  })
  pi.registerTool({
    name: 'supervisor_cancel',
    async execute(_call, _params, _signal, _update, ctx) {
      process.kill(-child.pid, 'SIGTERM')
      await new Promise((resolve) => child.once('close', resolve))
      const runDir = join(ctx.cwd, '.loops', 'supervisor', id)
      appendFileSync(join(runDir, 'journal.jsonl'), JSON.stringify({ kind: 'cancelled', id: id + ':s1' }) + '\\n')
      writeFileSync(join(runDir, 'state.json'), JSON.stringify({ status: 'cancelled' }))
      writeFileSync(join(ctx.cwd, 'signal-cancel-settled.txt'), 'settled')
      return text('cancellation settled')
    },
  })
}
`)

    const cancelTimeoutMs = 2_000
    const result = await run(process.execPath, [
      '--import', 'tsx', runSupervisorShim, extension, workspace, params,
    ], {
      timeoutMs: 1_000,
      killGraceMs: supervisorDriverKillGraceMs({
        DRIVER_CANCEL_TIMEOUT_MS: String(cancelTimeoutMs),
      }),
      env: {
        ...process.env,
        DRIVER_DEADLINE_MS: '60000',
        DRIVER_POLL_MS: '10',
        DRIVER_CANCEL_TIMEOUT_MS: String(cancelTimeoutMs),
      },
    })
    const workerPid = Number(await readFile(join(workspace, 'signal-worker.pid'), 'utf8'))
    workerPids.push(workerPid)

    expect(result.code, result.stdout + result.stderr).toBe(TIMEOUT_RC)
    expect(result.timedOut).toBe(true)
    expect(await readFile(join(workspace, 'spawn-entered.txt'), 'utf8')).toBe('entered')
    expect(await readFile(join(workspace, 'signal-worker-cleaned.txt'), 'utf8')).toBe('clean')
    expect(await readFile(join(workspace, 'signal-cancel-settled.txt'), 'utf8')).toBe('settled')
    await expect(access(`/proc/${workerPid}`)).rejects.toMatchObject({ code: 'ENOENT' })
  }, 15_000)

  it('recovers an on-disk supervisor id from an unparseable spawn response and cancels it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'swe-driver-id-recovery-'))
    dirs.push(dir)
    const workspace = join(dir, 'workspace')
    const params = join(dir, 'params.json')
    const extension = join(dir, 'fake-extension.mjs')
    await mkdir(workspace)
    await writeFile(params, '{}')
    const workerScript = `const fs=require('node:fs'); const marker=process.argv[1]; process.on('SIGTERM',()=>setTimeout(()=>{fs.writeFileSync(marker,'clean'); process.exit(0)},30)); setInterval(()=>{},1000)`
    await writeFile(extension, `
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const id = 'sup-4-recover78'
const text = (value) => ({ content: [{ type: 'text', text: value }] })
let child
export default function fakeExtension(pi) {
  pi.registerTool({
    name: 'spawn_supervisor',
    async execute(_call, _params, _signal, _update, ctx) {
      const runDir = join(ctx.cwd, '.loops', 'supervisor', id)
      mkdirSync(runDir, { recursive: true })
      writeFileSync(join(runDir, 'state.json'), JSON.stringify({ status: 'running' }))
      appendFileSync(join(runDir, 'journal.jsonl'), JSON.stringify({ kind: 'spawned', id, label: 'root' }) + '\\n')
      appendFileSync(join(runDir, 'journal.jsonl'), JSON.stringify({ kind: 'spawned', id: id + ':s1', parent: id, label: 'w-0' }) + '\\n')
      child = spawn(process.execPath, ['-e', ${JSON.stringify(workerScript)}, join(ctx.cwd, 'recovered-worker-cleaned.txt')], {
        detached: true,
        stdio: 'ignore',
      })
      writeFileSync(join(ctx.cwd, 'recovered-worker.pid'), String(child.pid))
      return text('the supervisor started, but this response omitted its identifier')
    },
  })
  pi.registerTool({
    name: 'supervisor_cancel',
    async execute(_call, params, _signal, _update, ctx) {
      writeFileSync(join(ctx.cwd, 'recovered-id.txt'), params.id)
      process.kill(-child.pid, 'SIGTERM')
      await new Promise((resolve) => child.once('close', resolve))
      const runDir = join(ctx.cwd, '.loops', 'supervisor', id)
      appendFileSync(join(runDir, 'journal.jsonl'), JSON.stringify({ kind: 'cancelled', id: id + ':s1' }) + '\\n')
      writeFileSync(join(runDir, 'state.json'), JSON.stringify({ status: 'cancelled' }))
      return text('cancellation settled')
    },
  })
}
`)

    const result = await run(process.execPath, [
      '--import', 'tsx', runSupervisorShim, extension, workspace, params,
    ], {
      timeoutMs: 5_000,
      killGraceMs: 500,
      env: {
        ...process.env,
        DRIVER_DEADLINE_MS: '60000',
        DRIVER_POLL_MS: '10',
        DRIVER_CANCEL_TIMEOUT_MS: '2000',
      },
    })
    const workerPid = Number(await readFile(join(workspace, 'recovered-worker.pid'), 'utf8'))
    workerPids.push(workerPid)

    expect(result.code, result.stdout + result.stderr).toBe(1)
    expect(result.timedOut).toBe(false)
    expect(result.stderr).toMatch(/cancelling recovered run\(s\): sup-4-recover78/)
    expect(await readFile(join(workspace, 'recovered-id.txt'), 'utf8')).toBe('sup-4-recover78')
    await expect(access(`/proc/${workerPid}`)).rejects.toMatchObject({ code: 'ENOENT' })
  }, 15_000)

  it('waits for a late worker terminal record before accepting completed state', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'swe-driver-late-settlement-'))
    dirs.push(dir)
    const workspace = join(dir, 'workspace')
    const params = join(dir, 'params.json')
    const extension = join(dir, 'fake-extension.mjs')
    await mkdir(workspace)
    await writeFile(params, '{}')
    await writeFile(extension, `
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const id = 'sup-5-late90'
const text = (value) => ({ content: [{ type: 'text', text: value }] })
export default function fakeExtension(pi) {
  pi.registerTool({
    name: 'spawn_supervisor',
    async execute(_call, _params, _signal, _update, ctx) {
      const runDir = join(ctx.cwd, '.loops', 'supervisor', id)
      mkdirSync(runDir, { recursive: true })
      writeFileSync(join(runDir, 'state.json'), JSON.stringify({ status: 'completed', verdict: 'delivered' }))
      appendFileSync(join(runDir, 'journal.jsonl'), JSON.stringify({ kind: 'spawned', id, label: 'root' }) + '\\n')
      appendFileSync(join(runDir, 'journal.jsonl'), JSON.stringify({ kind: 'spawned', id: id + ':s1', parent: id, label: 'w-0' }) + '\\n')
      setTimeout(() => {
        appendFileSync(join(runDir, 'journal.jsonl'), JSON.stringify({ kind: 'settled', id: id + ':s1', status: 'done' }) + '\\n')
      }, 40)
      return text('spawned supervisor ' + id)
    },
  })
  pi.registerTool({
    name: 'supervisor_cancel',
    async execute() { return text('already completed') },
  })
}
`)

    const result = await run(process.execPath, [
      '--import', 'tsx', runSupervisorShim, extension, workspace, params,
    ], {
      timeoutMs: 5_000,
      killGraceMs: 500,
      env: {
        ...process.env,
        DRIVER_DEADLINE_MS: '60000',
        DRIVER_POLL_MS: '10',
        DRIVER_CANCEL_TIMEOUT_MS: '2000',
        DRIVER_SETTLEMENT_TIMEOUT_MS: '500',
      },
    })

    expect(result.code, result.stdout + result.stderr).toBe(0)
    expect(result.timedOut).toBe(false)
    expect(result.stdout).toMatch(/worker settlement: workers=1, terminal=1/)
  })

  it('refuses completed state while a journal worker remains live', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'swe-driver-live-completed-worker-'))
    dirs.push(dir)
    const workspace = join(dir, 'workspace')
    const params = join(dir, 'params.json')
    const extension = join(dir, 'fake-extension.mjs')
    await mkdir(workspace)
    await writeFile(params, '{}')
    await writeFile(extension, `
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const id = 'sup-5-live90'
const text = (value) => ({ content: [{ type: 'text', text: value }] })
export default function fakeExtension(pi) {
  pi.registerTool({
    name: 'spawn_supervisor',
    async execute(_call, _params, _signal, _update, ctx) {
      const runDir = join(ctx.cwd, '.loops', 'supervisor', id)
      mkdirSync(runDir, { recursive: true })
      writeFileSync(join(runDir, 'state.json'), JSON.stringify({ status: 'completed', verdict: 'delivered' }))
      appendFileSync(join(runDir, 'journal.jsonl'), JSON.stringify({ kind: 'spawned', id, label: 'root' }) + '\\n')
      appendFileSync(join(runDir, 'journal.jsonl'), JSON.stringify({ kind: 'spawned', id: id + ':s1', parent: id, label: 'w-0' }) + '\\n')
      return text('spawned supervisor ' + id)
    },
  })
  pi.registerTool({
    name: 'supervisor_cancel',
    async execute() { return text('already completed') },
  })
}
`)

    const result = await run(process.execPath, [
      '--import', 'tsx', runSupervisorShim, extension, workspace, params,
    ], {
      timeoutMs: 5_000,
      killGraceMs: 500,
      env: {
        ...process.env,
        DRIVER_DEADLINE_MS: '60000',
        DRIVER_POLL_MS: '10',
        DRIVER_CANCEL_TIMEOUT_MS: '2000',
        DRIVER_SETTLEMENT_TIMEOUT_MS: '80',
      },
    })

    expect(result.code, result.stdout + result.stderr).toBe(4)
    expect(result.timedOut).toBe(false)
    expect(result.stderr).toMatch(/refusing completed supervisor/)
    expect(result.stderr).toMatch(/workers=1, terminal=0, unsettled=1/)
    expect(result.stdout).not.toContain('[done] id=')
  })

  it.each(['failed', 'cancelled'] as const)(
    'settles a detached worker before returning terminal status $status',
    async (status) => {
      const dir = await mkdtemp(join(tmpdir(), `swe-driver-${status}-worker-`))
      dirs.push(dir)
      const workspace = join(dir, 'workspace')
      const params = join(dir, 'params.json')
      const extension = join(dir, 'fake-extension.mjs')
      await mkdir(workspace)
      await writeFile(params, '{}')
      const workerScript = `const fs=require('node:fs'); const marker=process.argv[1]; const ready=process.argv[2]; process.on('SIGTERM',()=>setTimeout(()=>{fs.writeFileSync(marker,'clean'); process.exit(0)},30)); fs.writeFileSync(ready,'ready'); setInterval(()=>{},1000)`
      await writeFile(extension, `
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const id = 'sup-6-${status}12'
const text = (value) => ({ content: [{ type: 'text', text: value }] })
let child
export default function fakeExtension(pi) {
  pi.registerTool({
    name: 'spawn_supervisor',
    async execute(_call, _params, _signal, _update, ctx) {
      const runDir = join(ctx.cwd, '.loops', 'supervisor', id)
      mkdirSync(runDir, { recursive: true })
      appendFileSync(join(runDir, 'journal.jsonl'), JSON.stringify({ kind: 'spawned', id, label: 'root' }) + '\\n')
      appendFileSync(join(runDir, 'journal.jsonl'), JSON.stringify({ kind: 'spawned', id: id + ':s1', parent: id, label: 'w-0' }) + '\\n')
      const readyPath = join(ctx.cwd, 'terminal-worker-ready.txt')
      child = spawn(process.execPath, ['-e', ${JSON.stringify(workerScript)}, join(ctx.cwd, 'terminal-worker-cleaned.txt'), readyPath], {
        detached: true,
        stdio: 'ignore',
      })
      writeFileSync(join(ctx.cwd, 'terminal-worker.pid'), String(child.pid))
      while (!existsSync(readyPath)) await new Promise((resolve) => setTimeout(resolve, 5))
      writeFileSync(join(runDir, 'state.json'), JSON.stringify({ status: '${status}', error: 'fixture terminal state' }))
      return text('spawned supervisor ' + id)
    },
  })
  pi.registerTool({
    name: 'supervisor_cancel',
    async execute(_call, _params, _signal, _update, ctx) {
      appendFileSync(join(ctx.cwd, 'terminal-cancel-count.txt'), '1\\n')
      process.kill(-child.pid, 'SIGTERM')
      await new Promise((resolve) => child.once('close', resolve))
      const runDir = join(ctx.cwd, '.loops', 'supervisor', id)
      appendFileSync(join(runDir, 'journal.jsonl'), JSON.stringify({ kind: 'cancelled', id: id + ':s1' }) + '\\n')
      writeFileSync(join(runDir, 'state.json'), JSON.stringify({ status: 'cancelled' }))
      return text('terminal worker settled')
    },
  })
}
`)

      const result = await run(process.execPath, [
        '--import', 'tsx', runSupervisorShim, extension, workspace, params,
      ], {
        timeoutMs: 5_000,
        killGraceMs: 500,
        env: {
          ...process.env,
          DRIVER_DEADLINE_MS: '60000',
          DRIVER_POLL_MS: '10',
          DRIVER_CANCEL_TIMEOUT_MS: '2000',
        },
      })
      const workerPid = Number(await readFile(join(workspace, 'terminal-worker.pid'), 'utf8'))
      workerPids.push(workerPid)

      expect(result.code, result.stdout + result.stderr).toBe(1)
      expect(result.timedOut).toBe(false)
      expect(result.stdout).toContain(`[done] id=sup-6-${status}12 status=${status}`)
      expect(result.stdout).toContain('worker settlement: workers=1, terminal=1')
      expect(await readFile(join(workspace, 'terminal-cancel-count.txt'), 'utf8')).toBe('1\n')
      expect(await readFile(join(workspace, 'terminal-worker-cleaned.txt'), 'utf8')).toBe('clean')
      await expect(access(`/proc/${workerPid}`)).rejects.toMatchObject({ code: 'ENOENT' })
    },
    15_000,
  )
})
