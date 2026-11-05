import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { AGENT_PROFILE_MATERIALIZATION_AXES } from '@tangle-network/agent-interface'
import { expect, it } from 'vitest'
import { readSpawnJournal } from '../../src/durable'
import { FileSpawnJournal } from '../../src/durable/spawn-journal/journal-store'
import { createFileRunContext, type DriveHarness, supervise } from '../../src/runtime'
import { HarnessTurnFailedError } from '../../src/runtime/supervise/driver-attempt-evidence'
import { executorFailure } from '../../src/runtime/supervise/executor-outcome'
import { runtimeToolDeclarations, testAgentProfile } from '../kernel/test-agent-profile'

const execute = promisify(execFile)
const native = `
const fs = require('node:fs')
const assert = require('node:assert/strict')
;(async () => {
  const config = JSON.parse(process.env.NATIVE_ATTEMPT)
  const response = await fetch(config.url, {
    method: 'POST', signal: AbortSignal.timeout(5000),
    headers: { 'content-type': 'application/json', ...config.headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).error, undefined)
  const failure = { kind: config.kind, code: config.code ?? 'native-proof-failure' }
  if (config.kind === 'capacity') failure.resetAt = new Date(Date.now() + 1000).toISOString()
  const outcome = { success: false, error: 'native proof failure', failure }
  const receipt = { pid: process.pid, outcome,
    ...(config.progress ? { usage: { iterations: 1, tokens: { input: 1, output: 0 }, usd: 0, ms: 0 } } : {}) }
  fs.writeFileSync('native-outcome.json', JSON.stringify(receipt))
  fs.appendFileSync('native-attempts.jsonl', JSON.stringify(receipt) + '\\n')
  process.stdout.write(JSON.stringify(outcome))
})().catch(error => { console.error(error); process.exitCode = 1 })
`

async function nativeFailure(
  driver: Parameters<DriveHarness>[0],
  directory: string,
  kind: string,
  code?: string,
  progress = false,
): Promise<never> {
  const result = await execute(process.execPath, ['-e', native], {
    cwd: directory,
    timeout: 5000,
    signal: driver.scope.signal,
    env: {
      ...process.env,
      NATIVE_ATTEMPT: JSON.stringify({
        kind,
        code,
        progress,
        url: driver.coordinationMcpUrl,
        headers: driver.coordinationMcpHeaders,
      }),
    },
  })
  if (progress) {
    const receipt = JSON.parse(await readFile(join(directory, 'native-outcome.json'), 'utf8'))
    await driver.scope.meter(receipt.usage)
  }
  const failure = executorFailure({ outcome: JSON.parse(result.stdout) })
  if (!failure) throw new Error('native process supplied no failure')
  throw new HarnessTurnFailedError('native-proof', failure)
}

it.each(['caller', 'infra', 'work', 'capacity'] as const)(
  'preserves the native %s failure through retry recording and cold journal reads',
  async (kind) => {
    const directory = await mkdtemp(join(tmpdir(), 'typed-driver-attempt-'))
    const runDir = join(directory, 'run')
    const context = createFileRunContext(runDir)
    const controller = new AbortController()
    const runId = `native-failure-${kind}`
    let invoked = false
    try {
      const result = await supervise(
        testAgentProfile('native-failure-root', {
          harness: 'codex',
          tools: runtimeToolDeclarations('stop'),
        }),
        'Record a native refusal.',
        {
          runDir,
          runId,
          journal: context.journal,
          blobs: context.blobs,
          makeWorkerAgent: () => {
            throw new Error('a refused native turn cannot delegate')
          },
          signal: controller.signal,
          budget: { maxTokens: 100, maxIterations: 5, deadlineMs: 10000 },
          driveHarnessMaterialization: {
            name: 'native-attempt-proof',
            axes: AGENT_PROFILE_MATERIALIZATION_AXES,
          },
          coordination: { host: '127.0.0.1', port: 0, authentication: true },
          driveHarness: async (driver) => {
            invoked = true
            return nativeFailure(driver, directory, kind)
          },
          onDriverAttempt: () => controller.abort(new Error('proof received its durable attempt')),
        },
      )
      expect(invoked, JSON.stringify(result)).toBe(true)
      const emitted = JSON.parse(await readFile(join(directory, 'native-outcome.json'), 'utf8'))
      expect(emitted.pid).not.toBe(process.pid)
      expect(emitted.outcome.failure).toMatchObject({ kind, code: 'native-proof-failure' })
      if (kind === 'capacity')
        expect(Number.isFinite(Date.parse(emitted.outcome.failure.resetAt))).toBe(true)
      const cold = await new FileSpawnJournal(join(runDir, 'spawn-journal.jsonl')).loadTree(runId)
      const attempts = cold?.filter(
        (event) =>
          event.kind === 'driver-attempt' && event.record.error?.includes('native proof failure'),
      )
      expect(attempts).toHaveLength(1)
      expect(attempts![0]).toMatchObject({
        kind: 'driver-attempt',
        record: {
          failure: emitted.outcome.failure,
          classification:
            kind === 'caller' ? 'terminal' : kind === 'capacity' ? 'unavailable' : 'transient',
        },
      })
      const read = await readSpawnJournal(runDir)
      expect(
        read.records.some(
          (record) =>
            record.kind === 'event' &&
            JSON.stringify(record.event) === JSON.stringify(attempts![0]),
        ),
      ).toBe(true)
    } finally {
      controller.abort()
      await rm(directory, { recursive: true, force: true })
    }
  },
)

