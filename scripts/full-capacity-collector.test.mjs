import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'
import * as collector from './lib/full-capacity-collector.mjs'
import { nativeProductivity } from './lib/full-capacity-acceptance.mjs'

const fixture = JSON.parse(await readFile(new URL('./fixtures/native-collector-20261002.json', import.meta.url), 'utf8'))
const clone = value => JSON.parse(JSON.stringify(value))
const identity = row => JSON.stringify([row.nativeScope, row.environmentId, row.sessionId, row.executionId])
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'runtime-native-collector-'))
  t.onTestFinished(() => rm(path, { recursive: true, force: true }))
  return path
}

function replay(sessions) {
  const calls = { get: 0, sessions: 0, messages: 0, status: 0 }
  const client = { get: async environmentId => {
    calls.get++
    const rows = sessions.filter(row => row.environmentId === environmentId)
    if (!rows.length) throw Object.assign(new Error('retained native read unavailable'), { code: 'FIXTURE_UNAVAILABLE' })
    return { sessions: async () => {
      calls.sessions++
      return rows.map(row => ({ info: clone(row.info), session: {
        messages: async options => { calls.messages++; assert.deepEqual(options, { limit: 1000 }); return clone(row.messages) },
        status: async () => { calls.status++; return clone(row.info) },
      } }))
    } }
  } }
  return { calls, client }
}

for (const snapshot of fixture.snapshots) {
  test(`production structural replay ${snapshot.observedAt}: ${snapshot.sourceRawSampleRows} rows represent ${snapshot.expectedDistinct} physical executions`, async t => {
    const evidence = { attempts: clone(snapshot.attempts), samples: [], observationErrors: [] }
    const { calls, client } = replay(snapshot.sessions)
    await collector.collectNativeSamples(evidence, client, await directory(t), 4)
    assert.equal(evidence.attempts.length, snapshot.attempts.length, 'Historical admissions must remain in the denominator')
    const attributed = snapshot.expectedDistinct - snapshot.expectedUnattributedCurrent
    assert.equal(evidence.samples.length, attributed)
    assert.equal(new Set(evidence.samples.map(identity)).size, attributed)
    assert.equal(evidence.nativeSessions.filter(s => s.executionId).length, snapshot.expectedDistinct)
    const statuses = {}
    for (const sample of evidence.nativeSessions.filter(s => s.executionId)) statuses[sample.status] = (statuses[sample.status] ?? 0) + 1
    assert.deepEqual(statuses, snapshot.expectedStatuses)
    assert.equal(evidence.observationErrors.length, snapshot.expectedReadErrors + snapshot.expectedUnattributedCurrent)
    const environments = new Set(snapshot.attempts.filter(a => a.environmentId && a.sessionId).map(a => a.environmentId))
    assert.equal(calls.get, environments.size)
    assert.equal(calls.messages, attributed)
    assert.equal(calls.status, attributed)
    for (const attempt of evidence.attempts) {
      if (attempt.nativeCapture) {
        const capture = JSON.parse(await readFile(attempt.nativeCapture.path, 'utf8'))
        assert.equal(capture.session.activeExecutionId ?? capture.session.latestExecutionId, attempt.executionId)
        assert.equal(capture.turnId, attempt.turnId)
      } else assert.equal(attempt.nativeObservation.state, 'unobserved')
    }
    assert(evidence.attempts.some(a => a.nativeObservation.reason === 'different-current-execution'))
    assert(evidence.samples.every(sample => sample.productiveBytes === 0), 'Body-free identity fixtures cannot prove productive capacity')
  })
}

function current() {
  const info = { id: 'session', status: 'running', activeExecutionId: 'current', latestExecutionId: 'current', backend: 'claude-code', model: 'claude-opus-5-5' }
  const attempt = { runId: 'root', nodeId: 'root', attemptId: 'attempt', idempotencyKey: 'logical-key', nativeScope: 'test-api', environmentId: 'sandbox', sessionId: info.id, executionId: 'current', turnId: 'current-turn', nativeCapture: null }
  const old = { role: 'assistant', metadata: { turnId: 'old-turn' }, parts: [{ type: 'text', text: 'Retained work from a different execution' }] }
  const fresh = { role: 'assistant', metadata: { turnId: 'current-turn' }, parts: [{ type: 'text', text: 'Work produced in the admitted current turn' }] }
  return { info, attempt, old, fresh }
}

test('historical attempts cannot consume the current execution response', async () => {
  const { info, attempt, fresh } = current()
  let messages = 0
  const box = { sessions: async () => [{ info, session: { messages: async () => { messages++; return [fresh] }, status: async () => info } }] }
  await assert.rejects(collector.readNativeResponse(box, { ...attempt, executionId: 'historical' }), /native-execution-mismatch/u)
  assert.equal(messages, 0)
})

