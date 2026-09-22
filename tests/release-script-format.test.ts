import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const checkScript = join(repoRoot, 'scripts/check-release-script-format.mjs')
const releaseScripts = [
  'scripts/verify-packed-cohort.mjs',
  'scripts/lib/packed-cohort-archive.mjs',
  'scripts/lib/packed-cohort-build.mjs',
  'scripts/lib/packed-cohort-metadata.mjs',
  'scripts/lib/packed-cohort-process.mjs',
]

describe('packed-cohort release-script format check', () => {
  const temporaryRoots: string[] = []

  afterEach(() => {
    for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true })
    temporaryRoots.length = 0
  })

  it('checks all five files and rejects formatting and import-order mutations', () => {
    const root = copyReleaseScriptFixture()
    expect(runCheck(root).status).toBe(0)

    const formattingTarget = join(root, releaseScripts[1]!)
    const originalArchive = readFileSync(formattingTarget, 'utf8')
    writeFileSync(formattingTarget, originalArchive.replace(/\n$/, ''))
    expect(runCheck(root).status).not.toBe(0)
    writeFileSync(formattingTarget, originalArchive)

    const importTarget = join(root, releaseScripts[0]!)
    const originalVerifier = readFileSync(importTarget, 'utf8')
    const buildImport = "import { buildAndPack } from './lib/packed-cohort-build.mjs'\n"
    const archiveImport = originalVerifier.match(
      /import \{\n {2}archiveFileSpec,[\s\S]*?\n\} from '\.\/lib\/packed-cohort-archive\.mjs'\n/,
    )?.[0]
    expect(archiveImport).toBeDefined()
    const malformedVerifier = originalVerifier.replace(
      `${archiveImport}${buildImport}`,
      `${buildImport}${archiveImport}`,
    )
    expect(malformedVerifier).not.toBe(originalVerifier)
    writeFileSync(importTarget, malformedVerifier)
    expect(runCheck(root).status).not.toBe(0)
    writeFileSync(importTarget, originalVerifier)

    expect(runCheck(root).status).toBe(0)
  })

  function copyReleaseScriptFixture(): string {
    const root = mkdtempSync(join(tmpdir(), 'agent-runtime-release-format-'))
    temporaryRoots.push(root)
    cpSync(join(repoRoot, 'biome.json'), join(root, 'biome.json'))
    for (const relativePath of releaseScripts) {
      const destination = join(root, relativePath)
      mkdirSync(dirname(destination), { recursive: true })
      cpSync(join(repoRoot, relativePath), destination)
    }
    return root
  }

  function runCheck(root: string): { status: number | null; output: string } {
    const result = spawnSync(process.execPath, [checkScript, '--root', root], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
    return {
      status: result.status,
      output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    }
  }
})
