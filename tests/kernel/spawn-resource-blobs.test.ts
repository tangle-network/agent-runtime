import { createHash } from 'node:crypto'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore } from '../../src/durable/spawn-journal'
import { ConfigError } from '../../src/errors'
import type { McpToolDescriptor } from '../../src/mcp/server'
import { createCoordinationTools, type JournalPage } from '../../src/mcp/tools/coordination'
import {
  decodeSpawnBlobBase64,
  InMemorySpawnBlobStore,
  parseSpawnBlobRef,
  SPAWN_BLOB_MAX_BYTES,
  type SpawnBlobStore,
  spawnBlobRef,
} from '../../src/mcp/tools/spawn-blob-store'
import { resolveSpawnResources } from '../../src/mcp/tools/spawn-resource-paths'
import type { Budget, ResultBlobStore, Scope, Spend } from '../../src/runtime'
import { serveCoordinationMcp } from '../../src/runtime/supervise/coordination-mcp'
import { alignedTableModule } from '../helpers/aligned-table-module'

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
const kindOf = (entry: JournalPage['entries'][number]) =>
  (entry.event as { type?: string } | undefined)?.type
const zeroSpend = (): Spend => ({ iterations: 0, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 })
const blobs: ResultBlobStore = { get: async () => undefined, put: async () => {} }

/** The manager's own scope, with `spawn` calling the agent thunk so a test can read the profile a
 *  child would actually receive. Counting calls is how the ordering assertions prove a refusal
 *  happened before any child existed. */
function mockScope(spy?: { spawned: number }) {
  const nodes: unknown[] = []
  const scope = {
    spawn: (agent: () => unknown, _task: unknown, opts: { label: string }) => {
      if (spy) spy.spawned += 1
      agent()
      nodes.push({
        id: 'w0',
        label: opts.label,
        status: 'running' as const,
        runtime: 'router',
        budget: { maxIterations: 1, maxTokens: 10 },
        spent: zeroSpend(),
      })
      return {
        ok: true as const,
        handle: { id: 'w0', label: opts.label, status: 'running' as const, abort() {} },
      }
    },
    next: async () => null,
    send: () => false,
    get view() {
      return { root: 'root', nodes, inFlight: nodes.length }
    },
    budget: { tokensLeft: 10, usdLeft: 0, deadlineMs: 0, reservedTokens: 0 },
    signal: new AbortController().signal,
  }
  return scope as unknown as Scope<unknown>
}

interface Toolbox {
  readonly put: McpToolDescriptor
  readonly spawn: McpToolDescriptor
  readonly received: AgentProfile[]
  readonly tools: ReturnType<typeof createCoordinationTools>
}

function toolbox(options?: {
  spawnResources?: Record<string, number>
  spy?: { spawned: number }
}): Toolbox {
  const received: AgentProfile[] = []
  const tools = createCoordinationTools({
    scope: mockScope(options?.spy),
    blobs,
    makeWorkerAgent: (profile) => {
      received.push(profile)
      return { name: 'w', act: async () => 0 }
    },
    perWorker: { maxIterations: 1, maxTokens: 10 },
    ...(options?.spawnResources ? { spawnResources: options.spawnResources } : {}),
  })
  const put = tools.tools.find((t) => t.name === 'put_blob')
  const spawn = tools.tools.find((t) => t.name === 'spawn_worker')
  if (!put || !spawn) throw new Error('coordination toolbox is missing put_blob or spawn_worker')
  return { put, spawn, received, tools }
}

const stageArgs = (bytes: Buffer, name = 'probe.py') => ({
  name,
  sha256: spawnBlobRef(bytes),
  contentBase64: bytes.toString('base64'),
})

function blobProfile(ref: string, name = 'probe') {
  return {
    name: 'blind-checker',
    harness: 'opencode',
    model: { provider: 'tangle-router', default: 'claude-sonnet-4-6' },
    resources: { files: [{ path: 'probe.py', resource: { kind: 'inline', name, blob: ref } }] },
  }
}

