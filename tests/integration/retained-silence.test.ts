import { execFile, spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, expect, it } from 'vitest'
import { appendCommittedJsonLine, readCommittedJsonLines } from '../../src/durable/jsonl-file'
import { RetainedObservation } from '../../src/runtime/environment-provider/provider-retained-observation'
import { exactSession } from '../../src/runtime/retained-run-binding'
import { startRetainedRun } from '../../src/runtime/retained-run-start'
import {
  type DriverAttemptRecord,
  DriverAttemptsExhaustedError,
} from '../../src/runtime/supervise/driver-attempt-evidence'
import { runDriverWithRetry } from '../../src/runtime/supervise/driver-retry'
import { RetainedExecutionPendingError } from '../../src/runtime/supervise/retained-executor'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'

const quietMs = 300
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function nativeRun(mode: 'duplicate' | 'progress' | 'held' | 'closed' | 'probe') {
  const directory = await mkdtemp(join(tmpdir(), 'retained-silence-'))
  const child = spawn(process.execPath, ['tests/helpers/retained-silence-native.cjs', directory], {
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const stop = new AbortController()
  const deadline = setTimeout(() => stop.abort(new Error('proof deadline')), 5_000)
  const pending = new Map<number, (value: unknown) => void>()
  let sequence = 0
  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    const response = JSON.parse(line)
    pending.get(response.id)?.(response.value)
    pending.delete(response.id)
  })
  const command = (op: string, input = {}) =>
    new Promise<unknown>((resolve) => {
      const id = ++sequence
      pending.set(id, resolve)
      child.stdin.write(`${JSON.stringify({ id, op, ...input })}\n`)
    })
  cleanups.push(async () => {
    clearTimeout(deadline)
    stop.abort()
    const exited =
      child.exitCode !== null || child.signalCode !== null
        ? Promise.resolve()
        : new Promise<void>((resolve) => child.once('close', () => resolve()))
    child.kill('SIGKILL')
    await exited
    lines.close()
    await rm(directory, { recursive: true, force: true })
  })
  const base = durableRetainedProvider(join(directory, 'provider.json'))
  let dispatches = 0
  const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
    ...environment,
    async dispatch(turn) {
      dispatches++
      const dispatched = await environment.dispatch!(turn)
      await command('start', { mode, quietMs })
      return dispatched
    },
    session(id, options) {
      const session = environment.session!(id, options)
      return {
        ...session,
        status: async () => (await command('status')) as 'running',
        async *events(options): AsyncIterable<AgentEnvironmentEvent> {
          let offset = 0
          while (!stop.signal.aborted && !options?.signal?.aborted) {
            const rows = (await readFile(join(directory, 'events.jsonl'), 'utf8'))
              .trim()
              .split('\n')
            for (const row of rows.slice(offset)) yield JSON.parse(row)
            offset = rows.length
            if (mode === 'closed') return
            await delay(10, undefined, { signal: stop.signal })
          }
        },
        async result() {
          while (!stop.signal.aborted) {
            if (
              await access(join(directory, 'result')).then(
                () => true,
                () => false,
              )
            )
              return session.result()
            await delay(10, undefined, { signal: stop.signal })
          }
          throw stop.signal.reason
        },
      }
    },
  })
  const provider: AgentEnvironmentProvider = {
    ...base,
    create: async (input) => wrap(await base.create(input)),
    get: async (id) => {
      const environment = await base.get!(id)
      return environment && wrap(environment)
    },
  }
  const handle = await startRetainedRun({
    provider,
    environment: {
      idempotencyKey: 'silence',
      profile: {
        name: 'native',
        harness: 'opencode',
        model: { provider: 'fixture', default: 'fixture/native' },
      },
    },
    turn: { turnId: 'native-turn', prompt: 'offline native work' },
    journalRoot: join(directory, 'admissions'),
    async onAdmission(admission) {
      await appendCommittedJsonLine(join(directory, 'admissions.jsonl'), admission)
    },
  })
  const environment = (await provider.get!(handle.controlRef.environmentId))!
  const session = exactSession(environment, handle.controlRef).session
  const journal = join(directory, 'observed.jsonl')
  return { directory, child, stop, handle, session, command, journal, dispatches: () => dispatches }
}

