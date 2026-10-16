import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { workerFromBackend } from '../../src/runtime/supervise/supervise'

function codexProfile(name: string, tools?: AgentProfile['tools']): AgentProfile {
  return {
    name,
    harness: 'codex',
    prompt: { systemPrompt: `Act as ${name}.` },
    model: { provider: 'openai', default: 'gpt-5.6' },
    ...(tools ? { tools } : {}),
  }
}

function routerProfile(name: string): AgentProfile {
  return {
    name,
    harness: 'cli-base',
    prompt: { systemPrompt: `Act as ${name}.` },
    model: { provider: 'tangle-router', default: 'test' },
  }
}

describe('supervise — peer mail mounts on the backend-derived worker path', () => {
  it('refuses a peer-mail spawn on a backend that can only mount tools through the profile', () => {
    // A local CLI harness receives tools only through its materialized AgentProfile, so writing a
    // per-process capability URL there would move the digest a durable session is bound to. The
    // spawn fails instead of handing the worker a capability nothing serves.
    const make = workerFromBackend({
      backend: 'cli-in-place',
      workspacePath: process.cwd(),
    })
    expect(() =>
      make(codexProfile('w1'), {
        assignmentId: 'ordinal:0',
        parentNodeId: 'root',
        budget: {
          tokensLeft: 10,
          iterationsLeft: 1,
          usdLeft: 1,
          usdCapped: false,
          deadlineMs: 0,
        },
        task: 'go',
        label: 'worker',
        peerMailUrl: `http://127.0.0.1:1/mail/${'a'.repeat(32)}`,
      }),
    ).toThrow(/cannot mount a peer-mail endpoint/)
  })

  it('mounts nothing, and refuses nothing, for an in-process worker', () => {
    // A router-tools worker runs no MCP client at all: its tool surface is the caller's own array
    // and `WorkerSpawnContext.peerMailUrl` is the deliverable that caller uses directly. The spawn
    // must therefore build, not refuse — the refusal above is only for a harness the runtime has
    // no channel to.
    const make = workerFromBackend({
      backend: 'router-tools',
      routerBaseUrl: 'http://offline.test/v1',
      routerKey: 'test',
      tools: [],
      executeToolCall: async () => '',
      complete: async () => ({
        model: 'offline-test-model',
        choices: [{ message: { content: 'done', tool_calls: [] } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, cost_usd: 0 },
      }),
    })
    const agent = make(routerProfile('w1'), {
      assignmentId: 'ordinal:0',
      parentNodeId: 'root',
      budget: { tokensLeft: 10, iterationsLeft: 1, usdLeft: 1, usdCapped: false, deadlineMs: 0 },
      task: 'go',
      label: 'worker',
      peerMailUrl: `http://127.0.0.1:1/mail/${'a'.repeat(32)}`,
    })
    expect(agent.name).toBe('w1')
  })
})