// ── The 2026-09-17 defect, byte for byte ──────────────────────────────────────────────────────

describe('a file with an aligned table survives staging byte-exact', () => {
  it('stages 6,983 authored bytes and hands the child 6,983 bytes, not 6,981', async () => {
    const authored = alignedTableModule()
    expect(authored.length).toBe(6983)
    const box = toolbox()
    const staged = (await box.put.handler(stageArgs(authored))) as Record<string, unknown>
    expect(staged).toMatchObject({ ref: spawnBlobRef(authored), bytes: 6983, stored: true })

    const spawned = (await box.spawn.handler({
      profile: blobProfile(spawnBlobRef(authored)),
      task: 'run probe.py and report its sha256',
      label: 'checker',
    })) as Record<string, unknown>
    expect(spawned).toMatchObject({
      workerId: 'w0',
      resourcesFromBlob: [
        {
          at: 'files[0].resource',
          blob: spawnBlobRef(authored),
          name: 'probe',
          byteLength: 6983,
          sha256: sha(authored),
        },
      ],
    })
    const delivered = box.received[0]?.resources?.files?.[0]?.resource as {
      kind: string
      name: string
      content: string
      blob?: string
    }
    expect(delivered.kind).toBe('inline')
    expect(delivered.blob).toBeUndefined()
    expect(Buffer.from(delivered.content, 'utf8').equals(authored)).toBe(true)
    expect(sha(Buffer.from(delivered.content, 'utf8'))).toBe(sha(authored))
    expect(Buffer.byteLength(delivered.content, 'utf8')).toBe(6983)
  })

  it('resolves the same bytes straight through the resolver', async () => {
    const authored = alignedTableModule()
    const store = new InMemorySpawnBlobStore()
    const ref = spawnBlobRef(authored)
    expect(store.put(ref, authored)).toEqual({ ok: true, stored: true })
    const result = await resolveSpawnResources(blobProfile(ref), { blobs: store })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const profile = result.profile as { resources: { files: Array<{ resource: unknown }> } }
    expect(profile.resources.files[0]?.resource).toEqual({
      kind: 'inline',
      name: 'probe',
      content: authored.toString('utf8'),
    })
    expect(result.resolvedBlobs).toEqual([
      {
        at: 'files[0].resource',
        blob: ref,
        name: 'probe',
        byteLength: 6983,
        sha256: sha(authored),
      },
    ])
  })
})

// ── put_blob ──────────────────────────────────────────────────────────────────────────────────

