import { execFile, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { installAcrossPropagation } from '../../scripts/lib/npm-registry.mjs'

const exec = promisify(execFile)
const checker = resolve('scripts/check-release-version-free.mjs')
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function scratch(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  return directory
}

async function registry(handle: (req: IncomingMessage, res: ServerResponse) => void) {
  const requests: string[] = []
  const server = createServer((req, res) => {
    requests.push(req.url ?? '')
    handle(req, res)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  cleanups.push(() => new Promise((done) => server.close(() => done())))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { base, requests }
}

// Fixture repositories run no host hooks: a host pre-commit hook may refuse a throwaway identity.
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'release',
      GIT_AUTHOR_EMAIL: 'release@example.invalid',
      GIT_COMMITTER_NAME: 'release',
      GIT_COMMITTER_EMAIL: 'release@example.invalid',
    },
  }).trim()

/** A clone of a real bare origin whose package.json names agent-runtime 9.9.9. */
async function releaseClone() {
  const root = await scratch('release-version-free-')
  const origin = join(root, 'origin.git')
  const work = join(root, 'work')
  git(root, 'init', '--quiet', '--bare', '--initial-branch=main', origin)
  git(root, 'clone', '--quiet', origin, work)
  await writeFile(
    join(work, 'package.json'),
    `${JSON.stringify({ name: '@tangle-network/agent-runtime', version: '9.9.9' })}\n`,
  )
  git(work, 'add', 'package.json')
  git(work, 'commit', '--quiet', '-m', 'release 9.9.9')
  git(work, 'push', '--quiet', 'origin', 'main')
  return { root, work }
}

/** Run the check with the public registry origin redirected to `base`, as an unmodified script. */
async function check(work: string, base: string) {
  const loader = join(work, '..', 'registry-redirect.mjs')
  await writeFile(
    loader,
    `const upstream = globalThis.fetch;
    globalThis.fetch = (url, options) => upstream(
      String(url).replace('https://registry.npmjs.org', ${JSON.stringify(base)}), options);
    `,
  )
  try {
    const { stdout, stderr } = await exec(process.execPath, ['--import', loader, checker], {
      cwd: work,
    })
    return { code: 0, stdout, stderr }
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string }
    return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr }
  }
}

const answer = (status: number) => (_req: IncomingMessage, res: ServerResponse) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(
    status === 200
      ? JSON.stringify({ name: '@tangle-network/agent-runtime', version: '9.9.9' })
      : '{}',
  )
}

describe('release version check', () => {
  it('refuses a version whose tag on origin names another tree, without reading the registry', async () => {
    const { work } = await releaseClone()
    const tagged = git(work, 'rev-parse', 'HEAD')
    git(work, 'tag', '-a', 'v9.9.9', '-m', 'v9.9.9')
    git(work, 'push', '--quiet', 'origin', 'v9.9.9')
    await writeFile(join(work, 'CHANGELOG.md'), 'a change the tagged archive does not carry\n')
    git(work, 'add', 'CHANGELOG.md')
    git(work, 'commit', '--quiet', '-m', 'later change')
    const npm = await registry(answer(404))

    const result = await check(work, npm.base)

    expect(result.code).toBe(1)
    expect(result.stderr).toContain(`v9.9.9 already exists on origin at ${tagged}, another tree`)
    expect(npm.requests).toEqual([])
  })

  it("accepts the tag that names this tree as this release's own, without reading the registry", async () => {
    const { work } = await releaseClone()
    git(work, 'tag', '-a', 'v9.9.9', '-m', 'v9.9.9')
    git(work, 'push', '--quiet', 'origin', 'v9.9.9')
    const npm = await registry(answer(200))

    const result = await check(work, npm.base)

    expect(result.code).toBe(0)
    expect(result.stdout).toContain(
      "names this tree; @tangle-network/agent-runtime@9.9.9 is this release's own",
    )
    expect(npm.requests).toEqual([])
  })

  it('admits an untagged version only on a definite registry 404', async () => {
    const { work } = await releaseClone()
    const npm = await registry(answer(404))

    const result = await check(work, npm.base)

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('@tangle-network/agent-runtime@9.9.9 is free')
    expect(npm.requests).toEqual(['/%40tangle-network%2Fagent-runtime/9.9.9'])
  })

  it('refuses an untagged version the registry already serves', async () => {
    const { work } = await releaseClone()
    const npm = await registry(answer(200))

    const result = await check(work, npm.base)

    expect(result.code).toBe(1)
    expect(result.stderr).toContain(
      '@tangle-network/agent-runtime@9.9.9 is already on the npm registry',
    )
  })

  it('refuses as could not read when the registry answers an error or cannot be reached', async () => {
    const { work } = await releaseClone()
    const failing = await registry(answer(503))
    const failed = await check(work, failing.base)
    expect(failed.code).toBe(1)
    expect(failed.stderr).toContain(
      'could not read the npm registry for @tangle-network/agent-runtime@9.9.9: HTTP 503',
    )

    const closed = await registry(answer(404))
    const port = new URL(closed.base).port
    await cleanups.pop()?.()
    const unreachable = await check(work, `http://127.0.0.1:${port}`)
    expect(unreachable.code).toBe(1)
    expect(unreachable.stderr).toContain(
      'could not read the npm registry for @tangle-network/agent-runtime@9.9.9',
    )
    expect(unreachable.stdout).not.toContain('is free')
  })

  it("refuses when origin's tags cannot be read", async () => {
    const { work, root } = await releaseClone()
    git(work, 'remote', 'set-url', 'origin', join(root, 'missing.git'))
    const npm = await registry(answer(404))

    const result = await check(work, npm.base)

    expect(result.code).toBe(1)
    expect(result.stderr).toContain("could not read origin's tags for v9.9.9")
    expect(npm.requests).toEqual([])
  })
})

