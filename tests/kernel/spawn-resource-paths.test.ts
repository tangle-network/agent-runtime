import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { createCoordinationTools } from '../../src/mcp/tools/coordination'
import {
  environmentReader,
  hostDirectoryReader,
  resolveSpawnResourcePaths,
  SPAWN_RESOURCE_PATH_MAX_BYTES,
} from '../../src/mcp/tools/spawn-resource-paths'
import type { ResultBlobStore, Scope, Spend } from '../../src/runtime'
import { rootSpawnResourceRoot } from '../../src/runtime/supervise/supervise'

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')

async function workspace(): Promise<{ root: string; outside: string }> {
  const base = await mkdtemp(join(tmpdir(), 'spawn-resource-paths-'))
  const root = join(base, 'workspace')
  const outside = join(base, 'outside')
  await mkdir(join(root, 'experiments'), { recursive: true })
  await mkdir(outside, { recursive: true })
  return { root, outside }
}

describe('resolveSpawnResourcePaths', () => {
  it('reads an inline resource named by path under the root and reports its bytes', async () => {
    const { root } = await workspace()
    // 29,144 characters of base64 is the payload size a director could not retype on 2026-09-12.
    const payload = Buffer.from('x'.repeat(21_852)).toString('base64')
    await writeFile(join(root, 'experiments', 'payload.b64'), payload)
    const result = await resolveSpawnResourcePaths(
      {
        name: 'checker',
        resources: {
          files: [
            {
              path: 'payload.b64',
              resource: { kind: 'inline', name: 'payload', path: 'experiments/payload.b64' },
            },
            { path: 'spec.md', resource: { kind: 'inline', name: 'spec', content: 'as written' } },
          ],
        },
      },
      root,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const profile = result.profile as { resources: { files: Array<{ resource: unknown }> } }
    expect(profile.resources.files[0]?.resource).toEqual({
      kind: 'inline',
      name: 'payload',
      content: payload,
    })
    // A resource already carrying content is not touched.
    expect(profile.resources.files[1]?.resource).toEqual({
      kind: 'inline',
      name: 'spec',
      content: 'as written',
    })
    expect(result.resolved).toEqual([
      {
        at: 'files[0].resource',
        path: 'experiments/payload.b64',
        byteLength: payload.length,
        sha256: sha(payload),
      },
    ])
  })

  it('returns the same profile object when nothing names a path', async () => {
    const profile = { name: 'plain', resources: { files: [] } }
    const result = await resolveSpawnResourcePaths(profile, '/nowhere')
    expect(result).toEqual({ ok: true, profile, resolved: [] })
  })

  it('refuses a path when the manager has no readable workspace root', async () => {
    const result = await resolveSpawnResourcePaths(
      { resources: { skills: [{ kind: 'inline', name: 's', path: 'skill.md' }] } },
      undefined,
    )
    expect(result).toMatchObject({ ok: false, at: 'skills[0]' })
    if (result.ok) return
    expect(result.reason).toContain('no workspace root')
  })

  it('refuses an absolute path, a `..` escape, and a symlink that resolves outside the root', async () => {
    const { root, outside } = await workspace()
    await writeFile(join(outside, 'secret'), 'not for children')
    await symlink(join(outside, 'secret'), join(root, 'link'))
    for (const [path, fragment] of [
      [join(outside, 'secret'), 'not absolute'],
      ['../outside/secret', 'leaves the workspace root'],
      ['link', 'resolves outside the workspace root'],
    ] as const) {
      const result = await resolveSpawnResourcePaths(
        { resources: { files: [{ path: 'f', resource: { kind: 'inline', name: 'f', path } }] } },
        root,
      )
      expect(result.ok, path).toBe(false)
      if (result.ok) continue
      expect(result.reason, path).toContain(fragment)
    }
  })

  it('refuses a missing file, a directory, an oversized file, and bytes that are not UTF-8', async () => {
    const { root } = await workspace()
    await writeFile(join(root, 'binary.bin'), Buffer.from([0xff, 0xfe, 0x00, 0x80]))
    await writeFile(join(root, 'big.txt'), Buffer.alloc(SPAWN_RESOURCE_PATH_MAX_BYTES + 1, 0x61))
    for (const [path, fragment] of [
      ['absent.txt', 'does not exist'],
      ['experiments', 'not a regular file'],
      ['big.txt', `at most ${SPAWN_RESOURCE_PATH_MAX_BYTES} bytes`],
      ['binary.bin', 'not valid UTF-8'],
    ] as const) {
      const result = await resolveSpawnResourcePaths(
        { resources: { tools: [{ kind: 'inline', name: 't', path }] } },
        root,
      )
      expect(result.ok, path).toBe(false)
      if (result.ok) continue
      expect(result.reason, path).toContain(fragment)
    }
  })
})

describe('resolveSpawnResourcePaths through the manager’s own environment', () => {
  // A sandbox-rooted manager. The coordination server cannot open its filesystem, but the
  // provider that created the box serves `read()`, and that is the channel with no model in it.
  function sandbox(files: Record<string, string>) {
    const reads: string[] = []
    return {
      reads,
      environment: {
        id: 'sandbox-7274acc42ded',
        async read(path: string) {
          reads.push(path)
          const content = files[path]
          if (content === undefined) {
            throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
          }
          return content
        },
      },
    }
  }

  it('hands the child the bytes the manager has on its own box, with a sha256 receipt', async () => {
    // The instrument run 20260917h's director certified and then lost to its own emission:
    // 9,752 bytes is fastpath.py's size, above anything a model retypes reliably.
    const instrument = `${'def battery(model):\n    return 1e-4\n'.repeat(250)}`
    const { environment, reads } = sandbox({ 'work/instrument.py': instrument })
    const result = await resolveSpawnResourcePaths(
      {
        name: 'producer',
        resources: {
          files: [
            {
              path: 'instrument.py',
              resource: { kind: 'inline', name: 'instrument', path: 'work/instrument.py' },
            },
          ],
        },
      },
      environmentReader(environment),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const profile = result.profile as { resources: { files: Array<{ resource: unknown }> } }
    expect(profile.resources.files[0]?.resource).toEqual({
      kind: 'inline',
      name: 'instrument',
      content: instrument,
    })
    expect(result.resolved).toEqual([
      {
        at: 'files[0].resource',
        path: 'work/instrument.py',
        byteLength: Buffer.byteLength(instrument),
        sha256: sha(instrument),
      },
    ])
    expect(reads).toEqual(['work/instrument.py'])
  })

  it('refuses an absolute path and a `..` escape before asking the environment', async () => {
    const { environment, reads } = sandbox({})
    for (const [path, fragment] of [
      ['/home/agent/work/x.py', 'not absolute'],
      ['../other-box/x.py', 'leaves the manager'],
      ['work/../../x.py', 'leaves the manager'],
    ] as const) {
      const result = await resolveSpawnResourcePaths(
        { resources: { files: [{ path: 'f', resource: { kind: 'inline', name: 'f', path } }] } },
        environmentReader(environment),
      )
      expect(result.ok, path).toBe(false)
      if (result.ok) continue
      expect(result.reason, path).toContain(fragment)
    }
    expect(reads).toEqual([])
  })

  it('names the environment when a file is missing, so the manager knows which filesystem was consulted', async () => {
    const { environment } = sandbox({})
    const result = await resolveSpawnResourcePaths(
      { resources: { skills: [{ kind: 'inline', name: 's', path: 'skills/absent.md' }] } },
      environmentReader(environment),
    )
    expect(result).toMatchObject({ ok: false, at: 'skills[0]' })
    if (result.ok) return
    expect(result.reason).toContain('does not exist')
    expect(result.reason).toContain('sandbox-7274acc42ded')
  })

  it('enforces the same size bound as the host reader on what the environment returns', async () => {
    const { environment } = sandbox({ 'big.txt': 'a'.repeat(SPAWN_RESOURCE_PATH_MAX_BYTES + 1) })
    const result = await resolveSpawnResourcePaths(
      { resources: { tools: [{ kind: 'inline', name: 't', path: 'big.txt' }] } },
      environmentReader(environment),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain(`at most ${SPAWN_RESOURCE_PATH_MAX_BYTES} bytes`)
  })

  it('a host directory passed as a string and as a reader resolve identically', async () => {
    const { root } = await workspace()
    await writeFile(join(root, 'experiments', 'p.txt'), 'same bytes')
    const profile = {
      resources: {
        files: [{ path: 'p', resource: { kind: 'inline', name: 'p', path: 'experiments/p.txt' } }],
      },
    }
    const asString = await resolveSpawnResourcePaths(profile, root)
    const asReader = await resolveSpawnResourcePaths(profile, hostDirectoryReader(root))
    expect(asReader).toEqual(asString)
  })

  it('refuses with a reason naming both absent channels when there is no reader at all', async () => {
    const result = await resolveSpawnResourcePaths(
      { resources: { skills: [{ kind: 'inline', name: 's', path: 'skill.md' }] } },
      undefined,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('no host directory')
    expect(result.reason).toContain('no environment with read')
  })
})

describe('resolveSpawnResourcePaths failures the runtime process cannot read past', () => {
  it('turns an unreadable file into the typed refusal instead of a thrown tool failure', async () => {
    if (process.getuid?.() === 0) return // root reads everything; the permission bit means nothing
    const { root } = await workspace()
    await writeFile(join(root, 'locked.txt'), 'x')
    await chmod(join(root, 'locked.txt'), 0o000)
    const result = await resolveSpawnResourcePaths(
      {
        resources: {
          files: [{ path: 'f', resource: { kind: 'inline', name: 'f', path: 'locked.txt' } }],
        },
      },
      root,
    )
    expect(result).toMatchObject({ ok: false, at: 'files[0].resource' })
    if (result.ok) return
    expect(result.reason).toContain('not readable by the runtime process')
  })
})

describe('spawn_worker with an inline resource by path', () => {
  const zeroSpend = (): Spend => ({ iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 })
  const blobs: ResultBlobStore = { get: async () => undefined, put: async () => {} }
  function mockScope() {
    const nodes = [
      {
        id: 'w0',
        label: 'worker',
        status: 'running' as const,
        runtime: 'router',
        budget: { maxIterations: 1, maxTokens: 10 },
        spent: zeroSpend(),
      },
    ]
    const scope = {
      // `Scope.spawn` receives the agent as a thunk and calls it when the worker starts; calling it
      // here is what lets the test see the profile the child would receive.
      spawn: (agent: () => unknown, _task: unknown, opts: { label: string }) => {
        agent()
        return {
          ok: true as const,
          handle: { id: 'w0', label: opts.label, status: 'running' as const, abort() {} },
        }
      },
      next: async () => null,
      send: () => false,
      get view() {
        return { root: 'root', nodes, inFlight: 1 }
      },
      budget: { tokensLeft: 10, usdLeft: 0, deadlineMs: 0, reservedTokens: 0 },
      signal: new AbortController().signal,
    }
    return scope as unknown as Scope<unknown>
  }

  it('hands the child the file bytes as content and returns a sha256 receipt', async () => {
    const { root } = await workspace()
    const payload = Buffer.from('y'.repeat(21_852)).toString('base64')
    await writeFile(join(root, 'payload.b64'), payload)
    const received: AgentProfile[] = []
    const tb = createCoordinationTools({
      scope: mockScope(),
      blobs,
      makeWorkerAgent: (profile) => {
        received.push(profile)
        return { name: 'w', act: async () => 0 }
      },
      perWorker: { maxIterations: 1, maxTokens: 10 },
      spawnResourceRoot: root,
    })
    const spawn = tb.tools.find((x) => x.name === 'spawn_worker')
    if (!spawn) throw new Error('no spawn_worker')
    const result = await spawn.handler({
      profile: {
        name: 'blind-checker',
        harness: 'opencode',
        model: { provider: 'tangle-router', default: 'claude-sonnet-4-6' },
        resources: {
          files: [
            {
              path: 'payload.b64',
              resource: { kind: 'inline', name: 'payload', path: 'payload.b64' },
            },
          ],
        },
      },
      task: 'decode payload.b64 and check its sha256',
      label: 'checker',
    })
    expect(result).toMatchObject({
      workerId: 'w0',
      resourcesFromPath: [
        {
          at: 'files[0].resource',
          path: 'payload.b64',
          byteLength: payload.length,
          sha256: sha(payload),
        },
      ],
    })
    expect(received).toHaveLength(1)
    expect(received[0]?.resources?.files?.[0]?.resource).toEqual({
      kind: 'inline',
      name: 'payload',
      content: payload,
    })
  })

  it('reads from the manager’s environment when no host root serves it, and the environment wins over nothing', async () => {
    // A sandbox-rooted manager: no spawnResourceRoot, a reader over its own box instead.
    const instrument = 'x'.repeat(9_752) // fastpath.py's size in the run that motivated this
    const received: AgentProfile[] = []
    const reads: string[] = []
    const tb = createCoordinationTools({
      scope: mockScope(),
      blobs,
      makeWorkerAgent: (profile) => {
        received.push(profile)
        return { name: 'w', act: async () => 0 }
      },
      perWorker: { maxIterations: 1, maxTokens: 10 },
      spawnResourceReader: environmentReader({
        id: 'sandbox-7274acc42ded',
        async read(path) {
          reads.push(path)
          if (path === 'work/pinned/fastpath.py') return instrument
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        },
      }),
    })
    const spawn = tb.tools.find((x) => x.name === 'spawn_worker')
    if (!spawn) throw new Error('no spawn_worker')
    const result = await spawn.handler({
      profile: {
        name: 'producer',
        harness: 'opencode',
        model: { provider: 'tangle-router', default: 'claude-sonnet-4-6' },
        resources: {
          files: [
            {
              path: 'fastpath.py',
              resource: { kind: 'inline', name: 'fastpath', path: 'work/pinned/fastpath.py' },
            },
          ],
        },
      },
      task: 'run the battery',
      label: 'producer',
    })
    expect(result).toMatchObject({
      workerId: 'w0',
      resourcesFromPath: [
        {
          at: 'files[0].resource',
          path: 'work/pinned/fastpath.py',
          byteLength: 9_752,
          sha256: sha(instrument),
        },
      ],
    })
    expect(reads).toEqual(['work/pinned/fastpath.py'])
    expect(received[0]?.resources?.files?.[0]?.resource).toEqual({
      kind: 'inline',
      name: 'fastpath',
      content: instrument,
    })
  })

  it('prefers the environment reader over a host root when both are set', async () => {
    const { root } = await workspace()
    await writeFile(join(root, 'f.txt'), 'from the host')
    const received: AgentProfile[] = []
    const tb = createCoordinationTools({
      scope: mockScope(),
      blobs,
      makeWorkerAgent: (profile) => {
        received.push(profile)
        return { name: 'w', act: async () => 0 }
      },
      perWorker: { maxIterations: 1, maxTokens: 10 },
      spawnResourceRoot: root,
      spawnResourceReader: environmentReader({
        id: 'sandbox-x',
        read: async () => 'from the sandbox',
      }),
    })
    const spawn = tb.tools.find((x) => x.name === 'spawn_worker')
    if (!spawn) throw new Error('no spawn_worker')
    await spawn.handler({
      profile: {
        name: 'p',
        harness: 'opencode',
        model: { provider: 'tangle-router', default: 'claude-sonnet-4-6' },
        resources: {
          files: [{ path: 'f', resource: { kind: 'inline', name: 'f', path: 'f.txt' } }],
        },
      },
      task: 'go',
    })
    expect(received[0]?.resources?.files?.[0]?.resource).toMatchObject({
      content: 'from the sandbox',
    })
  })

  it('refuses the spawn, before any reservation, when the path cannot be resolved', async () => {
    const { root } = await workspace()
    let spawned = 0
    const tb = createCoordinationTools({
      scope: mockScope(),
      blobs,
      makeWorkerAgent: () => {
        spawned += 1
        return { name: 'w', act: async () => 0 }
      },
      perWorker: { maxIterations: 1, maxTokens: 10 },
      spawnResourceRoot: root,
    })
    const spawn = tb.tools.find((x) => x.name === 'spawn_worker')
    if (!spawn) throw new Error('no spawn_worker')
    const result = await spawn.handler({
      profile: {
        name: 'blind-checker',
        harness: 'opencode',
        model: { provider: 'tangle-router', default: 'claude-sonnet-4-6' },
        resources: {
          files: [{ path: 'p', resource: { kind: 'inline', name: 'p', path: '../elsewhere' } }],
        },
      },
      task: 'go',
    })
    expect(result).toMatchObject({ error: 'invalid-profile' })
    expect((result as { reason: string }).reason).toContain('resources.files[0].resource')
    expect((result as { reason: string }).reason).toContain('leaves the workspace root')
    expect(spawned).toBe(0)
  })
})

describe('rootSpawnResourceRoot', () => {
  it('is the cwd of a loopback bridge driver and nothing else', () => {
    const bridge = {
      backend: 'bridge' as const,
      bridgeUrl: 'http://127.0.0.1:8913',
      bridgeBearer: 'b',
    }
    expect(rootSpawnResourceRoot({ ...bridge, cwd: '/runs/r1/workspace' })).toBe(
      '/runs/r1/workspace',
    )
    expect(
      rootSpawnResourceRoot({ ...bridge, bridgeUrl: 'http://localhost:8913', cwd: '/w' }),
    ).toBe('/w')
    expect(rootSpawnResourceRoot(bridge)).toBeUndefined()
    expect(
      rootSpawnResourceRoot({ ...bridge, bridgeUrl: 'https://bridge.example.net', cwd: '/w' }),
    ).toBeUndefined()
    expect(rootSpawnResourceRoot({ ...bridge, bridgeUrl: 'not a url', cwd: '/w' })).toBeUndefined()
    expect(rootSpawnResourceRoot({ backend: 'cli', bin: 'x', cwd: '/w' })).toBeUndefined()
    expect(rootSpawnResourceRoot(undefined)).toBeUndefined()
  })
})
