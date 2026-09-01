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
  await writeSurface(root, '.', '@tangle-network/agent-runtime', {
    '.': { runAgent: 'value', AgentSpec: 'type' },
  })
  await writeSurface(root, 'bench', '@tangle-network/agent-bench', { '.': { runBench: 'value' } })
  await commit(root, 'base')
  return root
}

/**
 * An export surface record for a fixture package. Every publishable manifest
 * must carry one, so the fixture writes one wherever it writes a manifest.
 */
async function writeSurface(
  root: string,
  directory: string,
  name: string,
  entries: Record<string, Record<string, string>>,
): Promise<void> {
  await writeFile(
    join(root, directory, 'api-surface.json'),
    `${JSON.stringify({ package: name, entries, assets: [] }, null, 2)}\n`,
  )
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
      PACKAGE_VERSION_BUMP_ROOT: root,
      PACKAGE_VERSION_BUMP_BASE: base,
      // Hermetic: a fixture with no release tag would otherwise fall back to the
      // real registry, where these package names ARE published, and every
      // fixture version would be measured against a stranger's release.
      PACKAGE_VERSION_BUMP_REGISTRY: '0',
    },
  })
}

/** Mark a fixture commit as released, the way `publish.yml` marks a real one. */
async function tag(root: string, name: string): Promise<void> {
  await git(root, 'tag', name)
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
          PACKAGE_VERSION_BUMP_ROOT: root,
          PACKAGE_VERSION_BUMP_BASE: '',
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
    await writeSurface(root, join('packages', 'bench'), '@tangle-network/agent-bench', {
      '.': { runBench: 'value' },
    })
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
    const failure = await check(root, base).catch((error) => error)
    expect(failure.stderr).toContain('@tangle-network/agent-bench')
    expect(failure.stderr).toContain(
      'peerDependencies: (absent) -> {"@tangle-network/agent-eval":">=0.141.0 <0.142.0"}',
    )
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
    await writeSurface(root, join('packages', 'group', 'nested'), '@tangle-network/nested', {
      '.': { nested: 'value' },
    })
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

    const failure = await check(root, base).catch((error) => error)
    expect(failure.stderr).toContain('@tangle-network/nested')
    expect(failure.stderr).toContain('peerDependencies.react: ">=18" -> ">=19"')
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

describe('a change to the exported symbols requires a version bump', () => {
  it('rejects an added export while every manifest field stays identical', async () => {
    const root = await createRepo()
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()
    await writeSurface(root, '.', '@tangle-network/agent-runtime', {
      '.': { runAgent: 'value', AgentSpec: 'type', PursuitProjection: 'type' },
    })
    await commit(root, 'add an export')

    // The shape that shipped PursuitProjection into no published version: the
    // manifest never moves, so the manifest comparison sees nothing at all.
    expect((await git(root, 'diff', base, 'HEAD', '--', 'package.json')).trim()).toBe('')
    const failure = await check(root, base).catch((error) => error)
    expect(failure.stderr).toContain('export added: . PursuitProjection')
    expect(failure.stderr).toContain('additive change needing a minor bump')
  })

  it('accepts the added export once a minor pays for it', async () => {
    const root = await createRepo()
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()
    await writeManifests(root, {
      version: '1.1.0',
      evalPeer: '>=0.140.1 <0.141.0',
      knowledgeCatalog: '7.0.4',
      benchVersion: '0.4.9',
    })
    await writeSurface(root, '.', '@tangle-network/agent-runtime', {
      '.': { runAgent: 'value', AgentSpec: 'type', PursuitProjection: 'type' },
    })
    await commit(root, 'add an export and bump the minor')

    await expect(check(root, base)).resolves.toMatchObject({
      stdout: expect.stringContaining('1.0.0 -> 1.1.0 (minor)'),
    })
  })

  it('rejects a patch for an added export on a 1.x package', async () => {
    const root = await createRepo()
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()
    await writeManifests(root, {
      version: '1.0.1',
      evalPeer: '>=0.140.1 <0.141.0',
      knowledgeCatalog: '7.0.4',
      benchVersion: '0.4.9',
    })
    await writeSurface(root, '.', '@tangle-network/agent-runtime', {
      '.': { runAgent: 'value', AgentSpec: 'type', PursuitProjection: 'type' },
    })
    await commit(root, 'add an export and bump only the patch')

    await expect(check(root, base)).rejects.toMatchObject({
      stderr: expect.stringContaining('moves 1.0.0 -> 1.0.1, only a patch bump'),
    })
  })

  it('demands a major for a removed export on a 1.x package', async () => {
    const root = await createRepo()
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()
    await writeManifests(root, {
      version: '1.1.0',
      evalPeer: '>=0.140.1 <0.141.0',
      knowledgeCatalog: '7.0.4',
      benchVersion: '0.4.9',
    })
    await writeSurface(root, '.', '@tangle-network/agent-runtime', { '.': { runAgent: 'value' } })
    await commit(root, 'remove an export and bump the minor')

    await expect(check(root, base)).rejects.toMatchObject({
      stderr: expect.stringContaining('breaking change needing a major bump'),
    })
  })

  it('treats a value that becomes type-only as breaking', async () => {
    const root = await createRepo()
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()
    await writeSurface(root, '.', '@tangle-network/agent-runtime', {
      '.': { runAgent: 'type', AgentSpec: 'type' },
    })
    await commit(root, 'drop the runtime binding behind an export')

    const failure = await check(root, base).catch((error) => error)
    expect(failure.stderr).toContain('export narrowed: . runAgent: value -> type')
    expect(failure.stderr).toContain('needing a major bump')
  })

  it('moves the boundary one position right below 1.0', async () => {
    const root = await createRepo()
    await writeManifests(root, {
      version: '0.140.0',
      evalPeer: '>=0.140.1 <0.141.0',
      knowledgeCatalog: '7.0.4',
      benchVersion: '0.4.9',
    })
    await commit(root, 'move to a 0.x version')
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()

    // A consumer window is `>=0.140.0 <0.141.0`, so a patch already reaches an
    // addition and a break has to leave the window at the minor.
    await writeManifests(root, {
      version: '0.140.1',
      evalPeer: '>=0.140.1 <0.141.0',
      knowledgeCatalog: '7.0.4',
      benchVersion: '0.4.9',
    })
    await writeSurface(root, '.', '@tangle-network/agent-runtime', {
      '.': { runAgent: 'value', AgentSpec: 'type', PursuitProjection: 'type' },
    })
    await commit(root, 'add an export and bump the patch')
    await expect(check(root, base)).resolves.toMatchObject({
      stdout: expect.stringContaining('needing a patch bump'),
    })

    await writeSurface(root, '.', '@tangle-network/agent-runtime', { '.': { runAgent: 'value' } })
    await commit(root, 'remove an export on the same patch')
    await expect(check(root, base)).rejects.toMatchObject({
      stderr: expect.stringContaining('breaking change needing a minor bump'),
    })
  })

  it('does not fire when the exported symbols do not move', async () => {
    const root = await createRepo()
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()
    await writeFile(join(root, 'source.ts'), 'export const value = 2\n')
    await commit(root, 'edit source only')

    await expect(check(root, base)).resolves.toMatchObject({
      stdout: expect.stringContaining('consumer surface unchanged at 1.0.0'),
    })
  })

  it('records a first surface without demanding payment for it', async () => {
    const root = await createRepo()
    await git(root, 'rm', '--quiet', 'api-surface.json', 'bench/api-surface.json')
    await commit(root, 'a history with no surface record')
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()
    await writeSurface(root, '.', '@tangle-network/agent-runtime', {
      '.': { runAgent: 'value', AgentSpec: 'type' },
    })
    await writeSurface(root, 'bench', '@tangle-network/agent-bench', { '.': { runBench: 'value' } })
    await commit(root, 'record the surface for the first time')

    await expect(check(root, base)).resolves.toMatchObject({
      stdout: expect.stringContaining('consumer surface unchanged at 1.0.0'),
    })
  })

  it('rejects a field removed from an exported type, which moves no name', async () => {
    const root = await createRepo()
    await writeSurface(root, '.', '@tangle-network/agent-runtime', {
      '.': { runAgent: 'value 1f0a2b3c4d5e', AgentSpec: 'type 9a8b7c6d5e4f' },
    })
    await commit(root, 'state the shape behind each name')
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()
    await writeSurface(root, '.', '@tangle-network/agent-runtime', {
      '.': { runAgent: 'value 1f0a2b3c4d5e', AgentSpec: 'type 0011223344ff' },
    })
    await commit(root, 'remove a field from AgentSpec')

    // The name set is byte-identical, which is why the manifest comparison and
    // a name-only record both answer "consumer surface unchanged".
    await expect(check(root, base)).rejects.toMatchObject({
      stderr: expect.stringContaining(
        'export shape changed: . AgentSpec: shape 9a8b7c6d5e4f -> 0011223344ff',
      ),
    })
  })

  it('does not compare a shape the base record does not state', async () => {
    const root = await createRepo()
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()
    await writeSurface(root, '.', '@tangle-network/agent-runtime', {
      '.': { runAgent: 'value 1f0a2b3c4d5e', AgentSpec: 'type 9a8b7c6d5e4f' },
    })
    await commit(root, 'state the shapes for the first time')

    await expect(check(root, base)).resolves.toMatchObject({
      stdout: expect.stringContaining('consumer surface unchanged at 1.0.0'),
    })
  })

  it('fails closed when a publishable package states no surface at all', async () => {
    const root = await createRepo()
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()
    await git(root, 'rm', '--quiet', 'api-surface.json')
    await commit(root, 'delete the surface record')

    await expect(check(root, base)).rejects.toMatchObject({
      stderr: expect.stringContaining('api-surface.json does not exist'),
    })
  })
})

/**
 * The version a change is measured against is the LAST PUBLISHED one, not the
 * base branch's.
 *
 * Reading the base branch instead made an unreleased version behave like a
 * released one. Measured 2026-09-01 on agent-runtime: main declared 0.190.0
 * while the registry's newest was 0.189.0, and two export-adding pull requests
 * open against that main were each refused for adding exports to a version no
 * consumer could yet resolve. One unpublished bump absorbs every consumer-visible
 * change until it ships; a published version still buys nothing.
 */
describe('the baseline is the last published version, not the base branch', () => {
  /** Release `v1.0.0`, then put an unshipped `1.1.0` on the base. */
  async function repoWithUnpublishedBump(): Promise<{ root: string; base: string }> {
    const root = await createRepo()
    await tag(root, 'v1.0.0')
    await writeManifests(root, {
      version: '1.1.0',
      evalPeer: '>=0.140.1 <0.141.0',
      knowledgeCatalog: '7.0.4',
      benchVersion: '0.4.9',
    })
    await commit(root, 'prepare 1.1.0')
    return { root, base: (await git(root, 'rev-parse', 'HEAD')).trim() }
  }

  it('accepts added exports when the base carries a bump that has not shipped', async () => {
    const { root, base } = await repoWithUnpublishedBump()
    await writeSurface(root, '.', '@tangle-network/agent-runtime', {
      '.': { runAgent: 'value', AgentSpec: 'type', supervise: 'value' },
    })
    await commit(root, 'add an export under the unshipped 1.1.0')

    // 1.1.0 is not on the registry, so it is still paying for its own contents.
    const result = await check(root, base)
    expect(result.stdout).toContain('paid for by 1.0.0 -> 1.1.0 (minor)')
    expect(result.stdout).toContain('1.0.0 is the last published version (v1.0.0)')
  })

  it('accepts a SECOND change under the same unshipped bump — the release-train case', async () => {
    const { root, base } = await repoWithUnpublishedBump()
    // The first change already landed on the base; this is the one that used to
    // be told to open a version of its own.
    await writeSurface(root, '.', '@tangle-network/agent-runtime', {
      '.': { runAgent: 'value', AgentSpec: 'type', supervise: 'value' },
    })
    await commit(root, 'first export-adding change')
    const secondBase = (await git(root, 'rev-parse', 'HEAD')).trim()
    await writeSurface(root, '.', '@tangle-network/agent-runtime', {
      '.': { runAgent: 'value', AgentSpec: 'type', supervise: 'value', runGraph: 'value' },
    })
    await commit(root, 'second export-adding change')

    await expect(check(root, secondBase)).resolves.toMatchObject({
      stdout: expect.stringContaining('paid for by 1.0.0 -> 1.1.0 (minor)'),
    })
  })

  it('still refuses added exports when the base version IS published', async () => {
    const root = await createRepo()
    await tag(root, 'v1.0.0')
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()
    await writeSurface(root, '.', '@tangle-network/agent-runtime', {
      '.': { runAgent: 'value', AgentSpec: 'type', supervise: 'value' },
    })
    await commit(root, 'add an export under the published 1.0.0')

    // The defect this file exists for is unchanged: npm already holds 1.0.0, and
    // publish.yml skips a version already on the registry.
    const failure = await check(root, base).catch((error) => error)
    expect(failure.stderr).toContain('still declares 1.0.0')
    expect(failure.stderr).toContain('export added: . supervise')
  })

  it('names the published baseline in the refusal when the base is ahead but still short', async () => {
    const root = await createRepo()
    await tag(root, 'v1.0.0')
    await writeManifests(root, {
      version: '1.0.1',
      evalPeer: '>=0.140.1 <0.141.0',
      knowledgeCatalog: '7.0.4',
      benchVersion: '0.4.9',
    })
    await commit(root, 'prepare 1.0.1')
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()
    // A 1.x package needs a MINOR for an addition, and the unshipped bump is only
    // a patch, so the absorbing case applies and still falls short.
    await writeSurface(root, '.', '@tangle-network/agent-runtime', {
      '.': { runAgent: 'value', AgentSpec: 'type', supervise: 'value' },
    })
    await commit(root, 'add an export under the unshipped 1.0.1')

    const failure = await check(root, base).catch((error) => error)
    expect(failure.stderr).toContain('moves 1.0.0 -> 1.0.1, only a patch bump')
    expect(failure.stderr).toContain(
      'measured against the last published version 1.0.0 (v1.0.0); the base declares 1.0.1, ' +
        'which is not published yet',
    )
  })

  it('passes a change with no consumer surface, published or not', async () => {
    const { root, base } = await repoWithUnpublishedBump()
    await writeFile(join(root, 'source.ts'), 'export const value = 2\n')
    await commit(root, 'change only source')

    await expect(check(root, base)).resolves.toMatchObject({
      stdout: expect.stringContaining('consumer surface unchanged at 1.1.0'),
    })
  })

  it('orders release tags semantically, so v0.100.0 outranks v0.99.0', async () => {
    const root = await createRepo()
    await writeManifests(root, {
      version: '0.99.0',
      evalPeer: '>=0.140.1 <0.141.0',
      knowledgeCatalog: '7.0.4',
      benchVersion: '0.4.9',
    })
    await commit(root, 'release 0.99.0')
    await tag(root, 'v0.99.0')
    await writeManifests(root, {
      version: '0.100.0',
      evalPeer: '>=0.140.1 <0.141.0',
      knowledgeCatalog: '7.0.4',
      benchVersion: '0.4.9',
    })
    await commit(root, 'release 0.100.0')
    await tag(root, 'v0.100.0')
    await writeManifests(root, {
      version: '0.101.0',
      evalPeer: '>=0.140.1 <0.141.0',
      knowledgeCatalog: '7.0.4',
      benchVersion: '0.4.9',
    })
    await commit(root, 'prepare 0.101.0')
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()
    await writeSurface(root, '.', '@tangle-network/agent-runtime', {
      '.': { runAgent: 'value', AgentSpec: 'type', supervise: 'value' },
    })
    await commit(root, 'add an export')

    // Lexically v0.99.0 is the larger string. Picking it would measure against a
    // version two releases stale.
    await expect(check(root, base)).resolves.toMatchObject({
      stdout: expect.stringContaining('paid for by 0.100.0 -> 0.101.0'),
    })
  })

  it('reads each package own released version at the tag, never the root one', async () => {
    const root = await createRepo()
    await tag(root, 'v1.0.0')
    // The root ships an unpublished bump; bench does not move at all.
    await writeManifests(root, {
      version: '1.1.0',
      evalPeer: '>=0.140.1 <0.141.0',
      knowledgeCatalog: '7.0.4',
      benchVersion: '0.4.9',
    })
    await commit(root, 'prepare 1.1.0')
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()
    await writeSurface(root, 'bench', '@tangle-network/agent-bench', {
      '.': { runBench: 'value', runSuite: 'value' },
    })
    await commit(root, 'add a bench export')

    // bench released 0.4.9 and still declares 0.4.9, so the root's unshipped
    // 1.1.0 pays nothing for it.
    const failure = await check(root, base).catch((error) => error)
    expect(failure.stderr).toContain('bench/package.json (@tangle-network/agent-bench)')
    expect(failure.stderr).toContain('still declares 0.4.9')
  })
})
