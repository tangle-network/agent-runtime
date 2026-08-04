import type { AgentProfile } from '@tangle-network/agent-interface'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The `delegate` tool routes through `delegate()` → `supervise()`. Mock the ONE front door so the
// tool's contract is provable offline: it hands the agent's INTENT to a supervisor and returns the
// delivered output TOGETHER WITH the conserved cost (spentTotal).
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

import { createMcpServer } from '../../src/mcp/server'
import {
  createDelegateHandler,
  DELEGATE_TOOL_NAME,
  validateDelegateArgs,
} from '../../src/mcp/tools/delegate'
import type { RouterTransportConfig } from '../../src/runtime/router-client'
import type { ExecutorConfig } from '../../src/runtime/supervise/runtime'
import type { Spend, SupervisedResult, TreeView } from '../../src/runtime/supervise/types'

const router: RouterTransportConfig = {
  routerBaseUrl: 'http://localhost/v1',
  routerKey: 'k',
}
const supervisorProfile: AgentProfile = {
  name: 'delegate-supervisor',
  harness: 'cli-base',
  model: { provider: 'test-provider', default: 'deepseek-v4-flash' },
}
const backend: ExecutorConfig = {
  backend: 'router-tools',
  routerBaseUrl: 'http://localhost/v1',
  routerKey: 'k',
}

const emptyTree = { id: 'root', children: [] } as unknown as TreeView
const spentTotal: Spend = {
  iterations: 2,
  tokens: { input: 500, output: 300 },
  usd: 0.0019,
  ms: 4200,
}
const winnerResult: SupervisedResult<unknown> = {
  kind: 'winner',
  out: { patch: 'diff' },
  outRef: 'blob:1',
  tree: emptyTree,
  spentTotal,
}

beforeEach(() => {
  superviseSpy.mockReset()
  superviseSpy.mockResolvedValue(winnerResult)
})

describe('delegate MCP tool — generic delegation verb that returns cost', () => {
  it('validates a non-empty intent', () => {
    expect(() => validateDelegateArgs({})).toThrow(/intent/)
    expect(() => validateDelegateArgs({ intent: '   ' })).toThrow(/intent/)
    expect(validateDelegateArgs({ intent: 'do x' }).intent).toBe('do x')
  })

  it('routes the intent to delegate()/supervise() and returns the delivered output WITH spentTotal', async () => {
    const handler = createDelegateHandler({ router, backend, supervisorProfile })
    const result = (await handler({ intent: 'fix the bug' })) as {
      status: string
      out: unknown
      spentTotal: Spend
    }

    expect(superviseSpy).toHaveBeenCalledTimes(1)
    const [, task] = superviseSpy.mock.calls[0] as [unknown, unknown, unknown]
    expect(task).toBe('fix the bug')

    expect(result.status).toBe('winner')
    expect(result.out).toEqual({ patch: 'diff' })
    // The whole point: the agent learns what the delegation cost.
    expect(result.spentTotal).toEqual(spentTotal)
  })

  it('reports no-winner faithfully with the reason AND the real spend (never a faked success or zero cost)', async () => {
    superviseSpy.mockResolvedValue({
      kind: 'no-winner',
      reason: 'all-children-down',
      tree: emptyTree,
      downCount: 2,
      spentTotal,
    })
    const handler = createDelegateHandler({ router, backend, supervisorProfile })
    const result = (await handler({ intent: 'do x' })) as {
      status: string
      reason: string
      spentTotal: Spend
    }
    expect(result.status).toBe('no-winner')
    expect(result.reason).toBe('all-children-down')
    // A failed delegation still cost real compute; the agent must learn it — never a fabricated zero.
    expect(result.spentTotal).toEqual(spentTotal)
  })

  // `reason` is a four-word code. The supervisor attaches the rejection to the result precisely so
  // a caller can read WHY; dropping it here leaves the agent — and whoever it reports to — with a
  // failure that names nothing it can act on.
  it('carries the driver’s rejection so a failure is diagnosable from the tool result', async () => {
    superviseSpy.mockResolvedValue({
      kind: 'no-winner',
      reason: 'driver-failed',
      tree: emptyTree,
      downCount: 0,
      spentTotal,
      error: { name: 'Error', message: 'router 503: no provider configured for this model' },
    } as unknown as SupervisedResult<unknown>)
    const handler = createDelegateHandler({ router, backend, supervisorProfile })
    const result = (await handler({ intent: 'do x' })) as {
      status: string
      reason: string
      error?: { name: string; message: string }
    }
    expect(result.status).toBe('no-winner')
    expect(result.reason).toBe('driver-failed')
    expect(result.error).toEqual({
      name: 'Error',
      message: 'router 503: no provider configured for this model',
    })
  })

  it('omits the error entirely on a no-winner the driver did not reject on', async () => {
    superviseSpy.mockResolvedValue({
      kind: 'no-winner',
      reason: 'all-children-down',
      tree: emptyTree,
      downCount: 2,
      spentTotal,
    })
    const handler = createDelegateHandler({ router, backend, supervisorProfile })
    const result = (await handler({ intent: 'do x' })) as Record<string, unknown>
    expect('error' in result).toBe(false)
  })

  it('rejects per-call execution overrides before supervision', async () => {
    const handler = createDelegateHandler({ router, backend, supervisorProfile })
    await expect(handler({ intent: 'do x', model: 'glm-5.2' })).rejects.toThrow(/unknown.*model/)
    expect(superviseSpy).not.toHaveBeenCalled()
  })

  it('createMcpServer registers `delegate` only when delegateSupervisor is wired', () => {
    const without = createMcpServer({})
    expect(without.tools.has(DELEGATE_TOOL_NAME)).toBe(false)

    const withSupervisor = createMcpServer({
      delegateSupervisor: { router, backend, supervisorProfile },
    })
    expect(withSupervisor.tools.has(DELEGATE_TOOL_NAME)).toBe(true)
  })
})
