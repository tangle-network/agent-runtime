import { describe, expect, it } from 'vitest'
import { detectExecutor } from '../../src/mcp/bin-helpers'
import { inProcessEnvironmentProvider } from '../../src/runtime/in-process-environment-provider'

const provider = inProcessEnvironmentProvider({
  name: 'test-provider',
  onTurn: () => [],
})

describe('detectExecutor: local worktree selection', () => {
  it('selects local worktrees when AGENT_RUNTIME_IN_SANDBOX=1', async () => {
    const exec = await detectExecutor({
      provider,
      env: { AGENT_RUNTIME_IN_SANDBOX: '1', AGENT_RUNTIME_REPO_ROOT: '/workspace' },
    })
    expect(exec.describe()).toMatch(/local worktrees/)
    expect(exec.describe()).toContain('/workspace')
    expect(exec.describe()).toContain('workers=[claude-code]')
    expect(exec.placement).toBe('local')
  })

  it('keeps the configured provider when local worktree mode is disabled', async () => {
    const exec = await detectExecutor({ provider, env: {} })
    expect(exec.provider).toBe(provider)
    expect(exec.placement).toBe('provider')
  })

  it('throws when local worktree mode lacks repo root', async () => {
    await expect(
      detectExecutor({
        provider,
        env: { AGENT_RUNTIME_IN_SANDBOX: '1' },
      }),
    ).rejects.toThrow(/AGENT_RUNTIME_REPO_ROOT/)
  })

  it('passes through configured harnesses list', async () => {
    const exec = await detectExecutor({
      provider,
      env: {
        AGENT_RUNTIME_IN_SANDBOX: '1',
        AGENT_RUNTIME_REPO_ROOT: '/wk',
        AGENT_RUNTIME_LOCAL_HARNESSES: 'claude-code,codex,opencode',
      },
    })
    expect(exec.describe()).toContain('workers=[claude-code,codex,opencode]')
  })

  it('rejects unknown harness name', async () => {
    await expect(
      detectExecutor({
        provider,
        env: {
          AGENT_RUNTIME_IN_SANDBOX: '1',
          AGENT_RUNTIME_REPO_ROOT: '/wk',
          AGENT_RUNTIME_LOCAL_HARNESSES: 'claude',
        },
      }),
    ).rejects.toThrow(/unknown harness "claude"/)
  })

  it('accepts test and typecheck commands for the local executor', async () => {
    const exec = await detectExecutor({
      provider,
      env: {
        AGENT_RUNTIME_IN_SANDBOX: '1',
        AGENT_RUNTIME_REPO_ROOT: '/wk',
        AGENT_RUNTIME_TEST_CMD: 'pnpm test',
        AGENT_RUNTIME_TYPECHECK_CMD: 'pnpm typecheck',
      },
    })
    expect(exec.placement).toBe('local')
    expect(exec.provider.name).toBe('worktree-process')
  })

  it('local worktree mode takes priority over TANGLE_FLEET_ID', async () => {
    const exec = await detectExecutor({
      provider,
      env: {
        AGENT_RUNTIME_IN_SANDBOX: '1',
        AGENT_RUNTIME_REPO_ROOT: '/wk',
        TANGLE_FLEET_ID: 'fleet-x',
      },
    })
    expect(exec.placement).toBe('local')
  })
})
