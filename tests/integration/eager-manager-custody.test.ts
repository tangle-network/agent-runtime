import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { replaySpawnTree } from '../../src/durable/spawn-journal/replay'
import { loadSpawnForest } from '../../src/durable/spawn-journal/spawn-forest'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import type { UnconfirmedTeardown } from '../../src/runtime/supervise/types'
import { compileFixture } from '../helpers/compile-fixture'

let fixture: Awaited<ReturnType<typeof compileFixture>>
beforeAll(async () => {
  fixture = await compileFixture('tests/helpers/eager-manager-custody-child.ts')
})
afterAll(async () => {
  await fixture?.dispose()
})
const runId = 'manager-custody'
async function runPhase(directory: string, phase: string) {
  return new Promise<{
    code: number | null
    signal: NodeJS.Signals | null
    stdout: string
    stderr: string
  }>((resolve, reject) => {
    const child = spawn(process.execPath, [fixture.path, directory, phase], {
      cwd: process.cwd(),
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

it.each(['kill', 'complete', 'refuse'] as const)(
  'keeps manager custody truthful across parent terminal publication (%s)',
  async (phase) => {
    const directory = await mkdtemp(join(tmpdir(), 'eager-manager-custody-'))
    try {
      const first = await runPhase(directory, phase)
      expect(phase === 'kill' ? first.signal : first.code, first.stderr + first.stdout).toBe(
        phase === 'kill' ? 'SIGKILL' : 0,
      )
      const context = createFileRunContext(join(directory, 'run'), { withDriver: true })
      const forest = await loadSpawnForest(context.journal, runId)
      const manager = forest.nodes.find((node) => node.label === 'manager')!
      expect(manager, first.stderr + first.stdout).toBeDefined()
      const terminal = forest.events.filter(
        ({ treeRoot, event }) =>
          treeRoot === runId && event.kind === 'settled' && event.id === manager.id,
      )
      expect(terminal).toHaveLength(1)
      expect(terminal[0]!.event).toMatchObject({ status: 'done' })
      const admission = forest.events.find(
        ({ event }) =>
          event.id === manager.id &&
          event.kind === 'execution-admitted' &&
          event.admission.phase === 'environment',
      )!.event
      if (admission.kind !== 'execution-admitted' || admission.admission.phase !== 'environment')
        throw new Error('native manager environment missing')
      const admitted = admission.admission
      const environmentId = admitted.environmentId
      const dispatch = forest.events.find(
        ({ event }) =>
          event.id === manager.id &&
          event.kind === 'execution-admitted' &&
          event.admission.phase === 'dispatched',
      )!.event
      if (dispatch.kind !== 'execution-admitted' || dispatch.admission.phase !== 'dispatched')
        throw new Error('exact manager dispatch missing')
      expect(dispatch.admission.controlRef).toMatchObject({
        provider: admitted.provider,
        environmentId,
      })
      const receipts = forest.events.filter(
        ({ event }) =>
          event.kind === 'environment-teardown' &&
          event.id === manager.id &&
          event.environmentId === environmentId &&
          event.destroyed,
      )
      const providerState = JSON.parse(await readFile(join(directory, 'provider.json'), 'utf8'))
      const moments = (await readFile(join(directory, 'moments.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      expect(moments.some((entry) => entry.what === 'coordination-http')).toBe(true)
      expect(
        moments.filter(
          (entry) => entry.what === 'dispatch' && entry.environmentId === environmentId,
        ),
      ).toHaveLength(1)
      if (phase === 'complete') {
        expect(receipts).toHaveLength(1)
        expect(providerState.environments[environmentId]).toBeUndefined()
        expect(
          moments.filter(
            (entry) => entry.what === 'destroy-acked' && entry.environmentId === environmentId,
          ),
        ).toHaveLength(1)
        return
      }
      expect(providerState.environments[environmentId]).toBeDefined()
      expect(receipts).toEqual([])
      expect(
        providerState.environments[environmentId].sessions[dispatch.admission.controlRef.sessionId]
          .controlRef,
      ).toEqual(dispatch.admission.controlRef)
      const namesCustody = (entry: Pick<UnconfirmedTeardown, 'id' | 'environments' | 'kept'>) =>
        entry.id === manager.id &&
        [...(entry.environments ?? []), ...(entry.kept ?? [])].some(
          (ref) => ref.provider === admitted.provider && ref.environmentId === environmentId,
        )
      if (phase === 'refuse') {
        expect(JSON.parse(first.stdout.trim()).teardownUnconfirmed?.some(namesCustody)).toBe(true)
        expect(
          forest.events.some(
            ({ event }) => event.kind === 'teardown-unconfirmed' && namesCustody(event),
          ),
        ).toBe(true)
      }
      const replayData = async () =>
        (await replaySpawnTree(context.journal, context.blobs, runId)).map(
          ({ handle, ...result }) => {
            const { abort: _abort, ...identity } = handle
            return { ...result, handle: identity }
          },
        )
      const replay = await replayData()
      const cancelled = await runPhase(directory, 'cancel')
      expect(cancelled.code, cancelled.stderr + cancelled.stdout).toBe(0)
      const result = JSON.parse(cancelled.stdout.trim())
      expect(result).toMatchObject({ kind: 'no-winner', reason: 'cancelled' })
      expect(result.teardownUnconfirmed?.some(namesCustody)).toBe(true)
      const after = await loadSpawnForest(context.journal, runId)
      expect(
        after.events.filter(
          ({ treeRoot, event }) =>
            treeRoot === runId && event.kind === 'settled' && event.id === manager.id,
        ),
      ).toEqual(terminal)
      expect(await replayData()).toEqual(replay)
      expect(
        after.events.some(
          ({ event }) => event.kind === 'teardown-unconfirmed' && namesCustody(event),
        ),
      ).toBe(true)
      expect(
        after.events.filter(
          ({ event }) => event.kind === 'teardown-confirmed' && event.id === manager.id,
        ),
      ).toEqual([])
      expect(await readFile(join(directory, 'moments.jsonl'), 'utf8')).toBe(
        `${moments.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
      )
      expect(
        JSON.parse(await readFile(join(directory, 'provider.json'), 'utf8')).environments[
          environmentId
        ],
      ).toBeDefined()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)
