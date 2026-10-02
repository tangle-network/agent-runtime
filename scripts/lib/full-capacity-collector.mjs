import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { digest, nativeProductivity } from './full-capacity-acceptance.mjs'

async function capture(directory, name, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value))
  const path = join(directory, name)
  await writeFile(path, bytes, { flag: 'wx', mode: 0o600 })
  return { path, sha256: digest(bytes), bytes: bytes.length }
}

/** Preserve identity conflicts instead of folding them away as repeated transport receipts. */
export function retainAdmission(attempts, admission, at) {
  const incoming = { ...admission, ...(admission.controlRef ?? {}) }
  if (!incoming.idempotencyKey) throw new Error('Runtime admission has no key')
  const matching = [...attempts.entries()].filter(([, prior]) => prior.idempotencyKey === incoming.idempotencyKey)
  const latest = matching.at(-1)
  const conflict = latest && ['environmentId', 'sessionId', 'executionId'].some((field) =>
    latest[1][field] && incoming[field] && latest[1][field] !== incoming[field])
  const entryKey = !latest || conflict ? `${incoming.idempotencyKey}:admission:${matching.length}` : latest[0]
  const attempt = !latest || conflict ? { startedAt: at } : latest[1]
  Object.assign(attempt, incoming)
  attempts.set(entryKey, attempt)
}

const currentExecution = session => session?.activeExecutionId ?? session?.latestExecutionId
const logicalOwner = attempt => JSON.stringify([attempt.runId, attempt.nodeId])
const nativeIdentity = attempt => JSON.stringify([attempt.nativeScope, attempt.environmentId, attempt.sessionId, attempt.executionId])
const readError = code => Object.assign(new Error(code), { code })

export async function readNativeResponse(box, attempt, sessions = undefined) {
  sessions ??= await box.sessions()
  const entry = sessions.find((candidate) => candidate.info.id === attempt.sessionId)
  if (!entry) throw new Error('exact Runtime session absent from provider')
  if (!attempt.executionId || currentExecution(entry.info) !== attempt.executionId) throw readError('native-execution-mismatch')
  if (!attempt.turnId) throw readError('native-turn-unattributed')
  const messages = await entry.session.messages({ limit: 1000 })
  const session = await entry.session.status()
  // Messages are a session-wide endpoint. A rollover during this read cannot certify either execution.
  if (!session || session.id !== attempt.sessionId || currentExecution(session) !== attempt.executionId ||
      session.status !== entry.info.status || session.model !== entry.info.model ||
      (session.backendType ?? session.backend) !== (entry.info.backendType ?? entry.info.backend)) {
    throw readError('native-session-changed-during-read')
  }
  const messagesComplete = messages.length < 1000 && messages.every(message =>
    message.role !== 'assistant' || typeof message.metadata?.turnId === 'string' && message.metadata.turnId.length > 0)
  return { nativeScope: attempt.nativeScope, environmentId: attempt.environmentId, session, sessionBefore: entry.info,
    turnId: attempt.turnId, messages, messagesComplete }
}

