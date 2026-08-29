/**
 * A boxless `SandboxClient` seam refuses a per-prompt backend.
 *
 * Four seams present an in-process executor as a box. `promptOptions.backend` names the harness
 * to run and the credential to run it on — an instrument choice only a real sandbox can apply.
 * Accepting the prompt and dropping that key would run the turn on a different instrument than
 * the caller asked for and report nothing, so each seam fails before the prompt runs.
 *
 * Every other per-prompt key stays accepted and ignored: `timeoutMs` and `context` shape how a
 * box executes a turn, not which instrument serves it.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import type { SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it, vi } from 'vitest'
import { ValidationError } from '../../src/errors'
import { createInProcessExecutor } from '../../src/mcp/in-process-executor'
import type { GitRunner } from '../../src/mcp/worktree'
import { inProcessSandboxClient } from '../../src/runtime/in-process-sandbox-client'
import { inlineSandboxClient } from '../../src/runtime/inline-sandbox-client'
import { localSandboxClient } from '../../src/runtime/local-sandbox-client'
import type { Executor } from '../../src/runtime/supervise/types'

/** The per-prompt options that choose the instrument: which harness, on which credential, as
 *  which model. A boxless seam has no box to apply either to. */
const perPromptBackend = { backend: { type: 'codex' as const } }
const perPromptModel = { model: 'gpt-5.6-sol' }

/** Values a caller can only have supplied by mistake. `undefined` stays valid: the SDK-typed
 *  `streamPrompt(message, options?)` signature makes the whole argument optional. */
const notAnObject = ['oops', null, 42, [perPromptBackend]]

const offlineProfile: AgentProfile = {
  name: 'boxless-worker',
  harness: 'opencode',
  model: { provider: 'offline', default: 'offline-test-model' },
}

const drain = async (box: SandboxInstance, options?: unknown): Promise<SandboxEvent[]> => {
  const collected: SandboxEvent[] = []
  for await (const event of box.streamPrompt('work', options as { signal?: AbortSignal })) {
    collected.push(event)
  }
  return collected
}

describe('inlineSandboxClient — a per-prompt backend cannot apply without a box', () => {
  /** Counts executor construction, which is the first work `streamPrompt` does after the guard. */
  const countingClient = (): { client: ReturnType<typeof inlineSandboxClient>; runs: number[] } => {
    const runs: number[] = []
    const client = inlineSandboxClient(
      () => {
        runs.push(runs.length)
        const artifact = {
          outRef: 'ref',
          out: { content: 'done' },
          spent: { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 1 },
        }
        return {
          async execute() {
            return artifact
          },
          resultArtifact: () => artifact,
          async teardown() {},
        } as unknown as Executor<unknown>
      },
      { profile: offlineProfile },
    )
    return { client, runs }
  }

  const client = () =>
    inlineSandboxClient(
      () => {
        const artifact = {
          outRef: 'ref',
          out: { content: 'done' },
          spent: { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 1 },
        }
        return {
          async execute() {
            return artifact
          },
          resultArtifact: () => artifact,
          async teardown() {},
        } as unknown as Executor<unknown>
      },
      { profile: offlineProfile },
    )

  it('refuses the prompt and names the seam', async () => {
    const box = await client().create()
    await expect(drain(box, perPromptBackend)).rejects.toThrow(
      'inlineSandboxClient: promptOptions.backend cannot apply without a box',
    )
    await expect(drain(box, perPromptBackend)).rejects.toBeInstanceOf(ValidationError)
  })

  it('refuses a per-turn model the same way', async () => {
    const box = await client().create()
    await expect(drain(box, perPromptModel)).rejects.toThrow(
      'inlineSandboxClient: promptOptions.model cannot apply without a box',
    )
    await expect(drain(box, perPromptModel)).rejects.toBeInstanceOf(ValidationError)
  })

  it('names backend first when a value carries both', async () => {
    const box = await client().create()
    await expect(drain(box, { ...perPromptBackend, ...perPromptModel })).rejects.toThrow(
      'inlineSandboxClient: promptOptions.backend cannot apply without a box',
    )
  })

  it('rejects a non-object on the same rule the kernels apply, before any work', async () => {
    const { client: counting, runs } = countingClient()
    const box = await counting.create()
    for (const value of notAnObject) {
      await expect(drain(box, value)).rejects.toThrow(
        'inlineSandboxClient: promptOptions must be an object of SDK PromptOptions',
      )
      await expect(drain(box, value)).rejects.toBeInstanceOf(ValidationError)
    }
    expect(runs).toEqual([])
  })

  it('accepts a prompt that carries only options a boxless seam can ignore', async () => {
    const box = await client().create()
    await expect(drain(box, { timeoutMs: 5 })).resolves.not.toHaveLength(0)
    await expect(drain(box, undefined)).resolves.not.toHaveLength(0)
  })
})

