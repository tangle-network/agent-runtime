/**
 * The behavior every {@link WorkspaceStore} adapter must show, as runnable
 * cases with no test-framework dependency. An adapter suite registers them:
 *
 * ```ts
 * for (const c of workspaceStoreContractCases(makeStore)) it(c.name, c.run)
 * ```
 *
 * or runs them all with {@link runWorkspaceStoreContract}.
 */
import { WorkspaceConflictError, type WorkspaceStore } from './store'
import {
  createFileTools,
  createMemoryTools,
  defaultMemoryPolicy,
  type MemoryPolicy,
  readTurnMemories,
  renderPinnedMemory,
  WorkspacePolicyError,
  type WorkspaceToolDefinition,
  type WorkspaceTurn,
} from './tools'

export interface WorkspaceStoreContractCase {
  readonly name: string
  run(): Promise<void>
}

export interface WorkspaceStoreContractResult {
  readonly name: string
  readonly passed: boolean
  readonly error?: string
}

/** Make a fresh, empty store for one case. */
export type MakeWorkspaceStore = () => WorkspaceStore | Promise<WorkspaceStore>

export interface WorkspaceStoreContractOptions {
  /** Also check `operationId` replay; for a store that sets `idempotentOperations`. */
  readonly idempotentOperations?: boolean
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`workspace store contract: ${message}`)
}

async function rejects(
  action: () => Promise<unknown>,
  type: new (...args: never[]) => Error,
  message: string,
): Promise<Error> {
  try {
    await action()
  } catch (error) {
    check(error instanceof type, `${message}: expected ${type.name}, got ${String(error)}`)
    return error as Error
  }
  throw new Error(`workspace store contract: ${message}: expected ${type.name}, call succeeded`)
}

const W = 'ws-contract'
const alice: WorkspaceTurn = { workspaceId: W, memberId: 'alice', role: 'member' }
const bob: WorkspaceTurn = { workspaceId: W, memberId: 'bob', role: 'member' }
const owner: WorkspaceTurn = { workspaceId: W, memberId: 'olive', role: 'owner' }
const guest: WorkspaceTurn = { workspaceId: W, memberId: 'gus', role: 'guest' }

type ContractCase = [string, (store: WorkspaceStore) => Promise<void>]

function toolsFor(store: WorkspaceStore, turn: WorkspaceTurn, policy?: MemoryPolicy) {
  const context = { store, activeTurn: async () => turn, ...(policy ? { policy } : {}) }
  const byName = new Map<string, WorkspaceToolDefinition>(
    [...createMemoryTools(context), ...createFileTools(context)].map((tool) => [tool.name, tool]),
  )
  return (name: string, args: Record<string, unknown>) => {
    const tool = byName.get(name)
    if (!tool) throw new Error(`no tool ${name}`)
    return tool.run(args) as Promise<any>
  }
}

