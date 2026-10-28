import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { expect, it } from 'vitest'
import { supervisePursuit } from '../../src/durable'
import { FileSpawnJournal } from '../../src/durable/spawn-journal/journal-store'
import type { Agent, AgentSpec, Executor, ExecutorResult } from '../../src/runtime/supervise/types'
import { testContinuation } from '../helpers/continuation'
import { runtimeToolDeclarations, testAgentProfile } from '../kernel/test-agent-profile'

/** A real, prewarmed process; executor entry is proved independently of process startup. */
function workerProcess(name: string) {
  const child = spawn(
    process.execPath,
    [
      '-e',
      "console.log('ready');process.stdin.once('data',()=>{console.log('working');setInterval(()=>{},1000)})",
    ],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  )
  const lines = createInterface({ input: child.stdout })
  const ready = new Promise<void>((resolve, reject) => {
    lines.on('line', (line) => {
      if (line === 'ready') resolve()
    })
    child.once('error', reject)
    child.once('close', () => reject(new Error('child closed before readiness')))
  })
  const working = new Promise<void>((resolve) => {
    lines.on('line', (line) => {
      if (line === 'working') resolve()
    })
  })
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
  let enter!: () => void
  const entered = new Promise<void>((resolve) => {
    enter = resolve
  })
  const profile = testAgentProfile(name)
  const executor: Executor<unknown> = {
    runtime: 'local-process',
    async execute(_task, signal) {
      signal.throwIfAborted()
      const abort = () => child.kill('SIGTERM')
      signal.addEventListener('abort', abort, { once: true })
      try {
        child.stdin.write('run\n')
        await Promise.race([
          working,
          closed.then(() => {
            throw new Error('child closed before admitted work')
          }),
        ])
        enter()
        await closed
        if (signal.aborted) throw signal.reason
        return {
          out: { answer: 'child-finished' },
          outRef: `process:${name}`,
          spent: { iterations: 1, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 },
        } satisfies ExecutorResult<unknown>
      } finally {
        signal.removeEventListener('abort', abort)
      }
    },
    async teardown() {
      child.kill('SIGTERM')
      await closed
      return { destroyed: true }
    },
  }
  const agent: Agent<unknown, unknown> & { executorSpec: AgentSpec } = {
    name,
    act: async () => {
      throw new Error('process executor owns execution')
    },
    executorSpec: { profile, harness: null, executor },
  }
  return { child, ready, closed, entered, profile, agent }
}

