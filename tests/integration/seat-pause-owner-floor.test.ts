import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { compileFixture } from '../helpers/compile-fixture'

let fixture: Awaited<ReturnType<typeof compileFixture>>
beforeAll(async () => {
  fixture = await compileFixture('tests/helpers/seat-pause-owner-floor-child.ts')
})
afterAll(async () => {
  await fixture?.dispose()
})
const run = (directory: string, phase: string) =>
  new Promise<{
    code: number | null
    signal: NodeJS.Signals | null
    stdout: string
    stderr: string
  }>((resolve, reject) => {
    const child = spawn(process.execPath, [fixture.path, directory, phase], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 12_000,
      killSignal: 'SIGKILL',
    })
    let stdout = '',
      stderr = ''
    child.stdout.on('data', (data) => {
      stdout += data
    })
    child.stderr.on('data', (data) => {
      stderr += data
    })
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
it('cold-resumes original backing before cash top-ups without lending the root owner floor', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'seat-owner-floor-'))
  const context = createFileRunContext(join(directory, 'run'), { withDriver: true })
  try {
    const killed = await run(directory, 'kill')
    expect(killed.signal, killed.stderr + killed.stdout).toBe('SIGKILL')
    const before = (await context.journal.loadTree('seat-owner-floor'))!
    expect(before.findLast((event) => event.kind === 'reconciled')).toMatchObject({
      reservation: { maxTokens: 0 },
    })
    const nativeBefore = (await readFile(join(directory, 'native.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(nativeBefore.map((entry) => entry.name)).toEqual(['prefix', 'sibling'])
    const resumed = await run(directory, 'resume')
    const after = (await context.journal.loadTree('seat-owner-floor'))!
    expect(resumed.code, resumed.stderr + JSON.stringify(after.slice(-12))).toBe(0)
    expect(JSON.parse(resumed.stdout).result.spentTotal.tokens.input).toBe(20)
    expect(
      JSON.parse(await readFile(join(directory, 'restored-budget.json'), 'utf8')),
    ).toMatchObject({ committedTokens: 10, reservedTokens: 10, tokensLeft: 80 })
    expect(JSON.parse(await readFile(join(directory, 'final-budget.json'), 'utf8'))).toMatchObject({
      committedTokens: 20,
      reservedTokens: 0,
      tokensLeft: 80,
    })
    const nativeAfter = (await readFile(join(directory, 'native.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(nativeAfter).toHaveLength(3)
    expect(nativeAfter.slice(0, 2)).toEqual(nativeBefore)
    expect(nativeAfter[2].name).toBe('manager-after')
    const grants = after.filter(
      (event) => event.kind === 'admission-granted' && event.id === 'seat-owner-floor:s0',
    )
    expect(grants).toHaveLength(2)
    expect(grants[1]).toMatchObject({
      deadlineArmedAt: grants[0]!.deadlineArmedAt,
      deadlineAt: grants[0]!.deadlineAt,
    })
    expect(grants[1]!.attemptId.length).toBeGreaterThan(0)
    const siblingGrants = after.filter(
      (event) => event.kind === 'admission-granted' && event.id === 'seat-owner-floor:s1',
    )
    expect(siblingGrants).toHaveLength(2)
    expect(siblingGrants[1]).toMatchObject({
      deadlineArmedAt: siblingGrants[0]!.deadlineArmedAt,
      deadlineAt: siblingGrants[0]!.deadlineAt,
    })
    const siblingTerminal = after.findIndex(
      (event) => event.kind === 'settled' && event.id === 'seat-owner-floor:s1',
    )
    expect(siblingTerminal).toBeGreaterThan(0)
    const siblingRefund = after.findIndex(
      (event) =>
        event.kind === 'reconciled' &&
        event.id === 'seat-owner-floor:s1' &&
        event.reservation?.maxTokens === 0,
    )
    expect(siblingRefund).toBeGreaterThan(0)
    expect(after.indexOf(grants[1]!)).toBeGreaterThan(siblingRefund)
    expect(
      after.filter((event) => event.kind === 'spawned' && event.id === 'seat-owner-floor:s1'),
    ).toHaveLength(1)
    expect(after.slice(0, before.length)).toEqual(before)
  } finally {
    await writeFile(join(directory, 'release-sibling'), 'cleanup')
    const end = Date.now() + 1000
    while (
      Date.now() < end &&
      !(await readFile(join(directory, 'sibling-done')).catch(() => undefined))
    )
      await new Promise((resolve) => setTimeout(resolve, 5))
    await rm(directory, { recursive: true, force: true })
  }
})
