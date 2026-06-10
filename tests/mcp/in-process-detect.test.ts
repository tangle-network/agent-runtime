import { describe, expect, it, vi } from 'vitest'
import { detectExecutor } from '../../src/mcp/bin-helpers'

const stubClient = { create: vi.fn(async () => ({ id: 'sibling-stub' }) as never) }

describe('detectExecutor — in-process selection', () => {
  it('selects in-process when AGENT_RUNTIME_IN_SANDBOX=1', async () => {
    const exec = await detectExecutor({
      sandboxClient: stubClient,
      env: { AGENT_RUNTIME_IN_SANDBOX: '1', AGENT_RUNTIME_REPO_ROOT: '/workspace' },
    })
    expect(exec.describe()).toMatch(/in-process/)
    expect(exec.describe()).toContain('/workspace')
    expect(exec.describe()).toContain('harnesses=[claude]')
    // In-process placement has no sandbox session — the bin keys detached
    // dispatch off this tag, so it must never read session-backed here.
    expect(exec.placement).toBe('in-process')
  })

  it('tags sibling placement as session-backed', async () => {
    const exec = await detectExecutor({ sandboxClient: stubClient, env: {} })
    expect(exec.placement).toBe('sibling')
  })

  it('throws when in-sandbox mode lacks repo root', async () => {
    await expect(
      detectExecutor({
        sandboxClient: stubClient,
        env: { AGENT_RUNTIME_IN_SANDBOX: '1' },
      }),
    ).rejects.toThrow(/AGENT_RUNTIME_REPO_ROOT/)
  })

  it('passes through configured harnesses list', async () => {
    const exec = await detectExecutor({
      sandboxClient: stubClient,
      env: {
        AGENT_RUNTIME_IN_SANDBOX: '1',
        AGENT_RUNTIME_REPO_ROOT: '/wk',
        AGENT_RUNTIME_LOCAL_HARNESSES: 'claude,codex,opencode',
      },
    })
    expect(exec.describe()).toContain('harnesses=[claude,codex,opencode]')
  })

  it('rejects unknown harness name', async () => {
    await expect(
      detectExecutor({
        sandboxClient: stubClient,
        env: {
          AGENT_RUNTIME_IN_SANDBOX: '1',
          AGENT_RUNTIME_REPO_ROOT: '/wk',
          AGENT_RUNTIME_LOCAL_HARNESSES: 'claude,gemini',
        },
      }),
    ).rejects.toThrow(/unknown harness "gemini"/)
  })

  it('threads test + typecheck commands into the executor description', async () => {
    const exec = await detectExecutor({
      sandboxClient: stubClient,
      env: {
        AGENT_RUNTIME_IN_SANDBOX: '1',
        AGENT_RUNTIME_REPO_ROOT: '/wk',
        AGENT_RUNTIME_TEST_CMD: 'pnpm test',
        AGENT_RUNTIME_TYPECHECK_CMD: 'pnpm typecheck',
      },
    })
    expect(exec.describe()).toContain('testCmd="pnpm test"')
    expect(exec.describe()).toContain('typecheckCmd="pnpm typecheck"')
  })

  it('in-process takes priority over TANGLE_FLEET_ID', async () => {
    const exec = await detectExecutor({
      sandboxClient: stubClient,
      env: {
        AGENT_RUNTIME_IN_SANDBOX: '1',
        AGENT_RUNTIME_REPO_ROOT: '/wk',
        TANGLE_FLEET_ID: 'fleet-x',
      },
    })
    expect(exec.describe()).toMatch(/in-process/)
  })
})
