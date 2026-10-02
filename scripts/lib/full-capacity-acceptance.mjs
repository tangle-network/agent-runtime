import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
const instant = (value) => typeof value === 'string' ? Date.parse(value) : Number.NaN
const positive = (value) => Number.isSafeInteger(value) && value > 0
const nonnegative = (value) => Number.isSafeInteger(value) && value >= 0
const key = (runId, nodeId) => JSON.stringify([runId, nodeId])
const nativeKey = (attempt) => attempt.nativeScope && attempt.environmentId && attempt.sessionId && attempt.executionId
  ? JSON.stringify([attempt.nativeScope, attempt.environmentId, attempt.sessionId, attempt.executionId]) : null

export function nativeProductivity(capture) {
  const parts = (capture.messages ?? []).filter((message) => message.role === 'assistant').flatMap((message) => message.parts ?? [])
  const productiveParts = parts.filter((part) => ['text', 'text_delta', 'reasoning', 'reasoning_delta', 'thinking', 'tool_use', 'tool_call', 'tool-call'].includes(part?.type ?? part?.kind))
  const bytes = Buffer.from(JSON.stringify(productiveParts))
  return { productiveBytes: productiveParts.length ? bytes.length : 0, productiveDigest: digest(bytes) }
}

/** All ceilings use the same unit: total concurrent native executions in this cohort. */
export function deriveCapacityTarget(contract, snapshot) {
  const unknown = []
  const constraints = []
  if (!positive(contract.resources?.maxConcurrent)) unknown.push('explicit concurrency budget missing')
  else constraints.push({ name: 'authorized-resource-budget', value: contract.resources.maxConcurrent })
  for (const name of ['placement', 'sandboxAccount', 'modelSubscription', 'runtime']) {
    const bound = snapshot.constraints?.[name]
    if (!bound?.source || !Number.isFinite(instant(bound.observedAt))) {
      unknown.push(`${name}: source or observation time missing`)
    } else if (bound.state === 'known' && nonnegative(bound.value)) {
      constraints.push({ name, value: bound.value })
    } else if (bound.state !== 'unbounded') {
      unknown.push(`${name}: ${bound.reason ?? 'ceiling unknown'}`)
    }
    const observed = instant(bound?.observedAt)
    const registered = instant(contract.registeredAt)
    if (Number.isFinite(observed) && Number.isFinite(registered) &&
        (observed > registered || registered - observed > contract.maxCapacityAgeMs)) {
      unknown.push(`${name}: individual ceiling is stale or post-registration`)
    }
  }
  if (snapshot.scope !== 'configured-maximum') unknown.push('capacity snapshot is not the configured maximum')
  if (snapshot.shapeDigest !== contract.shapeDigest) unknown.push('capacity measured for a different resource shape')
  const start = instant(contract.registeredAt)
  const observed = instant(snapshot.observedAt)
  if (!Number.isFinite(start) || !Number.isFinite(observed) || observed > start ||
      !positive(contract.maxCapacityAgeMs) || start - observed > contract.maxCapacityAgeMs) {
    unknown.push('capacity snapshot is missing, stale, or post-registration')
  }
  return {
    target: unknown.length ? null : Math.min(...constraints.map((c) => c.value)),
    observedUpperBound: constraints.length ? Math.min(...constraints.map((c) => c.value)) : null,
    constraints,
    unknown,
  }
}

/** A sample count is never a concurrency count. Only overlapping, productive intervals qualify. */
export function productiveIntervals(samples, expectedProfile) {
  const intervals = []
  const ordered = [...samples].sort((a, b) => instant(a.startedAt) - instant(b.startedAt))
  for (let i = 1; i < ordered.length; i += 1) {
    const a = ordered[i - 1]
    const b = ordered[i]
    if (a.status !== 'running' || b.status !== 'running' || a.complete !== true || b.complete !== true) continue
    if (!a.executionId || a.executionId !== b.executionId || !a.sessionId || a.sessionId !== b.sessionId) continue
    if (a.harness !== expectedProfile.harness || b.harness !== expectedProfile.harness) continue
    if (!expectedProfile.models.includes(a.model) || !expectedProfile.models.includes(b.model)) continue
    if (!nonnegative(a.productiveBytes) || !positive(b.productiveBytes) || b.productiveBytes <= a.productiveBytes) continue
    if (!a.productiveDigest || !b.productiveDigest || a.productiveDigest === b.productiveDigest) continue
    const start = instant(a.completedAt)
    const end = instant(b.startedAt)
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      intervals.push({ start, end, executionId: a.executionId })
    }
  }
  return intervals
}

