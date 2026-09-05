import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { type AgentProfile, canonicalAgentProfileDigest } from '@tangle-network/agent-interface'
import { afterEach, describe, expect, it } from 'vitest'
import { workerFromBackend } from '../../src/runtime/supervise/supervise'
import { supervise } from '../helpers/runtime-with-test-brain'
import { runtimeToolDeclarations } from './test-agent-profile'

/**
 * `peerMail: true` mints one capability URL per spawn. This file proves the runtime also MOUNTS it
 * on the backend-derived worker path: a bridge worker receives the endpoint as a Runtime-owned MCP
 * attachment beside its authored profile, one worker posts through that endpoint, and its sibling
 * reads the message through its own.
 *
 * The mount rides `runtime_attachments`, never `AgentProfile.mcp`, so the digest the fake bridge
 * binds each session to is the digest of the profile the caller authored.
 */

const PEER_MAIL_ALIAS = 'agent-runtime-peer-mail'
const COORDINATION_ALIAS = 'agent-runtime-coordination'
const TEST_RUN_DIGEST = `sha256:${'c'.repeat(64)}`

interface BridgeRequest {
  model: string
  run_id: string
  session_id: string
  agent_profile: AgentProfile
  runtime_attachments?: { mcp: Record<string, { transport?: string; url?: string }> }
}

function codexProfile(name: string, tools?: AgentProfile['tools']): AgentProfile {
  return {
    name,
    harness: 'codex',
    prompt: { systemPrompt: `Act as ${name}.` },
    model: { provider: 'openai', default: 'gpt-5.6' },
    ...(tools ? { tools } : {}),
  }
}

function routerProfile(name: string): AgentProfile {
  return {
    name,
    harness: 'cli-base',
    prompt: { systemPrompt: `Act as ${name}.` },
    model: { provider: 'tangle-router', default: 'test' },
  }
}

async function readJson(req: AsyncIterable<Uint8Array>): Promise<BridgeRequest> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as BridgeRequest
}

/** One JSON-RPC tool call against an MCP endpoint, returning its structured reply. */
async function callTool(
  url: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `${name}-${Math.random()}`,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  const reply = (await response.json()) as {
    result?: { structuredContent?: Record<string, unknown> }
    error?: unknown
  }
  if (!reply.result?.structuredContent) {
    throw new Error(`tool ${name} returned no structured content: ${JSON.stringify(reply)}`)
  }
  return reply.result.structuredContent
}

async function waitFor<T>(read: () => Promise<T | undefined>, label: string): Promise<T> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const value = await read()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${label}`)
}

function respondWithBridgeStream(res: ServerResponse, request: BridgeRequest): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'x-run-id': request.run_id,
    'x-run-request-digest': TEST_RUN_DIGEST,
  })
  const frames = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: 'done' } }] })}`,
    `data: ${JSON.stringify({
      usage: {
        prompt_tokens: 11,
        completion_tokens: 7,
        cost: 0.01,
        cost_known: true,
        cost_provenance: 'provider-receipt',
      },
    })}`,
    `data: ${JSON.stringify({
      profile_materialization: {
        schema: 'cli-bridge.profile-materialization.v2',
        effectiveProfileDigest: canonicalAgentProfileDigest(request.agent_profile),
        harness: request.model.split('/')[0],
        provider: request.model.split('/')[1] ?? null,
        model: request.model,
        reasoningEffort: { requested: null, applied: null },
        workspacePlanDigest: `sha256:${'d'.repeat(64)}`,
        files: [],
        unsupported: [],
      },
    })}`,
    'data: [DONE]',
    '',
  ].join('\n\n')
  let seq = 0
  res.end(frames.replace(/^data: (?!\[DONE\])/gmu, () => `id: ${++seq}\ndata: `))
}

/** The pre-flight routes the real bridge answers, including the runtime-attachment capability. */
function createBridgeServer(handler: (req: BridgeRequest, res: ServerResponse) => void): Server {
  const sessionBindings = new Map<string, string>()
  return createServer((req, res) => {
    if (req.method === 'GET' && req.url?.startsWith('/v1/capabilities')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ model: '', backend: 'fake' }))
      return
    }
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok' }))
      return
    }
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          capabilities: {
            profileMaterialization: 'cli-bridge.profile-materialization.v2',
            usageCostProvenance: 'cli-bridge.usage-cost.v1',
            runtimeAttachments: { mcp: true },
          },
        }),
      )
      return
    }
    void (async () => {
      const body = await readJson(req)
      // The real bridge binds a session to the canonical profile digest on its first request and
      // refuses any later request that moves it. A mount written into AgentProfile.mcp would fail
      // here rather than pass quietly.
      const binding = JSON.stringify({
        effectiveProfileDigest: canonicalAgentProfileDigest(body.agent_profile),
        model: body.model,
      })
      const bound = sessionBindings.get(body.session_id)
      if (bound === undefined) sessionBindings.set(body.session_id, binding)
      else if (bound !== binding) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'session rebound', type: 'parse_error' } }))
        return
      }
      handler(body, res)
    })()
  })
}

