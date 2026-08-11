import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { fsSurfaceReader, harvestSurfaceDiffs, type SurfaceReader } from './surface-diff'
import type { MountManifestEntry } from './types'

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

const mount = (path: string, content: string, source = 'test'): MountManifestEntry => ({
  path,
  sha256: sha(content),
  bytes: Buffer.byteLength(content),
  source,
})

const readerOf = (files: Record<string, string | undefined>): SurfaceReader => {
  return (path) => {
    const content = files[path]
    if (content === undefined)
      return Promise.resolve({ succeeded: false, missing: true, error: 'ENOENT' })
    return Promise.resolve({ succeeded: true, value: new TextEncoder().encode(content) })
  }
}

describe('harvestSurfaceDiffs', () => {
  it('reports nothing when every surface settles with its mounted bytes', async () => {
    const diffs = await harvestSurfaceDiffs({
      mounts: [mount('CLAUDE.md', 'instructions'), mount('memory/notes.md', 'notes')],
      read: readerOf({ 'CLAUDE.md': 'instructions', 'memory/notes.md': 'notes' }),
    })
    expect(diffs).toEqual([])
  })

  it('reports a modified surface with the settled hash and size, preserving record order', async () => {
    const diffs = await harvestSurfaceDiffs({
      mounts: [mount('a.md', 'aaa'), mount('b.md', 'bbb', 'corpus:42'), mount('c.md', 'ccc')],
      read: readerOf({ 'a.md': 'aaa', 'b.md': 'bbb-edited-by-agent', 'c.md': 'ccc!' }),
    })
    expect(diffs.map((d) => d.path)).toEqual(['b.md', 'c.md'])
    expect(diffs[0]).toEqual({
      path: 'b.md',
      status: 'modified',
      mountedSha256: sha('bbb'),
      source: 'corpus:42',
      settledSha256: sha('bbb-edited-by-agent'),
      settledBytes: Buffer.byteLength('bbb-edited-by-agent'),
    })
  })

  it('reports a missing surface as removed and a failed read as unreadable with its error', async () => {
    const read: SurfaceReader = (path) => {
      if (path === 'gone.md')
        return Promise.resolve({ succeeded: false, missing: true, error: 'ENOENT' })
      return Promise.resolve({ succeeded: false, missing: false, error: 'EACCES: denied' })
    }
    const diffs = await harvestSurfaceDiffs({
      mounts: [mount('gone.md', 'x'), mount('locked.md', 'y')],
      read,
    })
    expect(diffs).toEqual([
      { path: 'gone.md', status: 'removed', mountedSha256: sha('x'), source: 'test' },
      {
        path: 'locked.md',
        status: 'unreadable',
        mountedSha256: sha('y'),
        source: 'test',
        error: 'EACCES: denied',
      },
    ])
  })

  it('collapses duplicate paths to the last mount — the bytes the agent actually saw', async () => {
    const diffs = await harvestSurfaceDiffs({
      mounts: [mount('a.md', 'first'), mount('a.md', 'second')],
      read: readerOf({ 'a.md': 'second' }),
    })
    expect(diffs).toEqual([])
  })

  it('treats an uppercase manifest hash as equal to the settled lowercase hash', async () => {
    const entry = { ...mount('a.md', 'same'), sha256: sha('same').toUpperCase() }
    const diffs = await harvestSurfaceDiffs({
      mounts: [entry],
      read: readerOf({ 'a.md': 'same' }),
    })
    expect(diffs).toEqual([])
  })
})

describe('fsSurfaceReader', () => {
  const root = mkdtempSync(join(tmpdir(), 'surface-diff-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('reads relative paths against the root and maps absence to missing', async () => {
    writeFileSync(join(root, 'notes.md'), 'hello')
    const read = fsSurfaceReader(root)
    const hit = await read('notes.md')
    expect(hit.succeeded).toBe(true)
    if (hit.succeeded) expect(new TextDecoder().decode(hit.value)).toBe('hello')
    const miss = await read('absent.md')
    expect(miss).toMatchObject({ succeeded: false, missing: true })
  })

  it('composes with the harvest over a real worktree edit', async () => {
    writeFileSync(join(root, 'skill.md'), 'v1')
    const mounts = [mount('skill.md', 'v1')]
    writeFileSync(join(root, 'skill.md'), 'v2')
    const diffs = await harvestSurfaceDiffs({ mounts, read: fsSurfaceReader(root) })
    expect(diffs).toMatchObject([
      { path: 'skill.md', status: 'modified', settledSha256: sha('v2') },
    ])
  })
})
