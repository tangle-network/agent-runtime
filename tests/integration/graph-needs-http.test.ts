import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { expect, it } from 'vitest'
import { ValidationError } from '../../src/errors'
import {
  GraphFileResolutionError,
  type LoadGraphFileOptions,
  loadGraphFile,
} from '../../src/runtime/supervise/graph-file'

type Connection = NonNullable<AgentProfile['connections']>[number]
type ResolveNeed = NonNullable<LoadGraphFileOptions['resolveNeed']>
const bindings = {
  fast: { connectionId: 'connection-fast', capabilities: ['read'] },
  slow: { connectionId: 'connection-slow', capabilities: ['write'] },
} satisfies Record<string, Connection>
const authored: Connection = { connectionId: 'already-authored', capabilities: ['read'] }

function source(needs = [['${trigger.provider}', '${params.provider}'], ['${params.provider}']]) {
  return JSON.stringify({
    params: { provider: { type: 'string', default: 'fast' } },
    nodes: ['one', 'two'].map((id, index) => ({
      id,
      needs: needs[index],
      profile: {
        harness: 'cli-base',
        model: { provider: 'offline', default: 'offline/local-process' },
        connections: [authored],
      },
    })),
    entry: [{ node: 'one', task: {} }],
    edges: [
      {
        kind: 'routes',
        from: 'one',
        to: 'two',
        directive: { surface: 'delegates/worker-brief', version: 1 },
      },
    ],
    budget: { maxIterations: 10, maxTokens: 1000 },
    check: { node: 'two', pointer: '/done', exists: true },
  })
}

