/**
 * Writes into a private CAS. An object's name is published only after its bytes are synced,
 * and that order is what makes a name trustworthy: see `createPrivateCasArtifactPort`.
 */

import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, open, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentCandidateArtifactRef } from '@tangle-network/agent-interface'
import { syncDirectory, syncHandle } from './durable-sync'
import {
  checkDirectories,
  objectPath,
  type PrivateCasLayout,
  privateCasRef,
  readObject,
  readPrivateCasRef,
  readPrivateCasStream,
} from './private-cas-objects'
import type { PrivateCasOffload } from './private-cas-offload'

const CREATE_EXCLUSIVE =
  constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW

/** Store a stream: stage it under a temporary name, verify the staged inode, then publish it. */
export async function putPrivateCasStream(
  layout: PrivateCasLayout,
  offload: PrivateCasOffload,
  input: { chunks: AsyncIterable<Uint8Array>; signal?: AbortSignal },
): Promise<AgentCandidateArtifactRef> {
  const { signal } = input
  const { store, durable } = layout
  signal?.throwIfAborted()
  await checkDirectories(store, true)
  const temporary = join(store, `.${randomUUID()}.tmp`)
  try {
    const file = await open(temporary, CREATE_EXCLUSIVE, 0o600)
    const hash = createHash('sha256')
    let byteLength = 0
    try {
      for await (const chunk of input.chunks) {
        signal?.throwIfAborted()
        if (!(chunk instanceof Uint8Array)) throw new Error('private CAS received a non-byte chunk')
        hash.update(chunk)
        byteLength += chunk.byteLength
        if (!Number.isSafeInteger(byteLength)) throw new Error('private CAS object is too large')
        await file.writeFile(chunk)
      }
      signal?.throwIfAborted()
      await syncHandle(file)
    } finally {
      await file.close()
    }
    const sha = hash.digest('hex')
    const digest = `sha256:${sha}` as AgentCandidateArtifactRef['sha256']
    const ref = privateCasRef(layout.namespace, digest, byteLength)
    for await (const _chunk of readObject(temporary, ref, signal)) {
      // Verify the staged inode before it can become another writer's deduplicated object.
    }
    const path = objectPath(layout, digest)
    const directory = join(store, sha.slice(0, 2))
    await checkDirectories(directory, true)
    signal?.throwIfAborted()
    let linked = true
    try {
      // The link commits publication. Later cancellation must not delete a shared CAS object.
      await link(temporary, path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      linked = false
      for await (const _chunk of readPrivateCasStream(layout, ref, { signal })) {
        // An existing object must independently match, even when our staged bytes were valid.
      }
    }
    await syncDirectory(directory)
    if (durable !== undefined) await offload.settlePut({ sha, byteLength, linked }, signal)
    return ref
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
}

/** Store bytes already in memory; the durable copy then reuses those bytes. */
export async function putPrivateCasBuffered(
  layout: PrivateCasLayout,
  offload: PrivateCasOffload,
  object: { bytes: Uint8Array; digest: AgentCandidateArtifactRef['sha256']; sha: string },
  signal?: AbortSignal,
): Promise<AgentCandidateArtifactRef> {
  const { bytes, digest, sha } = object
  const path = objectPath(layout, digest)
  const directory = join(layout.store, sha.slice(0, 2))
  await checkDirectories(directory, true)
  const temporary = join(directory, `.${sha}.${randomUUID()}.tmp`)
  const file = await open(temporary, CREATE_EXCLUSIVE, 0o600)
  try {
    await file.writeFile(bytes)
    await syncHandle(file)
  } finally {
    await file.close()
  }
  let linked = true
  try {
    signal?.throwIfAborted()
    try {
      await link(temporary, path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      linked = false
    }
    await syncDirectory(directory)
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
  const ref = privateCasRef(layout.namespace, digest, bytes.byteLength)
  await readPrivateCasRef(layout, ref)
  if (layout.durable !== undefined) {
    // The bytes are already in memory, so this put copies them itself; a pass that follows
    // skips this digest and only evicts and retries others.
    await offload.settlePut({ sha, byteLength: bytes.byteLength, linked, bytes }, signal)
  }
  return ref
}
