import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const roots: string[] = []
const registries = new Map<
  string,
  { server: Server; url: string; versions: Map<string, string[]> }
>()

async function createRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'agent-runtime-version-bump-'))
  roots.push(root)
  const versions = new Map<string, string[]>()
  const server = createServer((request, response) => {
    const name = decodeURIComponent(new URL(request.url!, 'http://registry').pathname.slice(1))
    const served = versions.get(name)
    response.setHeader('content-type', 'application/json')
    response.writeHead(served ? 200 : 404).end(
      JSON.stringify(
        served
          ? {
              name,
              'dist-tags': { latest: served.at(-1) },
              versions: Object.fromEntries(served.map((version) => [version, { name, version }])),
            }
          : { error: 'Not found' },
      ),
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fixture registry did not listen')
  registries.set(root, { server, url: `http://127.0.0.1:${address.port}`, versions })
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
        publishConfig: { registry: registries.get(root)!.url },
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
        publishConfig: { registry: registries.get(root)!.url },
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
      // Served fixtures exercise npm over HTTP; offline fixtures retain the conservative baseline.
      PACKAGE_VERSION_BUMP_REGISTRY: registries.get(root)?.versions.size ? '1' : '0',
    },
  })
}

async function publish(root: string, name: string): Promise<void> {
  await git(root, 'tag', name)
  const versions = registries.get(root)?.versions
  if (!versions) return
  for (const path of ['package.json', 'bench/package.json']) {
    const manifest = JSON.parse(await git(root, 'show', `HEAD:${path}`))
    versions.set(manifest.name, [
      ...new Set([...(versions.get(manifest.name) ?? []), manifest.version]),
    ])
  }
}

