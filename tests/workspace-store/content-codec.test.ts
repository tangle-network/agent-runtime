import { describe, expect, it } from 'vitest'
import {
  createInMemoryWorkspaceStore,
  createMemoryTools,
  runWorkspaceStoreContract,
  workspaceStoreContractCases,
} from '../../src/workspace-store'
import {
  aesGcmContentCodecFromEnv,
  createAesGcmContentCodec,
  openWorkspaceBytes,
  SEALED_CONTENT_PREFIX,
  sealWorkspaceBytes,
  WorkspaceCodecError,
  withContentCodec,
} from '../../src/workspace-store/codec'

const key = (fill: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)))
const K1 = key(1)
const K2 = key(2)
const codec = (active = 'k1', keys: Record<string, string> = { k1: K1 }) =>
  createAesGcmContentCodec({ keys, activeKeyId: active })
const put = { workspaceId: 'tax', path: '/files/client.md', kind: 'file' as const, actor: 'cpa' }
const SSN = 'Client SSN 123-45-6789, AGI 84,200'

describe('workspace store with the AES-256-GCM content codec', () => {
  for (const contractCase of workspaceStoreContractCases(
    () => withContentCodec(createInMemoryWorkspaceStore(), codec()),
    { idempotentOperations: true },
  )) {
    it(`contract: ${contractCase.name}`, contractCase.run)
  }

  it('passes the whole contract, including operationId replay', async () => {
    const results = await runWorkspaceStoreContract(
      () => withContentCodec(createInMemoryWorkspaceStore(), codec()),
      { idempotentOperations: true },
    )
    expect(results.filter((result) => !result.passed)).toEqual([])
  })

  it('stores only ciphertext and keeps the index readable', async () => {
    const inner = createInMemoryWorkspaceStore()
    const store = withContentCodec(inner, codec())
    const saved = await store.put({ ...put, content: SSN, ifRevision: null })
    expect(saved.content).toBe(SSN)
    const raw = await inner.get('tax', '/files/client.md')
    expect(raw?.content?.startsWith(SEALED_CONTENT_PREFIX)).toBe(true)
    expect(raw?.content).not.toContain('123-45-6789')
    expect(raw).toMatchObject({
      path: '/files/client.md',
      kind: 'file',
      revision: 1,
      createdBy: 'cpa',
    })
    expect((await store.list('tax', '/files/')).map((entry) => entry.content)).toEqual([SSN])
    // Two writes of the same text without an operationId do not reveal they are equal.
    await store.put({ ...put, path: '/files/again.md', content: SSN, ifRevision: null })
    expect((await inner.get('tax', '/files/again.md'))?.content).not.toBe(raw?.content)
  })

  it('reads values sealed with a retired key after rotation and seals new ones with the active key', async () => {
    const inner = createInMemoryWorkspaceStore()
    await withContentCodec(inner, codec()).put({ ...put, content: 'old', ifRevision: null })
    const rotated = withContentCodec(inner, codec('k2', { k1: K1, k2: K2 }))
    expect((await rotated.get('tax', put.path))?.content).toBe('old')
    await rotated.put({ ...put, path: '/files/new.md', content: 'new', ifRevision: null })
    await expect(withContentCodec(inner, codec()).get('tax', '/files/new.md')).rejects.toThrow(
      /unknown workspace store key id: k2/,
    )
  })

  it('refuses a value moved to another path or tenant, or tampered with', async () => {
    const inner = createInMemoryWorkspaceStore()
    const store = withContentCodec(inner, codec())
    await store.put({ ...put, content: SSN, ifRevision: null })
    const sealed = (await inner.get('tax', put.path))!.content!
    await inner.put({ ...put, path: '/files/moved.md', content: sealed, ifRevision: null })
    await inner.put({ ...put, workspaceId: 'other', content: sealed, ifRevision: null })
    await expect(store.get('tax', '/files/moved.md')).rejects.toBeInstanceOf(WorkspaceCodecError)
    await expect(store.get('other', put.path)).rejects.toBeInstanceOf(WorkspaceCodecError)
    const bytes = Uint8Array.from(atob(sealed.slice(SEALED_CONTENT_PREFIX.length)), (c) =>
      c.charCodeAt(0),
    )
    bytes[bytes.length - 1]! ^= 1
    await inner.put({
      ...put,
      path: '/files/tampered.md',
      ifRevision: null,
      content: `${SEALED_CONTENT_PREFIX}${btoa(String.fromCharCode(...bytes))}`,
    })
    await expect(store.get('tax', '/files/tampered.md')).rejects.toBeInstanceOf(WorkspaceCodecError)
  })

  it('refuses plaintext at rest unless the store is being moved onto the codec', async () => {
    const inner = createInMemoryWorkspaceStore()
    await inner.put({ ...put, content: 'legacy', ifRevision: null })
    await expect(withContentCodec(inner, codec()).get('tax', put.path)).rejects.toThrow(
      /not sealed/,
    )
    expect(
      (await withContentCodec(inner, codec(), { readPlaintext: true }).get('tax', put.path))
        ?.content,
    ).toBe('legacy')
  })

  it('serves the memory tools through the codec', async () => {
    const inner = createInMemoryWorkspaceStore()
    const tools = createMemoryTools({
      store: withContentCodec(inner, codec()),
      activeTurn: async () => ({ workspaceId: 'tax', memberId: 'cpa', role: 'owner' }),
    })
    const tool = (name: string) => tools.find((candidate) => candidate.name === name)!
    await tool('memory.remember').run({
      text: 'Client files jointly with spouse',
      kind: 'fact',
      scope: 'workspace',
    })
    expect(await tool('memory.recall').run({ query: 'jointly spouse' })).toMatchObject({
      memories: [{ text: 'Client files jointly with spouse' }],
    })
    expect(JSON.stringify(await inner.list('tax', '/memories/'))).not.toContain('spouse')
  })

  it('seals bytes for upload under the entry path', async () => {
    const context = { tenant: 'tax', path: '/files/w2.pdf' }
    const plain = new TextEncoder().encode('%PDF W-2')
    const sealed = await sealWorkspaceBytes(codec(), context, plain)
    expect(new TextDecoder().decode(await openWorkspaceBytes(codec(), context, sealed))).toBe(
      '%PDF W-2',
    )
    await expect(
      openWorkspaceBytes(codec(), { ...context, path: '/files/other.pdf' }, sealed),
    ).rejects.toBeInstanceOf(WorkspaceCodecError)
  })

  it('builds the codec from env and refuses half or bad configuration', async () => {
    expect(aesGcmContentCodecFromEnv({})).toBeNull()
    const fromEnv = aesGcmContentCodecFromEnv({
      WORKSPACE_STORE_KEYS: `k1:${K1}, k2:${K2}`,
      WORKSPACE_STORE_KEY_ID: 'k2',
    })
    const store = withContentCodec(createInMemoryWorkspaceStore(), fromEnv!)
    await store.put({ ...put, content: 'env', ifRevision: null })
    expect((await store.get('tax', put.path))?.content).toBe('env')
    expect(() => aesGcmContentCodecFromEnv({ WORKSPACE_STORE_KEYS: `k1:${K1}` })).toThrow(
      /set both/,
    )
    expect(() =>
      aesGcmContentCodecFromEnv({ WORKSPACE_STORE_KEYS: `k1:${K1}`, WORKSPACE_STORE_KEY_ID: 'k9' }),
    ).toThrow(/not among the keys/)
    expect(() =>
      createAesGcmContentCodec({ keys: { k1: btoa('short') }, activeKeyId: 'k1' }),
    ).toThrow(/32 bytes/)
  })
})
