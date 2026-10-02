import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assessCapacity, deriveCapacityTarget, digest, nativeProductivity } from './lib/full-capacity-acceptance.mjs'
import { readNativeResponse, retainAdmission } from './lib/full-capacity-collector.mjs'

const at = (ms) => new Date(Date.UTC(2026, 9, 2) + ms).toISOString()

// The acceptable fixture describes independently observable SDK responses and terminal artifacts.
// Its target exceeds the old thirty-spawn example and includes all fifty-four registered roots.
function fleet(count = 200, frontierCount = 54) {
  const bytes = new Map()
  const receipt = (path, payload) => {
    const value = Buffer.from(JSON.stringify(payload))
    bytes.set(path, value)
    return { path, sha256: digest(value), bytes: value.length }
  }
  const contract = {
    experimentId: 'calibration-full-capacity', mode: 'full-capacity', registeredAt: at(0), deadlineAt: at(120000),
    resources: { maxConcurrent: count, maxWallMs: 120000, maxPaidModelUsd: 0 },
    profile: { harness: 'claude-code', models: ['claude-opus-5-5'], credentialSource: 'subscription' },
    minProductiveOverlapMs: 60000, maxCapacityAgeMs: 300000, minRecursiveDepth: 2, shapeDigest: 'caller-shape-digest',
    frontiers: Array.from({ length: frontierCount }, (_, i) => `frontier-${i}`),
    runs: Array.from({ length: frontierCount }, (_, i) => ({ runId: `run-${i}`, frontierId: `frontier-${i}` })),
  }
  const known = { state: 'known', value: count, source: 'retained-authoritative-limit', observedAt: at(0) }
  const capacity = { scope: 'configured-maximum', observedAt: at(0), shapeDigest: contract.shapeDigest,
    constraints: { placement: { ...known }, sandboxAccount: { ...known }, modelSubscription: { ...known }, runtime: { ...known } } }
  const evidence = { contractDigest: digest(Buffer.from(JSON.stringify(contract))), observedAt: at(120000), enumerationComplete: true, attempts: [], samples: [], observationErrors: [], recoveries: [] }
  for (let index = 0; index < count; index += 1) {
    const runNumber = index % frontierCount
    const generation = Math.floor(index / frontierCount)
    const runId = `run-${runNumber}`
    const nodeId = generation === 0 ? runId : `${runId}:child-${generation}`
    const parentNodeId = generation === 0 ? null : generation === 1 ? runId : `${runId}:child-${generation - 1}`
    const executionId = `execution-${index}`
    const sessionId = `session-${index}`
    const nativeIdentity = { nativeScope: 'https://sandbox.tangle.tools', environmentId: `sandbox-${index}` }
    const session = { id: sessionId, activeExecutionId: executionId, latestExecutionId: executionId, backendType: 'claude-code', model: 'claude-opus-5-5', status: 'running' }
    for (const [round, clock] of [[0, 0], [1, 62000]]) {
      const payload = { ...nativeIdentity, session, messages: [{ role: 'assistant', parts: [{ type: 'text', text: `Independent derivation ${index}; ${'checked calculation '.repeat(round + 1)}` }] }] }
      evidence.samples.push({ runId, nodeId, ...nativeIdentity, startedAt: at(clock), completedAt: at(clock + 1000), sessionId, executionId, harness: session.backendType, model: session.model, status: 'running', complete: true, ...nativeProductivity(payload), nativeCapture: receipt(`${nodeId}-${round}.native.json`, payload) })
    }
    const terminalNative = { ...nativeIdentity, session: { ...session, activeExecutionId: null, status: 'completed', endedAt: at(119000) }, messages: [{ role: 'assistant', metadata: { completed: true }, parts: [{ type: 'text', text: `Final checked result ${index}` }] }] }
    evidence.attempts.push({ runId, nodeId, parentNodeId, ...nativeIdentity, frontierId: `frontier-${runNumber}`, attemptId: `attempt-${index}`, idempotencyKey: `stable-key-${index}`, executionId, sessionId, startedAt: at(0), profile: { harness: 'claude-code', model: 'claude-opus-5-5', credentialSource: 'subscription' }, auth: { mode: 'subscription', source: 'owner binding receipt', paidApiFallbackDisabled: true }, terminal: { status: 'done', at: at(119000) }, output: receipt(`${nodeId}.output`, `Final retained result ${index}`), nativeCapture: receipt(`${nodeId}.completed.json`, terminalNative) })
  }
  return { contract, capacity, evidence, bytes, read: async (path) => { if (!bytes.has(path)) throw Object.assign(new Error('absent'), { code: 'ENOENT' }); return bytes.get(path) } }
}

