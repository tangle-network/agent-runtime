import { describe, expect, it } from 'vitest'
import { agentHarness, harnessRunsAgent } from './harness-role'

describe('harnessRunsAgent', () => {
  it('treats only the router/no-agent mode and an absent preference as no agent', () => {
    expect(harnessRunsAgent('cli-base')).toBe(false)
    expect(harnessRunsAgent(undefined)).toBe(false)
    expect(harnessRunsAgent(null)).toBe(false)
    for (const harness of ['claude-code', 'codex', 'opencode', 'pi', 'kimi-code'] as const) {
      expect(harnessRunsAgent(harness)).toBe(true)
    }
  })

  it('keeps nanoclaw a full harness despite sharing cli-base reasoning clamp', () => {
    expect(harnessRunsAgent('nanoclaw')).toBe(true)
  })
})

describe('agentHarness', () => {
  it('drops the no-agent mode and passes a real harness through unchanged', () => {
    expect(agentHarness('cli-base')).toBeUndefined()
    expect(agentHarness(null)).toBeUndefined()
    expect(agentHarness(undefined)).toBeUndefined()
    expect(agentHarness('codex')).toBe('codex')
  })
})
