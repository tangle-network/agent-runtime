import { describe, expect, it } from 'vitest'
import type { ResearcherDelegate } from '../../src/mcp/delegates'
import { DelegationTaskQueue } from '../../src/mcp/task-queue'
import {
  createDelegateResearchHandler,
  DELEGATE_RESEARCH_DESCRIPTION,
  DELEGATE_RESEARCH_INPUT_SCHEMA,
  DELEGATE_RESEARCH_TOOL_NAME,
  validateDelegateResearchArgs,
} from '../../src/mcp/tools/delegate-research'

const stubOutput = { items: [], citations: [], proposedWrites: [] }
const stubDelegate: ResearcherDelegate = async () => stubOutput

describe('validateDelegateResearchArgs', () => {
  it('requires question + namespace', () => {
    expect(() => validateDelegateResearchArgs({ namespace: 'x' })).toThrow(/question/)
    expect(() => validateDelegateResearchArgs({ question: 'q?' })).toThrow(/namespace/)
  })

  it('rejects unknown source types', () => {
    expect(() =>
      validateDelegateResearchArgs({ question: 'q?', namespace: 'x', sources: ['rss'] }),
    ).toThrow(TypeError)
  })

  it('validates recencyWindow datetimes', () => {
    expect(() =>
      validateDelegateResearchArgs({
        question: 'q?',
        namespace: 'x',
        config: { recencyWindow: { since: 'not-a-date' } },
      }),
    ).toThrow(TypeError)
    const ok = validateDelegateResearchArgs({
      question: 'q?',
      namespace: 'x',
      config: { recencyWindow: { since: '2026-01-01T00:00:00Z' } },
    })
    expect(ok.config?.recencyWindow?.since).toBe('2026-01-01T00:00:00Z')
  })

  it('rejects minConfidence outside [0, 1]', () => {
    expect(() =>
      validateDelegateResearchArgs({
        question: 'q?',
        namespace: 'x',
        config: { minConfidence: 1.5 },
      }),
    ).toThrow(RangeError)
  })
})

describe('createDelegateResearchHandler', () => {
  it('returns a taskId with the researcher profile and isolates by namespace', async () => {
    const queue = new DelegationTaskQueue()
    const handler = createDelegateResearchHandler({ queue, delegate: stubDelegate })
    const { taskId } = await handler({ question: 'q?', namespace: 'tenant-a' })
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    const status = queue.status(taskId)
    expect(status?.profile).toBe('researcher')
    expect(status?.status).toBe('completed')
    expect(queue.history({ namespace: 'tenant-a' }).length).toBe(1)
    expect(queue.history({ namespace: 'tenant-b' }).length).toBe(0)
  })

  it('is idempotent on identical inputs', async () => {
    const queue = new DelegationTaskQueue()
    const handler = createDelegateResearchHandler({ queue, delegate: stubDelegate })
    const a = await handler({ question: 'q?', namespace: 'x' })
    const b = await handler({ question: 'q?', namespace: 'x' })
    expect(b.taskId).toBe(a.taskId)
  })

  it('exposes a description that warns about cross-tenant namespace risk', () => {
    expect(DELEGATE_RESEARCH_TOOL_NAME).toBe('delegate_research')
    expect(DELEGATE_RESEARCH_DESCRIPTION).toMatch(/namespace/i)
    expect((DELEGATE_RESEARCH_INPUT_SCHEMA as { required: string[] }).required).toEqual([
      'question',
      'namespace',
    ])
  })
})
