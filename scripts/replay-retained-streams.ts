/**
 * Replay recorded Tangle Sandbox execution streams through Runtime's retained provider path, all at
 * once and at their recorded pace, and measure what the process's event loop and heap did.
 *
 * usage:
 *   node --max-old-space-size=<MiB> --cpu-prof --cpu-prof-dir=<out> --import tsx \
 *     scripts/replay-retained-streams.ts <dir of *.ndjson.zst> <out dir> [file name part]
 *   node --import tsx scripts/replay-retained-streams.ts --summarize <out dir>
 *
 * Each file is one execution's events as `captureTangle*Evidence` stored them (one Sandbox SDK event
 * per line). Every line is parsed, converted by agent-provider-tangle's own
 * `environmentEventFromSandboxEvent`, rebound to the replay's execution, and served from a retained
 * session's `events()`; `result()` settles after the last line. Each execution runs through
 * `createExecutor({ backend: 'provider' })` with a retained executor context, so its frames take
 * `RetainedObservation`, `ProviderTurnObserver` and a node stream sink (`WorkerEvents`), the path a
 * supervised coordinator runs per child. A separate probe process asks an HTTP server in this
 * process every second; its longest unanswered stretch is the silence a coordination client sees.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { basename, dirname, join } from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { createExecutor } from '../src/runtime/supervise/executor-config'
import { retainedExecutorSeamKey } from '../src/runtime/supervise/retained-executor'
import type { UsageEvent } from '../src/runtime/supervise/types'
import { WorkerEvents } from '../src/runtime/supervise/worker-events'
import { durableRetainedProvider } from '../tests/helpers/durable-retained-provider'

type Converter = (event: unknown, expected: Record<string, unknown>) => AgentEnvironmentEvent

if (process.argv[2] === '--summarize') {
  summarize(process.argv[3]!)
  process.exit(0)
}

const [dataDir, outDir, only] = process.argv.slice(2) as [string, string, string?]
mkdirSync(outDir, { recursive: true })
const files = readdirSync(dataDir)
  .filter((name) => name.endsWith('.ndjson.zst') && (only === undefined || name.includes(only)))
  .sort()
  .map((name) => join(dataDir, name))

// The converter is not a public export; it sits beside the package entry in dist/.
const providerEntry = fileURLToPath(import.meta.resolve('@tangle-network/agent-provider-tangle'))
const { environmentEventFromSandboxEvent: convert } = (await import(
  pathToFileURL(join(dirname(providerEntry), 'tangle-events.js')).href
)) as { environmentEventFromSandboxEvent: Converter }

/** Lines of a zstd file, pulled: a slow consumer leaves the rest unread, as a fetch body does. */
async function* recordedLines(file: string): AsyncGenerator<string> {
  const child = spawn('zstd', ['-dc', '--long=27', file], { stdio: ['ignore', 'pipe', 'inherit'] })
  let rest = ''
  for await (const chunk of child.stdout) {
    const text = rest + chunk.toString('utf8')
    const lines = text.split('\n')
    rest = lines.pop() ?? ''
    for (const line of lines) if (line) yield line
  }
  if (rest) yield rest
}

// One wall clock for every file: each recorded frame is offered at its recorded offset.
const firstAt = await Promise.all(
  files.map(async (file) => {
    for await (const line of recordedLines(file)) return Number(JSON.parse(line).timestamp)
    return Number.POSITIVE_INFINITY
  }),
)
const origin = Math.min(...firstAt)
const startedAt = Date.now()

const lag = monitorEventLoopDelay({ resolution: 20 })
lag.enable()
const samples: Array<Record<string, number>> = []
const sampler = setInterval(() => {
  const { heapUsed, heapTotal, rss } = process.memoryUsage()
  samples.push({
    atS: Math.round((Date.now() - startedAt) / 1000),
    lagP99Ms: Math.round(lag.percentile(99) / 1e6),
    lagMaxMs: Math.round(lag.max / 1e6),
    heapUsedMb: Math.round(heapUsed / 1048576),
    heapTotalMb: Math.round(heapTotal / 1048576),
    rssMb: Math.round(rss / 1048576),
  })
  lag.reset()
}, 10_000)

