/**
 * Host process that lets an in-container Terminal-Bench agent delegate work to child agents.
 *
 * It exposes the coordination MCP on a container-reachable host address, then runs every spawned
 * worker in the same Docker container the benchmark grader inspects.
 */

import { appendFileSync, writeFileSync } from 'node:fs'
import {
  type Agent,
  createExecutorRegistry,
  createSupervisor,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  type Scope,
} from '../../src/runtime/index'
import { serveCoordinationMcp } from '../../src/runtime/supervise/coordination-mcp'
import { makeTbContainerWorkerAgent, type ParseUsage } from './tb-container-executor.mts'

const CONTAINER_ID = (process.env.TB_TARGET_CONTAINER ?? '').trim()
const ROUTER_KEY = process.env.OPENAI_API_KEY ?? ''
const ROUTER_BASE = process.env.OPENAI_BASE_URL ?? 'https://router.tangle.tools/v1'
const DOCKER_BRIDGE_GATEWAY = process.env.DOCKER_BRIDGE_GATEWAY ?? '172.17.0.1'
const PORT_FILE = process.env.TB_SIDECAR_PORT_FILE ?? '.tb-sidecar-port'
const LOG_FILE = process.env.TB_SIDECAR_LOG ?? '.tb-sidecar-events.jsonl'
const WORKER_WORKDIR = process.env.TB_WORKER_WORKDIR ?? '/app'
const WORKER_CONFIG_PATH = '/installed-agent/opencode-worker.json'

if (!CONTAINER_ID) {
  console.error('[sidecar] FATAL: TB_TARGET_CONTAINER not set')
  process.exit(2)
}

function logEvent(kind: string, payload: unknown): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), kind, payload }) + '\n'
  try {
    appendFileSync(LOG_FILE, line)
  } catch {
    /* logging is never fatal */
  }
  console.error(`[sidecar] ${kind} ${JSON.stringify(payload).slice(0, 300)}`)
}

const parseWorkerUsage: ParseUsage = ({ stdout }) => {
  let input = 0
  let output = 0
  let saw = false
  for (const raw of stdout.split('\n')) {
    const line = raw.trim()
    if (!line || !(line.startsWith('{') || line.startsWith('['))) continue
    let ev: unknown
    try {
      ev = JSON.parse(line)
    } catch {
      continue
    }
    const events = Array.isArray(ev) ? ev : [ev]
    for (const e of events) {
      if (!e || typeof e !== 'object') continue
      const dicts: Array<Record<string, unknown>> = [e as Record<string, unknown>]
      for (const k of ['usage', 'tokens', 'part', 'info', 'message']) {
        const sub = (e as Record<string, unknown>)[k]
        if (sub && typeof sub === 'object') {
          dicts.push(sub as Record<string, unknown>)
          for (const k2 of ['usage', 'tokens']) {
            const sub2 = (sub as Record<string, unknown>)[k2]
            if (sub2 && typeof sub2 === 'object') dicts.push(sub2 as Record<string, unknown>)
          }
        }
      }
      for (const d of dicts) {
        const i = (d.input_tokens ?? d.prompt_tokens ?? d.input) as unknown
        const o = (d.output_tokens ?? d.completion_tokens ?? d.output) as unknown
        if (typeof i === 'number' || typeof o === 'number') {
          input += typeof i === 'number' ? i : 0
          output += typeof o === 'number' ? o : 0
          saw = true
          break
        }
      }
    }
  }
  return saw ? { input, output } : undefined
}

