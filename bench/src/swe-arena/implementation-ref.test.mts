import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  fileTreeImplementationRef,
  pythonDistributionImplementationRef,
} from './implementation-ref.ts'

describe('implementation refs', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('is stable across creation order and changes with file content or symlink targets', async () => {
    const first = await mkdtemp(join(tmpdir(), 'implementation-ref-a-'))
    const second = await mkdtemp(join(tmpdir(), 'implementation-ref-b-'))
    roots.push(first, second)
    await mkdir(join(first, 'nested'))
    await writeFile(join(first, 'nested', 'b.ts'), 'export const b = 2\n')
    await writeFile(join(first, 'a.ts'), 'export const a = 1\n')
    await symlink('a.ts', join(first, 'entry.ts'))
    await writeFile(join(second, 'a.ts'), 'export const a = 1\n')
    await symlink('a.ts', join(second, 'entry.ts'))
    await mkdir(join(second, 'nested'))
    await writeFile(join(second, 'nested', 'b.ts'), 'export const b = 2\n')

    const initial = await fileTreeImplementationRef(first)
    expect(await fileTreeImplementationRef(second)).toBe(initial)

    await writeFile(join(second, 'nested', 'b.ts'), 'export const b = 3\n')
    expect(await fileTreeImplementationRef(second)).not.toBe(initial)
    await writeFile(join(second, 'nested', 'b.ts'), 'export const b = 2\n')
    await rm(join(second, 'entry.ts'))
    await symlink('nested/b.ts', join(second, 'entry.ts'))
    expect(await fileTreeImplementationRef(second)).not.toBe(initial)
  })

  it('binds a Python distribution to its complete manifest', async () => {
    const runPython = async (_script: string, args: string[]): Promise<string> =>
      `import warning\n${JSON.stringify({
        distribution: args[0],
        version: '1.0.0',
        python: '3.12.4',
        files: [{ path: '__init__.py', sha256: 'a'.repeat(64) }],
      })}`
    const original = await pythonDistributionImplementationRef('swebench', runPython)
    const changed = await pythonDistributionImplementationRef(
      'swebench',
      async (_script, args) =>
        JSON.stringify({
          distribution: args[0],
          version: '1.0.1',
          python: '3.12.4',
          files: [{ path: '__init__.py', sha256: 'b'.repeat(64) }],
        }),
    )

    expect(original).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(changed).not.toBe(original)
  })
})