async function assess(fixture) { return assessCapacity(fixture.contract, fixture.capacity, fixture.evidence, fixture.read) }
function refreshContract(fixture) { fixture.evidence.contractDigest = digest(Buffer.from(JSON.stringify(fixture.contract))) }

test('two hundred native executions across all fifty-four frontiers pass with retained terminal output', async () => {
  const result = await assess(fleet())
  assert.equal(result.verdict, 'pass', JSON.stringify(result))
  assert.equal(result.plan.target, 200)
  assert.deepEqual(result.logicalRuns, { denominator: 200, completed: 200, failed: 0, pending: 0, retained: 200 })
  assert.equal(result.frontiers.observed, 54)
  assert.equal(result.capacity.productivePeak, 200)
})

test('configured and explicitly authorized limits derive the target without a thirty-spawn cap', () => {
  const f = fleet()
  f.capacity.constraints.placement.value = 173
  assert.equal(deriveCapacityTarget(f.contract, f.capacity).target, 173)
  f.contract.resources.maxConcurrent = 111
  assert.equal(deriveCapacityTarget(f.contract, f.capacity).target, 111)
})

for (const scenario of ['queued', 'unchanged-output', 'sequential', 'missing-output', 'changed-output', 'one-stranded', 'paid-api', 'missing-frontier', 'no-grandchildren']) {
  test(`rejects realistic false pass: ${scenario}`, async () => {
    const f = fleet()
    if (scenario === 'queued') {
      for (const sample of f.evidence.samples) sample.status = 'queued'
    } else if (scenario === 'unchanged-output') {
      for (let i = 1; i < f.evidence.samples.length; i += 2) Object.assign(f.evidence.samples[i], { productiveBytes: f.evidence.samples[i - 1].productiveBytes, productiveDigest: f.evidence.samples[i - 1].productiveDigest, nativeCapture: f.evidence.samples[i - 1].nativeCapture })
    } else if (scenario === 'sequential') {
      for (let i = 0; i < f.evidence.samples.length; i += 2) {
        const sample = f.evidence.samples[i]
        const later = f.evidence.samples[i + 1]
        sample.startedAt = at(i * 70000); sample.completedAt = at(i * 70000 + 1000)
        later.startedAt = at(i * 70000 + 62000); later.completedAt = at(i * 70000 + 63000)
      }
    } else if (scenario === 'missing-output') f.bytes.delete(f.evidence.attempts[0].output.path)
    else if (scenario === 'changed-output') f.bytes.set(f.evidence.attempts[0].output.path, Buffer.from('replacement'))
    else if (scenario === 'one-stranded') f.evidence.attempts[0].terminal = null
    else if (scenario === 'paid-api') f.evidence.attempts[0].profile.credentialSource = 'api-key'
    else if (scenario === 'missing-frontier') f.evidence.attempts = f.evidence.attempts.filter((a) => a.frontierId !== 'frontier-53')
    else if (scenario === 'no-grandchildren') for (const a of f.evidence.attempts) if (a.parentNodeId) a.parentNodeId = a.runId
    const result = await assess(f)
    assert.equal(result.verdict, 'fail', JSON.stringify(result))
  })
}

test('missing and stale capacity dimensions remain unknown instead of reducing the target', async () => {
  const f = fleet()
  f.capacity.constraints.modelSubscription = { state: 'unknown', reason: 'quota endpoint timed out', source: 'account read', observedAt: at(0) }
  let result = await assess(f)
  assert.equal(result.verdict, 'incomplete')
  assert.equal(result.plan.target, null)
  f.capacity.observedAt = at(-3600000)
  result = await assess(f)
  assert.ok(result.unknown.some((reason) => reason.includes('stale')))
})

test('zero is an actual closed admission ceiling, not unlimited', async () => {
  const f = fleet()
  f.capacity.constraints.modelSubscription.value = 0
  const result = await assess(f)
  assert.equal(result.plan.target, 0)
  assert.equal(result.verdict, 'fail')
})