it.each(['same', 'changing', 'progress'] as const)(
  'bounds native repeated work failures while %s evidence earns the correct retries',
  async (mode) => {
    const directory = await mkdtemp(join(tmpdir(), 'native-retry-bound-'))
    const runDir = join(directory, 'run')
    const context = createFileRunContext(runDir)
    const controller = new AbortController()
    let calls = 0
    try {
      await supervise(
        testAgentProfile('native-retry-root', {
          harness: 'codex',
          tools: runtimeToolDeclarations('stop'),
        }),
        'Retry only when the failure or progress changes.',
        {
          runDir,
          runId: 'native-retry',
          journal: context.journal,
          blobs: context.blobs,
          makeWorkerAgent: () => {
            throw new Error('a failed native turn cannot delegate')
          },
          signal: controller.signal,
          budget: { maxTokens: 100, maxIterations: 10, deadlineMs: 10000 },
          driveHarnessMaterialization: {
            name: 'native-attempt-proof',
            axes: AGENT_PROFILE_MATERIALIZATION_AXES,
          },
          coordination: { host: '127.0.0.1', port: 0, authentication: true },
          driverRetry: {
            maxAttempts: 5,
            maxConsecutiveFailures: 10,
            initialBackoffMs: 0,
            maxBackoffMs: 0,
          },
          driveHarness: (driver) => {
            calls++
            return nativeFailure(
              driver,
              directory,
              'work',
              mode === 'changing' ? `work-failure-${calls}` : 'work-failure',
              mode === 'progress',
            )
          },
          onDriverAttempt(record) {
            if (mode !== 'same' && record.attempt === 4)
              controller.abort(new Error('four actual native retries observed'))
          },
        },
      )
      const emitted = (await readFile(join(directory, 'native-attempts.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      expect(calls).toBe(mode === 'same' ? 2 : 4)
      expect(emitted).toHaveLength(calls)
      expect(new Set(emitted.map((receipt) => receipt.pid)).size).toBe(calls)
      const events = (await new FileSpawnJournal(join(runDir, 'spawn-journal.jsonl')).loadTree(
        'native-retry',
      ))!
      const records = events.flatMap((event) =>
        event.kind === 'driver-attempt' && event.record.error?.includes('native proof failure')
          ? [event.record]
          : [],
      )
      expect(records).toHaveLength(calls)
      expect(records.map((record) => record.madeProgress)).toEqual(
        Array(calls).fill(mode === 'progress'),
      )
      if (mode === 'same') expect(records.at(-1)?.stop).toBe('repeated-failure')
      else expect(records.some((record) => record.stop === 'repeated-failure')).toBe(false)
      expect(records.map((record) => record.failure?.code)).toEqual(
        emitted.map((receipt) => receipt.outcome.failure.code),
      )
    } finally {
      controller.abort()
      await rm(directory, { recursive: true, force: true })
    }
  },
)