describe('put_blob', () => {
  it('stages once and reports a re-stage of identical bytes as stored:false', async () => {
    const box = toolbox()
    const bytes = Buffer.from('print("hello")\n')
    const first = (await box.put.handler(stageArgs(bytes))) as Record<string, unknown>
    expect(first).toMatchObject({
      ref: spawnBlobRef(bytes),
      name: 'probe.py',
      bytes: bytes.length,
      stored: true,
      store: { blobs: 1, bytes: bytes.length },
    })
    const again = (await box.put.handler(stageArgs(bytes))) as Record<string, unknown>
    expect(again).toMatchObject({ stored: false, store: { blobs: 1, bytes: bytes.length } })
    expect(box.tools.history().filter((r) => r.event.type === 'blob-staged')).toHaveLength(1)
  })

  it('stores nothing when the declared digest does not match the bytes', async () => {
    const box = toolbox()
    const authored = Buffer.from('alpha')
    const other = Buffer.from('alphb')
    const declared = spawnBlobRef(authored)
    const result = (await box.put.handler({
      name: 'p.py',
      sha256: declared,
      contentBase64: other.toString('base64'),
    })) as Record<string, string>
    expect(result.error).toBe('blob-digest-mismatch')
    expect(result.reason).toContain(spawnBlobRef(other))
    expect(result.reason).toContain(declared)
    expect(box.tools.blobStore().stats().blobs).toBe(0)
    expect(box.tools.blobStore().get(declared)).toBeUndefined()
    expect(box.tools.blobStore().get(spawnBlobRef(other))).toBeUndefined()
    expect(box.tools.history().filter((r) => r.event.type === 'blob-staged')).toHaveLength(0)
    const spawned = (await box.spawn.handler({
      profile: blobProfile(declared),
      task: 'go',
    })) as Record<string, string>
    expect(spawned.error).toBe('invalid-profile')
    expect(spawned.reason).toContain('is not held by this manager')
  })

  it('refuses every malformed request and stores nothing', async () => {
    const bytes = Buffer.from('x'.repeat(40))
    const good = stageArgs(bytes)
    const controlName = `a${String.fromCharCode(7)}b`
    const cases: ReadonlyArray<readonly [string, Record<string, unknown>, string]> = [
      ['uppercase hex', { ...good, sha256: good.sha256.toUpperCase() }, 'invalid-blob-digest'],
      ['no prefix', { ...good, sha256: sha(bytes) }, 'invalid-blob-digest'],
      ['63 hex', { ...good, sha256: `sha256:${sha(bytes).slice(0, 63)}` }, 'invalid-blob-digest'],
      ['bad alphabet', { ...good, contentBase64: '****' }, 'invalid-blob-encoding'],
      ['201-char name', { ...good, name: 'n'.repeat(201) }, 'invalid-blob-name'],
      ['control char name', { ...good, name: controlName }, 'invalid-blob-name'],
      ['drop plus stage', { ...good, drop: good.sha256 }, 'invalid-blob-request'],
      ['no fields at all', {}, 'invalid-blob-request'],
      ['missing contentBase64', { name: good.name, sha256: good.sha256 }, 'invalid-blob-request'],
    ]
    for (const [label, args, error] of cases) {
      const box = toolbox()
      const result = (await box.put.handler(args)) as Record<string, string>
      expect(result.error, label).toBe(error)
      expect(typeof result.reason, label).toBe('string')
      expect(box.tools.blobStore().stats().blobs, label).toBe(0)
      expect(
        box.tools.history().filter((r) => r.event.type === 'blob-staged'),
        label,
      ).toHaveLength(0)
    }
  })

  it('refuses bytes that are not valid UTF-8 and says to base64 them into the file instead', async () => {
    const box = toolbox()
    const bytes = Buffer.from([0xff, 0xfe, 0x00, 0x80])
    const result = (await box.put.handler(stageArgs(bytes, 'weights.bin'))) as Record<
      string,
      string
    >
    expect(result.error).toBe('blob-not-utf8')
    expect(result.reason).toContain('Base64-encode the file yourself')
    expect(box.tools.blobStore().stats().blobs).toBe(0)
  })

  it('bounds one blob, the entry count, and the total bytes', async () => {
    const perBlob = toolbox({ spawnResources: { maxBlobBytes: 64 } })
    const over = Buffer.from('a'.repeat(65))
    const tooLarge = (await perBlob.put.handler(stageArgs(over))) as Record<string, string>
    expect(tooLarge.error).toBe('blob-too-large')
    expect(tooLarge.reason).toContain('64')

    const counted = toolbox({ spawnResources: { maxBlobs: 2, maxBlobBytes: 64 } })
    for (const text of ['one', 'two']) {
      const ok = (await counted.put.handler(stageArgs(Buffer.from(text)))) as Record<
        string,
        unknown
      >
      expect(ok.stored).toBe(true)
    }
    const full = (await counted.put.handler(stageArgs(Buffer.from('three')))) as Record<
      string,
      string
    >
    expect(full.error).toBe('blob-store-full')
    expect(full.reason).toContain('2/2')
    // A full store still admits work already staged: a re-stage is a no-op, not a refusal.
    const restage = (await counted.put.handler(stageArgs(Buffer.from('one')))) as Record<
      string,
      unknown
    >
    expect(restage).toMatchObject({ stored: false })

    const byBytes = toolbox({ spawnResources: { maxBlobs: 64, maxBlobTotalBytes: 8 } })
    expect(
      ((await byBytes.put.handler(stageArgs(Buffer.from('12345678')))) as Record<string, unknown>)
        .stored,
    ).toBe(true)
    const overTotal = (await byBytes.put.handler(stageArgs(Buffer.from('9')))) as Record<
      string,
      string
    >
    expect(overTotal.error).toBe('blob-store-full')
    expect(overTotal.reason).toContain('8/8')
    expect(byBytes.tools.blobStore().stats().blobs).toBe(1)
  })

  it('carries maxContentBytes from the toolbox option into the spawn refusal', async () => {
    // The bound a caller sets on supervise() has to reach the resolver, or the refusal it exists
    // to produce never happens and the run pays for a sandbox to learn the same thing.
    const box = toolbox({ spawnResources: { maxContentBytes: 16_384 } })
    const big = Buffer.from('y'.repeat(20_000))
    expect(
      ((await box.put.handler(stageArgs(big, 'big.py'))) as Record<string, unknown>).stored,
    ).toBe(true)
    const refused = (await box.spawn.handler({
      profile: blobProfile(spawnBlobRef(big)),
      task: 'go',
    })) as Record<string, string>
    expect(refused.error).toBe('invalid-profile')
    expect(refused.reason).toContain('20000 bytes')
    expect(refused.reason).toContain('16384 bytes')
    expect(refused.reason).toContain('tangle-network/agent-sdk#340')
    // Under the bound, the same transport admits the file.
    const small = Buffer.from('z'.repeat(16_384))
    await box.put.handler(stageArgs(small, 'small.py'))
    const admitted = (await box.spawn.handler({
      profile: blobProfile(spawnBlobRef(small)),
      task: 'go',
    })) as Record<string, unknown>
    expect(admitted.workerId).toBe('w0')
  })

  it('drops a held blob and reports an unheld one honestly', async () => {
    const box = toolbox()
    const bytes = Buffer.from('to be dropped')
    const ref = spawnBlobRef(bytes)
    await box.put.handler(stageArgs(bytes))
    expect(box.tools.blobStore().stats().blobs).toBe(1)
    expect(await box.put.handler({ drop: ref })).toMatchObject({
      dropped: true,
      store: { blobs: 0, bytes: 0 },
    })
    expect(await box.put.handler({ drop: ref })).toMatchObject({ dropped: false })
    const spawned = (await box.spawn.handler({
      profile: blobProfile(ref),
      task: 'go',
    })) as Record<string, string>
    expect(spawned.error).toBe('invalid-profile')
    expect(spawned.reason).toContain('is not held by this manager')
  })
})

