import { existsSync } from 'node:fs'
import type { AgentEnvironmentEvent } from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import { inProcessEnvironmentProvider } from './in-process-environment-provider'

describe('inProcessEnvironmentProvider', () => {
  it('creates a real provider and preserves event usage', async () => {
    const provider = inProcessEnvironmentProvider({
      onTurn: (prompt): AgentEnvironmentEvent[] => [
        {
          type: 'llm_call',
          data: { tokensIn: 10, tokensOut: 5, costUsd: 0.001 },
          usage: { inputTokens: 10, outputTokens: 5, cost: 0.001 },
        },
        { type: 'result', data: { finalText: `echo:${prompt}` } },
      ],
    })

    const capabilities = await provider.capabilities()
    const environment = await provider.create({
      profile: { name: 'echo' },
      name: 'echo-environment',
    })
    const events = await collect(environment.stream({ prompt: 'hello' }))

    expect(provider.name).toBe('in-process')
    expect(environment.provider).toBe('in-process')
    expect(environment.name).toBe('echo-environment')
    expect(capabilities.streaming.live).toBe(true)
    expect(events.at(-1)?.data.finalText).toBe('echo:hello')
    expect(events[0]?.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cost: 0.001,
    })
  })

  it('increments rounds and forwards the profile and turn input', async () => {
    const seen: Array<{
      round: number
      profileName?: string
      model?: string
      providerOptions?: Record<string, unknown>
    }> = []
    const provider = inProcessEnvironmentProvider({
      onTurn: (_prompt, context): AgentEnvironmentEvent[] => {
        seen.push({
          round: context.round,
          profileName: context.profile.name,
          model: context.input.model,
          providerOptions: context.input.providerOptions,
        })
        return [{ type: 'result', data: { finalText: `r${context.round}` } }]
      },
    })
    const environment = await provider.create({ profile: { name: 'worker' } })

    await collect(
      environment.stream({
        prompt: 'a',
        model: 'model-a',
        providerOptions: { temperature: 0 },
      }),
    )
    await collect(environment.stream({ prompt: 'b' }))

    expect(seen).toEqual([
      {
        round: 0,
        profileName: 'worker',
        model: 'model-a',
        providerOptions: { temperature: 0 },
      },
      {
        round: 1,
        profileName: 'worker',
        model: undefined,
        providerOptions: undefined,
      },
    ])
  })

  it('provides filesystem and command execution and removes the workspace on destroy', async () => {
    let workdir: string | undefined
    const provider = inProcessEnvironmentProvider({
      workspacePrefix: 'in-process-provider-test',
      onTurn: async (_prompt, context): Promise<AgentEnvironmentEvent[]> => {
        workdir = context.workdir
        const fs = await import('node:fs/promises')
        const { join } = await import('node:path')
        await fs.writeFile(join(context.workdir ?? '', 'callback.txt'), 'callback', 'utf8')
        return [{ type: 'result', data: { finalText: 'done' } }]
      },
    })
    const capabilities = await provider.capabilities()
    const environment = await provider.create({ profile: { name: 'workspace' } })

    expect(capabilities.workspace).toMatchObject({ read: true, write: true, exec: true })
    await environment.write?.('nested/out.txt', 'written')
    expect(await environment.read?.('nested/out.txt')).toBe('written')
    await collect(environment.stream({ prompt: 'go' }))
    expect(await environment.read?.('callback.txt')).toBe('callback')

    const command = await environment.exec?.('printf hello')
    expect(command).toEqual({ exitCode: 0, stdout: 'hello', stderr: '' })
    await expect(environment.read?.('../outside.txt')).rejects.toThrow(/escapes workspace/)
    expect(workdir).toBeDefined()
    expect(existsSync(workdir ?? '')).toBe(true)

    await environment.destroy?.()
    expect(await environment.status()).toBe('stopped')
    expect(existsSync(workdir ?? '')).toBe(false)
    await expect(environment.read?.('nested/out.txt')).rejects.toThrow(/destroyed/)
  })

  it('supports deterministic ids and idempotent destroy', async () => {
    const provider = inProcessEnvironmentProvider({
      id: (sequence) => `environment-${sequence}`,
      onTurn: () => [],
    })
    const first = await provider.create({ profile: {} })
    const second = await provider.create({ profile: {} })

    expect(first.id).toBe('environment-0')
    expect(second.id).toBe('environment-1')

    await first.destroy?.()
    await first.destroy?.()
    expect(await first.status()).toBe('stopped')
  })

  it('propagates turn cancellation into the callback', async () => {
    let ready!: () => void
    const entered = new Promise<void>((resolve) => {
      ready = resolve
    })
    const provider = inProcessEnvironmentProvider({
      onTurn: async (_prompt, context) => {
        ready()
        await new Promise<void>((resolve) => {
          context.signal.addEventListener('abort', () => resolve(), { once: true })
        })
        return []
      },
    })
    const environment = await provider.create({ profile: {} })
    const controller = new AbortController()
    const running = collect(environment.stream({ prompt: 'wait', signal: controller.signal }))

    await entered
    controller.abort()

    await expect(running).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects named and invalid inline profiles before creating an environment', async () => {
    const provider = inProcessEnvironmentProvider({
      onTurn: () => [],
      validateProfile: (profile) => ({
        ok: profile.name !== 'blocked',
        issues:
          profile.name === 'blocked'
            ? [{ level: 'error', code: 'blocked', message: 'profile is blocked' }]
            : [],
        normalizedProfile: profile,
      }),
    })

    await expect(provider.create({ profile: 'catalog-profile' })).rejects.toThrow(
      /named profiles require a provider catalog/,
    )
    await expect(provider.create({ profile: { name: 'blocked' } })).rejects.toThrow(
      /profile is blocked/,
    )
  })

  it('accepts an async event stream from the callback', async () => {
    async function* stream(): AsyncIterable<AgentEnvironmentEvent> {
      yield { type: 'result', data: { finalText: 'streamed' } }
    }
    const provider = inProcessEnvironmentProvider({ onTurn: () => stream() })
    const environment = await provider.create({ profile: {} })

    const events = await collect(environment.stream({ prompt: 'x' }))

    expect(events.at(-1)?.data.finalText).toBe('streamed')
  })
})

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = []
  for await (const value of iterable) values.push(value)
  return values
}
