/** Deterministic regular-file archive used for runtime/Pier task outcomes. */
import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { canonicalJson } from '@tangle-network/agent-eval'
import type { AgentCandidateWorkspaceManifestMaterialV1 } from '@tangle-network/agent-interface'

export interface PierWorkspaceArchiveFile {
  readonly path: string
  readonly mode: 0o644 | 0o755
  readonly content: string
  readonly sha256: `sha256:${string}`
  readonly byteLength: number
}

export interface PierWorkspaceArchiveV1 {
  readonly schemaVersion: 1
  readonly kind: 'pier-workspace-archive'
  readonly files: readonly PierWorkspaceArchiveFile[]
}

export interface PierWorkspaceFile {
  readonly path: string
  readonly mode: 0o644 | 0o755
  readonly bytes: Uint8Array
}

const sha256 = (bytes: Uint8Array): `sha256:${string}` =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`

/** Encode sorted, detached file bytes and return the exact matching runtime manifest. */
export function createPierWorkspaceArchive(files: readonly PierWorkspaceFile[]): {
  readonly archive: Uint8Array
  readonly manifest: AgentCandidateWorkspaceManifestMaterialV1
} {
  const seen = new Set<string>()
  const ordered = [...files]
    .map((file) => {
      const path = safeRelativePath(file.path)
      if (seen.has(path)) throw new Error(`Pier workspace archive repeats path ${path}`)
      seen.add(path)
      if (file.mode !== 0o644 && file.mode !== 0o755) {
        throw new Error(`Pier workspace archive has unsupported mode for ${path}`)
      }
      const bytes = Uint8Array.from(file.bytes)
      return {
        path,
        mode: file.mode,
        content: Buffer.from(bytes).toString('base64'),
        sha256: sha256(bytes),
        byteLength: bytes.byteLength,
      }
    })
    .sort((left, right) => left.path.localeCompare(right.path))
  const document: PierWorkspaceArchiveV1 = {
    schemaVersion: 1,
    kind: 'pier-workspace-archive',
    files: ordered,
  }
  return {
    archive: Buffer.from(canonicalJson(document), 'utf8'),
    manifest: {
      schemaVersion: 1,
      kind: 'agent-candidate-workspace-manifest',
      files: ordered.map(({ path, mode, sha256, byteLength }) => ({
        path,
        mode,
        sha256,
        byteLength,
      })),
    },
  }
}

/** Decode only the canonical archive format and materialize its exact declared file set. */
export async function materializePierWorkspaceArchive(input: {
  readonly archive: Uint8Array
  readonly expected: AgentCandidateWorkspaceManifestMaterialV1
  readonly destination: string
}): Promise<void> {
  const parsed = parseArchive(input.archive)
  const observed = createPierWorkspaceArchive(
    parsed.files.map((file) => ({
      path: file.path,
      mode: file.mode,
      bytes: Buffer.from(file.content, 'base64'),
    })),
  )
  if (!Buffer.from(observed.archive).equals(Buffer.from(input.archive))) {
    throw new Error('Pier workspace archive is not canonical')
  }
  if (canonicalJson(observed.manifest) !== canonicalJson(input.expected)) {
    throw new Error('Pier workspace archive does not match the signed manifest')
  }

  const destination = resolve(input.destination)
  await mkdir(destination, { recursive: true, mode: 0o700 })
  const stats = await lstat(destination)
  if (!stats.isDirectory() || stats.isSymbolicLink() || (await realpath(destination)) !== destination) {
    throw new Error('Pier workspace archive destination must be a real directory')
  }
  if ((await readdir(destination)).length !== 0) {
    throw new Error('Pier workspace archive destination must be empty')
  }
  for (const file of parsed.files) {
    const bytes = Buffer.from(file.content, 'base64')
    if (bytes.byteLength !== file.byteLength || sha256(bytes) !== file.sha256) {
      throw new Error(`Pier workspace archive content differs at ${file.path}`)
    }
    const output = join(destination, file.path)
    await mkdir(dirname(output), { recursive: true, mode: 0o700 })
    await writeFile(output, bytes, { flag: 'wx', mode: 0o600 })
    await chmod(output, file.mode)
    const written = await readFile(output)
    if (!written.equals(bytes)) throw new Error(`Pier workspace archive write drifted at ${file.path}`)
  }
}

function parseArchive(bytes: Uint8Array): PierWorkspaceArchiveV1 {
  let value: unknown
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8'))
  } catch (error) {
    throw new Error('Pier workspace archive is not UTF-8 JSON', { cause: error })
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Pier workspace archive must be an object')
  }
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== 1 ||
    record.kind !== 'pier-workspace-archive' ||
    !Array.isArray(record.files) ||
    Object.keys(record).sort().join(',') !== 'files,kind,schemaVersion'
  ) {
    throw new Error('Pier workspace archive has an invalid envelope')
  }
  const files = record.files.map((value, index) => parseFile(value, index))
  return { schemaVersion: 1, kind: 'pier-workspace-archive', files }
}

function parseFile(value: unknown, index: number): PierWorkspaceArchiveFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Pier workspace archive file ${index} must be an object`)
  }
  const file = value as Record<string, unknown>
  if (
    Object.keys(file).sort().join(',') !== 'byteLength,content,mode,path,sha256' ||
    typeof file.path !== 'string' ||
    (file.mode !== 0o644 && file.mode !== 0o755) ||
    typeof file.content !== 'string' ||
    typeof file.sha256 !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(file.sha256) ||
    !Number.isSafeInteger(file.byteLength) ||
    (file.byteLength as number) < 0
  ) {
    throw new Error(`Pier workspace archive file ${index} is invalid`)
  }
  return {
    path: safeRelativePath(file.path),
    mode: file.mode,
    content: file.content,
    sha256: file.sha256 as `sha256:${string}`,
    byteLength: file.byteLength as number,
  }
}

function safeRelativePath(value: string): string {
  const parts = value.split('/')
  if (
    !value ||
    isAbsolute(value) ||
    value.includes('\\') ||
    value.includes('\0') ||
    parts.some((part) => !part || part === '.' || part === '..') ||
    parts[0]?.toLowerCase() === '.git'
  ) {
    throw new Error(`Pier workspace archive path is unsafe: ${value}`)
  }
  return value
}
