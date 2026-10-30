import { createHash } from 'node:crypto'
import { existsSync, type FSWatcher, readdirSync, watch } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { createServer, type ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { extname, resolve, sep } from 'node:path'
import { loadTopSnapshot, type TopSnapshot } from './top-snapshot'
import type { TopSessionReader } from './top-transcript'
import { serveTopAgent, type TopInspectionSource } from './top-web-agent'

export type { TopInspection, TopInspectionSource } from './top-web-agent'

/** Interval for reconciling missed filesystem notifications in the live viewer. */
export const TOP_SNAPSHOT_RECONCILE_MS = 500

/** A reconnect always receives current truth; deltas replace changed roots atomically. */
export interface TopSnapshotFrame {
  readonly sequence: number
  readonly observedAt: number
  readonly reset: boolean
  readonly snapshots: readonly TopSnapshot[]
}

export interface TopWebOptions {
  readonly roots: readonly string[]
  /** Defaults to the packaged Sandbox UI browser assets. */
  readonly assets?: string
  readonly host?: string
  readonly port?: number
  /** Product-owned verified conversation reads; no execution or credential access. */
  readonly source?: TopInspectionSource
  /** Canonical native decoding for ordinary Runtime transcript receipts. */
  readonly readSessions?: TopSessionReader
}

/** Read-only web transport over the same snapshots as the terminal. No execution or writes. */
export async function serveTopWeb(options: TopWebOptions) {
  if (!options.roots.length) throw new Error('At least one --root is required')
  const roots = [...new Set(await Promise.all(options.roots.map((root) => realpath(root))))]
  const require = createRequire(import.meta.url)
  const assets = await realpath(
    options.assets ?? resolve(require.resolve('@tangle-network/agent-runtime/tui'), '../../viewer'),
  )
  for (const file of ['workspace-viewer.js', 'styles.css']) await stat(resolve(assets, file))
  const host = options.host ?? '127.0.0.1'
  const clients = new Set<ServerResponse>()
  const transcripts = new Set<() => void>()
  const snapshots = new Map<string, TopSnapshot>()
  const digests = new Map<string, string>()
  const watchers: FSWatcher[] = []
  let sequence = 0
  let reading = false
  let dirty = true
  let closed = false
  let scheduled: NodeJS.Timeout | undefined
  const send = (client: ServerResponse, frame: TopSnapshotFrame) => {
    if (client.writableLength > 1024 * 1024) return client.destroy()
    client.write(`id: ${frame.sequence}\nevent: snapshot\ndata: ${JSON.stringify(frame)}\n\n`)
  }
  let inFlight: Promise<void> = Promise.resolve()
  const read = async () => {
    reading = true
    dirty = false
    try {
      const changed: TopSnapshot[] = []
      for (const root of roots) {
        const snapshot = existsSync(resolve(root, 'observer.jsonl'))
          ? await loadTopSnapshot(root, { runDir: root })
          : existsSync(resolve(root, 'spawn-journal.jsonl'))
            ? await loadTopSnapshot(root, { runDir: root, format: 'journal' })
            : existsSync(resolve(root, 'journal.jsonl'))
              ? await loadTopSnapshot(root, { runDir: root, format: 'workflow' })
              : await loadRunsRoot(root)
        const digest = createHash('sha256')
          .update(
            JSON.stringify(snapshot, (key, value) =>
              key === 'generatedAt' || key === 'latencyMs' ? undefined : value,
            ),
          )
          .digest('hex')
        snapshots.set(root, snapshot)
        if (digests.get(root) !== digest) {
          changed.push(snapshot)
          digests.set(root, digest)
        }
      }
      if (changed.length) {
        const frame = {
          sequence: ++sequence,
          observedAt: Date.now(),
          reset: false,
          snapshots: changed,
        }
        for (const client of clients) send(client, frame)
      }
      for (const update of transcripts) update()
    } finally {
      reading = false
      if (dirty && !closed) schedule()
    }
  }
  const refresh = (): Promise<void> => {
    if (reading || closed) return inFlight
    inFlight = read()
    return inFlight
  }
  const schedule = () => {
    dirty = true
    if (!scheduled && !closed)
      scheduled = setTimeout(() => {
        scheduled = undefined
        void refresh().catch((error: unknown) => {
          for (const client of clients)
            client.write(
              `event: unavailable\ndata: ${JSON.stringify({ message: String(error) })}\n\n`,
            )
        })
      }, 16)
  }
  await refresh()
  for (const root of roots) watchers.push(watch(root, { recursive: true }, schedule))
  // Watch notifications may be coalesced or lost; the same loader reconciles them without a second model.
  const reconcile = setInterval(schedule, TOP_SNAPSHOT_RECONCILE_MS)
  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(': alive\n\n')
  }, 15_000)
  const server = createServer((request, response) => {
    void (async () => {
      const base = `http://${request.headers.host}`
      const incomingHost = new URL(base).hostname.replace(/^\[|\]$/g, '')
      if (
        !request.headers.host ||
        ![host, '127.0.0.1', 'localhost', '::1'].includes(incomingHost) ||
        (request.headers.origin && request.headers.origin !== base)
      ) {
        response.writeHead(403).end()
        return
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD' }).end()
        return
      }
      const path = new URL(request.url ?? '/', base).pathname
      response.setHeader('Cache-Control', 'no-store')
      response.setHeader('X-Content-Type-Options', 'nosniff')
      if (path === '/api/top/events') {
        if (request.method === 'HEAD') {
          response.writeHead(200, { 'Content-Type': 'text/event-stream' }).end()
          return
        }
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' })
        response.flushHeaders()
        clients.add(response)
        send(response, {
          sequence,
          observedAt: Date.now(),
          reset: true,
          snapshots: [...snapshots.values()],
        })
        response.on('close', () => clients.delete(response))
      } else if (/^\/api\/top\/agents\/\d+\/[^/]+\/[^/]+(?:\/stream)?$/.test(path)) {
        await serveTopAgent({
          request,
          response,
          path,
          base,
          roots,
          snapshots,
          transcripts,
          source: options.source,
          readSessions: options.readSessions,
        })
      } else if (path === '/api/top') {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(
          JSON.stringify({
            sequence,
            observedAt: Date.now(),
            reset: true,
            snapshots: [...snapshots.values()],
          }),
        )
      } else if (path === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end(
          '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Live agents</title><link rel="stylesheet" href="/assets/styles.css"></head><body><div id="agent-workspace" data-mode="live" data-api="/api/top" data-theme="dark"></div><script type="module" src="/assets/workspace-viewer.js"></script></body></html>',
        )
      } else if (path.startsWith('/assets/')) {
        const file = await realpath(resolve(assets, decodeURIComponent(path.slice(8))))
        if (!file.startsWith(assets + sep)) {
          response.writeHead(403).end()
          return
        }
        const kind = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[
          extname(file)
        ]
        if (!kind) {
          response.writeHead(404).end()
          return
        }
        response.writeHead(200, { 'Content-Type': kind })
        response.end(request.method === 'HEAD' ? undefined : await readFile(file))
      } else response.writeHead(404).end()
    })().catch((error: unknown) => {
      if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: String(error) }))
    })
  })
  let closing: Promise<void> | undefined
  const close = () =>
    (closing ??= (async () => {
      clearInterval(reconcile)
      clearInterval(heartbeat)
      for (const watcher of watchers) watcher.close()
      // A caller closes right after its run settles: let a read in flight finish, then read once
      // more, so a terminal record appended just before close reaches connected clients.
      await inFlight.catch(() => undefined)
      await refresh().catch(() => undefined)
      closed = true
      if (scheduled) clearTimeout(scheduled)
      // The run is over for this viewer: say so, so a client stops instead of reconnecting.
      for (const client of clients) client.end('event: end\ndata: {}\n\n')
      transcripts.clear()
      server.closeAllConnections()
      await new Promise<void>((done, reject) =>
        server.close((error) =>
          error && (!('code' in error) || error.code !== 'ERR_SERVER_NOT_RUNNING')
            ? reject(error)
            : done(),
        ),
      )
    })())
  try {
    await new Promise<void>((done, reject) => {
      server.once('error', reject)
      server.listen(options.port ?? 0, host, done)
    })
  } catch (error) {
    await close()
    throw error
  }
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Web server has no TCP address')
  return { url: `http://${host.includes(':') ? `[${host}]` : host}:${address.port}/`, close }
}

