import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { describe, expect, it } from 'vitest'

const serverPath = fileURLToPath(
  new URL('../fixtures/generic-stdio-tool-server.ts', import.meta.url),
)

describe('createStdioToolServer — official client round trip', () => {
  it('delivers string and object results through the validated stdio protocol', async () => {
    const client = new Client({ name: 'agent-runtime-test', version: '0' })
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', serverPath],
      cwd: process.cwd(),
    })

    await client.connect(transport)
    const wire: unknown[] = []
    const receive = transport.onmessage
    transport.onmessage = (message) => {
      wire.push(message)
      receive?.(message)
    }
    try {
      const stringResult = await client.callTool({ name: 'string_result', arguments: {} })
      expect(stringResult.content).toEqual([{ type: 'text', text: 'plain string result' }])
      expect(stringResult).not.toHaveProperty('structuredContent')

      const objectResult = await client.callTool({ name: 'object_result', arguments: {} })
      expect(objectResult.content).toEqual([{ type: 'text', text: '{"answer":42}' }])
      expect(objectResult.structuredContent).toEqual({ answer: 42 })
      for (const [kind, text] of [
        ['null', 'null'],
        ['array', '[1,"two"]'],
        ['number', '42'],
        ['boolean', 'true'],
      ]) {
        const result = await client.callTool({ name: 'json_result', arguments: { kind } })
        expect(result.content).toEqual([{ type: 'text', text }])
        expect(result).not.toHaveProperty('structuredContent')
      }
      for (const kind of ['undefined', 'bigint', 'circular']) {
        await expect(
          client.callTool({ name: 'json_result', arguments: { kind } }),
        ).rejects.toMatchObject({ code: -32602 })
      }
      await expect(
        client.callTool({ name: 'unknown_failure', arguments: {} }),
      ).rejects.toMatchObject({
        code: -32000,
        data: { failure: { code: 'unknown', owner: 'unknown' } },
      })
      expect(wire.at(-1)).toMatchObject({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Ordinary tool failure',
          data: { failure: { code: 'unknown', owner: 'unknown' } },
        },
      })
      expect(JSON.stringify(wire)).not.toContain('private-error-credential-stdin-stderr-sentinel')
    } finally {
      await client.close()
    }
  })
})