// ── Construction bound ────────────────────────────────────────────────────────────────────────

describe('a blob bound the transport cannot carry fails at construction', () => {
  it('refuses maxBlobBytes the request bound cannot hold, and accepts the defaults', async () => {
    const scope = {} as Scope<unknown>
    await expect(
      serveCoordinationMcp({
        scope,
        blobs: new InMemoryResultBlobStore(),
        makeWorkerAgent: () => ({ name: 'w', act: async () => 0 }),
        perWorker: { maxIterations: 1, maxTokens: 1 } as Budget,
        toolNames: ['put_blob'],
        spawnResources: { maxBlobBytes: 900 * 1024 },
      }),
    ).rejects.toBeInstanceOf(ConfigError)
    const ok = await serveCoordinationMcp({
      scope,
      blobs: new InMemoryResultBlobStore(),
      makeWorkerAgent: () => ({ name: 'w', act: async () => 0 }),
      perWorker: { maxIterations: 1, maxTokens: 1 } as Budget,
      toolNames: ['put_blob'],
      spawnResources: { maxBlobBytes: SPAWN_BLOB_MAX_BYTES },
    })
    expect(ok.blobStats()).toMatchObject({ blobs: 0, bytes: 0 })
    await ok.close()
  })

  it('leaves a server that does not grant put_blob free to hold any request bound', async () => {
    // The bound is a promise about a capability. A server that serves no staging verb makes no
    // such promise, and several deliberately run a very small request bound.
    const ungranted = await serveCoordinationMcp({
      scope: {} as Scope<unknown>,
      blobs: new InMemoryResultBlobStore(),
      makeWorkerAgent: () => ({ name: 'w', act: async () => 0 }),
      perWorker: { maxIterations: 1, maxTokens: 1 } as Budget,
      toolNames: ['spawn_worker'],
      maxRequestBytes: 128,
    })
    expect(ungranted.blobStats()).toMatchObject({ blobs: 0, maxBytes: 32 * 1024 * 1024 })
    await ungranted.close()
  })
})