/** A loopback registry serving one package whose archive the test controls. */
async function packageRegistry(archiveAnswers: (reads: number) => number, manifestStatus = 200) {
  const source = await scratch('fresh-dependency-')
  await writeFile(
    join(source, 'package.json'),
    `${JSON.stringify({ name: 'fresh-dependency', version: '1.0.0' })}\n`,
  )
  execFileSync('npm', ['pack', '--silent'], { cwd: source })
  const bytes = await readFile(join(source, 'fresh-dependency-1.0.0.tgz'))
  let archiveReads = 0
  let base = ''
  const manifest = () => ({
    name: 'fresh-dependency',
    version: '1.0.0',
    dist: {
      tarball: `${base}/fresh-dependency/-/fresh-dependency-1.0.0.tgz`,
      integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    },
  })
  const npm = await registry((req, res) => {
    if (req.url === '/fresh-dependency/-/fresh-dependency-1.0.0.tgz') {
      archiveReads += 1
      const status = archiveAnswers(archiveReads)
      res.writeHead(status, { 'content-type': 'application/octet-stream' })
      res.end(status === 200 ? bytes : '')
      return
    }
    if (req.url === '/fresh-dependency/1.0.0') {
      res.writeHead(manifestStatus, { 'content-type': 'application/json' })
      res.end(manifestStatus === 200 ? JSON.stringify(manifest()) : '{}')
      return
    }
    if (req.url === '/fresh-dependency') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          name: 'fresh-dependency',
          'dist-tags': { latest: '1.0.0' },
          versions: { '1.0.0': manifest() },
        }),
      )
      return
    }
    res.writeHead(404)
    res.end()
  })
  base = npm.base
  const app = await scratch('fresh-consumer-')
  await mkdir(join(app, 'npm-cache'))
  await writeFile(join(app, 'empty.npmrc'), '')
  await writeFile(
    join(app, 'package.json'),
    `${JSON.stringify({ private: true, dependencies: { 'fresh-dependency': '1.0.0' } })}\n`,
  )
  // npm runs asynchronously so this process's loopback registry can answer it; its stderr travels
  // in the thrown message, as in the packed-consumer installs.
  const install = async () => {
    try {
      const { stdout } = await exec(
        'npm',
        [
          'install',
          '--no-audit',
          '--no-fund',
          '--registry',
          npm.base,
          '--cache',
          join(app, 'npm-cache'),
        ],
        { cwd: app, env: { ...process.env, npm_config_userconfig: join(app, 'empty.npmrc') } },
      )
      return stdout
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string }
      throw new Error(['command failed: npm install', failed.stdout, failed.stderr].join('\n'))
    }
  }
  return { app, install, archiveReads: () => archiveReads }
}

describe('packed-consumer install across registry propagation', () => {
  it('retries a listed version whose archive answers 404, naming it, until the archive is served', async () => {
    const fixture = await packageRegistry((reads) => (reads <= 2 ? 404 : 200))
    const lines: string[] = []

    await installAcrossPropagation(fixture.install, {
      windowMs: 20_000,
      intervalMs: 200,
      log: (line: string) => lines.push(line),
    })

    expect(existsSync(join(fixture.app, 'node_modules', 'fresh-dependency', 'package.json'))).toBe(
      true,
    )
    expect(fixture.archiveReads()).toBe(3)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('fresh-dependency@1.0.0 is listed but its archive answered 404')
  }, 60_000)

  it('fails at once on an archive 404 for a version the registry does not list', async () => {
    const fixture = await packageRegistry(() => 404, 404)
    const lines: string[] = []

    await expect(
      installAcrossPropagation(fixture.install, {
        windowMs: 20_000,
        intervalMs: 200,
        log: (line: string) => lines.push(line),
      }),
    ).rejects.toThrow(/404 Not Found - GET \S+fresh-dependency-1\.0\.0\.tgz/)
    expect(lines).toEqual([])
    expect(fixture.archiveReads()).toBe(1)
  }, 60_000)

  it('fails naming the package when a listed archive is still missing after the window', async () => {
    const fixture = await packageRegistry(() => 404)

    await expect(
      installAcrossPropagation(fixture.install, { windowMs: 700, intervalMs: 200, log: () => {} }),
    ).rejects.toThrow(
      'fresh-dependency@1.0.0 is listed on the npm registry but its archive still answered 404',
    )
  }, 60_000)

  it("keeps npm's error and adds the registry's when the registry cannot be read", async () => {
    const fixture = await packageRegistry(() => 404, 500)

    await expect(
      installAcrossPropagation(fixture.install, {
        windowMs: 20_000,
        intervalMs: 200,
        log: () => {},
      }),
    ).rejects.toThrow(
      /404 Not Found - GET \S+fresh-dependency-1\.0\.0\.tgz[\s\S]*and could not read the npm registry for fresh-dependency@1\.0\.0: HTTP 500/,
    )
    expect(fixture.archiveReads()).toBe(1)
  }, 60_000)
})