export function concurrencyWindows(intervals) {
  const edges = []
  for (const interval of intervals) {
    edges.push({ at: interval.start, change: 1, id: interval.logicalId })
    edges.push({ at: interval.end, change: -1, id: interval.logicalId })
  }
  edges.sort((a, b) => a.at - b.at || a.change - b.change)
  const active = new Map()
  const windows = []
  let prior = null
  for (const edge of edges) {
    if (prior !== null && edge.at > prior && active.size) {
      windows.push({ start: prior, end: edge.at, count: active.size, logicalIds: [...active.keys()] })
    }
    const next = (active.get(edge.id) ?? 0) + edge.change
    if (next > 0) active.set(edge.id, next)
    else active.delete(edge.id)
    prior = edge.at
  }
  return windows
}

export async function verifyArtifact(receipt, read = readFile) {
  if (!receipt?.path || !/^sha256:[a-f0-9]{64}$/.test(receipt.sha256 ?? '') || !positive(receipt.bytes)) {
    return { ok: false, reason: 'artifact receipt missing or empty' }
  }
  try {
    const bytes = await read(receipt.path)
    if (bytes.length !== receipt.bytes || digest(bytes) !== receipt.sha256) {
      return { ok: false, reason: 'retained bytes differ from receipt' }
    }
    return { ok: true, bytes: bytes.length }
  } catch (error) {
    return { ok: false, reason: `artifact unreadable: ${error.code ?? error.name}` }
  }
}

