import { type ChildProcess, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { supervisePursuit } from '../../src/durable'
import { FileSpawnJournal } from '../../src/durable/spawn-journal/journal-store'
import { connectHttpMcp } from '../../src/runtime/http-mcp-client'
import type { Agent } from '../../src/runtime/supervise/types'
import { testContinuation } from '../helpers/continuation'
import { runtimeToolDeclarations, testAgentProfile } from '../kernel/test-agent-profile'

/** Runtime admission starts the actual child; IPC acknowledges work before the manager waits. */
function workerProcess(name: string) {
  const entered = Promise.withResolvers<void>()
  let child: ChildProcess | undefined
  let closed = Promise.resolve()
  const stop = async () => {
    child?.kill('SIGTERM')
    await closed
  }
  const profile = testAgentProfile(name)
  const agent: Agent<unknown, unknown> = {
    name,
    async act(_task, { signal }) {
      signal.throwIfAborted()
      child = spawn(process.execPath, ['-e', "process.send('working');setInterval(()=>{},1000)"], {
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      })
      closed = new Promise<void>((resolve) => child!.once('close', () => resolve()))
      const abort = () => {
        child?.kill('SIGTERM')
      }
      signal.addEventListener('abort', abort, { once: true })
      try {
        expect((await once(child, 'message', { signal }))[0]).toBe('working')
        entered.resolve()
        await closed
        signal.throwIfAborted()
        return { answer: 'child-finished' }
      } finally {
        signal.removeEventListener('abort', abort)
      }
    },
  }
  return {
    profile,
    agent,
    entered: entered.promise,
    stop,
    get child() {
      return child
    },
    get closed() {
      return closed
    },
  }
}

it.each(['wait', 'submit', 'debounce'] as const)(
  'delivers one deadline notice over MCP with admitted live processes (%s)',
  async (mode) => {
    const directory = await mkdtemp(join(tmpdir(), 'deadline-process-'))
    const workers = [
      workerProcess('blocking'),
      ...(mode === 'debounce' ? [workerProcess('finishing')] : []),
    ]
    const abort = new AbortController()
    const tasks: string[] = []
    const workerIds: string[] = []
    const settlements = new Map<string, number>()
    let release: ReturnType<typeof setTimeout> | undefined
    let run: ReturnType<typeof supervisePursuit> | undefined
    try {
      run = supervisePursuit(
        testAgentProfile('deadline-root', {
          tools: runtimeToolDeclarations('spawn_worker', 'submit_result'),
        }),
        'wait for the deadline notice',
        {
          pursuitId: 'deadline-proof',
          runId: 'deadline-proof',
          runDir: directory,
          signal: abort.signal,
          onCoordinationEvent: (_context, _eventId, { event }) => {
            if (event.type === 'settled') settlements.set(event.worker.id, Date.now())
          },
          budget: { maxIterations: 10, maxTokens: 10_000, deadlineMs: 6_000 },
          wake: {
            deadlineWarningMs: 1_500,
            heartbeatMs: 60_000,
            debounceMs: mode === 'debounce' ? 2_000 : 0,
          },
          continuation: testContinuation({ deadline: 1 }),
          driverRetry: { enabled: false },
          deliverable: {
            check: (out: unknown) =>
              (out as { answer?: string } | undefined)?.answer === 'best-so-far',
          },
          makeWorkerAgent: (profile) => {
            const worker = workers.find((candidate) => candidate.profile.name === profile.name)
            if (!worker) throw new Error('unknown worker')
            return worker.agent
          },
          driveHarness: async ({
            coordinationMcpUrl: url,
            coordinationMcpHeaders: protectedHeaders,
            task,
            scope,
          }) => {
            const connection = await connectHttpMcp({ url, protectedHeaders })
            const call = async (name: string, args: Record<string, unknown>) =>
              JSON.parse(await connection.callTool(name, args))
            try {
              tasks.push(String(task))
              if (tasks.length === 1) {
                for (const worker of workers) {
                  const admitted = await call('spawn_worker', {
                    profile: worker.profile,
                    task: 'remain alive until cancellation',
                  })
                  expect(admitted.workerId).toBeTypeOf('string')
                  workerIds.push(admitted.workerId)
                  scope.signal.throwIfAborted()
                  await Promise.race([
                    worker.entered,
                    once(scope.signal, 'abort').then(() => {
                      throw scope.signal.reason
                    }),
                  ])
                  expect([worker.child?.exitCode, worker.child?.signalCode]).toEqual([null, null])
                }
                expect(
                  await call('submit_result', { result: { answer: 'too-early' } }),
                ).toMatchObject({ accepted: false, error: 'open-work' })
                if (mode === 'debounce')
                  release = setTimeout(
                    () => {
                      workers[1]?.child?.kill('SIGTERM')
                    },
                    Math.max(0, scope.budget.deadlineMs - 1_900 - Date.now()),
                  )
                return
              }
              expect(String(task)).toContain("The run's deadline is in")
              expect(String(task)).toContain('Submit your best result now with submit_result')
              expect(String(task)).toContain(`Workers running: ${workerIds[0]}`)
              expect([workers[0]?.child?.exitCode, workers[0]?.child?.signalCode]).toEqual([
                null,
                null,
              ])
              if (mode === 'debounce') {
                expect(settlements.get(workerIds[1]!)).toBeLessThan(scope.budget.deadlineMs - 1_500)
                expect(workers[1]?.child?.signalCode).toBe('SIGTERM')
              }
              expect(scope.signal.aborted).toBe(false)
              expect(Date.now()).toBeGreaterThanOrEqual(scope.budget.deadlineMs - 2_000)
              expect(Date.now()).toBeLessThan(scope.budget.deadlineMs - 500)
              if (mode !== 'wait')
                expect(
                  await call('submit_result', { result: { answer: 'best-so-far' } }),
                ).toMatchObject({ accepted: true })
            } finally {
              await connection.close()
            }
          },
        },
      )
      const { result } = await run
      expect(tasks, JSON.stringify(result)).toHaveLength(2)
      if (mode === 'wait') expect(result).toMatchObject({ kind: 'no-winner', reason: 'deadline' })
      else expect(result).toMatchObject({ kind: 'winner', out: { answer: 'best-so-far' } })
      const events = await new FileSpawnJournal(join(directory, 'spawn-journal.jsonl')).loadTree(
        'deadline-proof',
      )
      for (const id of workerIds)
        expect(events?.filter((event) => event.kind === 'spawned' && event.id === id)).toHaveLength(
          1,
        )
      await Promise.all(workers.map((worker) => worker.closed))
    } finally {
      clearTimeout(release)
      abort.abort(new Error('deadline process proof cleanup'))
      await Promise.all(workers.map((worker) => worker.stop()))
      await run?.catch(() => undefined)
      await rm(directory, { recursive: true, force: true })
    }
  },
)