const idempotentOperationCase: ContractCase = [
  'operationId: a repeated put or delete returns its result instead of a conflict',
  async (store) => {
    check(store.idempotentOperations === true, 'the store declares idempotentOperations')
    const base = { workspaceId: W, path: '/files/op.md', kind: 'file' as const, actor: 'alice' }
    const first = await store.put({
      ...base,
      content: 'one',
      ifRevision: null,
      operationId: 'op-1',
    })
    const replay = await store.put({
      ...base,
      content: 'one',
      ifRevision: null,
      operationId: 'op-1',
    })
    check(
      replay.revision === first.revision && replay.id === first.id && replay.content === 'one',
      'a repeated put returns the entry it wrote',
    )
    await rejects(
      () => store.put({ ...base, content: 'other', ifRevision: null, operationId: 'op-1' }),
      WorkspaceConflictError,
      'the same operation with different content',
    )
    await rejects(
      () => store.put({ ...base, content: 'one', ifRevision: null, operationId: 'op-other' }),
      WorkspaceConflictError,
      'another operation with the same content',
    )
    const second = await store.put({
      ...base,
      content: 'two',
      ifRevision: first.revision,
      operationId: 'op-2',
    })
    await rejects(
      () => store.put({ ...base, content: 'one', ifRevision: null, operationId: 'op-1' }),
      WorkspaceConflictError,
      'an operation a later write superseded',
    )
    const erase = { workspaceId: W, path: base.path, ifRevision: second.revision, actor: 'bob' }
    const tombstone = await store.delete({ ...erase, operationId: 'op-3' })
    const again = await store.delete({ ...erase, operationId: 'op-3' })
    check(
      tombstone !== null && again?.revision === tombstone.revision,
      'a repeated delete returns its tombstone',
    )
    await rejects(
      () => store.delete({ ...erase, operationId: 'op-4' }),
      WorkspaceConflictError,
      'another operation deleting the erased path',
    )
    check((await store.tombstones(W, base.path)).length === 1, 'a repeated delete erases once')
    await rejects(
      () => store.put({ ...base, content: 'x', ifRevision: null, operationId: '' }),
      TypeError,
      'an empty operationId',
    )
  },
]

const compareAndSetCase: ContractCase = [
  'compare-and-set: create, stale update, and re-create conflict with a typed error',
  async (store) => {
    const base = { workspaceId: W, path: '/files/a.md', kind: 'file' as const, actor: 'alice' }
    const first = await store.put({ ...base, content: 'one', ifRevision: null })
    check(first.revision >= 1 && first.content === 'one', 'create returns revision and content')
    check(
      first.createdBy === 'alice' && first.createdAt && first.updatedAt,
      'create stamps author and times',
    )
    const conflict = await rejects(
      () => store.put({ ...base, content: 'dup', ifRevision: null }),
      WorkspaceConflictError,
      'create over a live path',
    )
    check(
      (conflict as WorkspaceConflictError).actual === first.revision,
      'conflict reports the live revision',
    )
    const second = await store.put({
      ...base,
      content: 'two',
      ifRevision: first.revision,
      actor: 'bob',
    })
    check(
      second.revision > first.revision && second.id === first.id,
      'update bumps revision, keeps id',
    )
    check(
      second.createdBy === 'alice' && second.updatedBy === 'bob',
      'update keeps creator, records updater',
    )
    await rejects(
      () => store.put({ ...base, content: 'stale', ifRevision: first.revision }),
      WorkspaceConflictError,
      'update at a stale revision',
    )
    check((await store.get(W, base.path))?.content === 'two', 'a refused write changes nothing')
    const races = await Promise.allSettled(
      ['x', 'y'].map((content) => store.put({ ...base, content, ifRevision: second.revision })),
    )
    check(
      races.filter((r) => r.status === 'fulfilled').length === 1,
      'exactly one racing write wins',
    )
  },
]

const entriesCase: ContractCase = [
  'entries: exactly one of content or bytes, normalized paths, tenant isolation, sorted list',
  async (store) => {
    const bytes = { key: 'r2/obj-1', size: 42, contentType: 'application/pdf' }
    const file = await store.put({
      workspaceId: W,
      path: '/files/b.pdf',
      kind: 'file',
      actor: 'alice',
      bytes,
      ifRevision: null,
    })
    check(
      file.bytes?.key === bytes.key && file.content === undefined,
      'bytes reference round-trips',
    )
    await rejects(
      () =>
        store.put({
          workspaceId: W,
          path: '/files/c',
          kind: 'file',
          actor: 'a',
          ifRevision: null,
        }),
      TypeError,
      'neither content nor bytes',
    )
    for (const path of ['files/x', '/files/../x', '/files//x', '/files/x/']) {
      await rejects(
        () =>
          store.put({
            workspaceId: W,
            path,
            kind: 'file',
            actor: 'a',
            content: 'x',
            ifRevision: null,
          }),
        TypeError,
        `path ${path}`,
      )
    }
    await store.put({
      workspaceId: W,
      path: '/files/a.md',
      kind: 'file',
      actor: 'a',
      content: 'a',
      ifRevision: null,
    })
    await store.put({
      workspaceId: 'other',
      path: '/files/z.md',
      kind: 'file',
      actor: 'a',
      content: 'z',
      ifRevision: null,
    })
    const listed = await store.list(W, '/files/')
    check(
      listed.map((e) => e.path).join() === '/files/a.md,/files/b.pdf',
      'list is sorted and tenant-scoped',
    )
    check((await store.get('other', '/files/a.md')) === null, 'another tenant cannot read the path')
    const member = await store.put({
      workspaceId: W,
      path: '/memories/members/alice/m1',
      kind: 'fact',
      actor: 'alice',
      content: 'x',
      ifRevision: null,
    })
    check(member.scope === 'member' && file.scope === 'workspace', 'scope follows the path')
  },
]

