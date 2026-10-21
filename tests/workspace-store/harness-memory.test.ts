import { describe, expect, it } from 'vitest'
import {
  createInMemoryWorkspaceStore,
  readTurnMemories,
  type WorkspaceRole,
  type WorkspaceStore,
} from '../../src/workspace-store'
import {
  captureHarnessMemory,
  HARNESS_MEMORY_BEGIN,
  type HarnessNativeFiles,
  ingestHarnessMemories,
  memoryDivergence,
  parseHarnessActor,
  projectHarnessMemory,
  renderHarnessMemory,
} from '../../src/workspace-store/harness'

// Native memory locations per harness, as a host lays them out in a box.
const NATIVE: Record<string, string[]> = {
  'claude-code': ['CLAUDE.md', '.claude/memory/MEMORY.md'],
  codex: ['AGENTS.md'],
  opencode: ['AGENTS.md'],
  pi: ['AGENTS.md'],
}
const PROFILE_BODY =
  '# Pablo\n\nYou are the assistant for the QA hotel.\n- Answer in the guest language.\n'

async function seeded(): Promise<WorkspaceStore> {
  const store = createInMemoryWorkspaceStore()
  for (const [id, content] of [
    ['m1', 'The hot tub closes at 10pm.'],
    ['m2', 'Late checkout until 1pm costs 30 dollars.'],
  ] as const) {
    await store.put({
      workspaceId: 'w',
      path: `/memories/workspace/${id}`,
      kind: 'fact',
      ifRevision: null,
      actor: 'owner',
      content,
      id,
    })
  }
  return store
}

const turn = (role: WorkspaceRole = 'owner') => ({ workspaceId: 'w', memberId: 'owner', role })

async function projected(store: WorkspaceStore, paths: string[]): Promise<Record<string, string>> {
  const block = renderHarnessMemory(await readTurnMemories(store, turn()))
  return Object.fromEntries(
    paths.map((path) => [
      path,
      projectHarnessMemory(path.endsWith('MEMORY.md') ? '' : PROFILE_BODY, block),
    ]),
  )
}

describe.each(Object.entries(NATIVE))('one mind with %s', (harness, paths) => {
  it('projects the store, captures what the harness adds, ingests it once, and converges to 0 divergence', async () => {
    const store = await seeded()
    const start = await projected(store, paths)
    expect(await memoryDivergence(store, turn(), start, start)).toMatchObject({ total: 0 })

    // The harness writes memory its own way during the turn.
    const after: Record<string, string> = { ...start }
    after[paths[0]!] =
      `${start[paths[0]!]}- The pool closes at 9pm.\n- Remember: the hot tub closes at 10pm\n`
    const native: HarnessNativeFiles =
      harness === 'claude-code'
        ? {
            ...after,
            '.claude/memory/breakfast.md':
              '---\nname: breakfast\ntype: project\n---\nBreakfast runs 7 to 10am.\n',
          }
        : after
    const facts = captureHarnessMemory(start, native)
    expect(facts).toEqual(
      harness === 'claude-code'
        ? [
            'The pool closes at 9pm.',
            'Remember: the hot tub closes at 10pm',
            'Breakfast runs 7 to 10am.',
          ]
        : ['The pool closes at 9pm.', 'Remember: the hot tub closes at 10pm'],
    )
    expect((await memoryDivergence(store, turn(), start, native)).uncaptured).toBe(facts.length - 1)

    const result = await ingestHarnessMemories(
      { store, activeTurn: async () => turn() },
      { harness, turnId: 'turn-7', facts },
    )
    expect(result.duplicates).toEqual(['Remember: the hot tub closes at 10pm'])
    expect(result.saved.map((entry) => parseHarnessActor(entry.createdBy))).toEqual(
      result.saved.map(() => ({ harness, turnId: 'turn-7', memberId: 'owner' })),
    )
    // Captured, but not yet projected: only the new memories are missing from the blocks.
    expect(await memoryDivergence(store, turn(), start, native)).toMatchObject({
      uncaptured: 0,
      stale: 0,
      missing: result.saved.length * paths.length,
    })

    // Ingesting the same capture again saves nothing.
    const again = await ingestHarnessMemories(
      { store, activeTurn: async () => turn() },
      { harness, turnId: 'turn-8', facts },
    )
    expect(again.saved).toEqual([])

    // The next session's projection carries the captured facts to every harness.
    const next = await projected(store, paths)
    expect(await memoryDivergence(store, turn(), next, next)).toMatchObject({ total: 0 })
    expect(next[paths[0]!]).toContain('The pool closes at 9pm.')
  })
})

describe('harness memory projection', () => {
  it('replaces only the generated block and keeps the rest byte for byte', async () => {
    const store = await seeded()
    const block = renderHarnessMemory(await readTurnMemories(store, turn()))
    const once = projectHarnessMemory(PROFILE_BODY, block)
    expect(once.startsWith(PROFILE_BODY)).toBe(true)
    expect(projectHarnessMemory(once, block)).toBe(once)
    const edited = `${once}- added after\n`
    expect(projectHarnessMemory(edited, block)).toBe(edited)
    expect(once.split(HARNESS_MEMORY_BEGIN)).toHaveLength(2)
  })

  it('counts a hand-edited generated line as stale and a deleted memory as stale', async () => {
    const store = await seeded()
    const start = await projected(store, ['AGENTS.md'])
    const edited = { 'AGENTS.md': start['AGENTS.md']!.replace('closes at 10pm', 'closes at 11pm') }
    expect(await memoryDivergence(store, turn(), start, edited)).toMatchObject({
      total: 1,
      stale: 1,
    })
    await store.delete({ workspaceId: 'w', path: '/memories/workspace/m2', actor: 'owner' })
    expect(await memoryDivergence(store, turn(), start, start)).toMatchObject({
      total: 1,
      stale: 1,
    })
  })

  it('counts every memory missing when a harness drops the generated block', async () => {
    const store = await seeded()
    const start = await projected(store, ['AGENTS.md'])
    expect(
      await memoryDivergence(store, turn(), start, { 'AGENTS.md': PROFILE_BODY }),
    ).toMatchObject({ total: 2, missing: 2 })
  })

  it('refuses ingest for a read-only role through the memory policy', async () => {
    const store = await seeded()
    const result = await ingestHarnessMemories(
      { store, activeTurn: async () => turn('viewer') },
      { harness: 'codex', turnId: 'turn-1', facts: ['The gym opens at 6am.'] },
    )
    expect(result).toMatchObject({ saved: [], refused: [{ text: 'The gym opens at 6am.' }] })
  })

  it('ignores headings, fences and removed lines when capturing', () => {
    const before = { 'AGENTS.md': '- Keep this.\n' }
    const after = { 'AGENTS.md': '## Notes\n```\n- not memory\n```\n- New fact here.\n' }
    expect(captureHarnessMemory(before, after)).toEqual(['New fact here.'])
  })
})
