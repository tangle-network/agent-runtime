import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { AGENT_PROFILE_MATERIALIZATION_AXES } from '@tangle-network/agent-interface'
import { createTangleProvider } from '@tangle-network/agent-provider-tangle'
import { ATTR } from '@tangle-network/agent-trace-contract'
import { decodeOtlpTraceExport } from '@tangle-network/agent-trace-contract/otlp'
import { Sandbox } from '@tangle-network/sandbox'
import { expect, it } from 'vitest'
import { readSpawnJournal } from '../../src/durable'
import { FileSpawnJournal } from '../../src/durable/spawn-journal/journal-store'
import { createFileRunContext, type DriveHarness, supervise } from '../../src/runtime'
import { HarnessTurnFailedError } from '../../src/runtime/supervise/driver-attempt-evidence'
import { executorFailure } from '../../src/runtime/supervise/executor-outcome'
import type { RuntimeHookEvent } from '../../src/runtime-hooks'
import { createLiveTraceFixture, waitFor } from '../helpers/runtime-live-trace'
import { runtimeToolDeclarations, testAgentProfile } from '../kernel/test-agent-profile'
import { ProcessFixture, prepareExecutables } from './fixtures/uncertain-create-harness'
import { readRecords } from './fixtures/uncertain-create-protocol'

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
  const outcome = { success: false, error: 'native proof failure ' + (config.privateDetail ?? ''), failure }
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
  privateDetail?: string,
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
        privateDetail,
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
    const fixture = await createLiveTraceFixture()
    const { directory, endpoint, bodies, sentinel } = fixture
    fixture.collectorReply.release()
    const hooks: RuntimeHookEvent[] = []
    const runDir = join(directory, 'run')
    const context = createFileRunContext(runDir)
    const controller = new AbortController()
    const runId = `native-failure-${kind}`
    let invoked = false
    try {
      const running = supervise(
        testAgentProfile('native-failure-root', {
          harness: 'codex',
          tools: runtimeToolDeclarations('stop'),
        }),
        'Record a native refusal.',
        {
          runDir,
          runId,
          journal: {
            beginTree: context.journal.beginTree.bind(context.journal),
            loadTree: context.journal.loadTree.bind(context.journal),
            async appendEvent(root, event) {
              await context.journal.appendEvent(root, event)
              if (event.kind === 'driver-attempt' && event.record.failure) {
                const ack = await fetch(`${endpoint}/journal-ack`, {
                  method: 'POST',
                  signal: AbortSignal.timeout(5000),
                })
                if (!ack.ok) throw new Error('durable attempt acknowledgement refused')
              }
            },
          },
          otel: { exportConfig: { endpoint, batchSize: 1, flushIntervalMs: 10, timeoutMs: 5000 } },
          hooks: {
            onEvent(event) {
              hooks.push(event)
            },
          },
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
            return nativeFailure(driver, directory, kind, undefined, false, sentinel)
          },
          onDriverAttempt: () => controller.abort(new Error('proof received its durable attempt')),
        },
      )
      await waitFor('durable driver attempt', fixture.admissionEntered.wait)
      const beforeAck = (await context.journal.loadTree(runId))!.find(
        (event) => event.kind === 'driver-attempt',
      )!
      expect(beforeAck.kind).toBe('driver-attempt')
      expect(
        hooks.filter((event) => event.target === 'agent.execution' && event.phase === 'event'),
      ).toEqual([])
      // A real delayed HTTP acknowledgement must not move the attempt's durable end time.
      await new Promise((resolve) => setTimeout(resolve, 15))
      fixture.admissionAck.release()
      const result = await running
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
      const row = attempts![0]!
      if (row.kind !== 'driver-attempt') throw new Error('missing acknowledged driver attempt')
      expect(row).not.toHaveProperty('attemptId')
      const notices = hooks.filter(
        (event) => event.target === 'agent.execution' && event.phase === 'event',
      )
      expect(notices).toHaveLength(1)
      expect(notices[0]).toMatchObject({
        timestamp: Date.parse(row.at),
        payload: { nodeId: runId, record: row.record },
      })
      expect(notices[0]!.payload).not.toHaveProperty('attemptId')
      const spans = bodies.flatMap((body) => decodeOtlpTraceExport(body))
      const traced = spans.filter(
        (span) =>
          span.name === 'agent.execution' && span.attributes['tangle.driver.attempt'] !== undefined,
      )
      expect(traced).toHaveLength(1)
      expect(traced[0]).toMatchObject({
        status_code: 2,
        attributes: {
          [ATTR.spanKind]: 'CHAIN',
          [ATTR.outcome]: 'error',
          'tangle.supervise.node.id': runId,
          'tangle.driver.attempt': row.record.attempt,
          'tangle.driver.classification': row.record.classification,
          'tangle.failure.providerCode': row.record.failure!.code,
        },
      })
      expect(traced[0]!.attributes).not.toHaveProperty(ATTR.attemptId)
      expect(traced[0]!.end_time_unix_nano).toBe(
        (BigInt(Date.parse(row.at)) * 1_000_000n).toString(),
      )
      expect(
        Number(BigInt(traced[0]!.end_time_unix_nano!) - BigInt(traced[0]!.start_time_unix_nano!)) /
          1e6,
      ).toBeCloseTo(row.record.durationMs, 2)
      expect(
        Object.keys(traced[0]!.attributes).some((key) =>
          /token|cost|usd|tangle\.execution\./i.test(key),
        ),
      ).toBe(false)
      expect(spans.filter((span) => span.attributes[ATTR.spanKind] === 'LLM')).toHaveLength(0)
      expect(JSON.stringify(bodies)).not.toContain(sentinel)
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
      if (process.env.RUNTIME_TRACE_PROOF_DIR) {
        await mkdir(process.env.RUNTIME_TRACE_PROOF_DIR, { recursive: true })
        await writeFile(
          join(process.env.RUNTIME_TRACE_PROOF_DIR, `typed-driver-${kind}.otlp.jsonl`),
          `${bodies.map((body) => JSON.stringify(body)).join('\n')}\n`,
        )
      }
      await fixture.close()
    }
  },
)