export async function assessCapacity(contract, capacity, evidence, read = readFile) {
  const plan = deriveCapacityTarget(contract, capacity)
  const failures = []
  const unknown = [...plan.unknown]
  const add = (code, logicalId, detail) => failures.push({ code, logicalId, detail })
  const deadline = instant(contract.deadlineAt)
  const registered = instant(contract.registeredAt)
  const assessed = instant(evidence.observedAt)
  if (!['full-capacity', 'recovery'].includes(contract.mode)) unknown.push('acceptance mode missing')
  if (!Number.isFinite(deadline) || deadline <= registered || !positive(contract.resources?.maxWallMs) ||
      deadline - registered > contract.resources.maxWallMs) unknown.push('finite authorized deadline missing')
  if (!positive(contract.minProductiveOverlapMs)) unknown.push('productive overlap duration missing')
  if (!positive(contract.minRecursiveDepth)) unknown.push('recursive depth requirement missing')
  if (!Number.isFinite(assessed)) unknown.push('assessment time missing')
  if (evidence.contractDigest !== digest(Buffer.from(JSON.stringify(contract)))) unknown.push('evidence contract differs from frozen registration')
  if (!Array.isArray(contract.frontiers) || !contract.frontiers.length ||
      new Set(contract.frontiers).size !== contract.frontiers.length) unknown.push('frontier denominator missing or duplicated')
  if (evidence.enumerationComplete !== true) unknown.push('logical-node enumeration incomplete')
  if (evidence.observationErrors?.length) unknown.push(...evidence.observationErrors.map((x) => `observation: ${x}`))
  if (!contract.profile?.harness || !Array.isArray(contract.profile.models) || !contract.profile.models.length ||
      contract.profile.credentialSource !== 'subscription' || contract.resources?.maxPaidModelUsd !== 0) {
    unknown.push('exact subscription-only profile and zero paid-model budget required')
  }
  const logical = new Map()
  const attempts = evidence.attempts ?? []
  const admissionKeys = new Map()
  const nativeOwners = new Map()
  const seenAttemptIds = new Set()
  const failureClasses = {}
  const registeredRuns = new Map((contract.runs ?? []).map((run) => [run.runId, run]))
  if (!registeredRuns.size || registeredRuns.size !== contract.runs?.length) unknown.push('run denominator missing or duplicated')
  for (const attempt of attempts) {
    if (!attempt.runId || !attempt.nodeId || !attempt.attemptId) {
      unknown.push('attempt identity missing')
      continue
    }
    const logicalId = key(attempt.runId, attempt.nodeId)
    if (!registeredRuns.has(attempt.runId) || registeredRuns.get(attempt.runId).frontierId !== attempt.frontierId) {
      add('unregistered-logical-run', logicalId)
    }
    if (!Number.isFinite(instant(attempt.startedAt))) unknown.push(`${logicalId}: attempt start time missing`)
    const attemptKey = key(logicalId, attempt.attemptId)
    if (seenAttemptIds.has(attemptKey)) add('duplicate-attempt-record', logicalId, attempt.attemptId)
    seenAttemptIds.add(attemptKey)
    const node = logical.get(logicalId) ?? { logicalId, runId: attempt.runId, nodeId: attempt.nodeId, attempts: [] }
    node.attempts.push(attempt)
    logical.set(logicalId, node)
    if (attempt.failureClass) failureClasses[attempt.failureClass] = (failureClasses[attempt.failureClass] ?? 0) + 1
    if (!attempt.idempotencyKey) unknown.push(`${logicalId}: admission key missing`)
    else {
      const prior = admissionKeys.get(attempt.idempotencyKey)
      if (prior && prior.logicalId !== logicalId) add('key-shared-between-logical-nodes', logicalId, attempt.idempotencyKey)
      const identity = nativeKey(attempt)
      if (prior && ((prior.executionId && attempt.executionId && prior.executionId !== attempt.executionId) ||
          (prior.nativeIdentity && identity && prior.nativeIdentity !== identity))) {
        add('duplicate-native-execution-for-key', logicalId, attempt.idempotencyKey)
      }
      admissionKeys.set(attempt.idempotencyKey, { logicalId, executionId: attempt.executionId ?? prior?.executionId, nativeIdentity: identity ?? prior?.nativeIdentity })
    }
    const identity = nativeKey(attempt)
    if (identity) {
      const owner = nativeOwners.get(identity)
      if (owner && owner !== logicalId) add('native-execution-shared-between-logical-nodes', logicalId, owner)
      nativeOwners.set(identity, logicalId)
    } else unknown.push(`${logicalId}: complete native identity missing`)
    if (attempt.profile?.harness !== contract.profile?.harness ||
        !contract.profile?.models?.includes(attempt.profile?.model) ||
        attempt.profile?.credentialSource !== 'subscription') add('profile-mismatch', logicalId, attempt.profile)
    if (attempt.auth?.mode !== 'subscription' || !attempt.auth?.source || attempt.auth?.paidApiFallbackDisabled !== true) {
      unknown.push(`${logicalId}: served subscription route not proved`)
    }
  }
  const frontiers = new Set()
  const intervals = []
  let completed = 0
  let failed = 0
  let pending = 0
  let retained = 0
  let maxDepth = 0
  const verifiedSamples = []
  const nativeStates = new Map()
  for (const sample of evidence.samples ?? []) {
    const receipt = await verifyArtifact(sample.nativeCapture, read)
    if (!receipt.ok) {
      unknown.push(`${key(sample.runId, sample.nodeId)}: native sample bytes unavailable`)
      continue
    }
    try {
      const capture = JSON.parse((await read(sample.nativeCapture.path)).toString('utf8'))
      const productivity = nativeProductivity(capture)
      if (capture.nativeScope !== sample.nativeScope || capture.environmentId !== sample.environmentId) throw new Error('native scope differs from retained response')
      if (!logical.get(key(sample.runId, sample.nodeId))?.attempts.some((attempt) =>
        nativeKey(attempt) && nativeKey(attempt) === nativeKey(sample))) throw new Error('native sample is not an admitted execution')
      if (capture.session?.id !== sample.sessionId ||
          (capture.session?.activeExecutionId ?? capture.session?.latestExecutionId) !== sample.executionId ||
          capture.session?.status !== sample.status ||
          (capture.session?.backendType ?? capture.session?.backend) !== sample.harness ||
          capture.session?.model !== sample.model ||
          productivity.productiveBytes !== sample.productiveBytes ||
          productivity.productiveDigest !== sample.productiveDigest) throw new Error('native sample differs from retained response')
      if (sample.complete !== true || !Array.isArray(capture.messages) || capture.messages.length >= 1000) throw new Error('native sample truncated')
      const from = instant(sample.startedAt)
      const to = instant(sample.completedAt)
      if (!Number.isFinite(from) || !Number.isFinite(to) || to < from ||
          (sample.status === 'running' && (from < registered || to > deadline))) {
        add('native-sample-outside-registered-window', key(sample.runId, sample.nodeId))
        continue
      }
      verifiedSamples.push(sample)
      nativeStates.set(nativeKey(sample), { status: sample.status, failureCode: capture.session?.failureReason?.code ?? null })
    } catch {
      add('native-sample-mismatch', key(sample.runId, sample.nodeId))
    }
  }
  const byRunNode = new Map([...logical.values()].map((node) => [key(node.runId, node.nodeId), node]))
  for (const node of logical.values()) {
    const rows = [...node.attempts].sort((a, b) => instant(a.startedAt) - instant(b.startedAt))
    const latest = rows.at(-1)
    frontiers.add(latest.frontierId)
    let depth = 0
    let cursor = latest
    const visited = new Set([node.logicalId])
    while (cursor.parentNodeId) {
      const parentId = key(node.runId, cursor.parentNodeId)
      if (visited.has(parentId)) { add('parent-cycle', node.logicalId); break }
      visited.add(parentId)
      const parent = byRunNode.get(parentId)?.attempts.at(-1)
      if (!parent) { unknown.push(`${node.logicalId}: parent absent`); break }
      depth += 1
      cursor = parent
    }
    maxDepth = Math.max(maxDepth, depth)
    if (latest.terminal?.status === 'done') {
      completed += 1
      const ended = instant(latest.terminal.at)
      if (!Number.isFinite(ended) || ended < registered || ended > deadline) add('terminal-outside-registered-window', node.logicalId)
      const output = await verifyArtifact(latest.output, read)
      if (output.ok) retained += 1
      else add('output-not-retained', node.logicalId, output.reason)
      const native = await verifyArtifact(latest.nativeCapture, read)
      if (!native.ok) add('native-capture-not-retained', node.logicalId, native.reason)
      else {
        try {
          const capture = JSON.parse((await read(latest.nativeCapture.path)).toString('utf8'))
          const nativeEnd = instant(capture.session?.endedAt)
          if (!Number.isFinite(nativeEnd)) unknown.push(`${node.logicalId}: native completion time missing`)
          else if (nativeEnd < registered || nativeEnd > deadline) add('native-terminal-outside-registered-window', node.logicalId)
          if (capture.session?.status !== 'completed' || nativeProductivity(capture).productiveBytes === 0 ||
              capture.nativeScope !== latest.nativeScope || capture.environmentId !== latest.environmentId ||
              capture.session?.id !== latest.sessionId || capture.session?.latestExecutionId !== latest.executionId ||
              (capture.session?.backendType ?? capture.session?.backend) !== contract.profile?.harness ||
              capture.session?.model !== latest.profile?.model || !contract.profile?.models?.includes(capture.session?.model) ||
              !Array.isArray(capture.messages) || capture.messages.length >= 1000) {
            add('native-result-not-complete', node.logicalId)
          }
        } catch { add('native-result-unreadable', node.logicalId) }
      }
    } else if (latest.terminal?.status) {
      failed += 1
      add('logical-run-failed', node.logicalId, latest.terminal.status)
    } else {
      pending += 1
      if (assessed >= deadline) add('logical-run-stranded-at-deadline', node.logicalId)
    }
    const samples = verifiedSamples.filter((s) => s.runId === node.runId && s.nodeId === node.nodeId)
    if (!samples.some((sample) => sample.productiveBytes > 0)) unknown.push(`${node.logicalId}: no retained native productive event`)
    if (contract.profile?.models) {
      intervals.push(...productiveIntervals(samples, contract.profile).map((i) => ({ ...i, logicalId: node.logicalId })))
    }
  }
  for (const runId of registeredRuns.keys()) if (!logical.has(key(runId, runId))) add('registered-root-missing', null, runId)
  for (const frontier of contract.frontiers ?? []) if (!frontiers.has(frontier)) add('frontier-missing', null, frontier)
  for (const frontier of frontiers) if (!contract.frontiers?.includes(frontier)) add('unregistered-frontier', null, frontier)
  if (maxDepth < contract.minRecursiveDepth) add('recursive-depth-not-observed', null, { required: contract.minRecursiveDepth, observed: maxDepth })
  const windows = concurrencyWindows(intervals)
  const productivePeak = Math.max(0, ...windows.map((window) => window.count))
  let longest = 0
  let began = null
  let end = null
  for (const window of windows) {
    if (plan.target !== null && plan.target > 0 && window.count >= plan.target) {
      if (end !== window.start) began = window.start
      end = window.end
      longest = Math.max(longest, end - began)
    } else { began = null; end = null }
  }
  if (plan.target === 0) add('no-admissible-capacity', null)
  if (plan.target !== null && longest < contract.minProductiveOverlapMs) add('capacity-not-productively-sustained', null, { target: plan.target, productivePeak, longestMs: longest })
  if (pending) unknown.push(`${pending} logical nodes have no terminal result yet`)
  if (!logical.size) unknown.push('no logical runs observed')
  const recoveries = evidence.recoveries ?? []
  if (contract.mode === 'full-capacity' && recoveries.length) add('recovery-contaminates-capacity-arm', null)
  if (contract.mode === 'recovery') {
    if (!recoveries.length) unknown.push('no injected recovery observed')
    for (const recovery of recoveries) {
      const logicalId = key(recovery.runId, recovery.nodeId)
      if (!logical.has(logicalId)) add('recovery-identity-missing', logicalId)
      if (!recovery.beforeKey || recovery.beforeKey !== recovery.afterKey) add('recovery-replaced-key', logicalId)
      if (recovery.journalPrefixPreserved !== true || recovery.duplicateNativeExecutions !== 0) add('recovery-evidence-failed', logicalId)
      const duration = instant(recovery.recoveredAt) - instant(recovery.injectedAt)
      if (!positive(contract.recoveryDeadlineMs) || !(duration >= 0 && duration <= contract.recoveryDeadlineMs) || instant(recovery.recoveredAt) > deadline) add('recovery-deadline', logicalId)
    }
  }
  const nativeFailureClasses = {}
  for (const state of nativeStates.values()) if (state.status === 'failed') {
    const code = state.failureCode ?? 'unclassified-native-failure'
    nativeFailureClasses[code] = (nativeFailureClasses[code] ?? 0) + 1
  }
  return {
    schema: 'agent-runtime.full-capacity-assessment.v1',
    experimentId: contract.experimentId,
    mode: contract.mode,
    verdict: failures.length ? 'fail' : unknown.length ? 'incomplete' : 'pass',
    claim: contract.mode === 'recovery' ? 'same-key recovery under injection' : 'configured-capacity productive execution and retained results',
    plan,
    logicalRuns: { denominator: logical.size, completed, failed, pending, retained },
    attempts: { denominator: attempts.length, extraAttempts: attempts.length - logical.size, failureClasses },
    nativeExecutions: {
      observed: nativeStates.size,
      failed: [...nativeStates.values()].filter((state) => state.status === 'failed').length,
      failureClasses: nativeFailureClasses,
      logicalNodesWithoutNativeObservation: [...logical.values()].filter((node) => !verifiedSamples.some((sample) => sample.runId === node.runId && sample.nodeId === node.nodeId)).length,
    },
    frontiers: { required: contract.frontiers?.length ?? null, observed: frontiers.size },
    recursion: { maxDepth },
    capacity: { productivePeak, longestAtTargetMs: longest, requiredMs: contract.minProductiveOverlapMs },
    failures,
    unknown: [...new Set(unknown)],
    limits: ['Native activity is bracketed by two observations; it does not measure GPU/CPU utilization or scientific value.', 'Unknown prices remain unknown; the route proof verifies subscription-only execution, not a fabricated zero subscription cost.'],
  }
}
