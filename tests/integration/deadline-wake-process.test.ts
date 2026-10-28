import { once } from 'node:events'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { supervisePursuit } from '../../src/durable'
import { FileSpawnJournal } from '../../src/durable/spawn-journal/journal-store'
import { connectHttpMcp } from '../../src/runtime/http-mcp-client'
import type { Agent, AgentSpec } from '../../src/runtime/supervise/types'
import { testContinuation } from '../helpers/continuation'
import { physicalState, withInPlaceProcess, within } from '../helpers/in-place-process-fixture'
import { runtimeToolDeclarations, testAgentProfile } from '../kernel/test-agent-profile'

it.skipIf(process.platform === 'win32').each(['wait', 'submit', 'debounce'] as const)(
  'delivers one deadline notice over MCP with admitted live processes (%s)',
  async (mode) => {
    await withInPlaceProcess(
      'waiting',
      async (blocking) => {
        const prove = async (workers: (typeof blocking)[]) => {
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
                runDir: blocking.directory,
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
                  const fixture = workers.find((worker) => worker.profile.name === profile.name)
                  if (!fixture) throw new Error('unknown worker')
                  return {
                    name: profile.name,
                    act: async () => {
                      throw new Error('native executor owns execution')
                    },
                    executorSpec: {
                      profile,
                      harness: null,
                      executorFactory: (_spec, context) => {
                        if (!context.node) throw new Error('Scope attempt missing')
                        return fixture.constructExecutor(context.node.attemptId)
                      },
                    },
                  } satisfies Agent<unknown, unknown> & { executorSpec: AgentSpec }
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
                          worker.ready(),
                          once(scope.signal, 'abort').then(() => {
                            throw scope.signal.reason
                          }),
                        ])
                        expect(physicalState(worker.readyValue!)).toMatchObject({
                          leaderPresent: true,
                          childPresent: true,
                          groupPresent: true,
                        })
                      }
                      expect(
                        await call('submit_result', { result: { answer: 'too-early' } }),
                      ).toMatchObject({ accepted: false, error: 'open-work' })
                      if (mode === 'debounce')
                        release = setTimeout(
                          () => process.kill(-workers[1]!.readyValue!.leader, 'SIGTERM'),
                          Math.max(0, scope.budget.deadlineMs - 1_900 - Date.now()),
                        )
                      return
                    }
                    expect(String(task)).toContain("The run's deadline is in")
                    expect(String(task)).toContain('Submit your best result now with submit_result')
                    expect(String(task)).toContain(`Workers running: ${workerIds[0]}`)
                    expect(physicalState(blocking.readyValue!)).toMatchObject({
                      leaderPresent: true,
                      childPresent: true,
                      groupPresent: true,
                    })
                    if (mode === 'debounce') {
                      expect(settlements.get(workerIds[1]!)).toBeLessThan(
                        scope.budget.deadlineMs - 1_500,
                      )
                      expect(physicalState(workers[1]!.readyValue!)).toMatchObject({
                        leaderPresent: false,
                        childPresent: false,
                        groupPresent: false,
                      })
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
            if (mode === 'wait')
              expect(result).toMatchObject({ kind: 'no-winner', reason: 'deadline' })
            else expect(result).toMatchObject({ kind: 'winner', out: { answer: 'best-so-far' } })
            const events = await new FileSpawnJournal(
              join(blocking.directory, 'spawn-journal.jsonl'),
            ).loadTree('deadline-proof')
            for (const id of workerIds)
              expect(
                events?.filter((event) => event.kind === 'spawned' && event.id === id),
              ).toHaveLength(1)
            for (const worker of workers) {
              await within(worker.executor.teardown('infinity'))
              expect(physicalState(worker.readyValue!)).toEqual({
                leaderPresent: false,
                childPresent: false,
                groupPresent: false,
                inputPresent: false,
              })
            }
          } finally {
            clearTimeout(release)
            abort.abort(new Error('deadline process proof cleanup'))
            await run?.catch(() => undefined)
          }
        }
        if (mode === 'debounce')
          await withInPlaceProcess(
            'waiting',
            (finishing) => prove([blocking, finishing]),
            'finishing',
          )
        else await prove([blocking])
      },
      'blocking',
    )
  },
)
