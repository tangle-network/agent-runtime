// AgentProfile.mcp + agent-runtime-mcp stdio smoke. See README.md.
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentProfile, AgentProfileMcpServer } from '@tangle-network/sandbox'

// ── 1. PROFILE ───────────────────────────────────────────────────────────
//
// The MCP entry a product mounts into its AgentProfile. `npx -y` resolves
// the `agent-runtime-mcp` bin from the installed package; `env` is the
// child-process env the bin reads at startup.
const DELEGATION_MCP_SERVER_KEY = 'agent-runtime-delegation'

function buildDelegationMcpEntry(opts: {
  sandboxApiKey: string
  sandboxBaseUrl?: string
}): Record<string, AgentProfileMcpServer> {
  return {
    [DELEGATION_MCP_SERVER_KEY]: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@tangle-network/agent-runtime', 'mcp'],
      env: {
        TANGLE_API_KEY: opts.sandboxApiKey,
        SANDBOX_BASE_URL: opts.sandboxBaseUrl ?? 'https://sandbox.tangle.tools',
      },
      enabled: true,
      metadata: {
        surface: 'delegation:dispatch',
        tools: [
          'delegate_code',
          'delegate_research',
          'delegate_feedback',
          'delegation_status',
          'delegation_history',
        ],
      },
    },
  }
}

/**
 * Compose a product's AgentProfile with the delegation MCP entry merged in.
 * In production this is the `composeProductionAgentProfile`-style helper
 * each product owns. The shape here is illustrative — copy and adapt.
 */
export function composeAgentProfileWithDelegation(opts: {
  sandboxApiKey: string
  sandboxBaseUrl?: string
}): AgentProfile {
  return {
    name: 'demo-product-agent',
    description: 'Demo agent illustrating the delegation MCP mount.',
    prompt: { systemPrompt: 'You are a demo agent. Delegate when work would block this chat.' },
    permissions: {
      'delegation:dispatch': 'allow',
      'delegation:status': 'allow',
      'delegation:feedback': 'allow',
    },
    tools: { bash: true, fs: true },
    mcp: buildDelegationMcpEntry(opts),
  }
}

// ── 2. SMOKE ─────────────────────────────────────────────────────────────
//
// Spawn `agent-runtime-mcp` and verify the five canonical tools show up.
// The child is the same bin a sandbox-side agent would launch when the
// profile mounts the MCP entry above.

const EXPECTED_TOOLS = [
  'delegate_code',
  'delegate_feedback',
  'delegate_research',
  'delegation_history',
  'delegation_status',
]

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number | string | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

async function smokeMcpToolsList(): Promise<void> {
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (!env.TANGLE_API_KEY) {
    // Diagnostic mode — the bin starts without a sandbox client; tools/list
    // still resolves so the smoke leg verifies the MCP surface even when
    // no key is available.
    env.AGENT_RUNTIME_MCP_ALLOW_NO_KEY = '1'
  }

  // The repo's local bin: dist/mcp/bin.js. Built by `pnpm build` so this
  // example exercises the freshly-built code rather than a published copy.
  // Production code would `npx -y @tangle-network/agent-runtime mcp` instead.
  const __filename = fileURLToPath(import.meta.url)
  const repoRoot = path.resolve(path.dirname(__filename), '..', '..')
  const binPath = path.resolve(repoRoot, 'dist', 'mcp', 'bin.js')

  const child = spawn(process.execPath, [binPath], {
    cwd: repoRoot,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  let buffer = ''
  const pending = new Map<number, (msg: JsonRpcResponse) => void>()
  let nextId = 1

  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      let msg: JsonRpcResponse
      try {
        msg = JSON.parse(line) as JsonRpcResponse
      } catch {
        continue
      }
      const id = typeof msg.id === 'number' ? msg.id : null
      if (id !== null && pending.has(id)) {
        const handler = pending.get(id)!
        pending.delete(id)
        handler(msg)
      }
    }
  })

  child.stderr.on('data', (chunk: Buffer) => {
    process.stderr.write(`[mcp-stderr] ${chunk.toString('utf8')}`)
  })

  function call(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = 15_000,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = nextId++
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      pending.set(id, (msg) => {
        clearTimeout(timer)
        if (msg.error) reject(new Error(`${method}: ${JSON.stringify(msg.error)}`))
        else resolve(msg.result)
      })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }

  try {
    const init = (await call('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'mcp-delegation-example', version: '0.0.0' },
    })) as { serverInfo?: { name?: string; version?: string } }
    console.log(`server: ${init.serverInfo?.name ?? '?'}@${init.serverInfo?.version ?? '?'}`)

    const toolsResult = (await call('tools/list', {})) as { tools?: Array<{ name: string }> }
    const names = (toolsResult.tools ?? []).map((t) => t.name).sort()
    console.log(`tools: [${names.join(', ')}]`)

    const missing = EXPECTED_TOOLS.filter((t) => !names.includes(t))
    if (missing.length > 0) {
      throw new Error(`agent-runtime-mcp is missing tools: ${missing.join(', ')}`)
    }
    console.log('OK — all five delegation tools are exposed.')
  } finally {
    child.kill('SIGINT')
  }
}

async function main(): Promise<void> {
  // Show the AgentProfile a product would compose. Print just the MCP entry
  // for readability — the rest of the profile is whatever the product
  // already owns.
  const profile = composeAgentProfileWithDelegation({
    sandboxApiKey: 'sk_sb_demo_placeholder',
    sandboxBaseUrl: 'https://sandbox.tangle.tools',
  })
  console.log('— PROFILE ————————————————————————————————')
  console.log(`profile.name: ${profile.name}`)
  console.log('profile.mcp[agent-runtime-delegation]:')
  console.log(JSON.stringify(profile.mcp?.[DELEGATION_MCP_SERVER_KEY], null, 2))
  console.log()

  // Smoke the locally-built bin to prove all five tools are exposed.
  console.log('— SMOKE ———————————————————————————————————')
  await smokeMcpToolsList()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