/** A physical session is read once; earlier admitted executions remain explicitly unobserved. */
export async function collectNativeSamples(evidence, client, directory, readConcurrency) {
  if (!Number.isSafeInteger(readConcurrency) || readConcurrency < 1) throw new Error('finite read budget required')
  const environments = new Map()
  evidence.nativeSessions = []
  evidence.sources ??= []
  for (const attempt of evidence.attempts) {
    attempt.nativeObservation = { state: 'unobserved', reason: 'complete-native-identity-missing' }
    if (!attempt.environmentId || !attempt.sessionId) continue
    const key = JSON.stringify([attempt.nativeScope, attempt.environmentId])
    if (!environments.has(key)) environments.set(key, [])
    environments.get(key).push(attempt)
  }
  const groups = [...environments.values()]
  for (let offset = 0; offset < groups.length; offset += readConcurrency) {
    await Promise.all(groups.slice(offset, offset + readConcurrency).map(async attempts => {
      const readStartedAt = new Date().toISOString()
      let box, sessions, sessionCapture, listedAt
      try {
        box = await client.get(attempts[0].environmentId)
        sessions = await box.sessions()
        listedAt = new Date().toISOString()
        const scope = JSON.stringify([attempts[0].nativeScope, attempts[0].environmentId])
        sessionCapture = await capture(directory, `${digest(Buffer.from(scope)).slice(7)}.sessions.json`, sessions.map(entry => entry.info))
        evidence.sources.push(sessionCapture)
      } catch (error) {
        for (const attempt of attempts) attempt.nativeObservation = { state: 'unobserved', reason: 'native-environment-read-failed' }
        evidence.observationErrors.push(`${attempts[0].environmentId}: native read ${error.code ?? error.name}`)
        return
      }
      const sessionIds = new Set(attempts.map(attempt => attempt.sessionId))
      for (const sessionId of sessionIds) {
        const owners = attempts.filter(attempt => attempt.sessionId === sessionId)
        const entry = sessions.find(candidate => candidate.info.id === sessionId)
        const executionId = currentExecution(entry?.info)
        const matching = owners.filter(attempt => attempt.executionId && attempt.executionId === executionId)
        const observed = { nativeScope: owners[0].nativeScope, environmentId: owners[0].environmentId, sessionId,
          executionId: executionId ?? null, status: entry?.info.status ?? null, startedAt: readStartedAt, observedAt: listedAt,
          sessionCapture, matchingAttemptIds: matching.map(attempt => attempt.attemptId) }
        evidence.nativeSessions.push(observed)
        for (const attempt of owners) attempt.nativeObservation = { state: 'unobserved',
          reason: !entry ? 'native-session-absent' : !executionId ? 'current-execution-unknown' : 'different-current-execution',
          observedExecutionId: executionId ?? null }
        if (!entry || !executionId || !matching.length) {
          evidence.observationErrors.push(`${owners[0].environmentId}/${sessionId}: current native execution is absent or not admitted`)
          continue
        }
        if (new Set(matching.map(logicalOwner)).size !== 1 || new Set(matching.map(attempt => attempt.turnId)).size !== 1) {
          for (const attempt of matching) attempt.nativeObservation.reason = 'native-identity-owner-conflict'
          evidence.observationErrors.push(`${owners[0].environmentId}/${sessionId}: native identity has conflicting owners or turns`)
          continue
        }
        const attempt = matching[0]
        const startedAt = readStartedAt
        try {
          const response = await readNativeResponse(box, attempt, sessions)
          const native = await capture(directory, `${digest(Buffer.from(nativeIdentity(attempt))).slice(7)}.native.json`, response)
          for (const owner of matching) {
            owner.nativeCapture = native
            owner.nativeObservation = { state: 'observed', executionId, nativeCapture: native }
          }
          observed.nativeCapture = native
          evidence.samples.push({ runId: attempt.runId, nodeId: attempt.nodeId, nativeScope: attempt.nativeScope,
            environmentId: attempt.environmentId, sessionId, executionId, turnId: attempt.turnId,
            attemptIds: matching.map(owner => owner.attemptId), startedAt, completedAt: new Date().toISOString(),
            status: response.session.status, harness: response.session.backendType ?? response.session.backend,
            model: response.session.model, ...nativeProductivity(response), complete: response.messagesComplete, nativeCapture: native })
        } catch (error) {
          for (const owner of matching) owner.nativeObservation = { state: 'unobserved', reason: error.code ?? 'native-read-failed' }
          evidence.observationErrors.push(`${attempt.runId}/${attempt.nodeId}: native read ${error.code ?? error.name}`)
        }
      }
    }))
  }
}

