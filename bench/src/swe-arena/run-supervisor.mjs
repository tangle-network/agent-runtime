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
import { readFileSync, existsSync } from 'node:fs'
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
const t0 = Date.now()
const res = await spawn.execute('call-1', params, undefined, () => {}, ctx)
const text = res?.content?.[0]?.text ?? ''
console.log(`[driver] spawn_supervisor returned: ${text}`)
const id = text.match(/supervisor (sup-\d+-[a-z0-9]+)/i)?.[1]
if (!id) { console.error('[driver] could not parse supervisor id'); process.exit(1) }

const runDir = join(cwd, '.loops', 'supervisor', id)
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return undefined } }
const tail = (p, n) => {
  if (!existsSync(p)) return []
  const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean)
  return lines.slice(-n)
}
const workerSettlement = () => {
  const status = readJson(join(runDir, 'state.json'))?.status ?? 'missing'
  const events = tail(join(runDir, 'journal.jsonl'), Number.MAX_SAFE_INTEGER).flatMap((line) => {
    try { return [JSON.parse(line)] } catch { return [] }
  })
  const spawnedEvents = events.filter((event) => event.kind === 'spawned' && event.parent)
  const workerIds = new Set(spawnedEvents.flatMap((event) => typeof event.id === 'string' ? [event.id] : []))
  const terminalIds = new Set(events.flatMap((event) =>
    (event.kind === 'settled' || event.kind === 'cancelled') && typeof event.id === 'string' ? [event.id] : [],
  ))
  const missingIds = spawnedEvents.length - workerIds.size
  const unsettled = [...workerIds].filter((workerId) => !terminalIds.has(workerId))
  return { status, workers: spawnedEvents.length, terminal: workerIds.size - unsettled.length, missingIds, unsettled }
}

let last = ''
const positiveNumberEnv = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`)
  return value
}
const deadlineMs = positiveNumberEnv('DRIVER_DEADLINE_MS', 25 * 60 * 1000)
const pollMs = positiveNumberEnv('DRIVER_POLL_MS', 4000)
const cancelTimeoutMs = positiveNumberEnv('DRIVER_CANCEL_TIMEOUT_MS', 30_000)
let cancellation

const withTimeout = (promise, timeoutMs, message) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
  promise.then(
    (value) => { clearTimeout(timer); resolve(value) },
    (err) => { clearTimeout(timer); reject(err) },
  )
})

const cancelAndSettle = (reason) => {
  cancellation ??= (async () => {
    console.error(`[driver] cancelling ${id}: ${reason}`)
    const deadline = Date.now() + cancelTimeoutMs
    const result = await withTimeout(
      Promise.resolve(cancel.execute('cancel-1', { id }, undefined, () => {}, ctx)),
      Math.max(1, deadline - Date.now()),
      `supervisor cancellation did not settle within ${cancelTimeoutMs}ms`,
    )
    const message = result?.content?.[0]?.text ?? ''
    while (true) {
      const settlement = workerSettlement()
      if (settlement.status === 'cancelled' && settlement.missingIds === 0 && settlement.unsettled.length === 0) {
        console.error(`[driver] cancellation settled: workers=${settlement.workers}, terminal=${settlement.terminal}; ${message}`)
        return
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `supervisor cancellation left status=${settlement.status}, ${settlement.unsettled.length} worker(s) unsettled, and ${settlement.missingIds} spawn event(s) missing ids`,
        )
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, 250)))
    }
  })()
  return cancellation
}

let signalExitStarted = false
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, () => {
    if (signalExitStarted) return
    signalExitStarted = true
    void cancelAndSettle(`driver received ${signal}`).then(
      () => process.exit(code),
      (err) => {
        console.error(`[driver] cancellation failed: ${err instanceof Error ? err.message : String(err)}`)
        process.exit(4)
      },
    )
  })
}

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
    console.log(`\n[done] id=${id} status=${st.status} verdict=${st.verdict ?? ''} result=${JSON.stringify(st.result ?? {})} error=${st.error ?? ''}`)
    console.log(`[done] runDir=${runDir}`)
    process.exit(st.status === 'completed' ? 0 : 1)
  }
  if (Date.now() - t0 > deadlineMs) {
    console.error(`[driver] deadline exceeded (${deadlineMs}ms) — supervisor still ${status}. runDir=${runDir}`)
    try {
      await cancelAndSettle('driver deadline exceeded')
    } catch (err) {
      console.error(`[driver] cancellation failed: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(4)
    }
    process.exit(3)
  }
  await new Promise((r) => setTimeout(r, pollMs))
}
