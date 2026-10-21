import {
  assertNoSymlinkDescendant,
  publishExclusiveDurableFile,
} from '../../runtime/supervise/durable-file'
import { detachedSnapshot } from '../../runtime/supervise/snapshot'
import type { ResultBlobStore } from '../../runtime/supervise/types'
import { contentAddress } from '../content-address'
import { isNoEntError } from '../jsonl-file'

/**
 * FS `ResultBlobStore`. One JSON file per artifact under `dir`, named by a
 * filesystem-safe encoding of the `outRef` (`sha256:<hex>` → `sha256-<hex>.json`).
 * `put` fsyncs so a crash between writes never loses an acknowledged blob.
 *
 * @stable
 */
export class FileResultBlobStore implements ResultBlobStore {
  constructor(private readonly dir: string) {}

  async put(outRef: string, artifact: unknown): Promise<void> {
    const { text } = encodeResultBlob(outRef, artifact)
    const filePath = this.blobPath(outRef)
    assertNoSymlinkDescendant(this.dir, filePath, 'result blob')
    const fs = await import('node:fs/promises')
    await fs.mkdir(this.dir, { recursive: true })
    assertNoSymlinkDescendant(this.dir, filePath, 'result blob')
    if (!publishExclusiveDurableFile(filePath, text, { mode: 0o600 })) {
      const existing = await this.get(outRef)
      assertContentAddress(outRef, existing)
    }
  }

  async get(outRef: string): Promise<unknown | undefined> {
    const filePath = this.blobPath(outRef)
    assertNoSymlinkDescendant(this.dir, filePath, 'result blob')
    const fs = await import('node:fs/promises')
    const { constants } = await import('node:fs')
    let text: string
    try {
      const handle = await fs.open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        if (!(await handle.stat()).isFile()) throw new Error('result blob must be a regular file')
        text = await handle.readFile('utf8')
      } finally {
        await handle.close()
      }
    } catch (err) {
      if (isNoEntError(err)) return undefined
      throw err
    }
    const artifact: unknown = JSON.parse(text)
    assertContentAddress(outRef, artifact)
    return artifact
  }

  private blobPath(outRef: string): string {
    if (!/^sha256:[0-9a-f]{64}$/.test(outRef))
      throw new Error('invalid result blob content address')
    return `${this.dir}/${outRef.replace(/:/g, '-')}.json`
  }
}

/** @internal shared with the SQL-backed store. */
export function encodeResultBlob(
  outRef: string,
  artifact: unknown,
): { snapshot: unknown; text: string } {
  const detached = detachedSnapshot(artifact, 'result blob')
  assertContentAddress(outRef, detached)
  const text = JSON.stringify(detached)
  if (text === undefined) throw new Error('result blob must contain JSON')
  const snapshot: unknown = JSON.parse(text)
  // Both stores retain exactly the JSON value whose address survives durable serialization.
  assertContentAddress(outRef, snapshot)
  return { snapshot, text }
}

/** @internal shared with the SQL-backed store. */
function assertContentAddress(outRef: string, artifact: unknown): void {
  const expected = contentAddress(artifact)
  if (outRef !== expected) {
    throw new Error(
      `blob outRef '${outRef}' does not match the artifact content hash '${expected}'; ` +
        'a content-addressed store refuses a mismatched ref (breaks the replay invariant)',
    )
  }
}
