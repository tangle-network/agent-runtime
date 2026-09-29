import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createPrivateCasArtifactPort } from './private-cas'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

it('publishes and reopens hashed private bytes under one run identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'private-cas-'))
  roots.push(root)
  const port = createPrivateCasArtifactPort(join(root, 'evidence'), 'run-1')
  const bytes = Buffer.from('exact workspace bytes')
  const ref = await port.put({
    executionId: 'node-1',
    purpose: 'candidate-workspace-archive',
    bytes,
  })
  expect(ref.locator).toMatchObject({ kind: 'private-cas', namespace: 'run-1', digest: ref.sha256 })
  expect(Buffer.from(await port.read(ref)).equals(bytes)).toBe(true)
  await expect(
    createPrivateCasArtifactPort(join(root, 'evidence'), 'run-2').read(ref),
  ).rejects.toThrow('namespace')
  const hash = ref.sha256.slice(7)
  const path = join(root, 'evidence', 'sha256', hash.slice(0, 2), hash)
  expect((await readFile(path)).equals(bytes)).toBe(true)
  await writeFile(path, 'altered')
  await expect(port.read(ref)).rejects.toThrow('digest or length')
})

it('refuses a symlink in the private artifact path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'private-cas-'))
  roots.push(root)
  await mkdir(join(root, 'actual'))
  await symlink(join(root, 'actual'), join(root, 'evidence'))
  const port = createPrivateCasArtifactPort(join(root, 'evidence'), 'run-1')
  await expect(
    port.put({ executionId: 'node-1', purpose: 'trace', bytes: Buffer.from('trace') }),
  ).rejects.toThrow('real directory')
})