// The coordination ingress stand-in: answered by this loop, asked by another process.
const server = createServer((_request, response) => response.end('ok'))
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = (server.address() as { port: number }).port
const probe = spawn(
  process.execPath,
  [
    '-e',
    `let last=Date.now(),worst=0;const tick=async()=>{const s=Date.now();try{await fetch('http://127.0.0.1:${port}/',{signal:AbortSignal.timeout(10000)});const n=Date.now();worst=Math.max(worst,n-last);last=n}catch{}};setInterval(tick,1000);process.on('SIGTERM',()=>{worst=Math.max(worst,Date.now()-last);console.log(JSON.stringify({longestUnansweredMs:worst}));process.exit(0)})`,
  ],
  { stdio: ['ignore', 'pipe', 'inherit'] },
)
let probeOut = ''
probe.stdout.on('data', (chunk) => (probeOut += chunk))

/** Bind a recorded frame's run coordinates to the replay's execution, in every field the provider
 *  converter and Runtime's binding check read, so a frame passes exactly as it did live. */
function rebind(record: Record<string, unknown>, ref: { sessionId: string; executionId: string }) {
  const object = (value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined
  record.sessionId = ref.sessionId
  record.executionId = ref.executionId
  const data = object(record.data)
  if (data === undefined) return record
  delete data.runControlRef
  const properties = object(data.properties)
  for (const carrier of [data, properties, object(properties?.info), object(properties?.part)]) {
    if (carrier === undefined) continue
    for (const key of ['sessionId', 'sessionID'])
      if (key in carrier && !(carrier === data && record.type === 'session.updated'))
        carrier[key] = ref.sessionId
    if ('executionId' in carrier) carrier.executionId = ref.executionId
  }
  return record
}

async function replayOne(file: string, index: number) {
  const name = basename(file, '.ndjson.zst')
  // A turn is dispatched when its first frame is due, as live: an execution started at the replay's
  // origin would sit past Runtime's quiet interval before a later execution's first frame.
  const startIn = firstAt[index]! - origin - (Date.now() - startedAt)
  if (startIn > 0) await new Promise((resolve) => setTimeout(resolve, startIn))
  const directory = join(outDir, 'state', name)
  mkdirSync(directory, { recursive: true })
  const base = durableRetainedProvider(join(directory, 'provider.json'))
  let finish: () => void = () => {}
  const finished = new Promise<void>((resolve) => (finish = resolve))
  let frames = 0
  let refused = 0
  let bytes = 0
  const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
    ...environment,
    session(id, options) {
      const session = environment.session!(id, options)
      const ref = session.controlRef!
      return {
        ...session,
        async *events(options) {
          // A cursor replay resumes after the named frame, as the Sidecar's does.
          let skipping = options?.since !== undefined
          try {
            for await (const line of recordedLines(file)) {
              const record = JSON.parse(line) as Record<string, unknown>
              if (skipping) {
                skipping = String(record.eventId) !== options?.since
                continue
              }
              const due = Number(record.timestamp) - origin - (Date.now() - startedAt)
              if (due > 0) await new Promise((resolve) => setTimeout(resolve, due))
              frames += 1
              bytes += line.length
              let event: AgentEnvironmentEvent
              try {
                event = convert(rebind(record, ref), {
                  executionId: ref.executionId,
                  sessionId: ref.sessionId,
                  streamBound: true,
                })
              } catch (error) {
                refused += 1
                if (refused <= 5)
                  console.error(`${name}: frame ${String(record.eventId)} ${String(record.type)} refused: ${(error as Error).message}`)
                continue
              }
              yield event
            }
          } finally {
            finish()
          }
        },
        async result() {
          await finished
          return {
            text: 'replayed',
            success: true,
            sessionId: id,
            metadata: {
              executionId: ref.executionId,
              runId: ref.runId,
              requestDigest: ref.requestDigest,
            },
          }
        },
      }
    },
  })
  const provider: AgentEnvironmentProvider = {
    ...base,
    create: async (input) => wrap(await base.create(input)),
    get: async (id) => {
      const environment = await base.get!(id)
      return environment && wrap(environment)
    },
  }
  const nodeId = `replay:s${index}`
  const worker = new WorkerEvents({ runDir: outDir, nodeId, now: Date.now })
  await worker.start()
  const retention = {
    executionId: `${nodeId}:input:1`,
    admissions: [],
    onAdmission: async () => {},
    onResult: async () => {},
    onObserved: () => {},
  }
  const executor = createExecutor({ backend: 'provider', provider })(
    {
      profile: {
        name: `replay-${index}`,
        harness: 'opencode',
        model: { provider: 'openai-compat', default: 'glm-5.3' },
        prompt: { systemPrompt: 'replay' },
      },
      harness: null,
    },
    {
      signal: new AbortController().signal,
      seams: { [retainedExecutorSeamKey]: retention },
    },
  )
  const began = Date.now()
  let error: string | undefined
  try {
    for await (const event of executor.execute('replay', new AbortController().signal) as AsyncIterable<UsageEvent>) {
      if (event.kind === 'progress') worker.append(event.progress, Date.now())
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message.slice(0, 300) : String(caught)
  }
  await worker.settle().catch(() => {})
  return { name, frames, refused, mb: Math.round(bytes / 1e6), seconds: Math.round((Date.now() - began) / 1000), error }
}

