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
  const port: AgentCandidateOutputArtifactPort = {
    async put({ bytes, signal }) {
      signal?.throwIfAborted()
      const sha = createHash('sha256').update(bytes).digest('hex')
      const digest = `sha256:${sha}` as AgentCandidateArtifactRef['sha256']
      const path = destination(digest)
      const directory = join(store, sha.slice(0, 2))
      await checkDirectories(directory, true)
      const temporary = join(directory, `.${sha}.${randomUUID()}.tmp`)
      const file = await open(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      )
      try {
        await file.writeFile(bytes)
        await file.sync()
      } finally {
        await file.close()
      }
      try {
        signal?.throwIfAborted()
        try {
          await link(temporary, path)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
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
      } finally {
        await unlink(temporary).catch(() => undefined)
      }
      const ref: AgentCandidateArtifactRef = {
        locator: { kind: 'private-cas', namespace, digest },
        sha256: digest,
        byteLength: bytes.byteLength,
      }
      await port.read(ref)
      return ref
    },
    async read(ref) {
      if (
        ref.locator.kind !== 'private-cas' ||
        ref.locator.namespace !== namespace ||
        ref.locator.digest !== ref.sha256
      ) {
        throw new Error('private CAS locator does not match its digest and namespace')
      }
      const path = destination(ref.sha256)
      await checkDirectories(join(store, DIGEST.exec(ref.sha256)![1]!.slice(0, 2)), false)
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const bytes = await file.readFile()
        const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
        if (digest !== ref.sha256 || bytes.byteLength !== ref.byteLength)
          throw new Error('private CAS object failed digest or length verification')
        return bytes
      } finally {
        await file.close()
      }
    },
  }
  return port
}
