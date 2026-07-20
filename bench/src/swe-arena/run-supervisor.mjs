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

let last = ''
const deadlineMs = Number(process.env.DRIVER_DEADLINE_MS ?? 25 * 60 * 1000)
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
    process.exit(3)
  }
  await new Promise((r) => setTimeout(r, 4000))
}