test('unattributed admission cannot consume a session-wide transcript', async () => {
  const { info, attempt, fresh } = current()
  const box = { sessions: async () => [{ info, session: { messages: async () => [fresh], status: async () => info } }] }
  await assert.rejects(collector.readNativeResponse(box, { ...attempt, turnId: null }), /native-turn-unattributed/u)
})

test('retained history cannot fabricate productivity in a new execution', async () => {
  const { info, attempt, old } = current()
  const box = { sessions: async () => [{ info, session: { messages: async () => [old], status: async () => info } }] }
  const response = await collector.readNativeResponse(box, attempt)
  assert.equal(nativeProductivity(response).productiveBytes, 0)
  assert.deepEqual(response.messages, [old])
})

test('execution rollover during message capture remains unobserved', async () => {
  const { info, attempt, fresh } = current()
  const box = { sessions: async () => [{ info, session: { messages: async () => [fresh], status: async () => ({ ...info, activeExecutionId: 'next', latestExecutionId: 'next' }) } }] }
  await assert.rejects(collector.readNativeResponse(box, attempt), /native-session-changed-during-read/u)
})

test('a short selected turn does not hide a truncated session response', async () => {
  const { info, attempt, old, fresh } = current()
  const messages = [...Array.from({ length: 999 }, () => old), fresh]
  const box = { sessions: async () => [{ info, session: { messages: async () => messages, status: async () => info } }] }
  const response = await collector.readNativeResponse(box, attempt)
  assert.equal(response.messages.length, 1000)
  assert.equal(response.messagesComplete, false)
})

test('one physical execution cannot be credited to two logical owners', async t => {
  const { info, attempt, fresh } = current()
  const evidence = { attempts: [attempt, { ...attempt, nodeId: 'other', attemptId: 'other', idempotencyKey: 'other-key' }], samples: [], observationErrors: [] }
  const { calls, client } = replay([{ environmentId: attempt.environmentId, info, messages: [fresh] }])
  await collector.collectNativeSamples(evidence, client, await directory(t), 1)
  assert.equal(evidence.samples.length, 0)
  assert.equal(evidence.nativeSessions.length, 1)
  assert.equal(calls.messages, 0)
  assert.equal(evidence.observationErrors.length, 1)
  assert(evidence.attempts.every(a => a.nativeObservation.reason === 'native-identity-owner-conflict'))
})

test('an equal retry shares one read without deleting either admission', async t => {
  const { info, attempt, fresh } = current()
  const evidence = { attempts: [attempt, { ...attempt, attemptId: 'retry-receipt' }], samples: [], observationErrors: [] }
  const { calls, client } = replay([{ environmentId: attempt.environmentId, info, messages: [fresh] }])
  await collector.collectNativeSamples(evidence, client, await directory(t), 1)
  assert.equal(evidence.attempts.length, 2)
  assert.equal(evidence.samples.length, 1)
  assert.equal(calls.get, 1); assert.equal(calls.sessions, 1); assert.equal(calls.messages, 1)
  assert.deepEqual(evidence.attempts[0].nativeCapture, evidence.attempts[1].nativeCapture)
  assert.equal(evidence.observationErrors.length, 0)
})

test('equal session and execution ids on different sandboxes remain distinct', async t => {
  const { info, attempt, fresh } = current()
  const second = { ...attempt, nodeId: 'other', environmentId: 'other-sandbox', attemptId: 'other-attempt' }
  const evidence = { attempts: [attempt, second], samples: [], observationErrors: [] }
  const { client } = replay([attempt, second].map(a => ({ environmentId: a.environmentId, info, messages: [fresh] })))
  await collector.collectNativeSamples(evidence, client, await directory(t), 2)
  assert.equal(evidence.samples.length, 2)
  assert.equal(new Set(evidence.samples.map(s => s.nativeCapture.path)).size, 2)
  assert.equal(evidence.observationErrors.length, 0)
})

test('a current execution without a matching admission is retained as unattributed metadata', async t => {
  const { info, attempt, fresh } = current()
  attempt.executionId = 'historical'
  const evidence = { attempts: [attempt], samples: [], observationErrors: [] }
  const { calls, client } = replay([{ environmentId: attempt.environmentId, info, messages: [fresh] }])
  await collector.collectNativeSamples(evidence, client, await directory(t), 1)
  assert.equal(evidence.samples.length, 0)
  assert.equal(evidence.nativeSessions[0].executionId, 'current')
  assert.equal(attempt.nativeObservation.reason, 'different-current-execution')
  assert.equal(evidence.observationErrors.length, 1)
  assert.equal(calls.messages, 0)
})
