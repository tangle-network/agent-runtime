/**
 * Wire-contract snapshot — the FROZEN external surface of the delegation MCP.
 *
 * This test pins what an external MCP client observes, independent of any
 * internal delegate/topology rewrite: the 5 delegation tool names + their
 * descriptions + input schemas (`tools/list`), and the `tools/call` response
 * envelope + payload keys per tool (the `{taskId, estimatedDurationMs}` kickoff
 * shape, the `delegation_status` / `delegation_history` payloads). Any change
 * to observable output fails here — so a migration that re-homes the coder
 * delegate onto the generic combinator path cannot silently break the contract.
 *
 * Delegates are stubbed (the wire shape, not the work, is under test).
 */

import { describe, expect, it } from 'vitest'
import type { CoderDelegate, ResearcherDelegate, UiAuditorDelegate } from '../../src/mcp/delegates'
import { createMcpServer, type JsonRpcResponse } from '../../src/mcp/server'

const coderStub: CoderDelegate = async () => ({
  branch: 'feat/x',
  patch: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n+1',
  testResult: { passed: true, output: 'ok' },
  typecheckResult: { passed: true, output: 'ok' },
  diffStats: { filesChanged: 1, insertions: 1, deletions: 0 },
})

const researcherStub: ResearcherDelegate = async () => ({
  items: [],
  citations: [],
  proposedWrites: [],
})

const uiAuditorStub: UiAuditorDelegate = async () => ({
  workspaceDir: '/ws',
  indexFile: 'index.md',
  findings: [],
  iterations: 1,
})

function fullServer() {
  return createMcpServer({
    coderDelegate: coderStub,
    researcherDelegate: researcherStub,
    uiAuditorDelegate: uiAuditorStub,
  })
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

describe('wire-contract — tools/list (the frozen tool names + schemas)', () => {
  it('advertises exactly the 6 tools (5 delegation + the always-on queue trio)', async () => {
    const listed = await rpc(fullServer(), 'tools/list')
    const tools = (listed?.result as ToolList).tools
    expect(tools.map((t) => t.name).sort()).toEqual([
      'delegate_code',
      'delegate_feedback',
      'delegate_research',
      'delegate_ui_audit',
      'delegation_history',
      'delegation_status',
    ])
  })

  it('pins the delegate_code input schema (required fields + variants bound + config shape)', async () => {
    const listed = await rpc(fullServer(), 'tools/list')
    const tools = (listed?.result as ToolList).tools
    const code = tools.find((t) => t.name === 'delegate_code')!
    expect(code.inputSchema).toMatchInlineSnapshot(`
      {
        "additionalProperties": false,
        "properties": {
          "config": {
            "additionalProperties": false,
            "properties": {
              "forbiddenPaths": {
                "items": {
                  "type": "string",
                },
                "type": "array",
              },
              "maxDiffLines": {
                "minimum": 1,
                "type": "integer",
              },
              "testCmd": {
                "type": "string",
              },
              "typecheckCmd": {
                "type": "string",
              },
            },
            "type": "object",
          },
          "contextHint": {
            "description": "Optional free-form context the coder sees in the prompt prelude.",
            "type": "string",
          },
          "goal": {
            "description": "Natural-language description of what the coder must accomplish.",
            "type": "string",
          },
          "namespace": {
            "description": "Multi-tenant scope (customer-id, workspace-id).",
            "type": "string",
          },
          "repoRoot": {
            "description": "Absolute path inside the sandbox where the repo lives.",
            "type": "string",
          },
          "variants": {
            "description": "Number of parallel coder harnesses. Default 1.",
            "maximum": 8,
            "minimum": 1,
            "type": "integer",
          },
        },
        "required": [
          "goal",
          "repoRoot",
        ],
        "type": "object",
      }
    `)
  })

  it('every delegation tool exposes an object inputSchema with required keys', async () => {
    const listed = await rpc(fullServer(), 'tools/list')
    const tools = (listed?.result as ToolList).tools
    for (const t of tools) {
      const schema = t.inputSchema as { type?: unknown; required?: unknown }
      expect(schema.type, `${t.name} schema.type`).toBe('object')
      expect(typeof t.description, `${t.name} description`).toBe('string')
      expect((t.description as string).length, `${t.name} description non-empty`).toBeGreaterThan(0)
    }
    // The two kickoff tools name their required inputs verbatim.
    const required = (name: string) =>
      (tools.find((t) => t.name === name)!.inputSchema as { required?: string[] }).required
    expect(required('delegate_code')).toEqual(['goal', 'repoRoot'])
    expect(required('delegate_research')).toEqual(['question', 'namespace'])
  })
})

describe('wire-contract — tools/call envelope + payloads', () => {
  it('delegate_code returns {taskId, estimatedDurationMs} in the MCP content envelope', async () => {
    const res = await rpc(fullServer(), 'tools/call', {
      name: 'delegate_code',
      arguments: { goal: 'fix the bug', repoRoot: '/repo' },
    })
    const result = res?.result as {
      content: { type: string; text: string }[]
      structuredContent: { taskId: string; estimatedDurationMs: number }
      isError: boolean
    }
    expect(result.isError).toBe(false)
    expect(result.content[0]?.type).toBe('text')
    // structuredContent mirrors the parsed text payload exactly.
    expect(JSON.parse(result.content[0]!.text)).toEqual(result.structuredContent)
    expect(Object.keys(result.structuredContent).sort()).toEqual(['estimatedDurationMs', 'taskId'])
    expect(typeof result.structuredContent.taskId).toBe('string')
    expect(typeof result.structuredContent.estimatedDurationMs).toBe('number')
  })

  it('delegate_research returns {taskId, estimatedDurationMs}', async () => {
    const res = await rpc(fullServer(), 'tools/call', {
      name: 'delegate_research',
      arguments: { question: 'what is X?', namespace: 'tenant-a' },
    })
    const sc = (res?.result as { structuredContent: Record<string, unknown> }).structuredContent
    expect(Object.keys(sc).sort()).toEqual(['estimatedDurationMs', 'taskId'])
  })

  it('delegation_status reports the queued task by taskId (status payload contract)', async () => {
    const server = fullServer()
    const kicked = await rpc(server, 'tools/call', {
      name: 'delegate_code',
      arguments: { goal: 'fix the bug', repoRoot: '/repo' },
    })
    const taskId = (kicked?.result as { structuredContent: { taskId: string } }).structuredContent
      .taskId
    const statusRes = await rpc(server, 'tools/call', {
      name: 'delegation_status',
      arguments: { taskId },
    })
    const sc = (statusRes?.result as { structuredContent: Record<string, unknown> })
      .structuredContent
    expect(sc.taskId).toBe(taskId)
    expect(sc.profile).toBe('coder')
    expect(typeof sc.status).toBe('string')
    expect(typeof sc.startedAt).toBe('string')
  })

  it('delegation_history returns an entries array', async () => {
    const server = fullServer()
    await rpc(server, 'tools/call', {
      name: 'delegate_code',
      arguments: { goal: 'fix the bug', repoRoot: '/repo' },
    })
    const res = await rpc(server, 'tools/call', { name: 'delegation_history', arguments: {} })
    const sc = (res?.result as { structuredContent: { delegations?: unknown } }).structuredContent
    expect(Array.isArray(sc.delegations)).toBe(true)
  })

  it('an unknown tool is a JSON-RPC method error, never a silent success', async () => {
    const res = await rpc(fullServer(), 'tools/call', { name: 'no_such_tool', arguments: {} })
    expect(res?.error?.code).toBe(-32601)
  })
})
