/**
 * Thin driver over the REAL loops pi extension. It constructs a minimal
 * ExtensionAPI, calls the extension's default export to register the real tools
 * (spawn_supervisor / supervisor_status / supervisor_watch / compute_watch), then
 * invokes the REAL spawn_supervisor tool and polls the on-disk run dir until the
 * supervisor settles. No supervisor logic is reimplemented — this only replaces
 * pi's chat operator as the caller of the already-registered tool.
 *
 * usage: node --import tsx run-supervisor.mjs <extPath> <cwd> <paramsJsonPath>
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [extPath, cwd, paramsPath] = process.argv.slice(2)
if (!extPath || !cwd || !paramsPath) {
  console.error('usage: node --import tsx run-supervisor.mjs <extPath> <cwd> <paramsJsonPath>')
  process.exit(2)
}
const params = JSON.parse(readFileSync(paramsPath, 'utf8'))

const tools = new Map()
const pi = {
  on() {},
  registerTool(t) { tools.set(t.name, t) },
}

const mod = await import(pathToFileURL(extPath).href)
mod.default(pi)
console.log(`[driver] registered tools: ${[...tools.keys()].join(', ')}`)

const ctx = { cwd }
const spawn = tools.get('spawn_supervisor')
const cancel = tools.get('supervisor_cancel')
if (!spawn || !cancel) {
  console.error('[driver] extension must register spawn_supervisor and supervisor_cancel')
  process.exit(2)
}

const positiveNumberEnv = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`)
  return value
}
const deadlineMs = positiveNumberEnv('DRIVER_DEADLINE_MS', 25 * 60 * 1000)
const pollMs = positiveNumberEnv('DRIVER_POLL_MS', 4000)
const cancelTimeoutMs = positiveNumberEnv('DRIVER_CANCEL_TIMEOUT_MS', 30_000)
const settlementTimeoutMs = positiveNumberEnv('DRIVER_SETTLEMENT_TIMEOUT_MS', cancelTimeoutMs)
const t0 = Date.now()
const supervisorRoot = join(cwd, '.loops', 'supervisor')
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return undefined } }
const tail = (p, n) => {
  if (!existsSync(p)) return []
  const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean)
  return lines.slice(-n)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const listSupervisorIds = () => {
  try {
    return readdirSync(supervisorRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^sup-\d+-[a-z0-9]+$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}
const idsBeforeSpawn = new Set(listSupervisorIds())
const runDirFor = (id) => join(supervisorRoot, id)

const workerSettlement = (id) => {
  const runDir = runDirFor(id)
  const status = readJson(join(runDir, 'state.json'))?.status ?? 'missing'
  const journalPath = join(runDir, 'journal.jsonl')
  const lines = tail(journalPath, Number.MAX_SAFE_INTEGER)
  let invalidLines = 0
  const events = lines.flatMap((line) => {
    try { return [JSON.parse(line)] } catch { invalidLines += 1; return [] }
  })
  const rootSpawned = events.some((event) => event.kind === 'spawned' && event.id === id && !event.parent)
  const spawnedEvents = events.filter((event) => event.kind === 'spawned' && event.parent)
  let missingIds = 0
  const workerIds = new Set()
  for (const event of spawnedEvents) {
    if (typeof event.id === 'string' && event.id.length > 0) workerIds.add(event.id)
    else missingIds += 1
  }
  const terminalIds = new Set(events.flatMap((event) =>
    (event.kind === 'settled' || event.kind === 'cancelled') && typeof event.id === 'string' ? [event.id] : [],
  ))
  const unsettled = [...workerIds].filter((workerId) => !terminalIds.has(workerId))
  return {
    status,
    journalPresent: existsSync(journalPath),
    rootSpawned,
    invalidLines,
    workers: workerIds.size,
    terminal: workerIds.size - unsettled.length,
    missingIds,
    unsettled,
  }
}

const hasTerminalWorkerEvidence = (settlement) =>
  settlement.journalPresent &&
  settlement.rootSpawned &&
  settlement.invalidLines === 0 &&
  settlement.missingIds === 0 &&
  settlement.unsettled.length === 0

const settlementProblem = (settlement) =>
  `status=${settlement.status}, journal=${settlement.journalPresent ? 'present' : 'missing'}, root=${settlement.rootSpawned ? 'present' : 'missing'}, ` +
  `workers=${settlement.workers}, terminal=${settlement.terminal}, unsettled=${settlement.unsettled.length}, ` +
  `missingIds=${settlement.missingIds}, invalidLines=${settlement.invalidLines}`

const withTimeout = (promise, timeoutMs, message) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
  promise.then(
    (value) => { clearTimeout(timer); resolve(value) },
    (err) => { clearTimeout(timer); reject(err) },
  )
})

const cancellations = new Map()
const cancelAndSettle = (id, reason, deadline = Date.now() + cancelTimeoutMs) => {
  if (cancellations.has(id)) return cancellations.get(id)
  const cancellation = (async () => {
    console.error(`[driver] cancelling ${id}: ${reason}`)
    const result = await withTimeout(
      Promise.resolve(cancel.execute(`cancel-${id}`, { id }, undefined, () => {}, ctx)),
      Math.max(1, deadline - Date.now()),
      `supervisor cancellation did not settle within ${cancelTimeoutMs}ms`,
    )
    const message = result?.content?.[0]?.text ?? ''
    while (true) {
      const settlement = workerSettlement(id)
      const terminalStatus = ['completed', 'failed', 'cancelled'].includes(settlement.status)
      if (terminalStatus && hasTerminalWorkerEvidence(settlement)) {
        console.error(`[driver] cancellation settled: workers=${settlement.workers}, terminal=${settlement.terminal}; ${message}`)
        return settlement
      }
      if (Date.now() >= deadline) {
        throw new Error(`supervisor cancellation left ${settlementProblem(settlement)}`)
      }
      await sleep(Math.min(pollMs, 250, Math.max(1, deadline - Date.now())))
    }
  })()
  cancellations.set(id, cancellation)
  return cancellation
}

let parsedId
let spawnSettled = false
let receivedSignal
let signalExitPromise
const startedIds = () => {
  const ids = listSupervisorIds().filter((id) => !idsBeforeSpawn.has(id))
  if (parsedId && !ids.includes(parsedId)) ids.push(parsedId)
  return ids.sort()
}
const waitForStartedIds = async (deadline) => {
  while (true) {
    const ids = startedIds()
    if (ids.length > 0 || spawnSettled) return ids
    if (Date.now() >= deadline) {
      throw new Error(`spawn did not expose a supervisor id within ${cancelTimeoutMs}ms`)
    }
    await sleep(Math.min(pollMs, 50, Math.max(1, deadline - Date.now())))
  }
}
const cancelStartedRuns = async (reason, deadline) => {
  const ids = await waitForStartedIds(deadline)
  await Promise.all(ids.map((id) => cancelAndSettle(id, reason, deadline)))
  return ids
}
const finishSignalExit = () => {
  if (!receivedSignal) return Promise.resolve()
  signalExitPromise ??= (async () => {
    const { signal, code } = receivedSignal
    try {
      await cancelStartedRuns(`driver received ${signal}`, Date.now() + cancelTimeoutMs)
      process.exit(code)
    } catch (err) {
      console.error(`[driver] cancellation failed: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(4)
    }
  })()
  return signalExitPromise
}

for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, () => {
    if (receivedSignal) return
    receivedSignal = { signal, code }
    void finishSignalExit()
  })
}

let res
let spawnError
try {
  res = await spawn.execute('call-1', params, undefined, () => {}, ctx)
  const responseText = res?.content?.[0]?.text ?? ''
  parsedId = responseText.match(/supervisor (sup-\d+-[a-z0-9]+)/i)?.[1]
} catch (err) {
  spawnError = err
} finally {
  spawnSettled = true
}

if (receivedSignal) await finishSignalExit()

const text = res?.content?.[0]?.text ?? ''
if (res) console.log(`[driver] spawn_supervisor returned: ${text}`)
if (spawnError || !parsedId) {
  const ids = startedIds()
  if (ids.length > 0) {
    console.error(`[driver] spawn did not return a usable id; cancelling recovered run(s): ${ids.join(', ')}`)
    try {
      const deadline = Date.now() + cancelTimeoutMs
      await Promise.all(ids.map((id) => cancelAndSettle(id, 'spawn did not return a usable supervisor id', deadline)))
    } catch (err) {
      console.error(`[driver] recovered-run cancellation failed: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(4)
    }
  }
  if (spawnError) {
    console.error(`[driver] spawn_supervisor failed: ${spawnError instanceof Error ? spawnError.message : String(spawnError)}`)
  } else {
    console.error('[driver] could not parse supervisor id')
  }
  process.exit(1)
}

const id = parsedId
const runDir = runDirFor(id)
const waitForCompletedSettlement = async () => {
  const deadline = Date.now() + settlementTimeoutMs
  while (true) {
    const settlement = workerSettlement(id)
    if (settlement.status !== 'completed' || hasTerminalWorkerEvidence(settlement)) return settlement
    if (Date.now() >= deadline) {
      throw new Error(`completed supervisor lacks terminal worker evidence after ${settlementTimeoutMs}ms: ${settlementProblem(settlement)}`)
    }
    await sleep(Math.min(pollMs, 250, Math.max(1, deadline - Date.now())))
  }
}

let last = ''
while (true) {
  const st = readJson(join(runDir, 'state.json'))
  const status = st?.status ?? 'pending'
  const progress = st?.progress ?? ''
  const journal = tail(join(runDir, 'journal.jsonl'), 40)
  const spawned = journal.filter((l) => l.includes('"kind":"spawned"')).length
  const settled = journal.filter((l) => l.includes('"kind":"settled"')).length
  const stamp = `${((Date.now() - t0) / 1000).toFixed(0)}s status=${status} progress="${progress}" journal(spawned=${spawned},settled=${settled})`
  if (stamp !== last) { console.log(`[watch] ${stamp}`); last = stamp }
  if (st && ['completed', 'failed', 'cancelled'].includes(st.status)) {
    let settlement
    if (st.status === 'completed') {
      try {
        settlement = await waitForCompletedSettlement()
      } catch (err) {
        console.error(`[driver] refusing completed supervisor: ${err instanceof Error ? err.message : String(err)}`)
        process.exit(4)
      }
      if (settlement.status !== 'completed') continue
    }
    console.log(`\n[done] id=${id} status=${st.status} verdict=${st.verdict ?? ''} result=${JSON.stringify(st.result ?? {})} error=${st.error ?? ''}`)
    if (settlement) {
      console.log(`[done] worker settlement: workers=${settlement.workers}, terminal=${settlement.terminal}`)
    }
    console.log(`[done] runDir=${runDir}`)
    process.exit(st.status === 'completed' ? 0 : 1)
  }
  if (Date.now() - t0 > deadlineMs) {
    console.error(`[driver] deadline exceeded (${deadlineMs}ms) — supervisor still ${status}. runDir=${runDir}`)
    try {
      await cancelAndSettle(id, 'driver deadline exceeded')
    } catch (err) {
      console.error(`[driver] cancellation failed: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(4)
    }
    process.exit(3)
  }
  await sleep(pollMs)
}