async function main(): Promise<void> {
  writeFileSync(LOG_FILE, '')
  const blobs = new InMemoryResultBlobStore()

  const makeWorkerAgent = makeTbContainerWorkerAgent({
    containerId: CONTAINER_ID,
    workdir: WORKER_WORKDIR,
    commandPrefix: [
      'export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"',
      '{ [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; } 2>/dev/null || true',
      '{ [ -s /root/.nvm/nvm.sh ] && . /root/.nvm/nvm.sh; } 2>/dev/null || true',
    ],
    parseUsage: parseWorkerUsage,
    env: {
      OPENAI_API_KEY: ROUTER_KEY,
      OPENAI_BASE_URL: ROUTER_BASE,
      OPENCODE_CONFIG: WORKER_CONFIG_PATH,
      HOME: '/root',
    },
    runtime: 'tb-container',
  })

  const root: Agent<unknown, unknown> = {
    name: 'tb-supervisor-sidecar',
    async act(_t, scope: Scope<unknown>) {
      const mcp = await serveCoordinationMcp({
        scope,
        blobs,
        makeWorkerAgent,
        perWorker: { maxIterations: 40, maxTokens: 200_000 },
        toolNames: ['spawn_worker', 'observe_agent', 'await_event', 'stop'],
        host: '0.0.0.0',
        onEvent: (event) => logEvent('bus', event),
      })
      const containerUrl = `http://${DOCKER_BRIDGE_GATEWAY}:${mcp.port}/mcp`
      writeFileSync(PORT_FILE, String(mcp.port))
      logEvent('ready', { port: mcp.port, url: mcp.url, containerUrl, containerId: CONTAINER_ID })

      await new Promise<void>((resolve) => {
        const stop = (sig: string) => {
          logEvent('stop', { signal: sig })
          resolve()
        }
        process.on('SIGTERM', () => stop('SIGTERM'))
        process.on('SIGINT', () => stop('SIGINT'))
      })

      const drained = mcp.drainResolved()
      const settled = mcp.settled()
      const history = mcp.history()
      const workerOutputs: Array<Record<string, unknown>> = []
      let workerInput = 0
      let workerOutput = 0
      for (const w of settled) {
        if (!w.outRef) continue
        try {
          const out = (await blobs.get(w.outRef)) as
            | { command?: string; stdout?: string; stderr?: string; exitCode?: number | null; containerId?: string }
            | undefined
          if (out) {
            const usage = out.stdout ? parseWorkerUsage({ stdout: out.stdout, stderr: '', exitCode: null }) : undefined
            const workerId = 'id' in w && typeof w.id === 'string' ? w.id : undefined
            if (usage) {
              workerInput += usage.input
              workerOutput += usage.output
            }
            workerOutputs.push({
              id: workerId,
              status: w.status,
              command: out.command,
              exitCode: out.exitCode ?? null,
              containerId: out.containerId,
              stdoutBytes: out.stdout?.length ?? 0,
              stderrTail: (out.stderr ?? '').slice(-500),
              stdoutTail: (out.stdout ?? '').slice(-500),
              usage: usage ?? null,
            })
          }
        } catch {
          /* blob fetch is best-effort */
        }
      }
      logEvent('final', {
        drained,
        settled,
        settledCount: settled.length,
        historyLen: history.length,
        workerTokens: { input: workerInput, output: workerOutput },
        stats: mcp.stats(),
      })
      try {
        writeFileSync(
          `${LOG_FILE}.final.json`,
          JSON.stringify(
            { settled, drained, history, workerOutputs, workerTokens: { input: workerInput, output: workerOutput }, stats: mcp.stats() },
            null,
            2,
          ),
        )
      } catch {
        /* never fatal */
      }
      await mcp.close()
      return { settledCount: settled.length }
    },
  }

  await createSupervisor<unknown, unknown>().run(root, 'tb-supervisor', {
    budget: { maxIterations: 500, maxTokens: 2_000_000 },
    runId: 'tb-supervisor-sidecar',
    journal: new InMemorySpawnJournal(),
    blobs,
    executors: createExecutorRegistry(),
    maxDepth: 4,
    now: () => Date.now(),
  })
  process.exit(0)
}

main().catch((e) => {
  console.error('[sidecar] FATAL', e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
