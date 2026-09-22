import type {
  AgentEnvironment,
  AgentEnvironmentEvent,
  AgentEnvironmentProvider,
  CreateAgentEnvironmentInput,
} from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it, vi } from 'vitest'
import { createEnvironmentForSpec } from './environment-create'
import type { AgentRunSpec, MountManifestEntry } from './types'

function environment(id = 'environment-1', destroy?: () => Promise<void>): AgentEnvironment {
  return {
    id,
    provider: 'test-provider',
    status: async () => 'running',
    async *stream(): AsyncIterable<AgentEnvironmentEvent> {},
    ...(destroy ? { destroy } : {}),
  }
}

describe('createEnvironmentForSpec', () => {
  it('validates the profile, forwards creation fields, and prepares the environment', async () => {
    const controller = new AbortController()
    const created = environment()
    const createInputs: CreateAgentEnvironmentInput[] = []
    const mounts: MountManifestEntry[] = []
    const provider: AgentEnvironmentProvider = {
      name: 'test-provider',
      capabilities: () => {
        throw new Error('not used')
      },
      validateProfile: async () => ({
        ok: true,
        issues: [],
        normalizedProfile: { name: 'normalized' },
      }),
      async create(input) {
        createInputs.push(input)
        return created
      },
    }
    const prepareEnvironment = vi.fn(
      async (
        value: AgentEnvironment,
        context: {
          signal: AbortSignal
          recordMount: (entry: MountManifestEntry) => void
        },
      ) => {
        expect(value).toBe(created)
        expect(context.signal).toBe(controller.signal)
        context.recordMount({
          path: '/work/input.txt',
          sha256: 'abc123',
          bytes: 5,
          source: 'test',
        })
      },
    )
    const spec: AgentRunSpec<string> = {
      profile: { name: 'source' },
      taskToPrompt: (task) => task,
      environment: {
        backend: 'codex',
        name: 'job-1',
        idempotencyKey: 'job-1',
        workspace: { environment: 'universal' },
      },
      prepareEnvironment,
    }

    await expect(
      createEnvironmentForSpec(provider, spec, controller.signal, (entry) => mounts.push(entry)),
    ).resolves.toBe(created)

    expect(createInputs).toEqual([
      {
        backend: 'codex',
        name: 'job-1',
        idempotencyKey: 'job-1',
        workspace: { environment: 'universal' },
        profile: { name: 'normalized' },
        signal: controller.signal,
      },
    ])
    expect(prepareEnvironment).toHaveBeenCalledOnce()
    expect(mounts).toEqual([
      {
        path: '/work/input.txt',
        sha256: 'abc123',
        bytes: 5,
        source: 'test',
      },
    ])
  })

  it('rejects an invalid profile before creation', async () => {
    const create = vi.fn(async () => environment())
    const provider: AgentEnvironmentProvider = {
      name: 'strict-provider',
      capabilities: () => {
        throw new Error('not used')
      },
      validateProfile: async () => ({
        ok: false,
        issues: [
          {
            level: 'error',
            code: 'unsupported',
            path: 'tools',
            message: 'tools are unavailable',
          },
        ],
      }),
      create,
    }
    const spec: AgentRunSpec<string> = {
      profile: { name: 'invalid' },
      taskToPrompt: (task) => task,
    }

    await expect(
      createEnvironmentForSpec(provider, spec, new AbortController().signal),
    ).rejects.toThrow(
      'provider "strict-provider" rejected profile "invalid": tools: tools are unavailable',
    )
    expect(create).not.toHaveBeenCalled()
  })

  it('does not call the provider after cancellation', async () => {
    const create = vi.fn(async () => environment())
    const provider: AgentEnvironmentProvider = {
      name: 'test-provider',
      capabilities: () => {
        throw new Error('not used')
      },
      create,
    }
    const spec: AgentRunSpec<string> = {
      profile: { name: 'worker' },
      taskToPrompt: (task) => task,
    }
    const controller = new AbortController()
    controller.abort()

    await expect(createEnvironmentForSpec(provider, spec, controller.signal)).rejects.toThrow(
      /abort/i,
    )
    expect(create).not.toHaveBeenCalled()
  })

  it('destroys an environment when cancellation lands after creation', async () => {
    const controller = new AbortController()
    const destroy = vi.fn(async () => {})
    const created = environment('cancelled-environment', destroy)
    const provider: AgentEnvironmentProvider = {
      name: 'test-provider',
      capabilities: () => {
        throw new Error('not used')
      },
      async create() {
        controller.abort()
        return created
      },
    }
    const spec: AgentRunSpec<string> = {
      profile: { name: 'worker' },
      taskToPrompt: (task) => task,
    }

    await expect(createEnvironmentForSpec(provider, spec, controller.signal)).rejects.toMatchObject(
      {
        name: 'AbortError',
      },
    )
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('destroys an environment when preparation fails without masking the failure', async () => {
    const destroy = vi.fn(async () => {
      throw new Error('destroy failed')
    })
    const created = environment('unprepared-environment', destroy)
    const provider: AgentEnvironmentProvider = {
      name: 'test-provider',
      capabilities: () => {
        throw new Error('not used')
      },
      async create() {
        return created
      },
    }
    const spec: AgentRunSpec<string> = {
      profile: { name: 'worker' },
      taskToPrompt: (task) => task,
      prepareEnvironment() {
        throw new Error('preparation failed')
      },
    }

    await expect(
      createEnvironmentForSpec(provider, spec, new AbortController().signal),
    ).rejects.toThrow('preparation failed')
    expect(destroy).toHaveBeenCalledOnce()
  })
})
