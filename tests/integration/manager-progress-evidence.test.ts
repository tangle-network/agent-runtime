import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { AGENT_PROFILE_MATERIALIZATION_AXES } from '@tangle-network/agent-interface'
import { expect, it } from 'vitest'
import { readSettleRecord, writeSettleRecord } from '../../src/durable/settle-record'
import { createFileRunContext, type DriveHarness, supervise } from '../../src/runtime'
import { RunCancellationReason } from '../../src/runtime/supervise/abortable'
import { driverChild } from '../../src/runtime/supervise/driver-executor'
import { zeroSpend } from '../../src/runtime/util'
import { testContinuation } from '../helpers/continuation'
import { runtimeToolDeclarations, testAgentProfile } from '../kernel/test-agent-profile'

const execute = promisify(execFile)
const nativeManager = String.raw`
const assert = require('node:assert/strict')
const fs = require('node:fs')
const config = JSON.parse(process.env.PROGRESS_DRIVER)
const rpc = async (method, params) => {
  const response = await fetch(config.url, {
    method: 'POST', signal: AbortSignal.timeout(5000),
    headers: { 'content-type': 'application/json', ...config.headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.error, undefined)
  assert.notEqual(body.result.isError, true)
  return body.result
}
;(async () => {
  assert.equal(config.profile.harness, 'codex')
  assert.ok(config.turn <= 4)
  await rpc('tools/list')
  if (config.mode !== 'score' && config.turn === 2) {
    const result = await rpc('tools/call', {
      name: 'spawn_worker', arguments: { profile: config.worker, task: 'Write the checked artifact.', key: 'worker' },
    })
    const value = result.structuredContent ?? JSON.parse(result.content[0].text)
    assert.equal(typeof value.workerId, 'string')
  }
  fs.writeFileSync('milestone.txt', config.mode === 'score' && config.turn >= 3 ? 'checked milestone' : 'work incomplete')
  fs.appendFileSync('native-turns.jsonl', JSON.stringify({ pid: process.pid, turn: config.turn, task: config.task }) + '\n')
  process.stdout.write('native report without a completion claim\n')
})().catch(error => { console.error(error); process.exitCode = 1 })
`

