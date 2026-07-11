import assert from 'node:assert/strict'
import { chmod, lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  createPierWorkspaceArchive,
  materializePierWorkspaceArchive,
} from './pier-workspace-archive'

test('Pier workspace archive round-trips exact bytes, paths, and modes', async () => {
  const encoded = createPierWorkspaceArchive([
    { path: 'src/run.sh', mode: 0o755, bytes: Buffer.from('#!/bin/sh\n') },
    { path: 'README.md', mode: 0o644, bytes: Buffer.from('fixture\n') },
  ])
  const root = await mkdtemp(join(tmpdir(), 'pier-archive-test-'))
  const destination = join(root, 'workspace')
  try {
    await materializePierWorkspaceArchive({ ...encoded, expected: encoded.manifest, destination })
    assert.equal(await readFile(join(destination, 'README.md'), 'utf8'), 'fixture\n')
    assert.equal((await lstat(join(destination, 'src/run.sh'))).mode & 0o777, 0o755)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Pier workspace archive rejects unsafe, noncanonical, and nonempty materialization', async () => {
  assert.throws(
    () => createPierWorkspaceArchive([{ path: '../escape', mode: 0o644, bytes: Buffer.alloc(0) }]),
    /unsafe/,
  )
  const encoded = createPierWorkspaceArchive([
    { path: 'source.ts', mode: 0o644, bytes: Buffer.from('export {}\n') },
  ])
  const root = await mkdtemp(join(tmpdir(), 'pier-archive-test-'))
  const destination = join(root, 'workspace')
  try {
    await writeFile(join(root, 'tampered.json'), Buffer.from(encoded.archive))
    const noncanonical = Buffer.from(`${Buffer.from(encoded.archive).toString('utf8')}\n`)
    await assert.rejects(
      materializePierWorkspaceArchive({
        archive: noncanonical,
        expected: encoded.manifest,
        destination,
      }),
      /not canonical/,
    )
    await materializePierWorkspaceArchive({ ...encoded, expected: encoded.manifest, destination })
    await chmod(join(destination, 'source.ts'), 0o644)
    await assert.rejects(
      materializePierWorkspaceArchive({ ...encoded, expected: encoded.manifest, destination }),
      /must be empty/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
