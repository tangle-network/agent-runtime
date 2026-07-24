import { createServer } from 'node:http'

export interface CapturedModelRequest {
  authorization: string | undefined
  path: string | undefined
  body: Record<string, unknown>
}

export async function startOptimizerModelServer(content: string): Promise<{
  baseUrl: string
  requests: CapturedModelRequest[]
  close: () => Promise<void>
}> {
  const requests: CapturedModelRequest[] = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
    requests.push({
      authorization: request.headers.authorization,
      path: request.url,
      body,
    })
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            index: 0,
            message: { content, role: 'assistant' },
          },
        ],
        created: 0,
        id: 'chatcmpl-local',
        model: 'local-model',
        object: 'chat.completion',
        usage: {
          completion_tokens: 13,
          prompt_tokens: 11,
          total_tokens: 24,
        },
      }),
    )
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('optimizer model server failed to bind')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: async () => {
      server.closeAllConnections?.()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}