it('links a managed native driver attempt to its real execution binding after durable ACK', async () => {
  const { bundle, executables } = await prepareExecutables()
  const nativeFixture = await ProcessFixture.start('json-observation-long-failed', executables, {
    coordinator: false,
  })
  const fixture = await createLiveTraceFixture()
  fixture.collectorReply.release()
  const runId = 'managed-native-failure'
  const runDir = join(nativeFixture.directory, 'run')
  const context = createFileRunContext(runDir)
  const controller = new AbortController()
  const hooks: RuntimeHookEvent[] = []
  const provider = createTangleProvider({
    client: new Sandbox({
      apiKey: 'offline-not-a-secret',
      baseUrl: nativeFixture.url,
      platformUrl: nativeFixture.url,
      trustLocalCliAuth: false,
      directExec: false,
    }),
  })
  let running: ReturnType<typeof supervise> | undefined
  try {
    await nativeFixture.control({ finish: true })
    running = supervise(
      testAgentProfile('managed-native-root', {
        harness: 'opencode',
        model: { provider: 'openai', default: 'fixture-model' },
        tools: runtimeToolDeclarations('stop'),
      }),
      'Report the actual offline native failure.',
      {
        runDir,
        runId,
        journal: {
          beginTree: context.journal.beginTree.bind(context.journal),
          loadTree: context.journal.loadTree.bind(context.journal),
          async appendEvent(root, event) {
            await context.journal.appendEvent(root, event)
            if (event.kind === 'driver-attempt' && event.record.failure) {
              const ack = await fetch(`${fixture.endpoint}/journal-ack`, {
                method: 'POST',
                signal: AbortSignal.timeout(5000),
              })
              if (!ack.ok) throw new Error('durable attempt acknowledgement refused')
            }
          },
        },
        blobs: context.blobs,
        backend: { backend: 'provider', provider },
        driverBackend: { backend: 'provider', provider },
        otel: { exportConfig: { endpoint: fixture.endpoint, batchSize: 1, flushIntervalMs: 10 } },
        hooks: {
          onEvent(event) {
            hooks.push(event)
          },
        },
        signal: controller.signal,
        budget: { maxTokens: 100, maxIterations: 4, deadlineMs: 10000 },
        coordination: {
          host: '127.0.0.1',
          port: 0,
          authentication: true,
          publicUrl: (address) => `http://127.0.0.1:${address.port}/manager`,
        },
        onDriverAttempt: () => controller.abort(new Error('one acknowledged managed attempt')),
      },
    )
    await waitFor('managed driver attempt persisted', fixture.admissionEntered.wait)
    expect(
      hooks.filter((event) => event.target === 'agent.execution' && event.phase === 'event'),
    ).toEqual([])
    fixture.admissionAck.release()
    const result = await running
    const rows = (await new FileSpawnJournal(join(runDir, 'spawn-journal.jsonl')).loadTree(runId))!
    const attempts = rows.filter((event) => event.kind === 'driver-attempt')
    expect(attempts, JSON.stringify(result)).toHaveLength(1)
    const attempt = attempts[0]!
    const binding = rows.find((event) => event.kind === 'execution-bound')
    if (binding?.kind !== 'execution-bound')
      throw new Error('native driver has no execution binding')
    expect(binding.binding.attemptId).toMatch(/:attempt:[0-9a-f-]{36}$/)
    expect(attempt.attemptId).toBe(binding.binding.attemptId)
    expect(attempt.record.failure).toEqual({ kind: 'work', code: 'native-process-exit' })
    expect(attempt.record.classification).toBe('transient')
    const admitted = rows.filter(
      (event) => event.kind === 'execution-admitted' && event.admission.phase === 'dispatched',
    )
    expect(admitted).toHaveLength(1)
    expect(
      (await nativeFixture.state()).requests.filter((row) => row.kind === 'dispatch'),
    ).toHaveLength(1)
    const native = readRecords(join(nativeFixture.directory, 'json-worker-processes.jsonl'))
    expect(native).toHaveLength(1)
    expect(native[0]!.pid).not.toBe(process.pid)
    const notices = hooks.filter(
      (event) => event.target === 'agent.execution' && event.phase === 'event',
    )
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({
      timestamp: Date.parse(attempt.at),
      payload: { nodeId: runId, attemptId: binding.binding.attemptId, record: attempt.record },
    })
    const spans = fixture.bodies.flatMap((body) => decodeOtlpTraceExport(body))
    const traced = spans.filter(
      (span) =>
        span.name === 'agent.execution' && span.attributes['tangle.driver.attempt'] !== undefined,
    )
    expect(traced).toHaveLength(1)
    expect(traced[0]).toMatchObject({
      status_code: 2,
      attributes: {
        [ATTR.spanKind]: 'CHAIN',
        [ATTR.attemptId]: binding.binding.attemptId,
        [ATTR.outcome]: 'error',
        'tangle.driver.classification': 'transient',
        'tangle.failure.providerCode': 'native-process-exit',
      },
    })
    expect(traced[0]!.end_time_unix_nano).toBe(
      (BigInt(Date.parse(attempt.at)) * 1_000_000n).toString(),
    )
    expect(
      Number(BigInt(traced[0]!.end_time_unix_nano!) - BigInt(traced[0]!.start_time_unix_nano!)) /
        1e6,
    ).toBeCloseTo(attempt.record.durationMs, 2)
    expect(
      Object.keys(traced[0]!.attributes).some((key) =>
        /token|cost|usd|tangle\.execution\./i.test(key),
      ),
    ).toBe(false)
    expect(JSON.stringify(fixture.bodies)).not.toContain('native process exited 7')
  } finally {
    controller.abort()
    fixture.release()
    await running?.catch(() => undefined)
    if (process.env.RUNTIME_TRACE_PROOF_DIR) {
      await mkdir(process.env.RUNTIME_TRACE_PROOF_DIR, { recursive: true })
      await writeFile(
        join(process.env.RUNTIME_TRACE_PROOF_DIR, 'typed-driver-managed.otlp.jsonl'),
        `${fixture.bodies.map((body) => JSON.stringify(body)).join('\n')}\n`,
      )
    }
    await nativeFixture.close()
    await fixture.close()
    await rm(bundle, { recursive: true, force: true })
  }
}, 15000)

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
