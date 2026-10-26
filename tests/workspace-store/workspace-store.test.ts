import { describe, expect, it } from 'vitest'
import {
  createFileTools,
  createInMemoryWorkspaceStore,
  createMemoryTools,
  runWorkspaceStoreContract,
  workspaceStoreContractCases,
} from '../../src/workspace-store'

describe('in-memory workspace store contract', () => {
  for (const contractCase of workspaceStoreContractCases(
    () => {
      let nextId = 0
      return createInMemoryWorkspaceStore({
        newId: () => `41110000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`,
      })
    },
    { idempotentOperations: true },
  )) {
    it(contractCase.name, contractCase.run)
  }

  it('fails the operationId case for a store that declares replay but ignores operationId', async () => {
    const results = await runWorkspaceStoreContract(
      () => {
        const store = createInMemoryWorkspaceStore()
        return { ...store, put: (input) => store.put({ ...input, operationId: undefined }) }
      },
      { idempotentOperations: true },
    )
    expect(results.find((result) => result.name.startsWith('operationId'))?.passed).toBe(false)
    expect(results.filter((result) => !result.passed)).toHaveLength(1)
  })

  it('runWorkspaceStoreContract reports a broken adapter instead of throwing', async () => {
    const results = await runWorkspaceStoreContract(() => {
      const store = createInMemoryWorkspaceStore()
      // A store that ignores compare-and-set must fail the contract.
      return {
        ...store,
        put: (input) =>
          store
            .put({ ...input, ifRevision: null })
            .catch(() => store.get(input.workspaceId, input.path).then((e) => e!)),
      }
    })
    expect(results.length).toBe(
      workspaceStoreContractCases(() => createInMemoryWorkspaceStore()).length,
    )
    expect(results.some((result) => !result.passed && result.error?.includes('contract'))).toBe(
      true,
    )
  })
})

describe('workspace tools', () => {
  it('publish unique MCP-shaped definitions with object input schemas', () => {
    const context = {
      store: createInMemoryWorkspaceStore(),
      activeTurn: async () => ({ workspaceId: 'w', memberId: 'm', role: 'member' as const }),
    }
    const tools = [...createMemoryTools(context), ...createFileTools(context)]
    expect(tools.map((tool) => tool.name)).toEqual([
      'memory.remember',
      'memory.recall',
      'memory.forget',
      'files.list',
      'files.read',
      'files.write',
      'files.delete',
      'files.search',
    ])
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe('object')
      expect(tool.inputSchema.additionalProperties).toBe(false)
    }
  })

  it('takes identity from the trusted turn, never from arguments', async () => {
    const store = createInMemoryWorkspaceStore()
    const [remember] = createMemoryTools({
      store,
      activeTurn: async () => ({ workspaceId: 'w', memberId: 'alice', role: 'member' }),
    })
    await expect(
      remember!.run({ text: 'x', kind: 'fact', scope: 'me', memberId: 'bob' }),
    ).rejects.toThrow()
    const saved = (await remember!.run({ text: 'x', kind: 'fact', scope: 'me' })) as {
      path: string
    }
    expect(saved.path.startsWith('/memories/members/alice/')).toBe(true)
  })
})
