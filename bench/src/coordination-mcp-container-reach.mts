/**
 * Manual reachability probe for the coordination MCP from inside a Docker container.
 *
 * Run: `npx tsx bench/src/coordination-mcp-container-reach.mts`.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
import {
  type Agent,
  type AgentProfile,
  type AgentSpec,
  createExecutorRegistry,
  createSupervisor,
  type Executor,
  type ExecutorResult,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  type Scope,
  type UsageEvent,
} from '../../src/runtime/index'
import { serveCoordinationMcp } from '../../src/runtime/supervise/coordination-mcp'

const HOST_BIND = '0.0.0.0'
const DOCKER_BRIDGE_GATEWAY = process.env.DOCKER_BRIDGE_GATEWAY ?? '172.17.0.1'

function trivialWorker(name: string): Agent<unknown, unknown> {
  const ex: Executor<unknown> = {
    runtime: 'router',
    execute() {
      return (async function* () {
        yield { kind: 'iteration' } as UsageEvent
      })()
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: (): ExecutorResult<unknown> => ({
      outRef: `w:${name}`,
      out: { ok: true },
      verdict: { valid: true, score: 1 },
      spent: { iterations: 1, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 },
    }),
  }
  const spec: AgentSpec = { profile: { name } as AgentProfile, harness: null, executor: ex }
  return { name, act: async () => ({ ok: true }), executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

interface ToolsListResponse {
  result?: { tools?: Array<{ name: string; description?: string; inputSchema?: unknown }> }
  error?: { code: number; message: string }
}

async function dockerCurlToolsList(
  containerUrl: string,
): Promise<{ raw: string; parsed: ToolsListResponse; cmd: string }> {
  const rpc = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
  const args = [
    'run',
    '--rm',
    '--add-host',
    'host.docker.internal:host-gateway',
    'curlimages/curl',
    '-s',
    '-X',
    'POST',
    containerUrl,
    '-H',
    'content-type: application/json',
    '-d',
    rpc,
  ]
  const cmd = `docker ${args.join(' ')}`
  const { stdout } = await execFileAsync('docker', args, { encoding: 'utf8', timeout: 120_000 })
  return { raw: stdout, parsed: JSON.parse(stdout) as ToolsListResponse, cmd }
}

function opencodeConfigSnippet(containerUrl: string): string {
  return JSON.stringify(
    {
      $schema: 'https://opencode.ai/config.json',
      permission: {
        external_directory: 'allow',
        bash: 'allow',
        edit: 'allow',
        read: 'allow',
        write: 'allow',
        webfetch: 'allow',
        task: 'allow',
        plan_enter: 'allow',
        plan_exit: 'allow',
        question: 'allow',
      },
      mcp: {
        coordination: {
          type: 'remote',
          url: containerUrl,
          enabled: true,
        },
      },
    },
    null,
    2,
  )
}

async function main(): Promise<void> {
  const blobs = new InMemoryResultBlobStore()
  let ok = false

  const root: Agent<unknown, unknown> = {
    name: 'coordination-mcp-container-reach',
    async act(_t, scope: Scope<unknown>) {
      const mcp = await serveCoordinationMcp({
        scope,
        blobs,
        makeWorkerAgent: () => trivialWorker('w'),
        perWorker: { maxIterations: 4, maxTokens: 2000 },
        host: HOST_BIND,
      })
      // Docker containers reach the host through the bridge gateway, not the 0.0.0.0 bind URL.
      const containerUrl = `http://${DOCKER_BRIDGE_GATEWAY}:${mcp.port}/mcp`
      const hostDockerInternalUrl = `http://host.docker.internal:${mcp.port}/mcp`

      console.error(`[probe] host-binding used         : ${HOST_BIND}`)
      console.error(`[probe] server url (mcp.url)       : ${mcp.url}`)
      console.error(`[probe] container-reachable url    : ${containerUrl}`)
      console.error(`[probe] alt (host.docker.internal) : ${hostDockerInternalUrl}`)
      console.error('')

      try {
        console.error('[probe] POSTing tools/list from inside a docker container ...')
        const { raw, parsed, cmd } = await dockerCurlToolsList(containerUrl)
        console.error(`[probe] container ran: ${cmd}`)
        console.error(`[probe] container got back (${raw.length} bytes):`)
        console.error(raw)
        console.error('')

        const toolNames = (parsed.result?.tools ?? []).map((t) => t.name)
        const hasSpawn = toolNames.includes('spawn_agent')
        const hasAwait = toolNames.includes('await_event')
        console.error(`[probe] tools advertised: ${toolNames.join(', ')}`)
        console.error(`[probe] spawn_agent present = ${hasSpawn}; await_event present = ${hasAwait}`)
        ok = hasSpawn && hasAwait

        if (ok) {
          console.error('')
          console.error('[probe] opencode.json snippet (arm B writes this via OPENCODE_CONFIG):')
          console.error(opencodeConfigSnippet(containerUrl))
        }
        return ok ? { reachable: true } : undefined
      } finally {
        await mcp.close()
      }
    },
  }

  await createSupervisor<unknown, unknown>().run(root, 'reach', {
    budget: { maxIterations: 100, maxTokens: 400_000 },
    runId: 'coordination-mcp-container-reach',
    journal: new InMemorySpawnJournal(),
    blobs,
    executors: createExecutorRegistry(),
    maxDepth: 4,
    now: () => Date.now(),
  })

  console.log(
    ok
      ? 'CONTAINER-REACHABLE: docker tools/list returned spawn_agent and await_event.'
      : 'NOT reachable from container; see output above.',
  )
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