const deleteTombstoneCase: ContractCase = [
  'delete erases content and keeps a tombstone; revisions stay monotonic',
  async (store) => {
    const base = {
      workspaceId: W,
      path: '/files/secret.md',
      kind: 'file' as const,
      actor: 'alice',
    }
    const entry = await store.put({ ...base, content: 'card 4111', ifRevision: null })
    await rejects(
      () =>
        store.delete({
          workspaceId: W,
          path: base.path,
          ifRevision: entry.revision + 5,
          actor: 'alice',
        }),
      WorkspaceConflictError,
      'delete at a stale revision',
    )
    const tombstone = await store.delete({
      workspaceId: W,
      path: base.path,
      ifRevision: entry.revision,
      actor: 'bob',
    })
    check(tombstone !== null, 'delete returns a tombstone')
    check(
      tombstone.id === entry.id && tombstone.revision > entry.revision,
      'tombstone keeps id, bumps revision',
    )
    check(tombstone.deletedBy === 'bob' && !!tombstone.deletedAt, 'tombstone records actor/time')
    check(!JSON.stringify({ ...tombstone, id: '' }).includes('4111'), 'tombstone holds no content')
    check((await store.get(W, base.path)) === null, 'deleted entry is gone')
    check((await store.list(W, '/files/')).length === 0, 'deleted entry is not listed')
    const audit = await store.tombstones(W, '/files/')
    check(
      audit.length === 1 &&
        audit.every(
          (row) => row.id === entry.id && !JSON.stringify({ ...row, id: '' }).includes('4111'),
        ),
      'audit rows hold no content',
    )
    check(
      (await store.delete({ workspaceId: W, path: '/files/none', actor: 'a' })) === null,
      'unconditional delete of a missing path is a no-op',
    )
    const again = await store.put({ ...base, content: 'new', ifRevision: null })
    check(again.revision > tombstone.revision, 're-created path continues the revision sequence')
  },
]

const rememberRecallCase: ContractCase = [
  'tools: remember then recall round-trips, and forget erases',
  async (store) => {
    const call = toolsFor(store, alice)
    const saved = await call('memory.remember', {
      text: 'The walk-in freezer code is   on the clipboard',
      kind: 'fact',
      scope: 'workspace',
    })
    check(
      saved.saved && saved.path === `/memories/workspace/${saved.id}`,
      'remember saves under workspace',
    )
    const found = await toolsFor(store, bob)('memory.recall', { query: 'freezer code' })
    check(found.memories[0]?.id === saved.id, 'another member recalls a workspace fact')
    check(
      found.memories[0]?.text === 'The walk-in freezer code is on the clipboard',
      'whitespace is collapsed',
    )
    const updated = await call('memory.remember', {
      text: 'The freezer code is in the office',
      kind: 'fact',
      scope: 'workspace',
      replaces: saved.id,
    })
    check(updated.id === saved.id && updated.revision > saved.revision, 'replaces updates in place')
    await call('memory.forget', { id: saved.id })
    check(
      (await call('memory.recall', { query: 'freezer' })).memories.length === 0,
      'forgotten memory is not recalled',
    )
    check(
      (await store.tombstones(W)).some((row) => row.id === saved.id),
      'forget leaves a tombstone',
    )
  },
]

