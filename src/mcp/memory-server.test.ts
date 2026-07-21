import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ValidationError } from '../errors'
import {
  createMemoryToolServer,
  MEMORY_FILE_ENV,
  MEMORY_ITEMS_ENV,
  type MemoryItem,
  parseMemoryItems,
  readMemoryItemsFile,
  resolveMemoryFromEnv,
} from './memory-server'

const tmp = mkdtempSync(join(tmpdir(), 'memory-server-test-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const ITEMS: MemoryItem[] = [
  { id: 'mem-1', text: 'Always run the failing test before editing the fix', tags: ['testing'] },
  { id: 'mem-2', text: 'Prefer reading the traceback over guessing the module', source: 'run-7' },
  { id: 'mem-3', text: 'Pin the schema version before migrating rows', tags: ['db'] },
]

describe('createMemoryToolServer', () => {
  const server = createMemoryToolServer({ items: ITEMS })

  it('answers the MCP handshake with server info', async () => {
    const res = await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize' })
    expect(res?.result).toMatchObject({
      protocolVersion: '2024-11-05',
      serverInfo: { name: 'agent-memory' },
    })
  })

  it('lists memory_search and memory_get with schemas', async () => {
    const res = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const tools = (res?.result as { tools: Array<{ name: string; inputSchema: unknown }> }).tools
    expect(tools.map((t) => t.name)).toEqual(['memory_search', 'memory_get'])
    expect(tools[0]?.inputSchema).toMatchObject({ required: ['query'] })
  })

  it('memory_search returns the seeded item ranked by lexical overlap', async () => {
    const res = await server.handle({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'memory_search', arguments: { query: 'failing test run' } },
    })
    const out = (res?.result as { structuredContent: { results: Array<{ id: string }> } })
      .structuredContent
    expect(out.results[0]?.id).toBe('mem-1')
  })

  it('memory_search respects k and the tags filter', async () => {
    const res = await server.handle({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'memory_search',
        arguments: { query: 'schema version test', k: 1, tags: ['db'] },
      },
    })
    const out = (res?.result as { structuredContent: { results: Array<{ id: string }> } })
      .structuredContent
    expect(out.results.map((r) => r.id)).toEqual(['mem-3'])
  })

  it('rejects an empty query as invalid params (-32602)', async () => {
    const res = await server.handle({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'memory_search', arguments: { query: '  ' } },
    })
    expect(res?.error?.code).toBe(-32602)
  })

  it('memory_get returns the row verbatim and errors on an unknown id', async () => {
    const hit = await server.handle({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'memory_get', arguments: { id: 'mem-2' } },
    })
    expect((hit?.result as { structuredContent: MemoryItem }).structuredContent).toEqual(ITEMS[1])
    const miss = await server.handle({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'memory_get', arguments: { id: 'mem-999' } },
    })
    expect(miss?.error?.message).toMatch(/no memory item/)
  })

  it('refuses to serve an EMPTY memory (fail-closed ablation discipline)', () => {
    expect(() => createMemoryToolServer({ items: [] })).toThrow(ValidationError)
  })

  it('refuses duplicate item ids', () => {
    expect(() =>
      createMemoryToolServer({ items: [ITEMS[0] as MemoryItem, ITEMS[0] as MemoryItem] }),
    ).toThrow(/duplicate/)
  })

  it('appends one JSONL retrieval-log row per memory_search (the holdout seam)', async () => {
    const logPath = join(tmp, 'logs', 'retrieval.jsonl')
    const logged = createMemoryToolServer({ items: ITEMS, logPath })
    await logged.handle({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: { name: 'memory_search', arguments: { query: 'failing test' } },
    })
    const rows = readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ query: 'failing test', k: 5 })
    expect(rows[0].returned[0]).toMatchObject({ id: 'mem-1' })
  })
})

describe('readMemoryItemsFile', () => {
  it('reads a JSON array store', () => {
    const p = join(tmp, 'items.json')
    writeFileSync(p, JSON.stringify(ITEMS))
    expect(readMemoryItemsFile(p)).toEqual(ITEMS)
  })

  it('reads a JSONL store', () => {
    const p = join(tmp, 'items.jsonl')
    writeFileSync(p, `${ITEMS.map((i) => JSON.stringify(i)).join('\n')}\n`)
    expect(readMemoryItemsFile(p)).toEqual(ITEMS)
  })

  it('names the offending row on a malformed store', () => {
    const p = join(tmp, 'bad.jsonl')
    writeFileSync(p, `${JSON.stringify(ITEMS[0])}\n{"id":"x"}\n`)
    expect(() => readMemoryItemsFile(p)).toThrow(/bad\.jsonl:2.*'text'/)
  })

  it('fails loud on a missing file', () => {
    expect(() => readMemoryItemsFile(join(tmp, 'nope.jsonl'))).toThrow(/cannot read/)
  })
})

describe('parseMemoryItems / resolveMemoryFromEnv', () => {
  it('rejects non-array payloads and rows missing id/text', () => {
    expect(() => parseMemoryItems({}, 'env')).toThrow(/array/)
    expect(() => parseMemoryItems([{ id: 'a' }], 'env')).toThrow(/'text'/)
    expect(() => parseMemoryItems([{ id: '', text: 'x' }], 'env')).toThrow(/'id'/)
  })

  it('merges file + inline rows, inline winning on id collision', () => {
    const p = join(tmp, 'merge.jsonl')
    writeFileSync(p, `${JSON.stringify(ITEMS[0])}\n${JSON.stringify(ITEMS[1])}\n`)
    const inline: MemoryItem = { id: 'mem-1', text: 'inline override wins' }
    const resolved = resolveMemoryFromEnv({
      [MEMORY_FILE_ENV]: p,
      [MEMORY_ITEMS_ENV]: JSON.stringify([inline]),
    })
    expect(resolved.items).toHaveLength(2)
    expect(resolved.items.find((i) => i.id === 'mem-1')?.text).toBe('inline override wins')
  })

  it('refuses to boot with zero rows resolved', () => {
    expect(() => resolveMemoryFromEnv({})).toThrow(/no memory items/)
  })
})