test('a successful recovery is separately labeled and preserves the logical denominator', async () => {
  const f = fleet()
  f.contract.mode = 'recovery'; f.contract.recoveryDeadlineMs = 30000; refreshContract(f)
  const final = f.evidence.attempts[0]
  f.evidence.attempts.unshift({ ...final, attemptId: 'interrupted-attempt', startedAt: at(-1000), terminal: { status: 'interrupted', at: at(0) }, failureClass: 'injected-controller-loss' })
  f.evidence.recoveries.push({ runId: final.runId, nodeId: final.nodeId, beforeKey: final.idempotencyKey, afterKey: final.idempotencyKey, injectedAt: at(3000), recoveredAt: at(8000), journalPrefixPreserved: true, duplicateNativeExecutions: 0 })
  const result = await assess(f)
  assert.equal(result.verdict, 'pass', JSON.stringify(result))
  assert.equal(result.logicalRuns.denominator, 200)
  assert.equal(result.attempts.denominator, 201)
  assert.equal(result.attempts.failureClasses['injected-controller-loss'], 1)
  assert.equal(result.claim, 'same-key recovery under injection')
})

test('recovery cannot hide a replacement key or a duplicate native execution', async () => {
  const f = fleet()
  f.contract.mode = 'recovery'; f.contract.recoveryDeadlineMs = 30000; refreshContract(f)
  const final = f.evidence.attempts[0]
  f.evidence.attempts.unshift({ ...final, attemptId: 'duplicate-attempt', startedAt: at(-1000), executionId: 'second-native-run' })
  f.evidence.recoveries.push({ runId: final.runId, nodeId: final.nodeId, beforeKey: 'old-key', afterKey: 'new-key', injectedAt: at(0), recoveredAt: at(1000), journalPrefixPreserved: true, duplicateNativeExecutions: 0 })
  const result = await assess(f)
  assert.equal(result.verdict, 'fail')
  assert.ok(result.failures.some((failure) => failure.code === 'duplicate-native-execution-for-key'))
  assert.ok(result.failures.some((failure) => failure.code === 'recovery-replaced-key'))
})

test('missing native bytes and fabricated productivity cannot count toward the target', async () => {
  const f = fleet()
  f.evidence.samples[0].productiveBytes += 1
  const result = await assess(f)
  assert.equal(result.verdict, 'fail')
  assert.ok(result.failures.some((failure) => failure.code === 'native-sample-mismatch'))
})

test('the collector retains same-key execution conflicts through intent/environment/dispatched folds', async () => {
  const attempts = new Map()
  retainAdmission(attempts, { phase: 'intent', idempotencyKey: 'key', sessionId: 'session', executionId: 'one' }, at(0))
  retainAdmission(attempts, { phase: 'environment', idempotencyKey: 'key', environmentId: 'sandbox', sessionId: 'session', executionId: 'one' }, at(1))
  retainAdmission(attempts, { phase: 'dispatched', idempotencyKey: 'key', controlRef: { environmentId: 'sandbox', sessionId: 'session', executionId: 'one' } }, at(2))
  assert.equal(attempts.size, 1)
  retainAdmission(attempts, { phase: 'dispatched', idempotencyKey: 'key', controlRef: { environmentId: 'sandbox', sessionId: 'session', executionId: 'two' } }, at(3))
  assert.equal(attempts.size, 2)
  assert.deepEqual([...attempts.values()].map((a) => a.executionId), ['one', 'two'])
})

test('two logical nodes cannot inflate concurrency by claiming the same native execution under different keys', async () => {
  const f = fleet()
  const first = f.evidence.attempts[0]
  Object.assign(f.evidence.attempts[1], { nativeScope: first.nativeScope, environmentId: first.environmentId, sessionId: first.sessionId, executionId: first.executionId, nativeCapture: first.nativeCapture })
  const result = await assess(f)
  assert.equal(result.verdict, 'fail')
  assert.ok(result.failures.some((failure) => failure.code === 'native-execution-shared-between-logical-nodes'))
})

