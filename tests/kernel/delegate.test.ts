import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the ONE front door so these unit tests prove delegate's CONTRACT — it routes the intent to
// `supervise()` with a DEFAULT authoring-supervisor profile and returns supervise()'s result
// (including `spentTotal`) UNCHANGED — without standing up a real supervised run / network. The
// offline end-to-end supervise path is covered by supervise.test.ts / supervise-convenience.test.ts.
const superviseSpy =
  vi.fn<
    (
      profile: unknown,
      task: unknown,
      opts: unknown,
    ) => Promise<import('../../src/runtime/supervise/types').SupervisedResult<unknown>>
  >()
vi.mock('../../src/runtime/supervise/supervise', () => ({
  supervise: (profile: unknown, task: unknown, opts: unknown) => superviseSpy(profile, task, opts),
}))

import { supervisorInstructions } from '../../src/runtime/supervise/authoring'
import { defaultDelegateBudget, delegate } from '../../src/runtime/supervise/delegate'
import type { ExecutorConfig } from '../../src/runtime/supervise/runtime'
import type {
  RouterConfig,
  Spend,
  SupervisedResult,
  TreeView,
} from '../../src/runtime/supervise/types'

const router: RouterConfig = {
  routerBaseUrl: 'http://localhost/v1',
  routerKey: 'k',
  model: 'deepseek-v4-flash',
}
const backend: ExecutorConfig = {
  backend: 'router-tools',
  routerBaseUrl: 'http://localhost/v1',
  routerKey: 'k',
  model: 'deepseek-v4-flash',
} as ExecutorConfig

const emptyTree = { id: 'root', children: [] } as unknown as TreeView

const spentTotal: Spend = {
  iterations: 3,
  tokens: { input: 1200, output: 800 },
  usd: 0.0042,
  ms: 5100,
}

function winner(out: unknown): SupervisedResult<unknown> {
  return { kind: 'winner', out, outRef: 'blob:1', tree: emptyTree, spentTotal }
}

beforeEach(() => {
  superviseSpy.mockReset()
  superviseSpy.mockResolvedValue(winner({ answer: 42 }))
})

describe('delegate — the one generic delegation verb over supervise()', () => {
  it('routes to supervise() with the DEFAULT authoring-supervisor profile (no hardcoded worker)', async () => {
    await delegate('fix the failing auth test', { backend, router })

    expect(superviseSpy).toHaveBeenCalledTimes(1)
    const [profile, task, opts] = superviseSpy.mock.calls[0] as [
      { name?: string; harness?: unknown; systemPrompt?: string },
      unknown,
      { backend?: unknown; router?: unknown; budget?: unknown },
    ]
    // A router-brained AUTHORING supervisor: its standing instruction IS the authoring skill, so it
    // writes its own worker profile from the intent — no worker profile is baked into delegate.
    expect(profile.harness ?? null).toBeNull()
    expect(profile.systemPrompt).toBe(supervisorInstructions())
    // The intent is handed through verbatim as the task.
    expect(task).toBe('fix the failing auth test')
    // The injected substrate (where workers run + the brain) is forwarded.
    expect(opts.backend).toBe(backend)
    expect(opts.router).toBe(router)
    expect(opts.budget).toBe(defaultDelegateBudget)
  })

  it('returns the supervise() result UNCHANGED so spentTotal (the cost) rides through', async () => {
    const canned = winner({ patch: 'diff' })
    superviseSpy.mockResolvedValue(canned)

    const result = await delegate('refactor the parser', { backend, router })

    expect(result).toBe(canned)
    expect(result.kind).toBe('winner')
    if (result.kind === 'winner') {
      // delegate returns the real spend (spentTotal) alongside the delivered output.
      expect(result.spentTotal).toEqual(spentTotal)
      expect(result.spentTotal.usd).toBeGreaterThan(0)
      expect(result.spentTotal.tokens.input).toBe(1200)
    }
  })

  it('forwards a no-winner result faithfully — including its real spend (never fabricates a success or zero cost)', async () => {
    const noWinner: SupervisedResult<unknown> = {
      kind: 'no-winner',
      reason: 'budget-exhausted',
      tree: emptyTree,
      downCount: 1,
      spentTotal,
    }
    superviseSpy.mockResolvedValue(noWinner)

    const result = await delegate('do the thing', { backend, router })
    expect(result.kind).toBe('no-winner')
    if (result.kind === 'no-winner') {
      // A budget-exhausted delegation still cost real compute; the spend rides back unchanged.
      expect(result.spentTotal).toEqual(spentTotal)
    }
  })

  it('forwards deliverable, model, budget, allowedModels, runId to supervise()', async () => {
    const deliverable = { check: () => true, describe: 'always delivered' }
    const budget = { maxIterations: 7, maxTokens: 9000 }

    await delegate('intent', {
      backend,
      router,
      deliverable,
      model: 'glm-5.2',
      budget,
      allowedModels: ['glm-5.2', 'deepseek-v4-flash'],
      runId: 'run-7',
    })

    const [profile, , opts] = superviseSpy.mock.calls[0] as [
      { model?: string },
      unknown,
      Record<string, unknown>,
    ]
    expect(profile.model).toBe('glm-5.2')
    expect(opts.deliverable).toBe(deliverable)
    expect(opts.budget).toBe(budget)
    expect(opts.allowedModels).toEqual(['glm-5.2', 'deepseek-v4-flash'])
    expect(opts.runId).toBe('run-7')
  })

  it('lets the caller override only the supervisor name/stance', async () => {
    await delegate('intent', {
      backend,
      router,
      supervisor: { name: 'my-supervisor', systemPrompt: 'custom stance' },
    })
    const [profile] = superviseSpy.mock.calls[0] as [{ name?: string; systemPrompt?: string }]
    expect(profile.name).toBe('my-supervisor')
    expect(profile.systemPrompt).toBe('custom stance')
  })

  it('fails loud on an empty intent', async () => {
    await expect(delegate('   ', { backend, router })).rejects.toThrow(/intent/)
    expect(superviseSpy).not.toHaveBeenCalled()
  })

  it('fails loud when neither router nor brain is provided (no supervisor brain)', async () => {
    await expect(delegate('intent', { backend })).rejects.toThrow(/router|brain/)
    expect(superviseSpy).not.toHaveBeenCalled()
  })
})
