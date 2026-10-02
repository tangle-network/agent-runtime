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

export async function readNativeResponse(box, attempt) {
  const sessions = await box.sessions()
  const entry = sessions.find((candidate) => candidate.info.id === attempt.sessionId)
  if (!entry) throw new Error('exact Runtime session absent from provider')
  const messages = await entry.session.messages({ limit: 1000 })
  return { nativeScope: attempt.nativeScope, environmentId: attempt.environmentId, session: entry.info, messages }
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
  const targets = evidence.attempts.filter((attempt) => attempt.environmentId && attempt.sessionId)
  // Bound observation load; the caller supplies a finite read budget independently of the fleet target.
  if (!Number.isSafeInteger(contract.readConcurrency) || contract.readConcurrency < 1 ||
      !Number.isSafeInteger(contract.readTimeoutMs) || contract.readTimeoutMs < 1) throw new Error('finite read budget required')
  for (let offset = 0; offset < targets.length; offset += contract.readConcurrency) {
    await Promise.all(targets.slice(offset, offset + contract.readConcurrency).map(async (attempt) => {
      const startedAt = new Date().toISOString()
      try {
        const box = await client.get(attempt.environmentId)
        const nativeResponse = await readNativeResponse(box, attempt)
        const { session, messages } = nativeResponse
        const productivity = nativeProductivity(nativeResponse)
        const native = await capture(directory, `${digest(Buffer.from(attempt.attemptId)).slice(7)}.native.json`, nativeResponse)
        attempt.nativeCapture = native
        evidence.samples.push({
          runId: attempt.runId, nodeId: attempt.nodeId, nativeScope: attempt.nativeScope, environmentId: attempt.environmentId,
          startedAt, completedAt: new Date().toISOString(),
          status: session.status, executionId: session.activeExecutionId ?? session.latestExecutionId,
          sessionId: session.id, harness: session.backendType ?? session.backend,
          model: session.model, ...productivity, complete: messages.length < 1000, nativeCapture: native,
        })
      } catch (error) {
        evidence.observationErrors.push(`${attempt.runId}/${attempt.nodeId}: native read ${error.code ?? error.name}`)
      }
    }))
  }
  evidence.observedAt = new Date().toISOString()
  await writeFile(join(directory, 'observation.json'), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  return evidence
}