const results = await Promise.all(files.map(replayOne))
clearInterval(sampler)
probe.kill('SIGTERM')
await new Promise((resolve) => probe.once('close', resolve))
server.close()
const report = {
  files: results,
  wallS: Math.round((Date.now() - startedAt) / 1000),
  worstLagMs: Math.max(...samples.map((sample) => sample.lagMaxMs)),
  stretchesOverOneSecondS: samples.filter((sample) => sample.lagP99Ms >= 1000).length * 10,
  peakHeapUsedMb: Math.max(...samples.map((sample) => sample.heapUsedMb)),
  probe: probeOut.trim() ? JSON.parse(probeOut.trim()) : null,
  samples,
}
writeFileSync(join(outDir, 'replay-report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ ...report, samples: undefined }, null, 2))

/** Self and inclusive time per function across the run's CPU profiles: self names the hot leaf,
 *  inclusive names the caller in Runtime or the provider that owns it. */
function summarize(dir: string) {
  type Node = {
    id: number
    callFrame: { functionName: string; url: string; lineNumber: number }
    children?: number[]
  }
  for (const name of readdirSync(dir).filter((entry) => entry.endsWith('.cpuprofile'))) {
    const profile = JSON.parse(readFileSync(join(dir, name), 'utf8')) as {
      nodes: Node[]
      samples: number[]
      timeDeltas: number[]
    }
    const byId = new Map(profile.nodes.map((node) => [node.id, node]))
    const parent = new Map<number, number>()
    for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id)
    const label = (node: Node) =>
      `${node.callFrame.functionName || '(anonymous)'} ${node.callFrame.url.replace(/^.*node_modules\//, '').replace(/^.*\/(src|tests|scripts)\//, '$1/')}:${node.callFrame.lineNumber + 1}`
    const self = new Map<string, number>()
    const inclusive = new Map<string, number>()
    let total = 0
    profile.samples.forEach((id, index) => {
      const delta = profile.timeDeltas[index] ?? 0
      total += delta
      const leaf = label(byId.get(id)!)
      self.set(leaf, (self.get(leaf) ?? 0) + delta)
      const seen = new Set<string>()
      for (let at: number | undefined = id; at !== undefined; at = parent.get(at)) {
        const key = label(byId.get(at)!)
        if (seen.has(key)) continue
        seen.add(key)
        inclusive.set(key, (inclusive.get(key) ?? 0) + delta)
      }
    })
    const print = (title: string, table: Map<string, number>, keep: (key: string) => boolean) => {
      console.log(`${name}: ${title}, ${(total / 1e6).toFixed(1)} s sampled`)
      for (const [key, micros] of [...table].filter(([key]) => keep(key)).sort((a, b) => b[1] - a[1]).slice(0, 30)) {
        console.log(`${(micros / 1e6).toFixed(1).padStart(8)} s ${((100 * micros) / total).toFixed(1).padStart(5)}%  ${key}`)
      }
    }
    print('self time', self, () => true)
    print('inclusive time, Runtime and provider frames', inclusive, (key) =>
      /src\/|agent-provider-tangle|agent-interface|sandbox\//.test(key),
    )
  }
}
