import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { createServer, request } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import type { Sha256Digest } from '@tangle-network/agent-interface'
import { createS3PrivateCasStore } from '../../src/runtime/s3-private-cas-store'
import { createPrivateCasS3Transport } from '../../src/runtime/s3-private-cas-request'

const exec = promisify(execFile)

/** A real MinIO process, isolated bucket, HTTPS transport and production SigV4 signer. No mocked store. */
it.skipIf(!process.env.PRIVATE_CAS_MINIO_IMAGE)(
  'retires one complete reviewed namespace, refuses stale review and preserves its adjacent namespace',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cas-namespace-'))
    const name = `cas-namespace-${randomUUID()}`
    let stopTls: (() => Promise<void>) | undefined
    try {
      const image = process.env.PRIVATE_CAS_MINIO_IMAGE
      if (!image)
        throw new Error('PRIVATE_CAS_MINIO_IMAGE must name an installed MinIO fixture image')
      await exec('docker', [
        'run',
        '--rm',
        '-d',
        '--name',
        name,
        '-p',
        '127.0.0.1::9000',
        '-e',
        'MINIO_ROOT_USER=fixture-access',
        '-e',
        'MINIO_ROOT_PASSWORD=fixture-secret',
        image,
        'server',
        '/data',
      ])
      const { stdout } = await exec('docker', ['port', name, '9000/tcp'])
      const port = Number(stdout.trim().split(':').at(-1))
      if (!Number.isInteger(port) || port <= 0) throw new Error('MinIO port missing')
      await expect
        .poll(
          async () =>
            fetch(`http://127.0.0.1:${port}/minio/health/ready`).then(
              (r) => r.ok,
              () => false,
            ),
          { timeout: 30_000 },
        )
        .toBe(true)
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
      const ca = await readFile(join(directory, 'cert.pem'))
      // TLS termination changes no signed path, query, headers or bytes. MinIO
      // receives and verifies the production request, including its Host header.
      const server = createServer(
        { key: await readFile(join(directory, 'key.pem')), cert: ca },
        (incoming, outgoing) => {
          const upstream = httpRequest(
            {
              hostname: '127.0.0.1',
              port,
              path: incoming.url,
              method: incoming.method,
              headers: incoming.headers,
            },
            (response) => {
              outgoing.writeHead(response.statusCode ?? 502, response.headers)
              response.pipe(outgoing)
            },
          )
          upstream.on('error', (error) => outgoing.destroy(error))
          incoming.pipe(upstream)
        },
      )
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      stopTls = () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        )
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('TLS port missing')
      const endpoint = `https://127.0.0.1:${address.port}`
      // Trust only this fixture certificate, never a process-wide TLS bypass.
      const transport: typeof fetch = async (input, init) =>
        new Promise((resolve, reject) => {
          const call = request(
            String(input),
            {
              method: init?.method,
              headers: Object.fromEntries(new Headers(init?.headers)),
              ca,
              signal: init?.signal ?? undefined,
            },
            (response) => {
              const headers = new Headers()
              for (const [key, value] of Object.entries(response.headers)) {
                if (value !== undefined)
                  headers.set(key, Array.isArray(value) ? value.join(', ') : value)
              }
              const status = response.statusCode ?? 500
              const body =
                status === 204 || status === 304 || init?.method === 'HEAD'
                  ? null
                  : (Readable.toWeb(response) as ReadableStream<Uint8Array>)
              if (body === null) response.resume()
              resolve(new Response(body, { status, headers }))
            },
          )
          call.on('error', reject)
          if (init?.body instanceof ReadableStream) Readable.fromWeb(init.body).pipe(call)
          else if (init?.body === null || init?.body === undefined) call.end()
          else if (typeof init.body === 'string' || init.body instanceof Uint8Array)
            call.end(init.body)
          else {
            call.destroy()
            reject(new Error('unexpected fixture body'))
          }
        })
      const options = {
        endpoint,
        bucket: name,
        accessKeyId: 'fixture-access',
        secretAccessKey: 'fixture-secret',
        region: 'us-east-1',
        fetch: transport,
      }
      const bucket = await createPrivateCasS3Transport(options, new URL(endpoint)).request(
        'PUT',
        '',
      )
      expect(bucket.status).toBe(200)
      const store = createS3PrivateCasStore({ ...options, prefix: 'runs/' })
      const namespace = 'reviewed-disposable'
      const bytes = Buffer.from('minimal source fixture')
      const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}` as Sha256Digest
      await store.put({ namespace, digest, bytes })
      await store.put({ namespace: `${namespace}-research`, digest, bytes })
      // More than one ListObjectsV2 page. Pointers exercise escaping and the
      // ordinary mutable-key path in addition to immutable CAS objects.
      for (let start = 0; start < 1001; start += 32) {
        await Promise.all(
          Array.from({ length: Math.min(32, 1001 - start) }, (_, offset) =>
            store.putPointer({ namespace, name: `pointer-${start + offset}`, bytes }),
          ),
        )
      }
      const reviewed = await store.inspectNamespace({ namespace })
      expect(reviewed.objects).toHaveLength(1002)
      expect(await store.inspectNamespace({ namespace })).toEqual(reviewed)
      await store.putPointer({ namespace, name: 'late-pointer', bytes })
      await expect(store.retireNamespace({ inventory: reviewed })).rejects.toThrow('changed')
      expect((await store.inspectNamespace({ namespace })).objects).toHaveLength(1003)
      const final = await store.inspectNamespace({ namespace })
      const result = await store.retireNamespace({ inventory: final })
      expect(result).toMatchObject({
        complete: true,
        deletedObjects: 1003,
        deletedBytes: 1003 * bytes.byteLength,
        remainingObjects: 0,
        remainingBytes: 0,
      })
      expect(await store.get({ namespace, digest })).toBeUndefined()
      expect(await store.get({ namespace: `${namespace}-research`, digest })).toEqual(
        Uint8Array.from(bytes),
      )
      expect(await store.retireNamespace({ inventory: final })).toMatchObject({
        complete: true,
        deletedObjects: 0,
        deletedBytes: 0,
      })
      await expect(store.inspectNamespace({ namespace: '../research' })).rejects.toThrow('invalid')
      await expect(
        store.retireNamespace({ inventory: { ...final, namespace: `${namespace}-research` } }),
      ).rejects.toThrow('inventory')
    } finally {
      await stopTls?.()
      await exec('docker', ['rm', '-f', name]).catch((error: { stderr?: string }) => {
        if (!/No such container/u.test(error.stderr ?? '')) throw error
      })
      await rm(directory, { recursive: true, force: true })
    }
  },
  180_000,
)
