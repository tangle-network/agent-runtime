import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const exec = promisify(execFile)

// Exercise the public kernel, real TLS and native fetch, including the streamed request body.
it('identifies refused CAS objects without changing HTTP or stream semantics', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cas-refusal-'))
  const bytes = Buffer.from('verified fixture bytes')
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
  const seen: string[] = []
  const server = createServer()
  try {
    await exec('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(directory, 'key.pem'),
      '-out',
      join(directory, 'cert.pem'),
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=IP:127.0.0.1,DNS:localhost',
    ])
    server.setSecureContext({
      key: await readFile(join(directory, 'key.pem')),
      cert: await readFile(join(directory, 'cert.pem')),
    })
    server.on('request', (incoming, outgoing) => {
      const namespace = incoming.url?.split('/')[3]
      seen.push(`${incoming.method} ${incoming.url}`)
      expect(incoming.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /)
      incoming.resume()
      if (namespace === 'valid') return outgoing.end(bytes)
      if (namespace === 'missing' || (incoming.method === 'HEAD' && !namespace?.startsWith('head')))
        return outgoing.writeHead(404).end()
      outgoing.writeHead(502).end(`upstream failed ${'x'.repeat(600)}`)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('HTTPS fixture port missing')
    const endpoint = `https://127.0.0.1:${address.port}`
    const script = `
      import { createS3PrivateCasStore } from '@tangle-network/agent-runtime/kernel';
      const store = createS3PrivateCasStore({ endpoint: process.argv[1], bucket: 'fixture-bucket',
        prefix: 'safe-prefix/', accessKeyId: 'access-marker', secretAccessKey: 'secret-marker' });
      const bytes = Buffer.from('verified fixture bytes'), digest = ${JSON.stringify(digest)};
      const chunks = async function* () { yield bytes };
      const outcomes = [];
      for (const [namespace, method, pointer] of [
        ['head-buffered','HEAD',false],['head-stream','HEAD',false],
        ['put-buffered','PUT',false],['put-stream','PUT',false],
        ['get-buffered','GET',false],['get-stream','GET',false],
        ['put-pointer','PUT',true],['get-pointer','GET',true],
      ]) {
        try {
          const object = { namespace, digest, bytes, byteLength: bytes.length, chunks: chunks(), name: 'latest.json' };
          if (pointer) await store[method === 'GET' ? 'getPointer' : 'putPointer'](object);
          else if (namespace.endsWith('stream')) await store[method === 'GET' ? 'getStream' : 'putStream'](object);
          else await store[method === 'GET' ? 'get' : 'put'](object);
          outcomes.push({ namespace, method, pointer, error: 'no refusal' });
        } catch (error) { outcomes.push({ namespace, method, pointer, error: error.message }); }
      }
      const missing = await store.get({ namespace:'missing', digest });
      const missingStream = await store.getStream({ namespace:'missing', digest });
      const buffered = await store.get({ namespace:'valid', digest });
      const received = [];
      for await (const chunk of await store.getStream({ namespace:'valid', digest })) received.push(chunk);
      console.log(JSON.stringify({ outcomes, missing: missing === undefined && missingStream === undefined,
        buffered: Buffer.from(buffered).toString(), streamed: Buffer.concat(received).toString() }));
    `
    const { stdout } = await exec(
      process.execPath,
      ['--input-type=module', '--eval', script, endpoint],
      {
        env: { ...process.env, NODE_EXTRA_CA_CERTS: join(directory, 'cert.pem') },
        timeout: 20_000,
      },
    )
    const result = JSON.parse(stdout)
    expect(result.missing).toBe(true)
    expect(result.buffered).toBe(bytes.toString())
    expect(result.streamed).toBe(bytes.toString())
    expect(result.outcomes).toHaveLength(8)
    for (const { namespace, method, pointer, error } of result.outcomes) {
      const key = `safe-prefix/${namespace}/${pointer ? 'latest.json' : `sha256/${digest.slice(7)}`}`
      expect(error).toMatch(`S3 private CAS ${method} ${key} returned 502`)
      expect(error).not.toMatch(/access-marker|secret-marker|Credential=|Signature=|https?:\/\//)
      if (method !== 'HEAD') expect(error.split('returned 502: ')[1]).toHaveLength(300)
    }
    // No implicit retries: HEAD-before-PUT accounts for the only extra requests.
    expect(seen).toHaveLength(14)
  } finally {
    server.closeAllConnections()
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