// ── Resolver refusals ─────────────────────────────────────────────────────────────────────────

describe('the resolver refuses a reference it cannot prove', () => {
  const bytes = Buffer.from('print(1)\n')
  const ref = spawnBlobRef(bytes)

  function heldStore(content: Buffer = bytes): SpawnBlobStore {
    const store = new InMemorySpawnBlobStore()
    store.put(ref, content)
    return store
  }

  it('names the exact reason for every refusable shape', async () => {
    const liar: SpawnBlobStore = {
      get: () => Buffer.from('different bytes'),
      put: () => ({ ok: true, stored: true }),
      drop: () => false,
      stats: () => ({ blobs: 1, bytes: 15, maxBlobs: 1, maxBytes: 15 }),
      clear: () => {},
    }
    const cases: ReadonlyArray<
      readonly [string, unknown, { blobs?: SpawnBlobStore; maxContentBytes?: number }, string]
    > = [
      [
        'unknown digest',
        blobProfile(spawnBlobRef(Buffer.from('absent'))),
        { blobs: heldStore() },
        'is not held by this manager',
      ],
      [
        'bytes that do not hash to the key',
        blobProfile(ref),
        { blobs: liar },
        'the reference is refused',
      ],
      [
        'both path and blob',
        {
          resources: {
            files: [
              { path: 'p', resource: { kind: 'inline', name: 'p', path: 'p.py', blob: ref } },
            ],
          },
        },
        { blobs: heldStore() },
        'names both path and blob',
      ],
      ['no store wired', blobProfile(ref), {}, 'holds no blob store'],
      [
        'uppercase hex',
        blobProfile(`sha256:${sha(bytes).toUpperCase()}`),
        { blobs: heldStore() },
        '64 lowercase hex',
      ],
      [
        'over maxContentBytes',
        blobProfile(ref),
        { blobs: heldStore(), maxContentBytes: 8 },
        'tangle-network/agent-sdk#340',
      ],
    ]
    for (const [label, profile, source, fragment] of cases) {
      const result = await resolveSpawnResources(profile, source)
      expect(result.ok, label).toBe(false)
      if (result.ok) continue
      expect(result.reason, label).toContain(fragment)
    }
  })

  it('admits exactly maxContentBytes and refuses one more', async () => {
    const store = heldStore()
    const exact = await resolveSpawnResources(blobProfile(ref), {
      blobs: store,
      maxContentBytes: bytes.length,
    })
    expect(exact.ok).toBe(true)
    const over = await resolveSpawnResources(blobProfile(ref), {
      blobs: store,
      maxContentBytes: bytes.length - 1,
    })
    expect(over.ok).toBe(false)
    if (over.ok) return
    expect(over.reason).toContain(`${bytes.length} bytes`)
    expect(over.reason).toContain(`${bytes.length - 1} bytes`)
  })

  it('reaches every resource list the canonical schema declares', async () => {
    const store = heldStore()
    const resource = { kind: 'inline', name: 'r', blob: ref }
    const lists = [
      ['files', { files: [{ path: 'r.py', resource }] }, 'files[0].resource'],
      ['tools', { tools: [resource] }, 'tools[0]'],
      ['skills', { skills: [resource] }, 'skills[0]'],
      ['agents', { agents: [resource] }, 'agents[0]'],
      ['commands', { commands: [resource] }, 'commands[0]'],
      ['instructions', { instructions: resource }, 'instructions'],
    ] as const
    for (const [label, resources, at] of lists) {
      const result = await resolveSpawnResources({ name: 'p', resources }, { blobs: store })
      expect(result.ok, label).toBe(true)
      if (!result.ok) continue
      expect(
        result.resolvedBlobs.map((r) => r.at),
        label,
      ).toEqual([at])
    }
  })
})

