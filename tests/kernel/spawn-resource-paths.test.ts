import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { createCoordinationTools } from '../../src/mcp/tools/coordination-manager'
import {
  environmentReader,
  hostDirectoryReader,
  resolveSpawnResourcePaths,
  SPAWN_RESOURCE_PATH_MAX_BYTES,
} from '../../src/mcp/tools/spawn-resource-paths'
import type { ResultBlobStore, Scope, Spend } from '../../src/runtime'

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
})
