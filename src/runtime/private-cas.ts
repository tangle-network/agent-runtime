import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, unlink } from 'node:fs/promises'
import { isAbsolute, join, resolve, sep } from 'node:path'
import type { AgentCandidateArtifactRef } from '@tangle-network/agent-interface'
import type { AgentCandidateOutputArtifactPort } from '../candidate-execution/types'

const DIGEST = /^sha256:([0-9a-f]{64})$/u
const SAFE_NAMESPACE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u

async function realDirectory(path: string): Promise<void> {
  const entry = await lstat(path)
  if (!entry.isDirectory() || entry.isSymbolicLink())
    throw new Error(`private CAS directory is not a real directory: ${path}`)
}

async function checkDirectories(path: string, create: boolean): Promise<void> {
  const parts = resolve(path).split(sep)
  let current: string = sep
  for (const part of parts) {
    if (!part) continue
    current = join(current, part)
    if (create) {
      try {
        await mkdir(current, { mode: 0o700 })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    await realDirectory(current)
  }
}

/** Private host-local content-addressed storage scoped to one recorded run identity. */
export function createPrivateCasArtifactPort(
  root: string,
  namespace: string,
): AgentCandidateOutputArtifactPort {
  if (!isAbsolute(root)) throw new Error('private CAS root must be absolute')
  if (!SAFE_NAMESPACE.test(namespace) || namespace === '.' || namespace === '..')
    throw new Error('private CAS namespace must be one safe identifier')
  const store = join(resolve(root), 'sha256')
  const destination = (digest: string): string => {
    const match = DIGEST.exec(digest)
    if (!match) throw new Error('private CAS digest must be sha256:<64 lowercase hex>')
    return join(store, match[1]!.slice(0, 2), match[1]!)
  }

  async function* readStream(
    ref: AgentCandidateArtifactRef,
    options: { signal?: AbortSignal } = {},
  ): AsyncGenerator<Uint8Array> {
    const { signal } = options
    signal?.throwIfAborted()
    if (
      ref.locator.kind !== 'private-cas' ||
      ref.locator.namespace !== namespace ||
      ref.locator.digest !== ref.sha256
    )
      throw new Error('private CAS locator does not match its digest and namespace')
    const path = destination(ref.sha256)
    await checkDirectories(join(store, DIGEST.exec(ref.sha256)![1]!.slice(0, 2)), false)
    yield* readObject(path, ref, signal)
  }

  async function* readObject(
    path: string,
    ref: AgentCandidateArtifactRef,
    signal?: AbortSignal,
  ): AsyncGenerator<Uint8Array> {
    signal?.throwIfAborted()
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stats = await file.stat()
      if (!stats.isFile() || stats.size !== ref.byteLength)
        throw new Error('private CAS object failed digest or length verification')
      const hash = createHash('sha256')
      let byteLength = 0
      for await (const chunk of file.createReadStream({
        autoClose: false,
        highWaterMark: 64 * 1024,
      })) {
        signal?.throwIfAborted()
        byteLength += chunk.byteLength
        if (byteLength > ref.byteLength)
          throw new Error('private CAS object failed digest or length verification')
        hash.update(chunk)
        yield chunk
      }
      signal?.throwIfAborted()
      if (`sha256:${hash.digest('hex')}` !== ref.sha256 || byteLength !== ref.byteLength)
        throw new Error('private CAS object failed digest or length verification')
    } finally {
      await file.close()
    }
  }

  async function putStream(input: {
    chunks: AsyncIterable<Uint8Array>
    signal?: AbortSignal
  }): Promise<AgentCandidateArtifactRef> {
    const { signal } = input
    signal?.throwIfAborted()
    await checkDirectories(store, true)
    const temporary = join(store, `.${randomUUID()}.tmp`)
    try {
      const file = await open(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      )
      const hash = createHash('sha256')
      let byteLength = 0
      try {
        for await (const chunk of input.chunks) {
          signal?.throwIfAborted()
          if (!(chunk instanceof Uint8Array))
            throw new Error('private CAS received a non-byte chunk')
          hash.update(chunk)
          byteLength += chunk.byteLength
          if (!Number.isSafeInteger(byteLength)) throw new Error('private CAS object is too large')
          await file.writeFile(chunk)
        }
        signal?.throwIfAborted()
        await file.sync()
      } finally {
        await file.close()
      }
      const sha = hash.digest('hex')
      const digest = `sha256:${sha}` as AgentCandidateArtifactRef['sha256']
      const ref: AgentCandidateArtifactRef = {
        locator: { kind: 'private-cas', namespace, digest },
        sha256: digest,
        byteLength,
      }
      for await (const _chunk of readObject(temporary, ref, signal)) {
        // Verify the staged inode before it can become another writer's deduplicated object.
      }
      const path = destination(digest)
      const directory = join(store, sha.slice(0, 2))
      await checkDirectories(directory, true)
      signal?.throwIfAborted()
      try {
        // The link commits publication. Later cancellation must not delete a shared CAS object.
        await link(temporary, path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        for await (const _chunk of readStream(ref, { signal })) {
          // An existing object must independently match, even when our staged bytes were valid.
        }
      }
      const dir = await open(
        directory,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      )
      try {
        await dir.sync()
      } finally {
        await dir.close()
      }
      return ref
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
    }
  }

  return {
    put: ({ bytes, signal }) =>
      putStream({
        chunks: (async function* () {
          yield bytes
        })(),
        signal,
      }),
    putStream,
    readStream,
    async read(ref) {
      const chunks: Buffer[] = []
      for await (const chunk of readStream(ref)) chunks.push(Buffer.from(chunk))
      return Buffer.concat(chunks)
    },
  }
}
