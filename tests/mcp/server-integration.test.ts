import { describe, expect, it } from 'vitest'
import type { UiAuditorDelegate } from '../../src/mcp/delegates'
import {
  createInProcessTransport,
  createMcpServer,
  type JsonRpcResponse,
} from '../../src/mcp/server'

const uiAuditorStub: UiAuditorDelegate = async (args) => ({
  workspaceDir: args.workspaceDir,
  indexFile: 'index.md',
  findings: [],
  iterations: 0,
})

async function rpcCall(
  server: ReturnType<typeof createMcpServer>,
  method: string,
  params: Record<string, unknown> = {},
  id: number = 1,
): Promise<JsonRpcResponse | null> {
  return server.handle({ jsonrpc: '2.0', id, method, params })
}

describe('createMcpServer — JSON-RPC surface', () => {
  it('responds to initialize + tools/list with the always-on queue-bound tools', async () => {
    const server = createMcpServer({})
    const init = await rpcCall(server, 'initialize', {}, 0)
    expect(init?.result).toMatchObject({
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'agent-runtime-mcp' },
    })
    const listed = await rpcCall(server, 'tools/list', {}, 1)
    const names = (listed?.result as { tools: { name: string }[] }).tools.map((t) => t.name).sort()
    expect(names).toEqual(['delegate_feedback', 'delegation_history', 'delegation_status'])
  })

  it('registers delegate_ui_audit only when a uiAuditorDelegate is wired', async () => {
    const without = await rpcCall(createMcpServer({}), 'tools/list', {}, 1)
    const withoutNames = (without?.result as { tools: { name: string }[] }).tools.map((t) => t.name)
    expect(withoutNames).not.toContain('delegate_ui_audit')

    const withDelegate = await rpcCall(
      createMcpServer({ uiAuditorDelegate: uiAuditorStub }),
      'tools/list',
      {},
      1,
    )
    const withNames = (withDelegate?.result as { tools: { name: string }[] }).tools.map(
      (t) => t.name,
    )
    expect(withNames).toContain('delegate_ui_audit')
  })

  it('routes tools/call through the handler and returns structuredContent', async () => {
    const server = createMcpServer({ uiAuditorDelegate: uiAuditorStub })
    const call = await rpcCall(server, 'tools/call', {
      name: 'delegate_ui_audit',
      arguments: {
        workspaceDir: '/tmp/audits/x',
        routes: [{ name: 'home', url: 'https://example.com' }],
      },
    })
    const result = call?.result as {
      content: { type: string; text: string }[]
      structuredContent: { taskId: string }
    }
    expect(result.content[0]?.type).toBe('text')
    const parsed = JSON.parse(result.content[0]!.text) as { taskId: string }
    expect(parsed.taskId).toBe(result.structuredContent.taskId)
    expect(parsed.taskId).toMatch(/^dlg-/)
  })

  it('returns -32602 on validation failures', async () => {
    const server = createMcpServer({ uiAuditorDelegate: uiAuditorStub })
    const call = await rpcCall(server, 'tools/call', {
      name: 'delegate_ui_audit',
      arguments: { workspaceDir: '/tmp/x', routes: [] },
    })
    expect(call?.error?.code).toBe(-32602)
  })

  it('returns -32601 for unknown tools', async () => {
    const server = createMcpServer({})
    const call = await rpcCall(server, 'tools/call', { name: 'delegate_evaluation' })
    expect(call?.error?.code).toBe(-32601)
  })

  it('drives the full lifecycle end-to-end: delegate_ui_audit → status → feedback → history', async () => {
    const server = createMcpServer({ uiAuditorDelegate: uiAuditorStub })
    const created = await rpcCall(server, 'tools/call', {
      name: 'delegate_ui_audit',
      arguments: {
        workspaceDir: '/tmp/audits/y',
        routes: [{ name: 'home', url: 'https://example.com' }],
        namespace: 'tenant-a',
      },
    })
    const taskId = (created?.result as { structuredContent: { taskId: string } }).structuredContent
      .taskId

    // Wait for the async run to settle.
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r))

    const status = await rpcCall(server, 'tools/call', {
      name: 'delegation_status',
      arguments: { taskId },
    })
    expect(
      (status?.result as { structuredContent: { status: string } }).structuredContent.status,
    ).toBe('completed')

    const feedback = await rpcCall(server, 'tools/call', {
      name: 'delegate_feedback',
      arguments: {
        refersTo: { kind: 'delegation', ref: taskId },
        rating: { score: 0.85, label: 'good', notes: 'clean audit' },
        by: 'agent',
        namespace: 'tenant-a',
      },
    })
    expect(
      (feedback?.result as { structuredContent: { recorded: true; id: string } }).structuredContent
        .recorded,
    ).toBe(true)

    const history = await rpcCall(server, 'tools/call', {
      name: 'delegation_history',
      arguments: { namespace: 'tenant-a' },
    })
    const entries = (
      history?.result as {
        structuredContent: { delegations: Array<{ taskId: string; feedback?: unknown[] }> }
      }
    ).structuredContent.delegations
    expect(entries.find((e) => e.taskId === taskId)?.feedback?.length).toBe(1)
  })
})

describe('createMcpServer — stdio transport', () => {
  it('handles a single JSON-RPC line through serve() and writes a response', async () => {
    const server = createMcpServer({})
    const { transport, clientWrite, clientClose, readServer } = createInProcessTransport()
    const servePromise = server.serve(transport)
    clientWrite(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }))
    clientWrite(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }))
    // Allow drain.
    for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r))
    const responses = await readServer()
    expect(responses.length).toBeGreaterThanOrEqual(2)
    const list = responses.find((r) => r.id === 2)
    // Always-on: delegate_feedback, delegation_status, delegation_history.
    expect((list?.result as { tools: unknown[] }).tools.length).toBe(3)
    clientClose()
    await servePromise
  })

  it('emits a parse error for malformed JSON', async () => {
    const server = createMcpServer({})
    const { transport, clientWrite, clientClose, readServer } = createInProcessTransport()
    const servePromise = server.serve(transport)
    clientWrite('{not json')
    for (let i = 0; i < 4; i += 1) await new Promise((r) => setImmediate(r))
    const responses = await readServer()
    expect(responses[0]?.error?.code).toBe(-32700)
    clientClose()
    await servePromise
  })
})
