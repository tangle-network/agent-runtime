import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createS3PrivateCasStore } from '../../src/runtime/s3-private-cas-store'

/** Real file I/O behind an in-process S3 transport; no remote bucket or network is used. */
export async function diskS3StreamStore(root: string) {
  await mkdir(root, { recursive: true })
  const metadata = new Map<string, { digest: string; byteLength: number }>()
  let uploads = 0
  let reads = 0
  const store = createS3PrivateCasStore({
    endpoint: 'https://s3.invalid',
    bucket: 'streaming-test',
    accessKeyId: 'fixture-key',
    secretAccessKey: 'fixture-secret',
    async fetch(input, init) {
      const url = new URL(String(input))
      const object = url.pathname.split('/').at(-1)!
      if (!/^[a-f0-9]{64}$/.test(object)) throw new Error('unexpected fixture key')
      const path = join(root, object)
      if (init?.method === 'HEAD') {
        const value = metadata.get(object)
        return value
          ? new Response(null, {
              headers: {
                'content-length': String(value.byteLength),
                'x-amz-meta-sha256': value.digest,
              },
            })
          : new Response(null, { status: 404 })
      }
      if (init?.method === 'PUT') {
        if (!(init.body instanceof ReadableStream)) throw new Error('buffered S3 PUT is forbidden')
        const headers = new Headers(init.headers)
        if (headers.get('x-amz-content-sha256') !== object) throw new Error('missing signed digest')
        await pipeline(Readable.fromWeb(init.body), createWriteStream(path, { mode: 0o600 }))
        const byteLength = (await stat(path)).size
        if (byteLength !== Number(headers.get('content-length')))
          throw new Error('wrong streamed content length')
        metadata.set(object, { digest: headers.get('x-amz-meta-sha256')!, byteLength })
        uploads++
        return new Response(null)
      }
      if (init?.method === 'GET') {
        reads++
        if (!metadata.has(object)) return new Response(null, { status: 404 })
        return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>)
      }
      throw new Error('unexpected S3 request')
    },
  })
  return {
    store: {
      ...store,
      put: async (): Promise<never> => {
        throw new Error('buffered durable write is forbidden')
      },
      get: async (): Promise<never> => {
        throw new Error('buffered durable read is forbidden')
      },
    },
    counts: () => ({ uploads, reads }),
  }
}