/** One bounded, read-only sample. It never creates, resumes, cancels, or replaces work. */
export async function collectCapacityEvidence(contract, directory) {
  const { FileSpawnJournal, FileResultBlobStore } = await import(pathToFileURL(resolve(contract.consumer.runtimeKernel)).href)
  const { Sandbox } = await import(pathToFileURL(resolve(contract.consumer.sandboxSdk)).href)
  const apiKey = process.env[contract.consumer.apiKeyEnv]
  if (!apiKey) throw new Error(`missing credential reference ${contract.consumer.apiKeyEnv}`)
  const client = new Sandbox({ baseUrl: contract.consumer.baseUrl, apiKey, timeoutMs: contract.readTimeoutMs })
  await mkdir(directory, { recursive: false, mode: 0o700 })
  const evidence = {
    schema: 'agent-runtime.full-capacity-observation.v1',
    collectorVersion: 2,
    contractDigest: digest(Buffer.from(JSON.stringify(contract))),
    observedAt: new Date().toISOString(),
    enumerationComplete: true,
    observationErrors: [],
    sources: [],
    attempts: [],
    samples: [],
    recoveries: [],
  }
  let authReceipts = []
  if (contract.consumer.authEvidencePath) {
    try {
      const raw = await readFile(contract.consumer.authEvidencePath)
      const receipt = await capture(directory, 'subscription-route-receipts.json', raw)
      evidence.sources.push(receipt)
      authReceipts = JSON.parse(raw)
      if (!Array.isArray(authReceipts)) throw new Error('subscription route receipts must be an array')
    } catch (error) {
      evidence.observationErrors.push(`subscription route receipts: ${error.code ?? error.name}`)
    }
  }
  for (const source of contract.runs) {
    const nodes = new Map()
    try {
      const inputBytes = await readFile(join(source.directory, 'run-input.json'))
      if (digest(inputBytes) !== source.inputSha256) throw new Error('registered run input digest changed')
      const input = JSON.parse(inputBytes)
      if (input.runId !== source.runId) throw new Error('registered run identity changed')
      const journalBytes = await readFile(join(source.directory, 'spawn-journal.jsonl'))
      const journalCapture = await capture(directory, `${source.runId}.journal.jsonl`, journalBytes)
      evidence.sources.push(journalCapture)
      const envelopes = journalBytes.toString('utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
      const trees = [...new Set(envelopes.filter((row) => row.kind === 'begin').map((row) => row.root))]
      if (!trees.length) throw new Error('no Runtime tree found')
      const journal = new FileSpawnJournal(journalCapture.path)
      const events = []
      for (const tree of trees) {
        const loaded = await journal.loadTree(tree)
        if (!loaded) throw new Error('Runtime tree disappeared')
        events.push(...loaded)
      }
      events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
      for (const event of events) {
        if (!event.id) continue
        const node = nodes.get(event.id) ?? { id: event.id, attempts: new Map(), firstAt: event.at }
        if (event.kind === 'spawned') {
          // Nested tree root markers omit parent; they cannot erase the admitted edge.
          if (event.parent && node.parent && event.parent !== node.parent) throw new Error('conflicting Runtime parents')
          node.parent ??= event.parent
          node.profileRef ??= event.profileRef
        }
        if (event.kind === 'execution-admitted') {
          retainAdmission(node.attempts, event.admission, event.at)
        }
        if (event.kind === 'settled') node.terminal = event
        nodes.set(event.id, node)
      }
      const blobs = new FileResultBlobStore(join(source.directory, 'blobs'))
      for (const node of nodes.values()) {
        const profile = node.profileRef ? await blobs.get(node.profileRef) : input.profile
        const entries = [...node.attempts.entries()]
        if (!entries.length) entries.push([null, { startedAt: node.firstAt }])
        for (let index = 0; index < entries.length; index += 1) {
          const [attemptId, admission] = entries[index]
          const idempotencyKey = admission.idempotencyKey ?? null
          const latest = index === entries.length - 1
          const auth = authReceipts.find((receipt) => receipt.idempotencyKey === idempotencyKey && receipt.executionId === admission.executionId)
          const attempt = {
            runId: source.runId,
            nodeId: node.id,
            frontierId: source.frontierId,
            parentNodeId: node.parent ?? null,
            attemptId: attemptId ?? `${node.id}:not-admitted`,
            idempotencyKey,
            turnId: admission.turnId ?? null,
            nativeScope: contract.consumer.baseUrl,
            executionId: admission.executionId ?? null,
            sessionId: admission.sessionId ?? null,
            environmentId: admission.environmentId ?? null,
            startedAt: admission.startedAt,
            profile: { harness: profile?.harness, model: profile?.model?.default, credentialSource: profile?.model?.metadata?.credentialSource },
            auth: auth ? { mode: auth.mode, source: auth.source, paidApiFallbackDisabled: auth.paidApiFallbackDisabled } : null,
            terminal: latest && node.terminal && Date.parse(node.terminal.at) >= Date.parse(admission.startedAt)
              ? { status: node.terminal.status, at: node.terminal.at, reason: node.terminal.reason } : null,
            output: null,
            nativeCapture: null,
          }
          if (latest && node.terminal?.outRef) {
            const output = await blobs.get(node.terminal.outRef)
            if (output !== undefined) attempt.output = await capture(directory, `${source.runId}.${digest(Buffer.from(node.id)).slice(7)}.output.json`, output)
          }
          evidence.attempts.push(attempt)
        }
      }
    } catch (error) {
      evidence.enumerationComplete = false
      evidence.observationErrors.push(`${source.runId}: ${error.code ?? error.name}: ${error.message}`)
    }
  }
  // Bound observation load; the caller supplies a finite read budget independently of the fleet target.
  if (!Number.isSafeInteger(contract.readConcurrency) || contract.readConcurrency < 1 ||
      !Number.isSafeInteger(contract.readTimeoutMs) || contract.readTimeoutMs < 1) throw new Error('finite read budget required')
  await collectNativeSamples(evidence, client, directory, contract.readConcurrency)
  evidence.observedAt = new Date().toISOString()
  await writeFile(join(directory, 'observation.json'), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  return evidence
}
