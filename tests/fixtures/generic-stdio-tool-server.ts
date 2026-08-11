import { createStdioToolServer } from '../../src/mcp/tool-server'

const server = createStdioToolServer({
  serverName: 'generic-tool-server-test',
  serverVersion: '0',
  tools: [
    {
      name: 'string_result',
      description: 'Return a string result',
      inputSchema: { type: 'object' },
      handler: async () => 'plain string result',
    },
    {
      name: 'object_result',
      description: 'Return an object result',
      inputSchema: { type: 'object' },
      handler: async () => ({ answer: 42 }),
    },
  ],
})

await server.serve()