// ── Ordering: nothing is created before the refusal ───────────────────────────────────────────

describe('an unresolvable blob is refused before a child exists', () => {
  it('starts no worker and writes no journal row', async () => {
    const spy = { spawned: 0 }
    const box = toolbox({ spy })
    const rowsBefore = box.tools.history().length
    const result = (await box.spawn.handler({
      profile: blobProfile(spawnBlobRef(Buffer.from('never staged'))),
      task: 'go',
    })) as Record<string, string>
    expect(result.error).toBe('invalid-profile')
    expect(result.reason).toContain('resources.files[0].resource: ')
    expect(spy.spawned).toBe(0)
    expect(box.received).toHaveLength(0)
    expect(box.tools.history().length).toBe(rowsBefore)
    expect(box.tools.tools.find((t) => t.name === 'observe_agent')).toBeDefined()
    // The manager's own capacity reading is untouched: the refusal consumed no slot.
    const after = (await box.spawn.handler({ profile: { name: 'p' }, task: 'probe' })) as Record<
      string,
      unknown
    >
    expect(after.workerId).toBe('w0')
    expect(spy.spawned).toBe(1)
  })
})

// ── Journal ───────────────────────────────────────────────────────────────────────────────────

describe('a staged blob is one journal row carrying no content', () => {
  it('is projected in full by read_journal and never delivered by await_event', async () => {
    const box = toolbox()
    const bytes = alignedTableModule()
    const before = Date.now()
    await box.put.handler(stageArgs(bytes, 'aligned.py'))
    const read = box.tools.tools.find((t) => t.name === 'read_journal')
    if (!read) throw new Error('no read_journal')
    const unfiltered = (await read.handler({})) as JournalPage
    expect(unfiltered.entries.filter((e) => kindOf(e) === 'blob-staged')).toHaveLength(1)
    // The filter and the unfiltered read must agree; naming a kind the unfiltered read returns and
    // the filter drops is the exact drift JournalKindsAreExhaustive exists to prevent.
    const named = (await read.handler({ kinds: ['blob-staged'] })) as JournalPage
    expect(named.entries).toHaveLength(1)
    const event = named.entries[0]?.event as { type: string; blob: Record<string, unknown> }
    expect(event.type).toBe('blob-staged')
    expect(event.blob).toMatchObject({
      ref: spawnBlobRef(bytes),
      name: 'aligned.py',
      byteLength: 6983,
    })
    expect(typeof event.blob.stagedAt).toBe('number')
    expect(event.blob.stagedAt as number).toBeGreaterThanOrEqual(before)
    // The row is the receipt, never the file: a journal that carried the bytes would multiply the
    // one place they are already durably recorded (inside the spawned profile).
    expect(JSON.stringify(event)).not.toContain('resid_pre')
    expect(JSON.stringify(event)).not.toContain(bytes.toString('base64').slice(0, 32))
    const awaitEvent = box.tools.tools.find((t) => t.name === 'await_event')
    if (!awaitEvent) throw new Error('no await_event')
    expect(await awaitEvent.handler({})).toMatchObject({ idle: true })
  })
})

// ── Isolation ─────────────────────────────────────────────────────────────────────────────────

