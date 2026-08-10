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
    try {
      const stringResult = await client.callTool({ name: 'string_result', arguments: {} })
      expect(stringResult.content).toEqual([{ type: 'text', text: 'plain string result' }])
      expect(stringResult).not.toHaveProperty('structuredContent')

      const objectResult = await client.callTool({ name: 'object_result', arguments: {} })
      expect(objectResult.content).toEqual([{ type: 'text', text: '{"answer":42}' }])
      expect(objectResult.structuredContent).toEqual({ answer: 42 })
    } finally {
      await client.close()
    }
  })
})
