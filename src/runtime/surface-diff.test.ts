import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  boxSurfaceReader,
  fsSurfaceReader,
  harvestSurfaceDiffs,
  type SurfaceReader,
} from './surface-diff'
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

  it('reports a watched never-mounted path that now exists as created, and stays silent while absent', async () => {
    const diffs = await harvestSurfaceDiffs({
      mounts: [mount('CLAUDE.md', 'base')],
      read: readerOf({ 'CLAUDE.md': 'base', 'memory/new-lesson.md': 'learned it' }),
      watch: [
        { path: 'memory/new-lesson.md', source: 'harness-state' },
        { path: 'memory/still-absent.md' },
      ],
    })
    expect(diffs).toEqual([
      {
        path: 'memory/new-lesson.md',
        status: 'created',
        source: 'harness-state',
        settledSha256: sha('learned it'),
        settledBytes: Buffer.byteLength('learned it'),
      },
    ])
  })

  it('compares a watched path that was ALSO mounted against its mount, not as created', async () => {
    const diffs = await harvestSurfaceDiffs({
      mounts: [mount('a.md', 'v1')],
      read: readerOf({ 'a.md': 'v2' }),
      watch: [{ path: 'a.md' }],
    })
    expect(diffs.map((d) => d.status)).toEqual(['modified'])
  })

  it("treats a './'-prefixed mount and a bare watched path as one surface, and dedupes duplicate watches", async () => {
    const diffs = await harvestSurfaceDiffs({
      mounts: [mount('./AGENTS.md', 'given')],
      read: readerOf({ './AGENTS.md': 'given', 'memory/x.md': 'note' }),
      watch: [
        { path: 'AGENTS.md' },
        { path: 'memory/x.md' },
        { path: 'memory/x.md', source: 'tree' },
      ],
    })
    expect(diffs).toEqual([
      {
        path: 'memory/x.md',
        status: 'created',
        source: 'tree',
        settledSha256: sha('note'),
        settledBytes: Buffer.byteLength('note'),
      },
    ])
  })

  it('contains a reader that throws: the bad path reports unreadable, every other diff survives', async () => {
    const read: SurfaceReader = (path) => {
      if (path === 'boom.md') throw new Error('reader contract violation')
      return Promise.resolve({ succeeded: true, value: new TextEncoder().encode('v2') })
    }
    const diffs = await harvestSurfaceDiffs({
      mounts: [mount('boom.md', 'x'), mount('a.md', 'v1')],
      read,
    })
    expect(diffs.map((d) => [d.path, d.status])).toEqual([
      ['boom.md', 'unreadable'],
      ['a.md', 'modified'],
    ])
    expect(diffs[0]?.error).toBe('reader contract violation')
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

describe('boxSurfaceReader', () => {
  it('reads through box.fs.read, maps the SDK NotFoundError to missing, and reports other errors', async () => {
    const notFound = new Error('no such file')
    notFound.name = 'NotFoundError'
    const box = {
      fs: {
        read: (path: string) => {
          if (path === 'AGENTS.md') return Promise.resolve('edited')
          if (path === 'gone.md') return Promise.reject(notFound)
          return Promise.reject(new Error('transport down'))
        },
      },
    }
    const read = boxSurfaceReader(box, { retryDelayMs: 0 })
    const hit = await read('AGENTS.md')
    expect(hit.succeeded).toBe(true)
    if (hit.succeeded) expect(new TextDecoder().decode(hit.value)).toBe('edited')
    expect(await read('gone.md')).toEqual({
      succeeded: false,
      missing: true,
      error: 'no such file',
    })
    expect(await read('other.md')).toEqual({
      succeeded: false,
      missing: false,
      error: 'transport down',
    })
  })

  it('retries a transient first-attempt 404 instead of reporting a fresh write as missing', async () => {
    const blip = new Error('not flushed yet')
    blip.name = 'NotFoundError'
    let calls = 0
    const box = {
      fs: {
        read: () => {
          calls += 1
          return calls < 3 ? Promise.reject(blip) : Promise.resolve('finally visible')
        },
      },
    }
    const outcome = await boxSurfaceReader(box, { retryDelayMs: 0 })('memory/new.md')
    expect(calls).toBe(3)
    expect(outcome.succeeded).toBe(true)
  })

  it('does not report a still-flushing mounted file as removed when the first read 404s', async () => {
    const blip = new Error('not flushed yet')
    blip.name = 'NotFoundError'
    let calls = 0
    const box = {
      fs: {
        read: () => {
          calls += 1
          return calls === 1 ? Promise.reject(blip) : Promise.resolve('edited by the agent')
        },
      },
    }
    const diffs = await harvestSurfaceDiffs({
      mounts: [mount('CLAUDE.md', 'original')],
      read: boxSurfaceReader(box, { retryDelayMs: 0 }),
    })
    expect(diffs.map((d) => d.status)).not.toContain('removed')
    expect(diffs).toEqual([
      {
        path: 'CLAUDE.md',
        status: 'modified',
        mountedSha256: sha('original'),
        source: 'test',
        settledSha256: sha('edited by the agent'),
        settledBytes: Buffer.byteLength('edited by the agent'),
      },
    ])
  })

  it("treats the SDK's default 'Resource' resourceType as a missing FILE, so a deletion reports removed", async () => {
    // The SDK's HTTP mapper builds `new NotFoundError(data.resourceType || 'Resource', ...)`, so a
    // file 404 carries 'Resource' whenever the server does not name the type.
    const deleted = Object.assign(new Error('not found'), {
      name: 'NotFoundError',
      resourceType: 'Resource',
      resourceId: 'unknown',
    })
    const box = { fs: { read: () => Promise.reject(deleted) } }
    expect(await boxSurfaceReader(box, { attempts: 1 })('CLAUDE.md')).toEqual({
      succeeded: false,
      missing: true,
      error: 'not found',
    })
    const diffs = await harvestSurfaceDiffs({
      mounts: [mount('CLAUDE.md', 'original')],
      read: boxSurfaceReader(box, { attempts: 1 }),
    })
    expect(diffs.map((d) => d.status)).toEqual(['removed'])
  })

  it('stops retrying once the signal aborts instead of spending the remaining attempts', async () => {
    const controller = new AbortController()
    let calls = 0
    const box = {
      fs: {
        read: () => {
          calls += 1
          controller.abort()
          return Promise.reject(new Error('transport down'))
        },
      },
    }
    const outcome = await boxSurfaceReader(box, {
      attempts: 5,
      retryDelayMs: 0,
      signal: controller.signal,
    })('CLAUDE.md')
    expect(calls).toBe(1)
    expect(outcome).toEqual({ succeeded: false, missing: false, error: 'transport down' })
  })

  it('reports a box-level NotFoundError (resourceType names the sandbox) as unreadable, never missing', async () => {
    const boxGone = Object.assign(new Error('sandbox sb-1 not found'), {
      name: 'NotFoundError',
      resourceType: 'Sandbox',
      resourceId: 'sb-1',
    })
    const box = { fs: { read: () => Promise.reject(boxGone) } }
    expect(await boxSurfaceReader(box, { attempts: 1 })('CLAUDE.md')).toEqual({
      succeeded: false,
      missing: false,
      error: 'sandbox sb-1 not found',
    })
  })

  it('refuses to hash content the text wire lossy-decoded instead of reporting a false modification', async () => {
    const box = { fs: { read: () => Promise.resolve('binary�garbage') } }
    const outcome = await boxSurfaceReader(box, { attempts: 1 })('memory/store.db')
    expect(outcome).toMatchObject({ succeeded: false, missing: false })
    if (!outcome.succeeded) expect(outcome.error).toContain('not valid UTF-8')
  })

  it('composes with the harvest over a box double: modified mount + created watch', async () => {
    const box = {
      fs: {
        read: (path: string) => {
          if (path === 'CLAUDE.md') return Promise.resolve('rewritten')
          if (path === 'memory/lesson.md') return Promise.resolve('new note')
          const err = new Error('missing')
          err.name = 'NotFoundError'
          return Promise.reject(err)
        },
      },
    }
    const diffs = await harvestSurfaceDiffs({
      mounts: [mount('CLAUDE.md', 'original')],
      read: boxSurfaceReader(box),
      watch: [{ path: 'memory/lesson.md' }, { path: 'memory/other.md' }],
    })
    expect(diffs.map((d) => [d.path, d.status])).toEqual([
      ['CLAUDE.md', 'modified'],
      ['memory/lesson.md', 'created'],
    ])
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

  it('contains paths inside the root: ../ escapes and outside absolute paths fail without reading', async () => {
    const read = fsSurfaceReader(root)
    const escaped = await read('../outside.md')
    expect(escaped).toMatchObject({ succeeded: false, missing: false })
    if (!escaped.succeeded) expect(escaped.error).toContain('outside the reader root')
    const absolute = await read('/etc/hostname')
    expect(absolute).toMatchObject({ succeeded: false, missing: false })
    const insideAbsolute = await read(join(root, 'notes.md'))
    expect(insideAbsolute.succeeded).toBe(true)
  })

  it('refuses a symlink planted inside the root that points at a host file', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'surface-diff-outside-'))
    const secret = join(outside, 'host-secret.txt')
    writeFileSync(secret, 'host bytes')
    symlinkSync(secret, join(root, 'looks-contained.md'))
    const read = fsSurfaceReader(root)
    const outcome = await read('looks-contained.md')
    expect(outcome).toMatchObject({ succeeded: false, missing: false })
    if (!outcome.succeeded) expect(outcome.error).toContain('outside the reader root')
    rmSync(outside, { recursive: true, force: true })
  })

  it('still reads a file reached through a symlinked root', async () => {
    const realRoot = mkdtempSync(join(tmpdir(), 'surface-diff-real-'))
    const linkedRoot = join(mkdtempSync(join(tmpdir(), 'surface-diff-link-')), 'root-link')
    writeFileSync(join(realRoot, 'inside.md'), 'contained')
    symlinkSync(realRoot, linkedRoot)
    const outcome = await fsSurfaceReader(linkedRoot)('inside.md')
    expect(outcome.succeeded).toBe(true)
    if (outcome.succeeded) expect(new TextDecoder().decode(outcome.value)).toBe('contained')
    rmSync(realRoot, { recursive: true, force: true })
  })

  it('reports a vanished worktree root as unreadable, never as every mount removed', async () => {
    const doomed = mkdtempSync(join(tmpdir(), 'surface-diff-doomed-'))
    writeFileSync(join(doomed, 'a.md'), 'v1')
    const read = fsSurfaceReader(doomed)
    rmSync(doomed, { recursive: true, force: true })
    const diffs = await harvestSurfaceDiffs({
      mounts: [mount('a.md', 'v1'), mount('b.md', 'v1')],
      read,
    })
    expect(diffs.map((d) => d.status)).toEqual(['unreadable', 'unreadable'])
    expect(diffs[0]?.error).toContain('reader root')
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