const memberScopeCase: ContractCase = [
  'tools: a member cannot see or touch another member’s scope',
  async (store) => {
    const mine = await toolsFor(store, alice)('memory.remember', {
      text: 'Alice prefers replies in Spanish',
      kind: 'preference',
      scope: 'me',
    })
    check(mine.path === `/memories/members/alice/${mine.id}`, 'scope me writes under the member')
    const asBob = toolsFor(store, bob)
    check(
      (await asBob('memory.recall', { query: 'Spanish replies' })).memories.length === 0,
      'recall is member-isolated',
    )
    await rejects(
      () => asBob('memory.forget', { id: mine.id }),
      Error,
      'forget of another member’s memory',
    )
    check((await store.get(W, mine.path)) !== null, 'the other member’s memory survives')
    await rejects(
      () => asBob('files.read', { path: mine.path }),
      Error,
      'files.read outside /files and /knowledge',
    )
    const pinned = renderPinnedMemory(await readTurnMemories(store, bob))
    check(!pinned.includes('Spanish'), 'pinned memory is member-isolated')
    check(
      renderPinnedMemory(await readTurnMemories(store, alice)).includes('Spanish'),
      'the owner sees it pinned',
    )
  },
]

const policyCase: ContractCase = [
  'tools: default policy and admit hook refuse by name',
  async (store) => {
    await rejects(
      () =>
        toolsFor(store, alice)('memory.remember', {
          text: 'Never discount',
          kind: 'instruction',
          scope: 'workspace',
        }),
      WorkspacePolicyError,
      'member instruction',
    )
    await rejects(
      () =>
        toolsFor(store, alice)('memory.remember', {
          text: 'Use metric',
          kind: 'preference',
          scope: 'workspace',
        }),
      WorkspacePolicyError,
      'member workspace preference',
    )
    await rejects(
      () =>
        toolsFor(store, guest)('memory.remember', {
          text: 'I am Gus',
          kind: 'fact',
          scope: 'me',
        }),
      WorkspacePolicyError,
      'guest write',
    )
    await rejects(
      () =>
        toolsFor(store, alice)('files.write', {
          path: '/knowledge/menu.md',
          content: 'x',
          ifRevision: null,
        }),
      WorkspacePolicyError,
      'member knowledge write',
    )
    const rule = await toolsFor(store, owner)('memory.remember', {
      text: 'Never offer discounts',
      kind: 'instruction',
      scope: 'workspace',
    })
    check(rule.saved, 'owner saves an instruction')
    const noPhones = defaultMemoryPolicy({
      admit: (_turn, { text }) => (/\d{3}-\d{4}/.test(text) ? 'Phone numbers are not saved' : null),
    })
    const refused = await rejects(
      () =>
        toolsFor(
          store,
          alice,
          noPhones,
        )('memory.remember', { text: 'Call 555-0100', kind: 'fact', scope: 'me' }),
      WorkspacePolicyError,
      'admit hook',
    )
    check(refused.message === 'Phone numbers are not saved', 'refusal carries the product reason')
    check(
      (await store.list(W, '/memories/members/alice/')).length === 0,
      'refused writes store nothing',
    )
  },
]