it.each(['duplicate', 'closed'] as const)(
  'bounds %s observation and unchanged pending retry without destroying or redispatching the live invocation',
  async (mode) => {
    const fixture = await nativeRun(mode)
    const records: DriverAttemptRecord[] = []
    let failure: unknown
    try {
      await runDriverWithRetry({
        async drive() {
          try {
            const observation = new RetainedObservation(
              fixture.handle,
              fixture.stop.signal,
              undefined,
              quietMs,
            )
            for await (const event of observation.observe(fixture.session))
              await appendCommittedJsonLine(fixture.journal, event)
          } catch (cause) {
            throw new RetainedExecutionPendingError(cause)
          }
        },
        progress: () => ({ poolTokensSpent: 0, settledCount: 0, submitted: false }),
        budget: () => ({
          tokensLeft: 100,
          tokensKnown: true,
          cacheBreakdownKnown: true,
          usdLeft: 0,
          usdCapped: false,
          usdKnown: true,
          iterationsLeft: 10,
          deadlineMs: 0,
          reservedTokens: 0,
        }),
        signal: fixture.stop.signal,
        policy: {
          initialBackoffMs: 1,
          maxBackoffMs: 1,
          transientOutageMs: 0,
          maxConsecutiveFailures: 2,
        },
        async resolvePending(pending) {
          expect(pending.pendingCause).toBe('unobservable')
          expect((await fixture.handle.status()).status).toBe('running')
          return false
        },
        async onAttempt(record) {
          records.push(record)
          await appendCommittedJsonLine(join(fixture.directory, 'attempts.jsonl'), record)
        },
      })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(DriverAttemptsExhaustedError)
    expect(records).toHaveLength(2)
    expect(records.at(-1)).toMatchObject({
      stop: 'no-progress',
      pendingCause: 'unobservable',
      classification: 'transient',
      failureKind: 'infra',
      madeProgress: false,
    })
    expect(records[0]?.error).toContain('RetainedStreamError')
    expect(fixture.child.exitCode).toBeNull()
    expect((await fixture.handle.status()).status).toBe('running')
    expect(fixture.dispatches()).toBe(1)
    const stored = JSON.parse(await readFile(join(fixture.directory, 'provider.json'), 'utf8'))
    expect(
      stored.environments[fixture.handle.controlRef.environmentId].sessions[
        fixture.handle.controlRef.sessionId!
      ].controlRef,
    ).toEqual(fixture.handle.controlRef)
    const observed = []
    for await (const row of readCommittedJsonLines<AgentEnvironmentEvent>(fixture.journal))
      observed.push(row)
    expect(observed.filter((row) => row.type === 'result')).toEqual([])
    expect(observed.filter((row) => row.type === 'message')).toHaveLength(2)
    expect(JSON.stringify(observed)).toContain('awaitingResultSince')
    const protocol = await readFile(join(fixture.directory, 'protocol.jsonl'), 'utf8')
    expect(protocol.match(/"op":"status"/g)?.length).toBeGreaterThanOrEqual(3)
    expect(protocol).not.toMatch(/cancel|destroy/)
    await fixture.command('finish')
    expect(await fixture.handle.result()).toMatchObject({ success: true, text: 'durable result' })
  },
)

it('lets distinct native frames and an exact result outlive the quiet interval', async () => {
  const fixture = await nativeRun('progress')
  const started = Date.now()
  const rows = []
  for await (const row of new RetainedObservation(
    fixture.handle,
    fixture.stop.signal,
    undefined,
    quietMs,
  ).observe(fixture.session)) {
    await appendCommittedJsonLine(fixture.journal, row)
    rows.push(row)
    if ('id' in row && row.id === 'event-5') await fixture.command('finish')
  }
  expect(Date.now() - started).toBeGreaterThan(quietMs * 2)
  expect(rows.filter((row) => 'type' in row && row.type === 'message')).toHaveLength(6)
  expect(rows.at(-1)).toMatchObject({ type: 'result', data: { success: true } })
  expect(fixture.dispatches()).toBe(1)
})

it('excludes a consumer blocked on real filesystem persistence from provider silence', async () => {
  const fixture = await nativeRun('held')
  const iterator = new RetainedObservation(
    fixture.handle,
    fixture.stop.signal,
    undefined,
    quietMs,
  ).observe(fixture.session)
  expect((await iterator.next()).value).toMatchObject({ type: 'message' })
  const fifo = join(fixture.directory, 'persistence.fifo')
  await promisify(execFile)('mkfifo', [fifo])
  const persistence = readFile(fifo, 'utf8')
  await delay(quietMs * 3)
  await fixture.command('unblock')
  expect(await persistence).toBe('committed')
  const resumed = Date.now()
  expect((await iterator.next()).value).toHaveProperty('awaitingResultSince')
  expect(Date.now() - resumed).toBeGreaterThan(quietMs / 2)
  const awaitingPersistence = readFile(fifo, 'utf8')
  await delay(quietMs * 3)
  await fixture.command('unblock')
  expect(await awaitingPersistence).toBe('committed')
  const next = iterator.next()
  void next.catch(() => {})
  await delay(quietMs / 3)
  expect(await readFile(join(fixture.directory, 'protocol.jsonl'), 'utf8')).not.toContain('status')
  await fixture.command('finish')
  expect((await next).value).toMatchObject({ type: 'result', data: { success: true } })
  expect((await iterator.next()).done).toBe(true)
})

it('accepts the exact result that arrives while a live-status read is outstanding', async () => {
  const fixture = await nativeRun('probe')
  const answer = (async () => {
    while (!fixture.stop.signal.aborted) {
      const protocol = await readFile(join(fixture.directory, 'protocol.jsonl'), 'utf8')
      if (protocol.includes('status-enter')) {
        await fixture.command('finish')
        return
      }
      await delay(10)
    }
  })()
  const rows = []
  try {
    for await (const row of new RetainedObservation(
      fixture.handle,
      fixture.stop.signal,
      undefined,
      quietMs,
    ).observe(fixture.session))
      rows.push(row)
    await answer
    expect(rows.at(-1)).toMatchObject({ type: 'result', data: { success: true } })
  } finally {
    fixture.stop.abort()
    await answer
  }
})
