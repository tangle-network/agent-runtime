import { describe, expect, it } from 'vitest'
import { createStdioToolServer, type JsonRpcResponse } from '../../src/mcp/tool-server'

async function callTool(output: unknown): Promise<JsonRpcResponse | null> {
  const server = createStdioToolServer({
    serverName: 'test-server',
    serverVersion: 'test',
    tools: [
      {
        name: 'result',
        description: 'Return the configured result',
        inputSchema: { type: 'object' },
        handler: async () => output,
      },
    ],
  })
  return server.handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'result', arguments: {} },
  })
}

function resultOf(response: JsonRpcResponse | null): Record<string, unknown> {
  if (!response?.result || typeof response.result !== 'object') {
    throw new Error(`expected a result, received ${JSON.stringify(response)}`)
  }
  return response.result as Record<string, unknown>
}

describe('createStdioToolServer — tool result envelope', () => {
  it.each([
    ['null', null, 'null'],
    ['array', [1, 'two'], '[1,"two"]'],
    ['string', 'hello', '"hello"'],
    ['number', 42, '42'],
    ['boolean', true, 'true'],
  ])('keeps the %s result in content text without structuredContent', async (_, output, text) => {
    const result = resultOf(await callTool(output))

    expect(result.content).toEqual([{ type: 'text', text }])
    expect(result).not.toHaveProperty('structuredContent')
  })

  it('emits object structuredContent and the same JSON in content text', async () => {
    const output = { answer: 42, nested: { ok: true } }
    const result = resultOf(await callTool(output))

    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(output) }])
    expect(result.structuredContent).toEqual(output)
    expect(JSON.parse((result.content as [{ text: string }])[0].text)).toEqual(
      result.structuredContent,
    )
  })

  it('returns invalid params when a handler returns undefined', async () => {
    const response = await callTool(undefined)

    expect(response?.error?.code).toBe(-32602)
    expect(response?.error?.message).toBe('MCP tool result must be JSON-serializable')
  })

  it.each([
    ['a bigint', 1n],
    [
      'a circular object',
      (() => {
        const value: Record<string, unknown> = {}
        value.self = value
        return value
      })(),
    ],
  ])('returns invalid params when a handler returns %s', async (_, output) => {
    const response = await callTool(output)

    expect(response?.error?.code).toBe(-32602)
    expect(response?.error?.message).toMatch(/^MCP tool result must be JSON-serializable/)
  })
})