it.each(['checked', 'unchecked', 'score', 'checked-budget'] as const)(
  'records external-manager progress from real %s evidence, not raw activity',
  async (mode) => {
    const directory = await mkdtemp(join(tmpdir(), 'manager-progress-'))
    const checked = mode.startsWith('checked')
    const exhausted = mode === 'checked-budget'
    const runId = `manager-progress-${mode}`
    const context = createFileRunContext(join(directory, 'run'), { withDriver: true })
    const worker = testAgentProfile('file-worker')
    const artifact = join(directory, 'worker-report.txt')
    let turn = 0
    const cancellation = new AbortController()
    const driveHarness: DriveHarness = async (driver) => {
      const native = await execute(process.execPath, ['-e', nativeManager], {
        cwd: directory,
        timeout: 5000,
        signal: driver.scope.signal,
        env: {
          ...process.env,
          PROGRESS_DRIVER: JSON.stringify({
            mode,
            turn: ++turn,
            task: driver.task,
            profile: driver.authoredProfile,
            worker,
            url: driver.coordinationMcpUrl,
            headers: driver.coordinationMcpHeaders,
          }),
        },
      })
      expect(native.stdout).toContain('native report')
      if (exhausted && turn === 1)
        await driver.scope.meter({ ...zeroSpend(), tokens: { input: 1, output: 0 } })
      driver.onModelEvent?.()
    }
    try {
      const result = await supervise(
        testAgentProfile('native-progress-root', {
          harness: 'codex',
          tools: runtimeToolDeclarations('spawn_worker', 'submit_result'),
        }),
        'Make checked progress while the parent objective remains unmet.',
        {
          journal: context.journal,
          blobs: context.blobs,
          signal: cancellation.signal,
          onDriverAttempt(record) {
            if (record.attempt === 4)
              cancellation.abort(
                new RunCancellationReason('operator', 'offline progress proof complete'),
              )
          },
          runDir: join(directory, 'run'),
          runId,
          budget: { maxTokens: exhausted ? 2 : 1000, maxIterations: 20, deadlineMs: 15000 },
          perWorker: { maxTokens: exhausted ? 1 : 100, maxIterations: 3 },
          driveHarness,
          driveHarnessMaterialization: {
            name: 'offline-native-process',
            axes: AGENT_PROFILE_MATERIALIZATION_AXES,
          },
          coordination: { host: '127.0.0.1', port: 0, authentication: true },
          wake: { heartbeatMs: 5000, debounceMs: 0, deadlineWarningMs: 0 },
          continuation: testContinuation({ maxBarren: mode === 'unchecked' ? 100 : 2 }),
          driverRetry: { maxAttempts: 4, initialBackoffMs: 0, maxBackoffMs: 0 },
          finalizer: () => undefined,
          deliverable: {
            check: () => false,
            checkState: async () => {
              if (mode !== 'score') return false
              const milestone =
                (await readFile(join(directory, 'milestone.txt'), 'utf8')) === 'checked milestone'
              return {
                pass: false,
                composite: milestone ? 0.75 : 0,
                items: { milestone: milestone ? 1 : 0, final: 0 },
                threshold: 1,
              }
            },
          },
          makeWorkerAgent: (profile) =>
            driverChild(
              profile,
              {
                name: 'file-worker',
                async act(_task, scope) {
                  await execute(
                    process.execPath,
                    [
                      '-e',
                      "require('node:fs').writeFileSync(process.argv[1], 'checked work')",
                      artifact,
                    ],
                    {
                      cwd: directory,
                      timeout: 5000,
                      signal: scope.signal,
                    },
                  )
                  if (exhausted)
                    await scope.meter({ ...zeroSpend(), tokens: { input: 1, output: 0 } })
                  return await readFile(artifact, 'utf8')
                },
              },
              context.journal,
              undefined,
              undefined,
              undefined,
              undefined,
              checked
                ? {
                    check: async (out) =>
                      out === 'checked work' && (await readFile(artifact, 'utf8')) === out,
                  }
                : undefined,
            ),
        },
      )
      await writeSettleRecord(join(directory, 'run'), result)
      expect(await readSettleRecord(join(directory, 'run'))).toEqual(result)
      const events = (await context.journal.loadTree(runId)) ?? []
      const attempts = events.flatMap((event) =>
        event.kind === 'driver-attempt' ? [event.record] : [],
      )
      const native = (await readFile(join(directory, 'native-turns.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      const turns = exhausted ? 2 : 4
      expect(native).toHaveLength(turns)
      expect(new Set(native.map((entry) => entry.pid)).size).toBe(turns)
      expect(
        attempts.filter((entry) => entry.attempt <= turns).map((entry) => entry.attempt),
      ).toEqual(exhausted ? [1, 2] : [1, 2, 3, 4])
      expect(result).toMatchObject(
        exhausted
          ? { kind: 'no-winner', reason: 'budget-exhausted' }
          : { kind: 'no-winner', reason: 'cancelled', source: 'operator' },
      )
      expect(events.filter((event) => event.kind === 'barren-pause')).toEqual([])
      if (mode !== 'score') {
        const terminal = events.filter((event) => event.kind === 'settled' && event.id !== runId)
        expect(terminal).toHaveLength(1)
        expect(terminal[0]).toMatchObject({ status: 'done' })
        if (checked) expect(terminal[0]).toMatchObject({ verdict: { valid: true } })
        else expect(terminal[0]).not.toHaveProperty('verdict')
        if (!exhausted)
          expect(native[2].task).toContain(checked ? '"valid":true' : '"assessment":"unassessed"')
        expect(
          attempts
            .filter((entry) => entry.attempt === 2 || entry.attempt === 3)
            .some((entry) => entry.madeProgress),
        ).toBe(checked)
        if (exhausted)
          expect(attempts.at(-1)).toMatchObject({
            attempt: 2,
            madeProgress: true,
            stop: 'completed',
            repromptRefusedBy: 'budget-exhausted',
          })
      } else {
        expect(
          attempts.filter((entry) => entry.attempt <= 4).map((entry) => entry.madeProgress),
        ).toEqual([true, false, true, false])
        expect(
          result.continuation?.continuations.some((entry) => entry.before.composite === 0.75),
        ).toBe(true)
      }
      expect(result.continuation?.barrenReentries).toBe(
        exhausted ? 0 : mode === 'unchecked' ? 2 : 1,
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)