describe('inProcessSandboxClient — a per-prompt backend cannot apply without a box', () => {
  const client = () =>
    inProcessSandboxClient({
      onPrompt: () => [{ type: 'result', data: { finalText: 'done' } } as SandboxEvent],
    })

  it('refuses the prompt and names the seam', async () => {
    const box = await client().create()
    await expect(drain(box, perPromptBackend)).rejects.toThrow(
      'inProcessSandboxClient: promptOptions.backend cannot apply without a box',
    )
    await expect(drain(box, perPromptBackend)).rejects.toBeInstanceOf(ValidationError)
  })

  it('accepts a prompt that carries only options a boxless seam can ignore', async () => {
    const box = await client().create()
    await expect(drain(box, { timeoutMs: 5 })).resolves.toHaveLength(1)
    await expect(drain(box, undefined)).resolves.toHaveLength(1)
  })

  it('rejects a non-object on the same rule the kernels apply, before any work', async () => {
    const prompts: string[] = []
    const box = await inProcessSandboxClient({
      onPrompt: (prompt) => {
        prompts.push(String(prompt))
        return [{ type: 'result', data: { finalText: 'done' } } as SandboxEvent]
      },
    }).create()
    for (const value of notAnObject) {
      await expect(drain(box, value)).rejects.toThrow(
        'inProcessSandboxClient: promptOptions must be an object of SDK PromptOptions',
      )
      await expect(drain(box, value)).rejects.toBeInstanceOf(ValidationError)
    }
    expect(prompts).toEqual([])
  })

  it('delivers a per-turn model to onPrompt instead of refusing it', async () => {
    // This seam surfaces the verbatim per-call options to the callback, and the callback is the
    // executor: a per-turn model is something it can act on, so the seam must not refuse it.
    const seen: (Record<string, unknown> | undefined)[] = []
    const box = await inProcessSandboxClient({
      onPrompt: (_prompt, promptCtx) => {
        seen.push(promptCtx.options)
        return [{ type: 'result', data: { finalText: 'done' } } as SandboxEvent]
      },
    }).create()

    await expect(drain(box, perPromptModel)).resolves.toHaveLength(1)
    expect(seen).toEqual([{ model: 'gpt-5.6-sol' }])
  })
})

describe('localSandboxClient — a per-prompt backend cannot apply without a box', () => {
  const client = () =>
    localSandboxClient({
      router: { baseUrl: 'https://router.invalid', key: 'unused' },
      profile: offlineProfile,
    })

  it('refuses the prompt before it reaches the router', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('localSandboxClient must not call the router for a refused prompt')
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const box = await client().create()
      await expect(drain(box, perPromptBackend)).rejects.toThrow(
        'localSandboxClient: promptOptions.backend cannot apply without a box',
      )
      await expect(drain(box, perPromptBackend)).rejects.toBeInstanceOf(ValidationError)
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('refuses a per-turn model before it reaches the router', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('localSandboxClient must not call the router for a refused prompt')
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const box = await client().create()
      await expect(drain(box, perPromptModel)).rejects.toThrow(
        'localSandboxClient: promptOptions.model cannot apply without a box',
      )
      await expect(drain(box, perPromptModel)).rejects.toBeInstanceOf(ValidationError)
      expect(fetchMock).not.toHaveBeenCalled()
      // `timeoutMs` alone passes the guard, so the turn goes on to call the router — which is
      // what proves the guard, not some earlier failure, rejected the instrument keys above.
      await expect(drain(box, { timeoutMs: 5 })).rejects.not.toBeInstanceOf(ValidationError)
      expect(fetchMock).toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects a non-object before it reaches the router', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('localSandboxClient must not call the router for a refused prompt')
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const box = await client().create()
      for (const value of notAnObject) {
        await expect(drain(box, value)).rejects.toThrow(
          'localSandboxClient: promptOptions must be an object of SDK PromptOptions',
        )
        await expect(drain(box, value)).rejects.toBeInstanceOf(ValidationError)
      }
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('the in-process MCP executor — a per-prompt backend cannot apply without a box', () => {
  const fakeGit: GitRunner = async (args) => {
    if (args[0] === 'rev-parse') return { stdout: 'abc1234\n', stderr: '', exitCode: 0 }
    return { stdout: '', stderr: '', exitCode: 0 }
  }
  const runHarness = () =>
    vi.fn(async () => ({
      exitCode: 0,
      stdout: 'done',
      stderr: '',
      killedBySignal: null,
      durationMs: 1,
      timedOut: false,
    }))
  const executorWith = (harness: ReturnType<typeof runHarness>) =>
    createInProcessExecutor({ repoRoot: '/workspace', runGit: fakeGit, runHarness: harness })
  const executor = () => executorWith(runHarness())
  const codexBox = async (exec: ReturnType<typeof createInProcessExecutor>) =>
    exec.client.create({
      backend: {
        type: 'codex',
        profile: {
          name: 'worker-codex',
          harness: 'codex',
          model: { provider: 'openai', default: 'offline-test-model' },
        },
      },
    } as unknown as Parameters<typeof exec.client.create>[0])

  it('refuses the prompt before the worktree harness runs', async () => {
    const exec = executor()
    const box = await exec.client.create({
      backend: {
        type: 'codex',
        profile: {
          name: 'worker-codex',
          harness: 'codex',
          model: { provider: 'openai', default: 'offline-test-model' },
        },
      },
    } as unknown as Parameters<typeof exec.client.create>[0])
    await expect(drain(box, perPromptBackend)).rejects.toThrow(
      'in-process executor: promptOptions.backend cannot apply without a box',
    )
    await expect(drain(box, perPromptBackend)).rejects.toBeInstanceOf(ValidationError)
  })

  it('refuses a per-turn model the same way', async () => {
    const box = await codexBox(executor())
    await expect(drain(box, perPromptModel)).rejects.toThrow(
      'in-process executor: promptOptions.model cannot apply without a box',
    )
    await expect(drain(box, perPromptModel)).rejects.toBeInstanceOf(ValidationError)
  })

  it('rejects a non-object before the harness runs', async () => {
    const harness = runHarness()
    const box = await codexBox(executorWith(harness))
    for (const value of notAnObject) {
      await expect(drain(box, value)).rejects.toThrow(
        'in-process executor: promptOptions must be an object of SDK PromptOptions',
      )
      await expect(drain(box, value)).rejects.toBeInstanceOf(ValidationError)
    }
    expect(harness).not.toHaveBeenCalled()
  })
})
