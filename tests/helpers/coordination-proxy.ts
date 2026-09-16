import { createServer, request } from 'node:http'

/** A stable public address whose upstream changes when a retained coordinator restarts. */
export async function coordinationProxy() {
  let upstream: { host: string; port: number } | undefined
  const server = createServer((incoming, outgoing) => {
    if (!upstream) {
      outgoing.writeHead(503).end()
      return
    }
    const target = request(
      {
        hostname: upstream.host,
        port: upstream.port,
        path: incoming.url,
        method: incoming.method,
        headers: { ...incoming.headers, host: `${upstream.host}:${upstream.port}` },
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers)
        response.pipe(outgoing)
      },
    )
    target.on('error', () => outgoing.writeHead(502).end())
    outgoing.on('close', () => target.destroy())
    incoming.pipe(target)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('proxy did not bind')
  return {
    url: `http://127.0.0.1:${address.port}`,
    forwardTo(port: number, host = '127.0.0.1') {
      upstream = { host, port }
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