// A caller-owned, authenticated local inventory served from actual files over real TCP HTTP.
// This is not an OAuth/Hub simulator and replaces no Runtime network client or production API.
async function bindingHost() {
  const directory = await mkdtemp(join(tmpdir(), 'graph-need-http-'))
  await mkdir(join(directory, 'bindings'))
  for (const [provider, binding] of Object.entries(bindings))
    await writeFile(join(directory, 'bindings', `${provider}.json`), JSON.stringify(binding))
  const credential = 'local-binding-host-private-canary'
  const requests: string[] = []
  const arrived = new Map<string, () => void>()
  const closed = new Map<string, () => void>()
  const closedProviders = new Set<string>()
  const held = new Map<string, { wait: Promise<void>; release(): void }>()
  const active = new Set<Promise<void>>()
  const server = createServer((request, response) => {
    const pending = (async () => {
      const provider = /^\/([a-z-]+)\.json$/u.exec(
        new URL(request.url!, 'http://localhost').pathname,
      )?.[1]
      if (!provider || request.headers.authorization !== `Bearer ${credential}`) {
        response.writeHead(403).end()
        return
      }
      requests.push(provider)
      arrived.get(provider)?.()
      response.once('close', () => {
        closedProviders.add(provider)
        closed.get(provider)?.()
      })
      const gate = held.get(provider)
      if (gate)
        await Promise.race([
          gate.wait,
          new Promise<void>((resolve) => response.once('close', resolve)),
        ])
      if (response.destroyed) return
      try {
        const data = await readFile(join(directory, 'bindings', `${provider}.json`))
        response.writeHead(200, { 'content-type': 'application/json' }).end(data)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        response.writeHead(404).end()
      }
    })()
    active.add(pending)
    void pending.then(
      () => active.delete(pending),
      (error) => {
        active.delete(pending)
        response.destroy(error)
      },
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('local binding host did not bind TCP')
  const url = `http://127.0.0.1:${address.port}`
  return {
    directory,
    requests,
    async read(provider: string, signal?: AbortSignal) {
      return fetch(`${url}/${provider}.json`, {
        signal,
        headers: { authorization: `Bearer ${credential}` },
      })
    },
    hold(provider: string) {
      let release!: () => void
      const wait = new Promise<void>((resolve) => {
        release = resolve
      })
      held.set(provider, { wait, release })
    },
    release(provider: string) {
      held.get(provider)?.release()
    },
    arrival(provider: string) {
      return requests.includes(provider)
        ? Promise.resolve()
        : new Promise<void>((resolve) => arrived.set(provider, resolve))
    },
    closed(provider: string) {
      return closedProviders.has(provider)
        ? Promise.resolve()
        : new Promise<void>((resolve) => closed.set(provider, resolve))
    },
    assertNoCredentials(value: unknown) {
      expect(JSON.stringify(value)).not.toContain(credential)
    },
    async close() {
      for (const gate of held.values()) gate.release()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      })
      await Promise.allSettled(active)
      await rm(directory, { recursive: true, force: true })
    },
  }
}

it('binds through a real HTTP host once per host scope while preserving canonical order and digest', async () => {
  const host = await bindingHost()
  const file = join(host.directory, 'definitions', 'graph.json')
  const options = { source: source(), params: { provider: 'fast' }, trigger: { provider: 'slow' } }
  const contexts: Array<{ provider: string; node: string; cwd: string | undefined }> = []
  const completed: string[] = []
  // Coalescing is this caller's policy, scoped to one binding inventory/account and compilation.
  const resolver = (): ResolveNeed => {
    const pending = new Map<string, Promise<Connection | undefined>>()
    return (provider, context) => {
      contexts.push({ provider, node: context.node, cwd: context.cwd })
      let binding = pending.get(provider)
      if (!binding) {
        binding = host.read(provider, context.signal).then(async (response) => {
          if (response.status === 404) return undefined
          if (!response.ok) throw response
          const value: Connection = await response.json()
          completed.push(provider)
          if (provider === 'fast') host.release('slow')
          return value
        })
        pending.set(provider, binding)
      }
      return binding
    }
  }
  try {
    host.hold('slow')
    const expected = await loadGraphFile(file, { ...options, needs: bindings })
    const loaded = await loadGraphFile(file, { ...options, resolveNeed: resolver() })
    expect(loaded.graph).toEqual(expected.graph)
    expect(loaded.graph.digest).toBe(expected.graph.digest)
    expect(loaded.graph.nodes[0]!.profile.connections).toEqual([
      authored,
      bindings.slow,
      bindings.fast,
    ])
    expect(loaded.graph.nodes[1]!.profile.connections).toEqual([authored, bindings.fast])
    expect(completed).toEqual(['fast', 'slow'])
    expect(host.requests.filter((provider) => provider === 'fast')).toHaveLength(1)
    expect(host.requests.filter((provider) => provider === 'slow')).toHaveLength(1)
    expect(
      contexts.filter((context) => context.provider === 'fast').map((context) => context.node),
    ).toEqual(['one', 'two'])
    expect(contexts.every((context) => context.cwd === dirname(file))).toBe(true)
    const requestCount = host.requests.length
    await loadGraphFile(file, { ...options, needs: bindings, resolveNeed: resolver() })
    for (const invalid of [undefined, null, { connectionId: 7 }]) {
      await expect(
        loadGraphFile(file, {
          ...options,
          needs: { ...bindings, fast: invalid } as unknown as LoadGraphFileOptions['needs'],
          resolveNeed: resolver(),
        }),
      ).rejects.toBeInstanceOf(ValidationError)
    }
    expect(host.requests).toHaveLength(requestCount)
    expect(contexts).toHaveLength(3)
    const inherited = Object.assign(
      Object.create({ fast: { connectionId: 'must-not-use-inherited' } }),
      { slow: bindings.slow },
    ) as NonNullable<LoadGraphFileOptions['needs']>
    const inheritedResult = await loadGraphFile(file, {
      ...options,
      needs: inherited,
      resolveNeed: resolver(),
    })
    expect(inheritedResult.graph).toEqual(expected.graph)
    expect(host.requests.filter((provider) => provider === 'fast')).toHaveLength(2)
    // A fresh host resolver reacquires the same provider: Runtime has no cross-load cache.
    const reacquired = await loadGraphFile(file, { ...options, resolveNeed: resolver() })
    expect(reacquired.graph.digest).toBe(expected.graph.digest)
    expect(host.requests.filter((provider) => provider === 'fast')).toHaveLength(3)
    host.assertNoCredentials(loaded)
  } finally {
    await host.close()
  }
}, 30000)

it('keeps offline misses typed and preserves every host rejection value after real HTTP I/O', async () => {
  const host = await bindingHost()
  const file = join(host.directory, 'graph.json')
  const options = { source: source([['missing'], []]) }
  try {
    await expect(loadGraphFile(file, options)).rejects.toMatchObject({
      code: 'CONNECTION_REQUIRED',
      provider: 'missing',
      node: 'one',
    })
    expect(host.requests).toEqual([])
    const resolveNeed: ResolveNeed = async (provider, context) => {
      const response = await host.read(provider, context.signal)
      if (response.status === 404) return undefined
      return response.json()
    }
    const unavailable = await loadGraphFile(file, { ...options, resolveNeed }).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(unavailable).toBeInstanceOf(GraphFileResolutionError)
    expect(unavailable).toMatchObject({ provider: 'missing', node: 'one' })
    for (const rejection of [
      undefined,
      'host declined binding',
      { code: 'HOST_ACCOUNT_REQUIRED' },
    ]) {
      const rejected = await loadGraphFile(file, {
        ...options,
        resolveNeed: async (provider, context) => {
          const response = await host.read(provider, context.signal)
          expect(response.status).toBe(404)
          await response.arrayBuffer()
          throw rejection
        },
      }).then(
        () => ({ rejected: false }),
        (error: unknown) => ({ rejected: true, error }),
      )
      expect(rejected).toEqual({ rejected: true, error: rejection })
      if ('error' in rejected) expect(rejected.error).toBe(rejection)
    }
    await writeFile(
      join(host.directory, 'bindings', 'invalid.json'),
      JSON.stringify({ connectionId: 42 }),
    )
    await expect(
      loadGraphFile(file, { source: source([['invalid'], []]), resolveNeed }),
    ).rejects.toBeInstanceOf(ValidationError)
  } finally {
    await host.close()
  }
}, 30000)

it('passes the effective cwd and exact cancellation signal through an owned HTTP request and joins it', async () => {
  const host = await bindingHost()
  const controller = new AbortController()
  const reason = new Error('caller stopped binding resolution')
  const cwd = join(host.directory, 'effective-workspace')
  let observed: unknown
  let pending: ReturnType<typeof loadGraphFile> | undefined
  host.hold('pending')
  try {
    pending = loadGraphFile(join(host.directory, 'graph.json'), {
      source: source([['pending'], []]),
      cwd,
      signal: controller.signal,
      resolveNeed: async (provider, context) => {
        expect(context).toEqual({ node: 'one', cwd, signal: controller.signal })
        expect(context.signal).toBe(controller.signal)
        try {
          const response = await host.read(provider, context.signal)
          return response.json()
        } catch (error) {
          observed = error
          throw error
        }
      },
    })
    // Attach before awaiting network progress, so an early loader refusal is never unhandled.
    const outcome = pending.then(
      () => ({ rejected: false }),
      (error: unknown) => ({ rejected: true, error }),
    )
    await Promise.race([host.arrival('pending'), pending])
    controller.abort(reason)
    const result = await outcome
    expect(result.rejected).toBe(true)
    if ('error' in result) expect(result.error).toBe(observed)
    expect(observed).toBe(reason)
    await host.closed('pending')
    expect(host.requests).toEqual(['pending'])
  } finally {
    controller.abort(reason)
    await pending?.catch(() => undefined)
    await host.close()
  }
}, 30000)