async function call(
  url: string,
  headers: Readonly<Record<string, string>> | undefined,
  name: string,
  args: unknown,
) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: name,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  const body = await response.json()
  if (!response.ok || body.error || body.result?.isError)
    throw new Error(`coordination refusal: ${JSON.stringify(body)}`)
  return (
    body.result.structuredContent ??
    JSON.parse(body.result.content.find((item: { type: string }) => item.type === 'text').text)
  )
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
    const evidence: unknown[] = []
    const clockOrigin = { wall: Date.now(), monotonic: performance.now() }
    const clock = () => ({
      wall: Date.now() - clockOrigin.wall,
      monotonic: performance.now() - clockOrigin.monotonic,
    })
    let release: ReturnType<typeof setTimeout> | undefined
    let run: ReturnType<typeof supervisePursuit> | undefined
    try {
      await Promise.all(workers.map((worker) => worker.ready))
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
          onDriverAttempt: (record) => {
            evidence.push({ attempt: record, at: Date.now(), clock: clock() })
          },
          onCoordinationEvent: (_context, _eventId, record) => {
            evidence.push({ event: record.event, at: Date.now(), clock: clock() })
            if (record.event.type === 'settled') settlements.set(record.event.worker.id, Date.now())
          },
          budget: { maxIterations: 10, maxTokens: 10_000, deadlineMs: 6_000 },
          perWorker: { maxIterations: 2, maxTokens: 100 },
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
          driveHarness: async ({ coordinationMcpUrl, coordinationMcpHeaders, task, scope }) => {
            tasks.push(String(task))
            evidence.push({ task: tasks.length, clock: clock(), budget: scope.budget })
            if (tasks.length === 1)
              scope.signal.addEventListener(
                'abort',
                () => evidence.push({ abort: String(scope.signal.reason), clock: clock() }),
                { once: true },
              )
            if (tasks.length === 1) {
              for (const worker of workers) {
                const admitted = await call(
                  coordinationMcpUrl,
                  coordinationMcpHeaders,
                  'spawn_worker',
                  { profile: worker.profile, task: 'remain alive until cancellation' },
                )
                expect(admitted.workerId).toBeTypeOf('string')
                workerIds.push(admitted.workerId)
                scope.signal.throwIfAborted()
                await Promise.race([
                  worker.entered,
                  new Promise<never>((_resolve, reject) => {
                    scope.signal.addEventListener('abort', () => reject(scope.signal.reason), {
                      once: true,
                    })
                  }),
                ])
                expect(worker.child.exitCode).toBeNull()
                expect(worker.child.signalCode).toBeNull()
              }
              expect(
                await call(coordinationMcpUrl, coordinationMcpHeaders, 'submit_result', {
                  result: { answer: 'too-early' },
                }),
              ).toMatchObject({ accepted: false, error: 'open-work' })
              if (mode === 'debounce') {
                // A real settlement starts the debounce shortly before the absolute warning.
                release = setTimeout(
                  () => workers[1]?.child.kill('SIGTERM'),
                  Math.max(0, scope.budget.deadlineMs - 1_900 - Date.now()),
                )
              }
              return
            }
            expect(String(task)).toContain("The run's deadline is in")
            expect(String(task)).toContain('Submit your best result now with submit_result')
            expect(String(task)).toContain(`Workers running: ${workerIds[0]}`)
            expect(workers[0]?.child.exitCode).toBeNull()
            expect(workers[0]?.child.signalCode).toBeNull()
            if (mode === 'debounce') {
              expect(settlements.get(workerIds[1]!)).toBeLessThan(scope.budget.deadlineMs - 1_500)
              expect(workers[1]?.child.signalCode).toBe('SIGTERM')
            }
            expect(scope.signal.aborted).toBe(false)
            expect(Date.now()).toBeGreaterThanOrEqual(scope.budget.deadlineMs - 2_000)
            expect(Date.now()).toBeLessThan(scope.budget.deadlineMs - 500)
            if (mode !== 'wait')
              expect(
                await call(coordinationMcpUrl, coordinationMcpHeaders, 'submit_result', {
                  result: { answer: 'best-so-far' },
                }),
              ).toMatchObject({ accepted: true })
          },
        },
      )
      const { result } = await run
      expect(tasks, JSON.stringify({ result, evidence, clock: clock() })).toHaveLength(2)
      expect(tasks.filter((task) => task.includes("The run's deadline is in"))).toHaveLength(1)
      expect(result.kind).toBe(mode === 'wait' ? 'no-winner' : 'winner')
      if (mode === 'wait') expect(result).toMatchObject({ reason: 'deadline' })
      else expect(result).toMatchObject({ out: { answer: 'best-so-far' } })
      const events = await new FileSpawnJournal(join(directory, 'spawn-journal.jsonl')).loadTree(
        'deadline-proof',
      )
      for (const id of workerIds)
        expect(events?.filter((event) => event.kind === 'spawned' && event.id === id)).toHaveLength(
          1,
        )
      await Promise.all(workers.map((worker) => worker.closed))
      for (const worker of workers)
        expect(worker.child.exitCode !== null || worker.child.signalCode !== null).toBe(true)
    } finally {
      clearTimeout(release)
      abort.abort(new Error('deadline process proof cleanup'))
      for (const worker of workers) worker.child.kill('SIGTERM')
      await Promise.all(workers.map((worker) => worker.closed))
      await run?.catch(() => undefined)
      await rm(directory, { recursive: true, force: true })
    }
  },
)