describe('supervise — peer mail mounts on the backend-derived worker path', () => {
  let server: Server | undefined

  afterEach(async () => {
    if (server) await new Promise((resolve) => server?.close(resolve))
    server = undefined
  })

  it('mounts each spawn peer-mail endpoint on its bridge worker, and a sibling reads what a worker posts', async () => {
    const workerProfileDigests: string[] = []
    const mailUrls: string[] = []
    const senderReadouts: Array<Record<string, unknown>> = []
    const receiverInboxes: Array<Record<string, unknown>> = []
    let sendOutcome: Record<string, unknown> | undefined

    const mailUrlFor = async (index: number): Promise<string> =>
      waitFor(async () => mailUrls[index], `peer-mail url for worker ${index}`)

    server = createBridgeServer((body, res) => {
      const coordination = body.runtime_attachments?.mcp[COORDINATION_ALIAS]?.url
      const mail = body.runtime_attachments?.mcp[PEER_MAIL_ALIAS]?.url

      if (coordination !== undefined) {
        void (async () => {
          await callTool(coordination, 'spawn_worker', { profile: codexProfile('w1'), task: 'go' })
          await callTool(coordination, 'spawn_worker', { profile: codexProfile('w2'), task: 'go' })
          await callTool(coordination, 'await_event', {})
          await callTool(coordination, 'await_event', {})
          await callTool(coordination, 'stop', {})
          respondWithBridgeStream(res, body)
        })()
        return
      }

      if (mail === undefined) throw new Error('a bridge worker request carried no peer-mail mount')
      workerProfileDigests.push(canonicalAgentProfileDigest(body.agent_profile))
      const index = mailUrls.push(mail) - 1

      void (async () => {
        try {
          if (index === 0) {
            // The sender learns its sibling's id the way a real worker does — from its own
            // mailbox — then posts through the endpoint the runtime mounted for it.
            const readout = await waitFor(async () => {
              const seen = await callTool(await mailUrlFor(0), 'read_mail')
              return (seen.peers as unknown[]).length > 0 ? seen : undefined
            }, 'a live sibling in worker 0 peers')
            senderReadouts.push(readout)
            const peer = (readout.peers as Array<{ workerId: string }>)[0]
            sendOutcome = await callTool(await mailUrlFor(0), 'send_mail', {
              to: peer?.workerId,
              kind: 'ask',
              subject: 'convention check',
              body: 'Which permutation length are you counting?',
            })
          } else {
            const inbox = await waitFor(async () => {
              const seen = await callTool(await mailUrlFor(1), 'read_mail')
              return (seen.inbox as unknown[]).length > 0 ? seen : undefined
            }, 'worker 1 inbox')
            receiverInboxes.push(inbox)
          }
        } finally {
          respondWithBridgeStream(res, body)
        }
      })()
    })

    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo

    const result = await supervise(
      codexProfile('lead', runtimeToolDeclarations('spawn_worker', 'await_event', 'stop')),
      'fan out and compare notes',
      {
        backend: {
          backend: 'bridge',
          bridgeUrl: `http://127.0.0.1:${port}`,
          bridgeBearer: 'test-token',
        },
        budget: { maxIterations: 12, maxTokens: 200_000 },
        peerMail: true,
      },
    )

    expect(result.kind).not.toBe('error')
    expect(mailUrls).toHaveLength(2)
    for (const url of mailUrls) {
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mail\/[0-9a-f]{32}$/)
    }
    // One capability per spawn: a shared endpoint would let one worker speak as the other.
    expect(mailUrls[0]).not.toBe(mailUrls[1])
    // The mount is out of band: both workers ran the exact profile the caller authored.
    expect(workerProfileDigests).toEqual([
      canonicalAgentProfileDigest(codexProfile('w1')),
      canonicalAgentProfileDigest(codexProfile('w2')),
    ])
    expect(sendOutcome?.delivered).toBe(true)
    const received = receiverInboxes[0]?.inbox as Array<Record<string, unknown>>
    expect(received).toHaveLength(1)
    expect(received[0]?.subject).toBe('convention check')
    // The sender is read from the capability, never from a tool argument.
    expect(received[0]?.from).toBe((senderReadouts[0] as { you: string }).you)
    expect(received[0]?.to).toBe((receiverInboxes[0] as { you: string }).you)
  }, 30_000)

  it('refuses a peer-mail spawn on a backend that can only mount tools through the profile', () => {
    // A local CLI harness receives tools only through its materialized AgentProfile, so writing a
    // per-process capability URL there would move the digest a durable session is bound to. The
    // spawn fails instead of handing the worker a capability nothing serves.
    const make = workerFromBackend({
      backend: 'cli-in-place',
      workspacePath: process.cwd(),
    })
    expect(() =>
      make(codexProfile('w1'), {
        assignmentId: 'ordinal:0',
        parentNodeId: 'root',
        budget: {
          tokensLeft: 10,
          iterationsLeft: 1,
          usdLeft: 1,
          usdCapped: false,
          deadlineMs: 0,
        },
        task: 'go',
        label: 'worker',
        peerMailUrl: `http://127.0.0.1:1/mail/${'a'.repeat(32)}`,
      }),
    ).toThrow(/cannot mount a peer-mail endpoint/)
  })

  it('mounts nothing, and refuses nothing, for an in-process worker', () => {
    // A router-tools worker runs no MCP client at all: its tool surface is the caller's own array
    // and `WorkerSpawnContext.peerMailUrl` is the deliverable that caller uses directly. The spawn
    // must therefore build, not refuse — the refusal above is only for a harness the runtime has
    // no channel to.
    const make = workerFromBackend({
      backend: 'router-tools',
      routerBaseUrl: 'http://offline.test/v1',
      routerKey: 'test',
      tools: [],
      executeToolCall: async () => '',
      complete: async () => ({
        model: 'offline-test-model',
        choices: [{ message: { content: 'done', tool_calls: [] } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, cost_usd: 0 },
      }),
    })
    const agent = make(routerProfile('w1'), {
      assignmentId: 'ordinal:0',
      parentNodeId: 'root',
      budget: { tokensLeft: 10, iterationsLeft: 1, usdLeft: 1, usdCapped: false, deadlineMs: 0 },
      task: 'go',
      label: 'worker',
      peerMailUrl: `http://127.0.0.1:1/mail/${'a'.repeat(32)}`,
    })
    expect(agent.name).toBe('w1')
  })
})
