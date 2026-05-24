import { describe, expect, it } from 'vitest'
import type { CoderDelegate, ResearcherDelegate } from '../../src/mcp/delegates'
import { DelegationTaskQueue } from '../../src/mcp/task-queue'
import { createDelegateCodeHandler } from '../../src/mcp/tools/delegate-code'
import { createDelegateResearchHandler } from '../../src/mcp/tools/delegate-research'

const coderStub: CoderDelegate = async () => ({
  branch: 'feat/x',
  patch: '',
  testResult: { passed: true, output: '' },
  typecheckResult: { passed: true, output: '' },
  diffStats: { filesChanged: 0, insertions: 0, deletions: 0 },
})

const researcherStub: ResearcherDelegate = async () => ({
  items: [],
  citations: [],
  proposedWrites: [],
})

describe('MCP idempotency — duplicate calls return the same taskId', () => {
  it('coder: same arguments → same taskId; counted once in history', async () => {
    const queue = new DelegationTaskQueue()
    const handler = createDelegateCodeHandler({ queue, delegate: coderStub })
    const args = { goal: 'fix nav', repoRoot: '/r', variants: 1, config: { maxDiffLines: 100 } }
    const a = await handler(args)
    const b = await handler(args)
    const c = await handler(args)
    expect(b.taskId).toBe(a.taskId)
    expect(c.taskId).toBe(a.taskId)
    expect(queue.history().length).toBe(1)
  })

  it('coder: mutated config produces a fresh taskId', async () => {
    const queue = new DelegationTaskQueue()
    const handler = createDelegateCodeHandler({ queue, delegate: coderStub })
    const a = await handler({ goal: 'fix', repoRoot: '/r', config: { maxDiffLines: 100 } })
    const b = await handler({ goal: 'fix', repoRoot: '/r', config: { maxDiffLines: 200 } })
    expect(b.taskId).not.toBe(a.taskId)
  })

  it('researcher: same arguments → same taskId', async () => {
    const queue = new DelegationTaskQueue()
    const handler = createDelegateResearchHandler({ queue, delegate: researcherStub })
    const a = await handler({ question: 'who?', namespace: 'n', sources: ['web', 'twitter'] })
    const b = await handler({ question: 'who?', namespace: 'n', sources: ['twitter', 'web'] })
    // The hash canonicalizes by key sort, but `sources` is an array — order matters.
    // This ensures order-sensitivity for arrays (the agent should pass a canonical order).
    expect(b.taskId).not.toBe(a.taskId)
    const c = await handler({ question: 'who?', namespace: 'n', sources: ['web', 'twitter'] })
    expect(c.taskId).toBe(a.taskId)
  })
})