afterEach(async () => {
  await Promise.all(
    [...registries.values()].map(
      ({ server }) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        }),
    ),
  )
  registries.clear()
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

  it('accepts the same move once a patch pays for it', async () => {
    const root = await createRepo()
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()
    await writeManifests(root, {
      version: '1.0.1',
      evalPeer: '>=0.141.0 <0.142.0',
      knowledgeCatalog: '7.0.4',
      benchVersion: '0.4.9',
    })
    await commit(root, 'move the peer range and bump')

    await expect(check(root, base)).resolves.toMatchObject({
      stdout: expect.stringContaining('paid for by 1.0.0 -> 1.0.1'),
    })
  })

  it('refuses a minor where a patch pays for the change', async () => {
    const root = await createRepo()
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()
    await writeManifests(root, {
      version: '1.1.0',
      evalPeer: '>=0.141.0 <0.142.0',
      knowledgeCatalog: '7.0.4',
      benchVersion: '0.4.9',
    })
    await commit(root, 'move the peer range and bump a minor')

    await expect(check(root, base)).rejects.toMatchObject({
      stderr: expect.stringContaining(
        'a minor bump, but its change needs only a patch: publish 1.0.1',
      ),
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

    expect((await git(root, 'diff', base, 'HEAD', '--', 'package.json')).trim()).toBe('')
    const failure = await check(root, base).catch((error) => error)
    expect(failure.stderr).toContain('export added: . PursuitProjection')
    expect(failure.stderr).toContain('additive change needing a patch bump')
  })

  it('accepts the added export once a patch pays for it', async () => {
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
    await commit(root, 'add an export and bump the minor')

    await expect(check(root, base)).resolves.toMatchObject({
      stdout: expect.stringContaining('1.0.0 -> 1.0.1 (patch)'),
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
  }, 120_000)

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

describe('the baseline is the last published version, not the base branch', () => {
  async function repoWithUnpublishedBump(): Promise<{ root: string; base: string }> {
    const root = await createRepo()
    await publish(root, 'v1.0.0')
    await writeManifests(root, {
      version: '1.0.1',
      evalPeer: '>=0.140.1 <0.141.0',
      knowledgeCatalog: '7.0.4',
      benchVersion: '0.4.9',
    })
    await commit(root, 'prepare 1.0.1')
    await git(root, 'tag', 'v1.0.1') // An unserved immutable tag cannot establish publication.
    return { root, base: (await git(root, 'rev-parse', 'HEAD')).trim() }
  }

  it('accepts added exports when the base carries a bump that has not shipped', async () => {
    const { root, base } = await repoWithUnpublishedBump()
    await writeSurface(root, '.', '@tangle-network/agent-runtime', {
      '.': { runAgent: 'value', AgentSpec: 'type', supervise: 'value' },
    })
    await commit(root, 'add an export under the unshipped 1.0.1')

    const result = await check(root, base)
    expect(result.stdout).toContain('paid for by 1.0.0 -> 1.0.1 (patch)')
    expect(result.stdout).toContain('1.0.0 is the last published version (the npm registry)')
  })

  it('accepts a SECOND change under the same unshipped bump — the release-train case', async () => {
    const { root, base } = await repoWithUnpublishedBump()
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
      stdout: expect.stringContaining('paid for by 1.0.0 -> 1.0.1 (patch)'),
    })
  })

  it('still refuses added exports when the base version IS published', async () => {
    const root = await createRepo()
    await publish(root, 'v1.0.0')
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()
    await writeSurface(root, '.', '@tangle-network/agent-runtime', {
      '.': { runAgent: 'value', AgentSpec: 'type', supervise: 'value' },
    })
    await commit(root, 'add an export under the published 1.0.0')

    const failure = await check(root, base).catch((error) => error)
    expect(failure.stderr).toContain('still declares 1.0.0')
    expect(failure.stderr).toContain('export added: . supervise')
  })

  it('names the published baseline in the refusal when the base is ahead but still short', async () => {
    const root = await createRepo()
    await publish(root, 'v1.0.0')
    await writeManifests(root, {
      version: '1.0.1',
      evalPeer: '>=0.140.1 <0.141.0',
      knowledgeCatalog: '7.0.4',
      benchVersion: '0.4.9',
    })
    await commit(root, 'prepare 1.0.1')
    const base = (await git(root, 'rev-parse', 'HEAD')).trim()
    await writeSurface(root, '.', '@tangle-network/agent-runtime', { '.': { runAgent: 'value' } })
    await commit(root, 'remove an export under the unshipped 1.0.1')

    const failure = await check(root, base).catch((error) => error)
    expect(failure.stderr).toContain('moves 1.0.0 -> 1.0.1, only a patch bump')
    expect(failure.stderr).toContain(
      'measured against the last published version 1.0.0 (the npm registry); the base declares 1.0.1, ' +
        'which is not published yet',
    )
  })

  it('passes a change with no consumer surface, published or not', async () => {
    const { root, base } = await repoWithUnpublishedBump()
    await writeFile(join(root, 'source.ts'), 'export const value = 2\n')
    await commit(root, 'change only source')

    await expect(check(root, base)).resolves.toMatchObject({
      stdout: expect.stringContaining('consumer surface unchanged at 1.0.1'),
    })
  })

  it('orders served versions semantically, so 0.100.0 outranks 0.99.0', async () => {
    const root = await createRepo()
    await writeManifests(root, {
      version: '0.99.0',
      evalPeer: '>=0.140.1 <0.141.0',
      knowledgeCatalog: '7.0.4',
      benchVersion: '0.4.9',
    })
    await commit(root, 'release 0.99.0')
    await publish(root, 'v0.99.0')
    await writeManifests(root, {
      version: '0.100.0',
      evalPeer: '>=0.140.1 <0.141.0',
      knowledgeCatalog: '7.0.4',
      benchVersion: '0.4.9',
    })
    await commit(root, 'release 0.100.0')
    await publish(root, 'v0.100.0')
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

    await expect(check(root, base)).resolves.toMatchObject({
      stdout: expect.stringContaining('paid for by 0.100.0 -> 0.101.0'),
    })
  })

  it('reads each package own served version, never the root one', async () => {
    const root = await createRepo()
    await publish(root, 'v1.0.0')
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

    const failure = await check(root, base).catch((error) => error)
    expect(failure.stderr).toContain('bench/package.json (@tangle-network/agent-bench)')
    expect(failure.stderr).toContain('still declares 0.4.9')
  })
})

describe('a shape change is classified from the declarations it was built from', () => {
  async function build(root: string, version: string, declarations: string): Promise<string> {
    await mkdir(join(root, 'dist'), { recursive: true })
    await writeFile(
      join(root, 'package.json'),
      `${JSON.stringify({ name: '@tangle-network/fixture', version, exports: { '.': { types: './dist/index.d.ts' } } })}\n`,
    )
    await writeFile(join(root, 'dist', 'index.d.ts'), declarations)
    await execFileAsync(process.execPath, ['scripts/check-api-surface.mjs', '--write'], {
      cwd: process.cwd(),
      env: { ...process.env, API_SURFACE_ROOT: root },
    })
    return commit(root, version)
  }
  const options = (member: string) =>
    `export interface StartOptions {\n  readonly cwd: string;\n${member}}\nexport declare function start(options: StartOptions): void;\n`
  // A callable interface (DriveHarness) is both called and implemented; its arguments still split.
  const callable = (member: string) =>
    `export interface Drive {\n  (args: {\n  readonly cwd: string;\n${member}}): void;\n}\n`

  // An untagged union of an object and an intersection, the shape of SupervisedResult (9.0.4).
  const variants = (member: string, rest = '  readonly attempts: number;\n') =>
    `export type Outcome =\n  | {\n  readonly winner: string;\n${member}}\n  | ({\n${rest}${member}} & ({ readonly a: 1 } | { readonly b: 2 }));\n`

  it.each([
    ['an options interface', options],
    [
      'an interface with a public parent',
      (member: string) =>
        `export interface Parent { readonly cwd: string; } export interface StartOptions extends Parent { ${member} }`,
    ],
    [
      'an interface with literal Pick keys',
      (member: string) =>
        `export interface Parent { readonly cwd: string; readonly skip?: boolean; } export interface StartOptions extends Pick<Parent, 'cwd' | 'skip'> { ${member} }`,
    ],
    [
      'an interface with tuple-derived Pick keys',
      (member: string) =>
        `export interface Parent { readonly cwd: string; readonly skip?: boolean; } declare const keys: readonly ['cwd', 'skip']; type Keys = (typeof keys)[number]; export interface StartOptions extends Pick<Parent, Keys> { ${member} }`,
    ],
    ['a callable interface argument', callable],
    ['each variant of an untagged union', (member: string) => variants(member)],
  ])(
    'asks a patch for an added optional member of %s and a major for an added required one',
    async (_form, options) => {
      const root = await mkdtemp(join(tmpdir(), 'agent-runtime-shape-'))
      roots.push(root)
      await git(root, 'init', '--quiet', '--initial-branch=main')
      const released = await build(root, '1.0.0', options(''))
      await publish(root, 'v1.0.0')

      await build(root, '1.0.1', options('  readonly journalRoot?: string;\n'))
      await expect(check(root, released)).resolves.toMatchObject({
        stdout: expect.stringContaining('needing a patch bump, paid for by 1.0.0 -> 1.0.1 (patch)'),
      })

      await build(root, '1.0.1', options('  readonly journalRoot: string;\n'))
      const failure = await check(root, released).catch((error) => error)
      expect(failure.stderr).toContain('readonly journalRoot)')
      expect(failure.stderr).toContain('breaking change needing a major bump')
    },
  )

  it('does not classify a narrowed inherited optional property as an additive extension', async () => {
    const inherited = (own: string) =>
      `export interface Parent { readonly mode?: string | number; } export interface StartOptions extends Parent { ${own} }`
    const root = await mkdtemp(join(tmpdir(), 'agent-runtime-heritage-'))
    roots.push(root)
    await git(root, 'init', '--quiet', '--initial-branch=main')
    const released = await build(root, '1.0.0', inherited(''))
    await publish(root, 'v1.0.0')
    await build(root, '1.0.1', inherited('readonly mode?: string;'))
    const failure = await check(root, released).catch((error) => error)
    expect(failure.stderr).toContain('breaking change needing a major bump')
  })

  it('reads an inferred promised union part by part: an optional member is a patch, a removed one a major', async () => {
    const promised = (member: string, rest = '  readonly attempts: number;\n') =>
      `export declare function run(): Promise<{\n  readonly winner: string;\n${member}} | {\n${rest}${member}}>;\n`
    const root = await mkdtemp(join(tmpdir(), 'agent-runtime-shape-'))
    roots.push(root)
    await git(root, 'init', '--quiet', '--initial-branch=main')
    const released = await build(root, '1.0.0', promised(''))
    await publish(root, 'v1.0.0')
    await build(root, '1.0.1', promised('  readonly journalRoot?: string;\n'))
    await expect(check(root, released)).resolves.toMatchObject({
      stdout: expect.stringContaining('needing a patch bump, paid for by 1.0.0 -> 1.0.1 (patch)'),
    })
    await build(root, '1.0.1', promised('', ''))
    const failure = await check(root, released).catch((error) => error)
    expect(failure.stderr).toContain('breaking change needing a major bump')
  })

  it.each([
    ['a removed member', ''],
    ['a retyped member', '  readonly attempts: string;\n'],
  ])('asks a major for %s of an untagged union variant', async (_change, rest) => {
    const root = await mkdtemp(join(tmpdir(), 'agent-runtime-shape-'))
    roots.push(root)
    await git(root, 'init', '--quiet', '--initial-branch=main')
    const released = await build(root, '1.0.0', variants(''))
    await publish(root, 'v1.0.0')
    await build(root, '1.0.1', variants('  readonly journalRoot?: string;\n', rest))
    const failure = await check(root, released).catch((error) => error)
    expect(failure.stderr).toContain('readonly attempts')
    expect(failure.stderr).toContain('breaking change needing a major bump')
  })
})