/** CLI options stay on agent-runtime-top; the renderer is supplied by its installed owner. */
export async function runTopWeb(argv: readonly string[]) {
  const values = (flag: string) =>
    argv.flatMap((arg, i) => (arg === flag ? [argv[i + 1] ?? ''] : []))
  const roots = values('--root')
  const port = Number(values('--port')[0] ?? 0)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid --port')
  const web = await serveTopWeb({
    roots: roots.length ? roots : [process.cwd()],
    ...(values('--assets')[0] ? { assets: values('--assets')[0] } : {}),
    port,
    ...(values('--host')[0] ? { host: values('--host')[0] } : {}),
  })
  process.stdout.write(`${JSON.stringify({ event: 'ready', url: web.url, pid: process.pid })}\n`)
  const stop = () => {
    void web.close().catch((error: unknown) => {
      process.stderr.write(`${String(error)}\n`)
      process.exitCode = 1
    })
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  return web
}

/** A journal root holds one `<runId>/observer.jsonl` per retained run beside any workspace runs. */
async function loadRunsRoot(root: string): Promise<TopSnapshot> {
  const workspace = loadTopSnapshot(root)
  // A supervised run writes its spawn journal at begin and its observer journal after the first
  // turn; either one makes the run a card, so it appears as soon as supervision starts.
  const has = (runId: string, file: string) => existsSync(resolve(root, runId, file))
  const runIds = readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        (has(entry.name, 'observer.jsonl') || has(entry.name, 'spawn-journal.jsonl')),
    )
    .map((entry) => entry.name)
  if (!runIds.length) return workspace
  const runs = await Promise.all(
    runIds.map((runId) =>
      loadTopSnapshot(root, {
        runDir: resolve(root, runId),
        ...(has(runId, 'observer.jsonl') ? {} : { format: 'journal' as const }),
      }),
    ),
  )
  const diagnostics = [
    ...workspace.diagnostics,
    ...runs.flatMap((run, i) => run.diagnostics.map((d) => ({ ...d, runId: runIds[i] }))),
  ]
  const supervisors = [...workspace.supervisors, ...runs.flatMap((run) => run.supervisors)]
  return {
    ...workspace,
    supervisors,
    diagnostics,
    completeness: diagnostics.length ? 'partial' : 'complete',
    discovered: workspace.discovered + runIds.length,
    loaded: supervisors.length,
  }
}
