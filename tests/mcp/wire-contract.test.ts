/**
 * Wire-contract snapshot — the FROZEN external surface of the delegation MCP.
 *
 * This test pins what an external MCP client observes, independent of any
 * internal delegate/topology rewrite: the queue-bound tool names + their
 * descriptions + input schemas (`tools/list`), and the `tools/call` response
 * envelope + payload keys per tool (the `{taskId, estimatedDurationMs}` kickoff
 * shape, the `delegation_status` / `delegation_history` payloads). Any change
 * to observable output fails here.
 *
 * Delegates are stubbed (the wire shape, not the work, is under test).
 */

import { describe, expect, it } from 'vitest'
import type { UiAuditorDelegate } from '../../src/mcp/delegates'
import { createMcpServer, type JsonRpcResponse } from '../../src/mcp/server'
import { requireJsonRpcResult } from '../../src/mcp/test-helpers'

const uiAuditorStub: UiAuditorDelegate = async () => ({
  workspaceDir: '/ws',
  indexFile: 'index.md',
  findings: [],
  iterations: 1,
})

function fullServer() {
  return createMcpServer({ uiAuditorDelegate: uiAuditorStub })
}

async function rpc(
  server: ReturnType<typeof createMcpServer>,
  method: string,
  params: Record<string, unknown> = {},
  id: number = 1,
): Promise<JsonRpcResponse | null> {
  return server.handle({ jsonrpc: '2.0', id, method, params })
}

type ToolList = { tools: { name: string; description: string; inputSchema: unknown }[] }

const auditArgs = {
  workspaceDir: '/tmp/audits/x',
  routes: [{ name: 'home', url: 'https://example.com' }],
}

describe('wire-contract — tools/list (the frozen tool names + schemas)', () => {
  it('advertises exactly delegate_ui_audit + the always-on queue trio', async () => {
    const listed = await rpc(fullServer(), 'tools/list')
    const { tools } = requireJsonRpcResult<ToolList>(listed)
    expect(tools.map((t) => t.name).sort()).toEqual([
      'delegate_feedback',
      'delegate_ui_audit',
      'delegation_history',
      'delegation_status',
    ])
  })

  it('every delegation tool exposes an object inputSchema with a non-empty description', async () => {
    const listed = await rpc(fullServer(), 'tools/list')
    const { tools } = requireJsonRpcResult<ToolList>(listed)
    for (const t of tools) {
      const schema = t.inputSchema as { type?: unknown; required?: unknown }
      expect(schema.type, `${t.name} schema.type`).toBe('object')
      expect(typeof t.description, `${t.name} description`).toBe('string')
      expect((t.description as string).length, `${t.name} description non-empty`).toBeGreaterThan(0)
    }
    // The kickoff tool names its required inputs verbatim.
    const required = (name: string) =>
      (tools.find((t) => t.name === name)!.inputSchema as { required?: string[] }).required
    expect(required('delegate_ui_audit')).toEqual(['workspaceDir', 'routes'])
  })
})

describe('wire-contract — tools/call envelope + payloads', () => {
  it('delegate_ui_audit returns {taskId, estimatedDurationMs} in the MCP content envelope', async () => {
    const res = await rpc(fullServer(), 'tools/call', {
      name: 'delegate_ui_audit',
      arguments: auditArgs,
    })
    const result = requireJsonRpcResult<{
      content: { type: string; text: string }[]
      structuredContent: { taskId: string; estimatedDurationMs: number }
      isError: boolean
    }>(res)
    expect(result.isError).toBe(false)
    expect(result.content[0]?.type).toBe('text')
    // structuredContent mirrors the parsed text payload exactly.
    expect(JSON.parse(result.content[0]!.text)).toEqual(result.structuredContent)
    expect(Object.keys(result.structuredContent).sort()).toEqual(['estimatedDurationMs', 'taskId'])
    expect(typeof result.structuredContent.taskId).toBe('string')
    expect(typeof result.structuredContent.estimatedDurationMs).toBe('number')
  })

  it('delegation_status reports the queued task by taskId (status payload contract)', async () => {
    const server = fullServer()
    const kicked = await rpc(server, 'tools/call', {
      name: 'delegate_ui_audit',
      arguments: auditArgs,
    })
    const taskId = requireJsonRpcResult<{ structuredContent: { taskId: string } }>(kicked)
      .structuredContent.taskId
    const statusRes = await rpc(server, 'tools/call', {
      name: 'delegation_status',
      arguments: { taskId },
    })
    const sc = requireJsonRpcResult<{ structuredContent: Record<string, unknown> }>(
      statusRes,
    ).structuredContent
    expect(sc.taskId).toBe(taskId)
    expect(sc.profile).toBe('ui-auditor')
    expect(typeof sc.status).toBe('string')
    expect(typeof sc.startedAt).toBe('string')
  })

  it('delegation_history returns an entries array', async () => {
    const server = fullServer()
    await rpc(server, 'tools/call', { name: 'delegate_ui_audit', arguments: auditArgs })
    const res = await rpc(server, 'tools/call', { name: 'delegation_history', arguments: {} })
    const sc = requireJsonRpcResult<{ structuredContent: { delegations?: unknown } }>(
      res,
    ).structuredContent
    expect(Array.isArray(sc.delegations)).toBe(true)
  })

  it('an unknown tool is a JSON-RPC method error, never a silent success', async () => {
    const res = await rpc(fullServer(), 'tools/call', { name: 'no_such_tool', arguments: {} })
    expect(res?.error?.code).toBe(-32601)
  })
})