const fileToolsCase: ContractCase = [
  'tools: files write, read, CAS conflict, search, delete',
  async (store) => {
    const call = toolsFor(store, alice)
    const created = await call('files.write', {
      path: '/files/notes/menu.md',
      content: 'Tuesday special: lamb',
      ifRevision: null,
    })
    await rejects(
      () => call('files.write', { path: '/files/notes/menu.md', content: 'x', ifRevision: null }),
      WorkspaceConflictError,
      'files.write create over a live file',
    )
    const read = await toolsFor(store, bob)('files.read', { path: '/files/notes/menu.md' })
    check(
      read.content === 'Tuesday special: lamb' && read.revision === created.revision,
      'files.read returns content and revision',
    )
    const hits = await call('files.search', { query: 'lamb special' })
    check(
      hits.files[0]?.path === '/files/notes/menu.md' && hits.files[0].snippet.includes('lamb'),
      'files.search finds text',
    )
    check((await call('files.list', {})).files.length === 1, 'files.list lists it')
    await call('files.delete', { path: '/files/notes/menu.md', ifRevision: created.revision })
    await rejects(
      () => call('files.read', { path: '/files/notes/menu.md' }),
      Error,
      'read after delete',
    )
  },
]

const pinnedMemoryCase: ContractCase = [
  'renderPinnedMemory: stable, ordered, budgeted, ends with the recall index',
  async (store) => {
    await toolsFor(store, alice)('memory.remember', {
      text: 'Alice works weekends',
      kind: 'fact',
      scope: 'me',
    })
    await toolsFor(store, owner)('memory.remember', {
      text: 'Always greet by name',
      kind: 'instruction',
      scope: 'workspace',
    })
    for (let i = 0; i < 40; i += 1) {
      await toolsFor(store, alice)('memory.remember', {
        text: `Supplier ${i} delivers on day ${i % 7}`,
        kind: 'fact',
        scope: 'workspace',
      })
    }
    const entries = await readTurnMemories(store, alice)
    const block = renderPinnedMemory(entries)
    check(
      block === renderPinnedMemory([...entries].reverse()),
      'input order does not change the output',
    )
    check(
      block === renderPinnedMemory(await readTurnMemories(store, alice)),
      'identical input renders identically',
    )
    const lines = block.split('\n')
    check(
      lines.findIndex((l) => l.includes('Always greet')) <
        lines.findIndex((l) => l.includes('Supplier')),
      'instructions first',
    )
    check(
      lines.at(-1) === '</saved-memory>' && lines.at(-2)?.startsWith('Recall more:'),
      'ends with the recall index',
    )
    check(
      entries.every((e) => block.includes(`[${e.id}]`)),
      'every memory is shown with its id under the default budget',
    )
    const small = renderPinnedMemory(entries, { maxTokens: 120 })
    check(
      small.length <= 120 * 4 && /\d+ more not shown\./.test(small),
      'a small budget truncates and counts',
    )
  },
]

/** The contract as named cases; each case builds its own store. */
export function workspaceStoreContractCases(
  makeStore: MakeWorkspaceStore,
  options: WorkspaceStoreContractOptions = {},
): WorkspaceStoreContractCase[] {
  const cases: ContractCase[] = [
    compareAndSetCase,
    entriesCase,
    deleteTombstoneCase,
    rememberRecallCase,
    memberScopeCase,
    policyCase,
    fileToolsCase,
    pinnedMemoryCase,
  ]
  if (options.idempotentOperations) cases.push(idempotentOperationCase)
  return cases.map(([name, body]) => ({
    name,
    async run() {
      await body(await makeStore())
    },
  }))
}

/** Run every contract case against fresh stores; never throws for a failing case. */
export async function runWorkspaceStoreContract(
  makeStore: MakeWorkspaceStore,
  options: WorkspaceStoreContractOptions = {},
): Promise<WorkspaceStoreContractResult[]> {
  const results: WorkspaceStoreContractResult[] = []
  for (const contractCase of workspaceStoreContractCases(makeStore, options)) {
    try {
      await contractCase.run()
      results.push({ name: contractCase.name, passed: true })
    } catch (error) {
      results.push({
        name: contractCase.name,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return results
}
