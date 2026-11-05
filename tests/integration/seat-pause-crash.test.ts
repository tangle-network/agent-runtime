import { spawn } from 'node:child_process'
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { compileFixture } from '../helpers/compile-fixture'

let fixture: Awaited<ReturnType<typeof compileFixture>>
beforeAll(async () => {
  fixture = await compileFixture('tests/helpers/seat-pause-crash-child.ts')
})
afterAll(async () => {
  await fixture?.dispose()
})
async function run(directory: string, phase: string, scenario = 'quiescent') {
  return new Promise<{
    code: number | null
    signal: NodeJS.Signals | null
    stdout: string
    stderr: string
  }>((resolve, reject) => {
    const child = spawn(process.execPath, [fixture.path, directory, phase, scenario], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20_000,
      killSignal: 'SIGKILL',
    })
    let stdout = '',
      stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
}
it.each(['quiescent', 'overrun'])(
  'restores an ACKed pause prefix after actual process death without replaying its spend (%s)',
  async (scenario) => {
    const overrun = scenario === 'overrun'
    const directory = await mkdtemp(join(tmpdir(), 'seat-crash-'))
    const cold = `${directory}-cold`
    try {
      const killed = await run(directory, 'kill', scenario)
      expect(killed.signal, killed.stderr + killed.stdout).toBe('SIGKILL')
      const context = createFileRunContext(join(directory, 'run'), { withDriver: true })
      const before = (await context.journal.loadTree('seat-crash'))!
      const prefix = before.findLast((event) => event.kind === 'reconciled')
      expect(prefix).toMatchObject({
        spent: { iterations: 0 },
        reservation: {
          maxTokens: overrun ? 60 : 0,
          maxUsd: overrun ? 6 : 0,
          resources: { io: { limit: overrun ? 6 : 0 } },
        },
      })
      expect(await readFile(join(directory, 'processes'), 'utf8')).toBe(
        overrun ? 'before\nnested\n' : 'before\n',
      )
      await cp(directory, cold, { recursive: true })
      const coldResult = await run(cold, 'cold', scenario)
      expect(coldResult.code, coldResult.stderr + coldResult.stdout).toBe(0)
      const resumed = await run(directory, 'resume', scenario)
      expect(resumed.code, resumed.stderr + resumed.stdout).toBe(0)
      const data = JSON.parse(resumed.stdout.trim())
      expect(data.result.spentTotal).toMatchObject({
        iterations: overrun ? 3 : 2,
        tokens: { input: overrun ? 70 : 20, output: 0 },
        usd: overrun ? 7 : 2,
      })
      expect(data.result.spentTotal.resources.io).toEqual({
        unit: 'bytes',
        amount: overrun ? 3 : 2,
        known: true,
      })
      expect(data.processes).toBe(overrun ? 'before\nnested\nafter\n' : 'before\nafter\n')
      const after = (await context.journal.loadTree('seat-crash'))!
      const grants = after.filter((event) => event.kind === 'admission-granted')
      expect(grants).toHaveLength(2)
      expect(grants[1]).toMatchObject({
        deadlineArmedAt: grants[0]!.deadlineArmedAt,
        deadlineAt: grants[0]!.deadlineAt,
      })
      expect(after.slice(0, before.length)).toEqual(before)
    } finally {
      await rm(directory, { recursive: true, force: true })
      await rm(cold, { recursive: true, force: true })
    }
  },
)
