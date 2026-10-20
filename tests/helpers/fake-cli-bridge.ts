/**
 * A cli-bridge HTTP peer for integration tests: the routes Runtime reads before a turn, a streamed
 * turn that ends with the v2 profile-materialization receipt, and the run cancel operation. Each
 * turn POST goes to the test's handler, which answers it with `streamTurn`, holds it open, or fails it.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { type AgentProfile, canonicalAgentProfileDigest } from '@tangle-network/agent-interface'

export interface FakeBridgeTurn {
  readonly model: string
  readonly run_id: string
  readonly session_id: string
  readonly agent_profile: AgentProfile
  readonly runtime_attachments?: { mcp: Record<string, { url?: string }> }
  readonly messages: ReadonlyArray<{ role: string; content: string }>
}

export const FAKE_BRIDGE_RUN_DIGEST = `sha256:${'c'.repeat(64)}`

export interface FakeBridge {
  readonly url: string
  /** Run ids the bridge was asked to cancel, in order. */
  readonly cancelled: string[]
  close(): Promise<void>
}

export async function startFakeBridge(
  turn: (body: FakeBridgeTurn, res: ServerResponse) => void | Promise<void>,
): Promise<FakeBridge> {
  const cancelled: string[] = []
  const server: Server = createServer((req, res) => {
    void route(req, res).catch((error: unknown) => {
      if (!res.headersSent) res.writeHead(500)
      res.end(String(error))
    })
  })
  const json = (res: ServerResponse, body: unknown): void => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? ''
    if (req.method === 'GET' && url === '/') {
      return json(res, {
        capabilities: {
          profileMaterialization: 'cli-bridge.profile-materialization.v2',
          usageCostProvenance: 'cli-bridge.usage-cost.v1',
          runtimeAttachments: { mcp: true },
        },
      })
    }
    if (req.method === 'GET' && url.startsWith('/v1/capabilities')) {
      return json(res, { backend: 'fake' })
    }
    if (req.method === 'GET' && url === '/health') return json(res, { status: 'ok' })
    const cancel = url.match(/^\/v1\/runs\/([^/?]+)\/cancel/u)?.[1]
    if (cancel !== undefined) {
      const runId = decodeURIComponent(cancel)
      cancelled.push(runId)
      res.writeHead(200, {
        'content-type': 'application/json',
        'x-run-id': runId,
        'x-run-request-digest': FAKE_BRIDGE_RUN_DIGEST,
      })
      res.end(
        JSON.stringify({
          terminal: true,
          run: { id: runId, requestDigest: FAKE_BRIDGE_RUN_DIGEST, terminal: true },
        }),
      )
      return
    }
    if (req.method === 'POST' && url.startsWith('/v1/chat/completions')) {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      await turn(JSON.parse(Buffer.concat(chunks).toString('utf8')) as FakeBridgeTurn, res)
      return
    }
    res.writeHead(404)
    res.end()
  }
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    cancelled,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

/** Open a turn's event stream, as cli-bridge does before the harness answers. */
export function openTurn(res: ServerResponse, body: FakeBridgeTurn): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'x-run-id': body.run_id,
    'x-run-request-digest': FAKE_BRIDGE_RUN_DIGEST,
  })
}

/** Answer one turn completely: text, usage with a provider cost receipt, the profile
 *  materialization receipt, and `[DONE]`. */
export function streamTurn(res: ServerResponse, body: FakeBridgeTurn, content: string): void {
  if (!res.headersSent) openTurn(res, body)
  const [harness, provider] = body.model.split('/')
  const frames = [
    { choices: [{ delta: { content } }] },
    {
      usage: {
        prompt_tokens: 11,
        completion_tokens: 7,
        cost: 0.01,
        cost_known: true,
        cost_provenance: 'provider-receipt',
      },
    },
    {
      profile_materialization: {
        schema: 'cli-bridge.profile-materialization.v2',
        effectiveProfileDigest: canonicalAgentProfileDigest(body.agent_profile),
        harness,
        provider: provider ?? null,
        model: body.model,
        reasoningEffort: { requested: null, applied: null },
        workspacePlanDigest: `sha256:${'d'.repeat(64)}`,
        files: [],
        unsupported: [],
      },
    },
  ]
  res.end(
    `${frames.map((frame, index) => `id: ${index + 1}\ndata: ${JSON.stringify(frame)}\n\n`).join('')}data: [DONE]\n\n`,
  )
}

/** Call one coordination tool on the manager endpoint a turn carries, and return its result. */
export async function callCoordinationTool(
  body: FakeBridgeTurn,
  name: string,
  args: unknown,
): Promise<Record<string, unknown>> {
  const url = body.runtime_attachments?.mcp['agent-runtime-coordination']?.url
  if (url === undefined) throw new Error('the turn carries no coordination endpoint')
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: name,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  if (!response.ok) throw new Error(`coordination ${name} returned ${response.status}`)
  const reply = (await response.json()) as {
    result?: { content?: Array<{ text?: string }> }
  }
  return JSON.parse(reply.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>
}
