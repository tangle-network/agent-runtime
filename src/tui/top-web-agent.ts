import { once } from 'node:events'
import { existsSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join, resolve } from 'node:path'
import { FileResultBlobStore } from '../durable/spawn-journal/result-blob-store'
import { linkAbort, runAbortable } from '../runtime/supervise/abortable'
import { loadTopSnapshot, type TopSnapshot, type WorkerView } from './top-snapshot'
import {
  createTopAgentStream,
  readTopAgentInspection,
  retainedRouterInspection,
  type TopInspection,
  type TopSessionReader,
  topAgentMetadata,
  topAgentWorker,
  transcriptHistory,
  type transcriptRows,
  transcriptTail,
} from './top-transcript'

export type { TopInspection } from './top-transcript'

const SOURCE_READ_TIMEOUT_MS = 30_000
export type TopInspectionSource = (request: {
  readonly root: string
  readonly runId: string
  readonly workerId: string
  readonly signal?: AbortSignal
}) => Promise<TopInspection>

/** Selected reads share the web server's origin, method and lifecycle boundary. */
export async function serveTopAgent({
  request,
  response,
  path,
  base,
  roots,
  snapshots,
  transcripts,
  source,
  readSessions,
}: {
  request: IncomingMessage
  response: ServerResponse
  path: string
  base: string
  roots: readonly string[]
  snapshots: ReadonlyMap<string, TopSnapshot>
  transcripts: Set<() => void>
  source?: TopInspectionSource
  readSessions?: TopSessionReader
}) {
  const [, , , , rootIndex, runId, workerId] = path.split('/').map(decodeURIComponent)
  const root = roots[Number(rootIndex)]
  const run = root && snapshots.get(root)?.supervisors.find((entry) => entry.id === runId)
  const safeId = (id: string | undefined) =>
    !!id && /^[a-z0-9_.:-]+$/i.test(id) && id !== '.' && id !== '..'
  if (
    !safeId(runId) ||
    !safeId(workerId) ||
    !run ||
    (!run.workers.some((entry) => entry.id === workerId) && run.id !== workerId)
  ) {
    response.writeHead(404).end()
    return
  }
  // A runs root keeps each run's journals, blobs and root stream in `<root>/<runId>`.
  const own =
    root && existsSync(resolve(root, runId!, 'observer.jsonl')) ? resolve(root, runId!) : undefined
  const runDir = own ?? root
  const pursuit = own
    ? (await loadTopSnapshot(root!, { runDir: own })).pursuit
    : root
      ? snapshots.get(root)?.pursuit
      : undefined
  const worker = (): WorkerView | undefined => {
    const run = root ? snapshots.get(root)?.supervisors.find((run) => run.id === runId) : undefined
    const node = run && topAgentWorker(run, workerId!)
    return node && node.id === run?.id && existsSync(resolve(runDir!, 'root-stream.jsonl'))
      ? { ...node, eventFile: resolve(runDir!, 'root-stream.jsonl') }
      : node
  }

  if (!worker()) {
    response.writeHead(404).end()
    return
  }
  const controller = new AbortController()
  response.on('close', () => controller.abort())
  const readSource = async () => {
    const deadline = new AbortController()
    const linked = linkAbort(controller.signal, deadline.signal)
    const timer = setTimeout(
      () => deadline.abort('Inspection source read exceeded its deadline'),
      SOURCE_READ_TIMEOUT_MS,
    )
    timer.unref()
    try {
      const result = await runAbortable(
        () =>
          source
            ? source({
                root: runDir!,
                runId: runId!,
                workerId: workerId!,
                signal: linked.signal,
              })
            : readSessions
              ? readTopAgentInspection({
                  worker: worker()!,
                  runId: runId!,
                  blobs: new FileResultBlobStore(join(runDir!, 'blobs')),
                  readSessions,
                  signal: linked.signal,
                })
              : retainedRouterInspection(worker()!, runDir),
        linked.signal,
        'Inspection read stopped',
      )
      return result?.coverage.status === 'complete' && !result.rows?.length
        ? {
            ...result,
            coverage: {
              ...result.coverage,
              status: 'partial' as const,
              reason: 'No verified native conversation rows were supplied',
            },
          }
        : result
    } finally {
      clearTimeout(timer)
      linked.release()
    }
  }
  let history: ReturnType<typeof transcriptRows> | undefined = await transcriptHistory(
    worker()!,
    runDir,
    pursuit?.nodes.find((node) => node.runId === runId && node.id === workerId),
  )
  if (!path.endsWith('/stream')) {
    const inspection = await readSource()
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(
      request.method === 'HEAD'
        ? undefined
        : JSON.stringify(topAgentMetadata(inspection, history ?? [])),
    )
    return
  }
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' })
  response.flushHeaders()
  if (request.method === 'HEAD') {
    response.end()
    return
  }
  const stream = createTopAgentStream(Date.now())
  response.write(`event: reset\ndata: ${JSON.stringify(stream.reset)}\n\n`)
  let updating = false
  const update = () => {
    if (updating || response.destroyed || response.writableEnded) return
    updating = true
    void (async () => {
      const node = worker()
      if (!node || response.writableLength > 1024 * 1024) {
        response.destroy()
        return
      }
      const inspection = await readSource()
      const recorded = history ?? transcriptTail(node)
      history = undefined
      const alive = node.status === 'running'
      const frames = stream.frame({
        recorded,
        inspection,
        alive,
        includeContext: new URL(request.url ?? '/', base).searchParams.get('context') === '1',
      })
      for (const frame of frames) {
        if (!response.write(`event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`))
          await once(response, 'drain', { signal: controller.signal })
      }
      if (!alive) {
        response.write('event: end\ndata: {}\n\n')
        response.end()
      }
    })()
      .catch(() => {
        if (!response.destroyed) response.end('event: unavailable\ndata: {}\n\n')
      })
      .finally(() => {
        updating = false
      })
  }
  transcripts.add(update)
  response.on('close', () => transcripts.delete(update))
  update()
}
