import { describe, expect, it } from 'vitest'
import type { CoderDelegate } from '../../src/mcp/delegates'
import { DelegationTaskQueue } from '../../src/mcp/task-queue'
import {
  createDelegateCodeHandler,
  DELEGATE_CODE_DESCRIPTION,
  DELEGATE_CODE_INPUT_SCHEMA,
  DELEGATE_CODE_TOOL_NAME,
  validateDelegateCodeArgs,
} from '../../src/mcp/tools/delegate-code'

const stubOutput = {
  branch: 'feat/x',
  patch: '',
  testResult: { passed: true, output: '' },
  typecheckResult: { passed: true, output: '' },
  diffStats: { filesChanged: 0, insertions: 0, deletions: 0 },
}

const stubDelegate: CoderDelegate = async () => stubOutput

describe('validateDelegateCodeArgs', () => {
  it('accepts the minimal required surface', () => {
    const args = validateDelegateCodeArgs({ goal: 'fix', repoRoot: '/r' })
    expect(args).toEqual({ goal: 'fix', repoRoot: '/r' })
  })

  it('rejects an empty goal', () => {
    expect(() => validateDelegateCodeArgs({ goal: '   ', repoRoot: '/r' })).toThrow(TypeError)
  })

  it('rejects variants outside [1, 8]', () => {
    expect(() => validateDelegateCodeArgs({ goal: 'g', repoRoot: '/r', variants: 0 })).toThrow(
      RangeError,
    )
    expect(() => validateDelegateCodeArgs({ goal: 'g', repoRoot: '/r', variants: 9 })).toThrow(
      RangeError,
    )
  })

  it('rejects non-string forbiddenPaths entries', () => {
    expect(() =>
      validateDelegateCodeArgs({
        goal: 'g',
        repoRoot: '/r',
        config: { forbiddenPaths: ['ok', 1] },
      }),
    ).toThrow(TypeError)
  })

  it('coerces variants to a positive integer', () => {
    const args = validateDelegateCodeArgs({ goal: 'g', repoRoot: '/r', variants: 3.7 })
    expect(args.variants).toBe(3)
  })
})

describe('createDelegateCodeHandler', () => {
  it('returns a taskId and estimated duration on a happy-path call', async () => {
    const queue = new DelegationTaskQueue()
    const handler = createDelegateCodeHandler({ queue, delegate: stubDelegate })
    const result = await handler({ goal: 'fix', repoRoot: '/r' })
    expect(result.taskId).toMatch(/^dlg-/)
    expect(result.estimatedDurationMs).toBeGreaterThan(0)
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    expect(queue.status(result.taskId)?.status).toBe('completed')
  })

  it('is idempotent: duplicate identical input returns the same taskId', async () => {
    const queue = new DelegationTaskQueue()
    const handler = createDelegateCodeHandler({ queue, delegate: stubDelegate })
    const first = await handler({ goal: 'fix', repoRoot: '/r', variants: 2 })
    const second = await handler({ goal: 'fix', repoRoot: '/r', variants: 2 })
    expect(second.taskId).toBe(first.taskId)
  })

  it('returns a different taskId when contextHint differs', async () => {
    const queue = new DelegationTaskQueue()
    const handler = createDelegateCodeHandler({ queue, delegate: stubDelegate })
    const first = await handler({ goal: 'fix', repoRoot: '/r' })
    const second = await handler({ goal: 'fix', repoRoot: '/r', contextHint: 'see issue #42' })
    expect(second.taskId).not.toBe(first.taskId)
  })

  it('propagates validation errors out of the handler', async () => {
    const queue = new DelegationTaskQueue()
    const handler = createDelegateCodeHandler({ queue, delegate: stubDelegate })
    await expect(handler({ goal: '', repoRoot: '/r' })).rejects.toThrow(/non-empty string/)
  })

  it('surfaces delegate exceptions via the queue status', async () => {
    const queue = new DelegationTaskQueue()
    const handler = createDelegateCodeHandler({
      queue,
      delegate: async () => {
        throw new TypeError('bad sandbox')
      },
    })
    const { taskId } = await handler({ goal: 'fix', repoRoot: '/r' })
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    const status = queue.status(taskId)
    expect(status?.status).toBe('failed')
    expect(status?.error?.message).toBe('bad sandbox')
    expect(status?.error?.kind).toBe('TypeError')
  })
})

describe('tool descriptors', () => {
  it('exposes a non-empty description that explains when to call', () => {
    expect(DELEGATE_CODE_TOOL_NAME).toBe('delegate_code')
    expect(DELEGATE_CODE_DESCRIPTION).toMatch(/Use when:/)
  })
  it('declares goal and repoRoot as required', () => {
    expect((DELEGATE_CODE_INPUT_SCHEMA as { required: string[] }).required).toEqual([
      'goal',
      'repoRoot',
    ])
  })
})