for (const time of [-3600000, 1000]) {
  test(`fresh wrapper cannot launder an individual capacity timestamp ${time}`, async () => {
    const f = fleet()
    f.capacity.constraints.placement.observedAt = at(time)
    const result = await assess(f)
    assert.equal(result.verdict, 'incomplete')
    assert.equal(result.plan.target, null)
  })
}

for (const time of [-100000, 200000]) {
  test(`native productivity outside registration window ${time} cannot satisfy capacity`, async () => {
    const f = fleet()
    for (const sample of f.evidence.samples) {
      sample.startedAt = at(Date.parse(sample.startedAt) - Date.parse(at(0)) + time)
      sample.completedAt = at(Date.parse(sample.completedAt) - Date.parse(at(0)) + time)
    }
    const result = await assess(f)
    assert.equal(result.verdict, 'fail')
    assert.equal(result.capacity.productivePeak, 0)
  })
}

for (const time of [-1000, 200000]) {
  test(`terminal outside registration window ${time} cannot satisfy retention`, async () => {
    const f = fleet()
    f.evidence.attempts[0].terminal.at = at(time)
    const result = await assess(f)
    assert.equal(result.verdict, 'fail')
    assert.ok(result.failures.some((failure) => failure.code === 'terminal-outside-registered-window'))
  })
}

test('terminal native capture must preserve served harness/model and complete messages', async () => {
  const f = fleet()
  const receipt = f.evidence.attempts[0].nativeCapture
  const payload = JSON.parse(f.bytes.get(receipt.path))
  payload.session.model = 'unapproved-model'
  const bytes = Buffer.from(JSON.stringify(payload))
  f.bytes.set(receipt.path, bytes)
  Object.assign(receipt, { sha256: digest(bytes), bytes: bytes.length })
  const result = await assess(f)
  assert.equal(result.verdict, 'fail')
  assert.ok(result.failures.some((failure) => failure.code === 'native-result-not-complete'))
})

test('native reader uses the SDK session handle paired with the exact session metadata', async () => {
  let calls = 0
  const messages = [{ role: 'assistant', parts: [{ type: 'text', text: 'retained native work' }] }]
  const info = { id: 'exact-session', status: 'running', activeExecutionId: 'exact-execution', backend: 'claude-code', model: 'claude-opus-5-5' }
  const box = { sessions: async () => [{ info, session: { messages: async (options) => { calls += 1; assert.deepEqual(options, { limit: 1000 }); return messages } } }] }
  const result = await readNativeResponse(box, { sessionId: info.id, nativeScope: 'sandbox-api', environmentId: 'sandbox' })
  assert.equal(calls, 1)
  assert.deepEqual(result, { nativeScope: 'sandbox-api', environmentId: 'sandbox', session: info, messages })
  await assert.rejects(readNativeResponse(box, { sessionId: 'different-session' }), /exact Runtime session absent/)
})

test('installed SDK tool calls count as productive work without requiring assistant prose', () => {
  const response = { messages: [{ role: 'assistant', parts: [{ type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'run-checker' }, output: 'checked', time: { end: 1000 } } }] }] }
  const first = nativeProductivity(response)
  assert.ok(first.productiveBytes > 0)
  response.messages[0].parts.push({ type: 'tool', tool: 'bash', state: { input: { command: 'verify-result' } } })
  const second = nativeProductivity(response)
  assert.ok(second.productiveBytes > first.productiveBytes)
  assert.notEqual(second.productiveDigest, first.productiveDigest)
})

test('native metadata, tool-result delivery, and empty text cannot fabricate model productivity', () => {
  const response = { messages: [{ role: 'assistant', timestamp: at(0), parts: [{ type: 'text', id: 'one', text: '' }, { type: 'tool', id: 'call-one', tool: 'bash', state: { status: 'running', input: { command: 'run-checker' }, time: { start: 1000 } } }] }] }
  const first = nativeProductivity(response)
  response.messages[0].timestamp = at(10000)
  response.messages[0].parts[0].id = 'longer-metadata-value'
  Object.assign(response.messages[0].parts[1].state, { status: 'completed', output: 'a long delayed tool result', time: { start: 1000, end: 10000 } })
  assert.deepEqual(nativeProductivity(response), first)
  assert.equal(nativeProductivity({ messages: [{ role: 'assistant', parts: [{ type: 'text', text: '', id: 'metadata' }] }] }).productiveBytes, 0)
})