describe('one manager cannot reference a blob another manager staged', () => {
  it('holds a per-toolbox store, and identical content is not shared authorization', async () => {
    const bytes = alignedTableModule()
    const ref = spawnBlobRef(bytes)
    const a = toolbox()
    const b = toolbox()
    await a.put.handler(stageArgs(bytes))
    expect(a.tools.blobStore().stats().blobs).toBe(1)
    expect(b.tools.blobStore().stats().blobs).toBe(0)
    const refused = (await b.spawn.handler({ profile: blobProfile(ref), task: 'go' })) as Record<
      string,
      string
    >
    expect(refused.error).toBe('invalid-profile')
    expect(refused.reason).toContain('is not held by this manager')
    await b.put.handler(stageArgs(bytes))
    const admitted = (await b.spawn.handler({ profile: blobProfile(ref), task: 'go' })) as Record<
      string,
      unknown
    >
    expect(admitted.workerId).toBe('w0')
  })

  it('gives every manager a store with no option set, unlike spawnResourceRoot', async () => {
    // A nested manager builds its own toolbox and is handed no root; it must still be able to
    // stage, or a sandbox sub-director has no byte transport at all.
    const nested = toolbox()
    const bytes = Buffer.from('nested\n')
    expect(((await nested.put.handler(stageArgs(bytes))) as Record<string, unknown>).stored).toBe(
      true,
    )
    const spawned = (await nested.spawn.handler({
      profile: blobProfile(spawnBlobRef(bytes)),
      task: 'go',
    })) as Record<string, unknown>
    expect(spawned.workerId).toBe('w0')
  })
})

// ── The pure store and its parsers ────────────────────────────────────────────────────────────

describe('spawn blob store primitives', () => {
  it('accepts exactly one address spelling', () => {
    const hex = sha('x')
    expect(parseSpawnBlobRef(`sha256:${hex}`)).toBe(`sha256:${hex}`)
    expect(parseSpawnBlobRef(`sha256:${hex.toUpperCase()}`)).toBeUndefined()
    expect(parseSpawnBlobRef(hex)).toBeUndefined()
    expect(parseSpawnBlobRef(`sha256:${hex.slice(0, 63)}`)).toBeUndefined()
    expect(parseSpawnBlobRef(`sha256:${hex} `)).toBeUndefined()
    expect(parseSpawnBlobRef(42)).toBeUndefined()
  })

  it('decodes standard base64 and refuses anything else', () => {
    const bytes = alignedTableModule()
    expect(decodeSpawnBlobBase64(bytes.toString('base64'))?.equals(bytes)).toBe(true)
    // `base64` without -w0 wraps at 76 columns; whitespace is stripped before decoding.
    const wrapped = (bytes.toString('base64').match(/.{1,76}/g) ?? []).join('\n')
    expect(decodeSpawnBlobBase64(wrapped)?.equals(bytes)).toBe(true)
    expect(decodeSpawnBlobBase64('')?.length).toBe(0)
    expect(decodeSpawnBlobBase64('****')).toBeUndefined()
    expect(decodeSpawnBlobBase64('AAAA=')).toBeUndefined()
    // Base64url is a different alphabet; accepting it would make two spellings of one byte string.
    expect(decodeSpawnBlobBase64('-_8=')).toBeUndefined()
    expect(decodeSpawnBlobBase64(bytes.toString('base64').slice(0, -1))).toBeUndefined()
  })

  it('refuses a construction bound that is not a positive safe integer', () => {
    expect(() => new InMemorySpawnBlobStore({ maxBlobs: 0 })).toThrow(ConfigError)
    expect(() => new InMemorySpawnBlobStore({ maxBlobBytes: 1.5 })).toThrow(ConfigError)
    expect(() => new InMemorySpawnBlobStore({ maxBlobTotalBytes: -1 })).toThrow(ConfigError)
  })

  it('clears every held blob', () => {
    const store = new InMemorySpawnBlobStore()
    const bytes = Buffer.from('held')
    store.put(spawnBlobRef(bytes), bytes)
    expect(store.stats().blobs).toBe(1)
    store.clear()
    expect(store.stats()).toMatchObject({ blobs: 0, bytes: 0 })
  })
})
