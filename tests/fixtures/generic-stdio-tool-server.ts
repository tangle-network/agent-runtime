import { createStdioToolServer } from '../../src/mcp/tool-server'

const server = createStdioToolServer({
  serverName: 'generic-tool-server-test',
  serverVersion: '0',
  tools: [
    {
      name: 'json_result',
      description: 'Exercise JSON serialization over stdio',
      inputSchema: { type: 'object' },
      handler: async (args) => {
        const kind = (args as { kind: string }).kind
        const circular: Record<string, unknown> = {}
        circular.self = circular
        return (
          {
            null: null,
            array: [1, 'two'],
            number: 42,
            boolean: true,
            undefined: undefined,
            bigint: 1n,
            circular,
          } as Record<string, unknown>
        )[kind]
      },
    },
    {
      name: 'unknown_failure',
      description: 'An unclassified tool failure',
      inputSchema: { type: 'object' },
      handler: async () => {
        const privateValue = 'private-error-credential-stdin-stderr-sentinel'
        throw Object.assign(
          new Error('Ordinary tool failure', { cause: new Error(privateValue) }),
          {
            stdin: privateValue,
            stderr: privateValue,
            credentials: privateValue,
            remediation: { fix: privateValue },
            failure: { kind: 'invalid', code: privateValue },
          },
        )
      },
    },
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
