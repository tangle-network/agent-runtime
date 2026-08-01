import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const roots: string[] = []

/**
 * A throwaway repository with the two shapes that matter: a root manifest whose
 * peer ranges a consumer resolves against, and a workspace package that reaches
 * its dependency versions through a `catalog:` pin.
 */
async function createRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'agent-runtime-version-bump-'))
  roots.push(root)
  await git(root, 'init', '--quiet', '--initial-branch=main')
  await mkdir(join(root, 'bench'))
  await writeManifests(root, {
    version: '1.0.0',
    evalPeer: '>=0.140.1 <0.141.0',
    knowledgeCatalog: '7.0.4',
    benchVersion: '0.4.9',
  })
  await writeFile(join(root, 'source.ts'), 'export const value = 1\n')
  await commit(root, 'base')
  return root
}

async function writeManifests(
  root: string,
  spec: { version: string; evalPeer: string; knowledgeCatalog: string; benchVersion: string },
): Promise<void> {
  await writeFile(
    join(root, 'package.json'),
    `${JSON.stringify(
      {
        name: '@tangle-network/agent-runtime',
        version: spec.version,
        exports: { '.': './dist/index.js' },
        files: ['dist', 'README.md'],
        dependencies: { '@tangle-network/agent-knowledge': 'catalog:' },
        peerDependencies: { '@tangle-network/agent-eval': spec.evalPeer },
        devDependencies: { vitest: '^4.1.10' },
        scripts: { build: 'tsdown' },
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    join(root, 'bench', 'package.json'),
    `${JSON.stringify(
      {
        name: '@tangle-network/agent-bench',
        version: spec.benchVersion,
        dependencies: { '@tangle-network/agent-knowledge': 'catalog:' },
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    join(root, 'pnpm-workspace.yaml'),
    [
      'packages:',
      '  - bench',
      '',
      'catalog:',
      `  '@tangle-network/agent-knowledge': ${spec.knowledgeCatalog}`,
      '',
    ].join('\n'),
  )
}

async function git(root: string, ...args: string[]): Promise<string> {
  // -c core.hooksPath keeps a developer's global hooks out of the fixture; the
  // fixture identity is local so it never depends on machine git config.
  const { stdout } = await execFileAsync(
    'git',
    ['-C', root, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args],
    { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } },
  )
  return stdout
}

async function commit(root: string, message: string): Promise<string> {
  await git(root, 'add', '-A')
  await git(
    root,
    '-c',
    'user.email=t@t.dev',
    '-c',
    'user.name=T',
    'commit',
    '--quiet',
    '-m',
    message,
  )
  return (await git(root, 'rev-parse', 'HEAD')).trim()
}

async function check(root: string, base: string) {
  return execFileAsync(process.execPath, ['scripts/check-version-bump.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AGENT_RUNTIME_VERSION_BUMP_ROOT: root,
      AGENT_RUNTIME_VERSION_BUMP_BASE: base,
    },
  })
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('consumer-visible change requires a version bump', () => {
  it('rejects a peer range move that keeps the same version', async () => {
    const root = await createRepo()
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()
    await writeManifests(root, {
      version: '1.0.0',
      evalPeer: '>=0.141.0 <0.142.0',
      knowledgeCatalog: '7.0.4',
      benchVersion: '0.4.9',
    })
    await commit(root, 'move the peer range')

    await expect(check(root, base)).rejects.toMatchObject({
      stderr: expect.stringContaining(
        'peerDependencies.@tangle-network/agent-eval: ">=0.140.1 <0.141.0" -> ">=0.141.0 <0.142.0"',
      ),
    })
  })

  it('accepts the same move once the version pays for it', async () => {
    const root = await createRepo()
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()
    await writeManifests(root, {
      version: '1.1.0',
      evalPeer: '>=0.141.0 <0.142.0',
      knowledgeCatalog: '7.0.4',
      benchVersion: '0.4.9',
    })
    await commit(root, 'move the peer range and bump')

    await expect(check(root, base)).resolves.toMatchObject({
      stdout: expect.stringContaining('paid for by 1.0.0 -> 1.1.0'),
    })
  })

  it('rejects a catalog pin move even though every manifest is byte-identical', async () => {
    const root = await createRepo()
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()
    await writeManifests(root, {
      version: '1.0.0',
      evalPeer: '>=0.140.1 <0.141.0',
      knowledgeCatalog: '7.0.5',
      benchVersion: '0.4.9',
    })
    await commit(root, 'move only the catalog pin')

    // This is the shape that shipped 0.119.0 twice: the specifier string never
    // changes, so a manifest diff shows nothing while the resolved version moves.
    expect((await git(root, 'diff', base, 'HEAD', '--', 'package.json')).trim()).toBe('')
    const failure = await check(root, base).catch((error) => error)
    expect(failure.stderr).toContain(
      'dependencies.@tangle-network/agent-knowledge: "7.0.4" -> "7.0.5"',
    )
    // Every publishable package that resolves through the pin, not just the root.
    expect(failure.stderr).toContain('bench/package.json (@tangle-network/agent-bench)')
  })

  it('does not fire on an ordinary source-only change', async () => {
    const root = await createRepo()
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()
    await writeFile(join(root, 'source.ts'), 'export const value = 2\n')
    await commit(root, 'edit source')

    await expect(check(root, base)).resolves.toMatchObject({
      stdout: expect.stringContaining('consumer surface unchanged at 1.0.0'),
    })
  })

  it('does not fire on a devDependency or script change', async () => {
    const root = await createRepo()
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()
    const manifest = JSON.parse(await git(root, 'show', 'HEAD:package.json').then((raw) => raw))
    manifest.devDependencies.vitest = '^4.2.0'
    manifest.scripts.lint = 'biome check src'
    await writeFile(join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    await commit(root, 'bump a devDependency and add a script')

    await expect(check(root, base)).resolves.toMatchObject({
      stdout: expect.stringContaining('consumer surface unchanged at 1.0.0'),
    })
  })

  it('fails closed when a catalog specifier resolves to nothing', async () => {
    const root = await createRepo()
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()
    await writeFile(
      join(root, 'pnpm-workspace.yaml'),
      ['packages:', '  - bench', '', 'catalog: {}', ''].join('\n'),
    )
    await commit(root, 'drop the catalog entry the dependency points at')

    await expect(check(root, base)).rejects.toMatchObject({
      stderr: expect.stringContaining('has no catalog entry for it'),
    })
  })

  it('fails closed when the named base cannot be resolved', async () => {
    const root = await createRepo()

    await expect(check(root, '0000000000000000000000000000000000000000')).rejects.toMatchObject({
      stderr: expect.stringContaining('cannot resolve the requested base commit'),
    })
  })

  it('fails closed on a CI event that should have had a base branch', async () => {
    const root = await createRepo()
    await writeFile(join(root, 'source.ts'), 'export const value = 2\n')
    await commit(root, 'edit source')

    await expect(
      execFileAsync(process.execPath, ['scripts/check-version-bump.mjs'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          AGENT_RUNTIME_VERSION_BUMP_ROOT: root,
          AGENT_RUNTIME_VERSION_BUMP_BASE: '',
          GITHUB_BASE_REF: '',
          GITHUB_ACTIONS: 'true',
          GITHUB_EVENT_NAME: 'merge_group',
        },
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('with no base branch to compare against'),
    })
  })

  it('rejects a downgrade, which lands on a version the registry may already hold', async () => {
    const root = await createRepo()
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()
    await writeManifests(root, {
      version: '0.9.0',
      evalPeer: '>=0.141.0 <0.142.0',
      knowledgeCatalog: '7.0.4',
      benchVersion: '0.4.9',
    })
    await commit(root, 'move the peer range and lower the version')

    await expect(check(root, base)).rejects.toMatchObject({
      stderr: expect.stringContaining('moves 1.0.0 -> 0.9.0, which is not higher'),
    })
  })

  it('rejects an install-lifecycle script that would run on a consumer machine', async () => {
    const root = await createRepo()
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()
    const manifest = JSON.parse(await git(root, 'show', 'HEAD:package.json'))
    manifest.scripts.postinstall = 'node ./dist/postinstall.js'
    await writeFile(join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    await commit(root, 'add a postinstall script')

    await expect(check(root, base)).rejects.toMatchObject({
      stderr: expect.stringContaining('installScripts'),
    })
  })

  it('rejects a typesVersions change', async () => {
    const root = await createRepo()
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()
    const manifest = JSON.parse(await git(root, 'show', 'HEAD:package.json'))
    manifest.typesVersions = { '*': { '*': ['dist/*'] } }
    await writeFile(join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    await commit(root, 'add typesVersions')

    await expect(check(root, base)).rejects.toMatchObject({
      stderr: expect.stringContaining('typesVersions'),
    })
  })

  it('compares a moved package against the name it already published, not a new path', async () => {
    const root = await createRepo()
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()
    await mkdir(join(root, 'packages', 'bench'), { recursive: true })
    const manifest = JSON.parse(await git(root, 'show', 'HEAD:bench/package.json'))
    manifest.peerDependencies = { '@tangle-network/agent-eval': '>=0.141.0 <0.142.0' }
    await writeFile(
      join(root, 'packages', 'bench', 'package.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    )
    await rm(join(root, 'bench'), { recursive: true })
    await writeFile(
      join(root, 'pnpm-workspace.yaml'),
      [
        'packages:',
        '  - packages/*',
        '',
        'catalog:',
        "  '@tangle-network/agent-knowledge': 7.0.4",
        '',
      ].join('\n'),
    )
    await commit(root, 'move bench and change its peers')

    // Relocating a directory must not buy a free pass on an already-published name.
    await expect(check(root, base)).rejects.toMatchObject({
      stderr: expect.stringContaining('@tangle-network/agent-bench'),
    })
  })

  it('rejects marking a published package private without a version bump', async () => {
    const root = await createRepo()
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()
    const manifest = JSON.parse(await git(root, 'show', 'HEAD:bench/package.json'))
    manifest.private = true
    await writeFile(join(root, 'bench', 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    await commit(root, 'mark bench private')

    await expect(check(root, base)).rejects.toMatchObject({
      stderr: expect.stringContaining('private'),
    })
  })

  it('does not fire when a dependency moves between a catalog and an identical literal pin', async () => {
    const root = await createRepo()
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()
    const manifest = JSON.parse(await git(root, 'show', 'HEAD:package.json'))
    manifest.dependencies['@tangle-network/agent-knowledge'] = '7.0.4'
    await writeFile(join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    await commit(root, 'inline the catalog pin at the same version')

    // The tarball is byte-identical; only the authoring style moved.
    await expect(check(root, base)).resolves.toMatchObject({
      stdout: expect.stringContaining('consumer surface unchanged'),
    })
  })

  it('does not fire when files is reordered', async () => {
    const root = await createRepo()
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()
    const manifest = JSON.parse(await git(root, 'show', 'HEAD:package.json'))
    manifest.files = ['README.md', 'dist']
    await writeFile(join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    await commit(root, 'reorder files')

    await expect(check(root, base)).resolves.toMatchObject({
      stdout: expect.stringContaining('consumer surface unchanged'),
    })
  })

  it('does not police a directory the workspace excludes', async () => {
    const root = await createRepo()
    await writeFile(
      join(root, 'pnpm-workspace.yaml'),
      [
        'packages:',
        '  - bench',
        '  - fixtures/*',
        '  - "!fixtures/scratch"',
        '',
        'catalog:',
        "  '@tangle-network/agent-knowledge': 7.0.4",
        '',
      ].join('\n'),
    )
    await mkdir(join(root, 'fixtures', 'scratch'), { recursive: true })
    await writeFile(
      join(root, 'fixtures', 'scratch', 'package.json'),
      `${JSON.stringify({ name: 'scratch-fixture', version: '1.0.0', files: ['a'] }, null, 2)}\n`,
    )
    await commit(root, 'add an excluded fixture package')
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()

    await writeFile(
      join(root, 'fixtures', 'scratch', 'package.json'),
      `${JSON.stringify({ name: 'scratch-fixture', version: '1.0.0', files: ['a', 'b'] }, null, 2)}\n`,
    )
    await commit(root, 'edit the excluded fixture')

    await expect(check(root, base)).resolves.toMatchObject({
      stdout: expect.stringContaining('consumer surface unchanged at 1.0.0'),
    })
  })

  it('reaches a package nested deeper than one level under a ** pattern', async () => {
    const root = await createRepo()
    await writeFile(
      join(root, 'pnpm-workspace.yaml'),
      [
        'packages:',
        '  - bench',
        '  - packages/**',
        '',
        'catalog:',
        "  '@tangle-network/agent-knowledge': 7.0.4",
        '',
      ].join('\n'),
    )
    await mkdir(join(root, 'packages', 'group', 'nested'), { recursive: true })
    await writeFile(
      join(root, 'packages', 'group', 'nested', 'package.json'),
      `${JSON.stringify(
        { name: '@tangle-network/nested', version: '1.0.0', peerDependencies: { react: '>=18' } },
        null,
        2,
      )}\n`,
    )
    await commit(root, 'add a nested workspace package')
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()

    await writeFile(
      join(root, 'packages', 'group', 'nested', 'package.json'),
      `${JSON.stringify(
        { name: '@tangle-network/nested', version: '1.0.0', peerDependencies: { react: '>=19' } },
        null,
        2,
      )}\n`,
    )
    await commit(root, 'move the nested package peer range')

    await expect(check(root, base)).rejects.toMatchObject({
      stderr: expect.stringContaining('@tangle-network/nested'),
    })
  })

  it('survives a workspace file that does not exist', async () => {
    const root = await createRepo()
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()
    const manifest = JSON.parse(await git(root, 'show', 'HEAD:package.json'))
    // The catalog is gone, so nothing may resolve through it any more.
    manifest.dependencies['@tangle-network/agent-knowledge'] = '7.0.4'
    await writeFile(join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    await rm(join(root, 'pnpm-workspace.yaml'))
    await rm(join(root, 'bench'), { recursive: true })
    await commit(root, 'drop the workspace file')

    await expect(check(root, base)).resolves.toMatchObject({
      stdout: expect.stringContaining('consumer surface unchanged'),
    })
  })
})
