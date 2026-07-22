import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { runSupervisorShim } from './arms.ts'
import { run } from './proc.ts'

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
})
