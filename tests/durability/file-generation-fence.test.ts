import { type ChildProcess, spawn } from 'node:child_process'
import { appendFile, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'

const children = new Set<ChildProcess>()
const directories: string[] = []
const fixture = fileURLToPath(
  new URL('../helpers/durability/file-generation-child.ts', import.meta.url),
)
const tsx = createRequire(import.meta.url).resolve('tsx')

afterEach(async () => {
  await Promise.all(
    [...children].map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) return resolve()
          child.once('exit', () => resolve())
          child.kill('SIGKILL')
        }),
    ),
  )
  children.clear()
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function start(dir: string, mode: string) {
  const child = spawn(process.execPath, ['--import', tsx, fixture, dir, mode], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  })
  children.add(child)
  const messages: Array<{ type: string; generation?: number; outcomes?: Record<string, string> }> =
    []
  let error = ''
  child.stderr!.on('data', (chunk) => {
    error += String(chunk)
  })
  child.on('message', (message) => messages.push(message as (typeof messages)[number]))
  return {
    child,
    async message(type: string) {
      const deadline = Date.now() + 30_000
      while (Date.now() < deadline) {
        const found = messages.find((message) => message.type === type)
        if (found) return found
        if (child.exitCode !== null || child.signalCode !== null)
          throw new Error(`child exited: ${error}`)
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      throw new Error(`child did not report ${type}: ${error}`)
    },
  }
}

it('fences every stale store after a second process acquires the next generation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'file-generation-'))
  directories.push(dir)
  const first = start(dir, 'first')
  const a = await first.message('acquired')
  first.child.send('release')
  await first.message('released')
  const second = start(dir, 'second')
  const b = await second.message('acquired')
  expect(b.generation).toBe(a.generation! + 1)
  await Promise.all(
    ['spawn-journal.jsonl', 'observer.jsonl'].map((name) => appendFile(join(dir, name), '{"torn"')),
  )
  const before = await Promise.all(
    ['spawn-journal.jsonl', 'observer.jsonl'].map((name) => readFile(join(dir, name), 'utf8')),
  )
  first.child.send('write')
  const { outcomes } = await first.message('writes')
  expect(Object.keys(outcomes!)).toEqual(['journal', 'observer', 'blob', 'record'])
  for (const outcome of Object.values(outcomes!)) expect(outcome).toContain('lost its claim')
  expect(
    await Promise.all(
      ['spawn-journal.jsonl', 'observer.jsonl'].map((name) => readFile(join(dir, name), 'utf8')),
    ),
  ).toEqual(before)
  expect(await readdir(join(dir, 'blobs'))).toEqual([])
  await expect(readFile(join(dir, 'cancellations/run.request.json'))).rejects.toMatchObject({
    code: 'ENOENT',
  })
  // Old release is idempotent and cannot erase the new owner's claim.
  first.child.send('exit')
  second.child.send('write')
  const current = await second.message('writes')
  expect(Object.values(current.outcomes!)).toEqual(['WRITTEN', 'WRITTEN', 'WRITTEN', 'WRITTEN'])
  second.child.send('exit')
}, 90_000)

it('recovers a killed owner and its in-flight mutation claim through Eval dead-owner evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'file-generation-crash-'))
  directories.push(dir)
  const first = start(dir, 'hold-mutation')
  const a = await first.message('acquired')
  const exited = new Promise<void>((resolve) => first.child.once('exit', () => resolve()))
  first.child.kill('SIGKILL')
  await exited
  const second = start(dir, 'recovered')
  const b = await second.message('acquired')
  expect(b.generation).toBe(a.generation! + 1)
  second.child.send('write')
  const current = await second.message('writes')
  expect(Object.values(current.outcomes!)).toEqual(['WRITTEN', 'WRITTEN', 'WRITTEN', 'WRITTEN'])
  second.child.send('exit')
}, 90_000)
