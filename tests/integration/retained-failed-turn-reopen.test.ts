import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { supervisePursuit } from '../../src/durable/supervise-pursuit'
import type { DriverAttemptRecord } from '../../src/runtime/supervise/driver-attempt-evidence'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import type { SpawnEvent } from '../../src/runtime/supervise/types'
import { testContinuation } from '../helpers/continuation'
import { nativeSeatProvider } from '../helpers/native-seat-provider'
import { testAgentProfile } from '../kernel/test-agent-profile'

const FAILURE = 'native fixture work failed'
/** Tokens each native fixture turn reports, failed or not. */
const TURN_TOKENS = 5

function ofKind<K extends SpawnEvent['kind']>(
  events: readonly SpawnEvent[],
  kind: K,
): Array<Extract<SpawnEvent, { kind: K }>> {
  return events.filter((event): event is Extract<SpawnEvent, { kind: K }> => event.kind === kind)
}

function meteredTokens(events: readonly SpawnEvent[]): number {
  return ofKind(events, 'metered').reduce(
    (total, event) => total + event.spend.tokens.input + event.spend.tokens.output,
    0,
  )
}

it('replays a committed failed owner turn once per restart, then dispatches a new turn', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'retained-failed-turn-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const runId = 'retained-failed-turn'
  const runDir = join(directory, 'run')
  const profile = testAgentProfile('root', {
    harness: 'opencode',
    model: { provider: 'fixture', default: 'fixture/native' },
    seats: [
      {
        harness: 'opencode',
        provider: 'fixture',
        model: 'fixture/native',
        selector: { kind: 'all-eligible' },
      },
    ],
  })
  const rows = async (name: string): Promise<any[]> => {
    const text = (await readFile(join(directory, name), 'utf8').catch(() => '')).trim()
    return text === '' ? [] : text.split('\n').map((line) => JSON.parse(line))
  }
  // The check passes only once a native turn has committed a successful answer.
  const succeeded = async () =>
    (await rows('native-output.jsonl')).some((row) => JSON.parse(row.stdout).success === true)
  const journal = async () => (await createFileRunContext(runDir).journal.loadTree(runId)) ?? []
  // Each call is a new coordinator process over the same run directory and provider state.
  const segment = async (
    name: string,
    success: boolean,
    driverRetry: { readonly enabled?: boolean; readonly maxAttempts?: number },
  ) => {
    const native = nativeSeatProvider(directory, { success, recordOutput: true })
    const provider = {
      ...native,
      capabilities: async () => ({
        ...(await native.capabilities()),
        create: { runtimeAttachments: { mcp: true } },
      }),
    }
    const backend = { backend: 'provider' as const, provider }
    const before = await journal()
    const attempts: DriverAttemptRecord[] = []
    const { result } = await supervisePursuit(profile, 'Produce one checked native result.', {
      pursuitId: runId,
      runId,
      runDir,
      backend,
      driverBackend: backend,
      budget: { maxTokens: 1000, maxIterations: 20, deadlineMs: 120_000 },
      driverRetry: { ...driverRetry, initialBackoffMs: 0, maxBackoffMs: 0 },
      continuation: testContinuation(),
      maxDepth: 0,
      coordination: {
        authentication: {
          signingKeys: {
            activeKeyId: 'integration',
            keys: { integration: 'integration-secret-'.repeat(4) },
          },
        },
        publicUrl: (address: { port: number }) => `http://127.0.0.1:${address.port}/manager`,
      },
      finalizer: () => 'done',
      deliverable: { check: async (value: unknown) => value === 'done' && (await succeeded()) },
      selectSeat: async () => ({ seat: 'fixture-seat', backend }),
      onDriverAttempt: (record) => {
        attempts.push(record)
      },
      ...(before.length === 0
        ? {}
        : { reopen: { operator: 'integration', reason: name, operationId: name } }),
    })
    const events = await journal()
    return { result, attempts, events, added: events.slice(before.length) }
  }

  // An owner turn fails before any model output, and its own drive records that failure.
  const first = await segment('first', false, { enabled: false })
  expect(first.result, JSON.stringify(first.result)).toMatchObject({ kind: 'no-winner' })
  expect(first.attempts).toMatchObject([{ attempt: 1, stop: 'retry-disabled' }])
  expect(first.attempts[0]?.error).toContain(FAILURE)
  expect(await rows('native-receipts.jsonl')).toHaveLength(1)

  // A restart surfaces that committed failure once, and the following attempt dispatches a new
  // execution with its own input, admission, binding and result.
  const replayed = await segment('replayed', false, { maxAttempts: 5 })
  expect(replayed.attempts.map((record) => record.reentry)).toEqual([
    'run-reentered',
    'driver-failure',
  ])
  for (const record of replayed.attempts) expect(record.error).toContain(FAILURE)
  expect(await rows('native-receipts.jsonl')).toHaveLength(2)
  const records = ofKind(replayed.added, 'driver-attempt')
  expect(records).toHaveLength(2)
  const bound = ofKind(replayed.added, 'execution-bound').map((event) => event.binding.attemptId)
  expect(bound).not.toContain(records[0]!.attemptId)
  expect(bound).toContain(records[1]!.attemptId)
  expect(ofKind(replayed.added, 'execution-input')).toHaveLength(1)
  expect(ofKind(replayed.added, 'execution-admitted').length).toBeGreaterThan(0)
  expect(ofKind(replayed.added, 'execution-result')).toHaveLength(1)

  // The next restart surfaces the newer committed failure once and stops without a dispatch.
  const stopped = await segment('stopped', false, { enabled: false })
  expect(stopped.attempts).toMatchObject([{ attempt: 1, stop: 'retry-disabled' }])
  expect(stopped.attempts[0]?.error).toContain(FAILURE)
  expect(ofKind(stopped.added, 'execution-input')).toEqual([])
  expect(await rows('native-receipts.jsonl')).toHaveLength(2)

  // That replay consumed the failure durably: a later restart replays neither failure and
  // dispatches a new turn at once, which succeeds.
  const continued = await segment('continued', true, { maxAttempts: 5 })
  expect(continued.result, JSON.stringify(continued.result)).toMatchObject({ kind: 'winner' })
  expect(continued.attempts).toMatchObject([{ attempt: 1, stop: 'completed', contract: 'met' }])
  expect(continued.attempts[0]?.error).toBeUndefined()
  expect(ofKind(continued.added, 'execution-input')).toHaveLength(1)
  expect(await rows('native-receipts.jsonl')).toHaveLength(3)

  // A committed successful turn is restored, never run again, and its spend is not counted twice.
  const restored = await segment('restored', true, { maxAttempts: 5 })
  expect(restored.result, JSON.stringify(restored.result)).toMatchObject({ kind: 'winner' })
  expect(restored.attempts).toMatchObject([{ attempt: 1, stop: 'completed', contract: 'met' }])
  expect(ofKind(restored.added, 'execution-input')).toEqual([])
  expect(ofKind(restored.added, 'execution-result')).toEqual([])
  expect(meteredTokens(restored.added)).toBe(0)
  const receipts = await rows('native-receipts.jsonl')
  expect(receipts).toHaveLength(3)
  expect(new Set(receipts.map((receipt) => receipt.control.executionId)).size).toBe(3)
  expect(meteredTokens(restored.events)).toBe(TURN_TOKENS * receipts.length)
  const results = ofKind(restored.events, 'execution-result')
  expect(results.map((event) => event.outcome?.success ?? true)).toEqual([false, false, true])
  expect(ofKind(restored.events, 'execution-input')).toHaveLength(3)
}, 180_000)
