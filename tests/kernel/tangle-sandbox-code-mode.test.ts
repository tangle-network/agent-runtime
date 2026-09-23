import type { AgentProfile } from '@tangle-network/agent-interface'
import type {
  EgressPolicy,
  SandboxInstance,
  SandboxTerminalAttachOptions,
  TerminalExitInfo,
  TerminalStream,
} from '@tangle-network/sandbox'
import { describe, expect, it, vi } from 'vitest'

import { InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { codeModeSupervisorTools } from '../../src/runtime/supervise/code-mode'
import { superviseWithTestBrain } from '../../src/runtime/supervise/supervise'
import {
  type TangleSandboxCodeModeClient,
  TangleSandboxCodeModeRunner,
} from '../../src/runtime/supervise/tangle-sandbox-code-mode'
import type {
  Agent,
  AgentSpec,
  Executor,
  ExecutorResult,
  Spend,
} from '../../src/runtime/supervise/types'
import { scriptedBrain } from './scripted-brain'
import { testAgentProfile } from './test-agent-profile'

const protocolPrefix = '__tangle_code_mode_v1__:'

interface ProtocolMessage {
  readonly type: string
  readonly [key: string]: unknown
}

class ScriptedTerminal {
  handlers: SandboxTerminalAttachOptions['handlers'] | undefined
  onWrite: ((message: ProtocolMessage) => void) | undefined
  readonly write = vi.fn((data: string | Uint8Array) => {
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data)
    this.onWrite?.(decode(text))
  })
  readonly close = vi.fn(async () => undefined)

  emit(message: ProtocolMessage): void {
    this.handlers?.onData?.(new TextEncoder().encode(encode(message)))
  }

  exit(info: TerminalExitInfo): void {
    this.handlers?.onExit?.(info)
  }

  asTerminal(): TerminalStream {
    return this as unknown as TerminalStream
  }
}

function encode(message: ProtocolMessage): string {
  return `${protocolPrefix}${Buffer.from(JSON.stringify(message)).toString('base64')}\n`
}

function decode(line: string): ProtocolMessage {
  expect(line.startsWith(protocolPrefix)).toBe(true)
  return JSON.parse(
    Buffer.from(line.slice(protocolPrefix.length).trim(), 'base64').toString('utf8'),
  )
}

function fakeSandbox(policy: EgressPolicy = { mode: 'blocked' }) {
  const terminal = new ScriptedTerminal()
  const sandbox = {
    id: 'code-mode-box',
    egress: { get: vi.fn(async () => ({ policy })) },
    terminals: {
      attach: vi.fn(async (_connectionId: string, options?: SandboxTerminalAttachOptions) => {
        terminal.handlers = options?.handlers
        return terminal.asTerminal()
      }),
    },
    delete: vi.fn(async () => undefined),
  } as unknown as SandboxInstance
  const client = {
    create: vi.fn(async () => sandbox),
  } as unknown as TangleSandboxCodeModeClient
  return { client, sandbox, terminal }
}

const spend: Spend = { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 0 }

function leafSeam(profileRaw: unknown): Agent<unknown, unknown> {
  const profile = profileRaw as AgentProfile
  const name = profile.name ?? 'worker'
  let artifact: ExecutorResult<unknown> | undefined
  const executor: Executor<unknown> = {
    runtime: 'inline',
    async execute() {
      artifact = {
        outRef: `worker:${name}`,
        out: { built: name },
        verdict: { valid: true, score: 1 },
        spent: spend,
      }
      return artifact
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: () => {
      if (artifact === undefined) throw new Error('worker result requested before execution')
      return artifact
    },
  }
  return {
    name,
    act: async () => '',
    executorSpec: { profile, harness: null, executor } as AgentSpec,
  } as Agent<unknown, unknown> & { executorSpec: AgentSpec }
}

describe('TangleSandboxCodeModeRunner', () => {
  it('creates one ephemeral blocked-egress box and returns a host binding result over the terminal bridge', async () => {
    const { client, sandbox, terminal } = fakeSandbox()
    const calls: unknown[] = []
    terminal.onWrite = (message) => {
      if (message.type === 'start') {
        terminal.emit({ type: 'call', id: 'call-1', name: 'double', args: 21 })
        return
      }
      if (message.type === 'response') {
        expect(message).toMatchObject({ id: 'call-1', ok: true, value: 42 })
        terminal.emit({ type: 'log', text: 'doubled 21' })
        terminal.emit({ type: 'result', value: { answer: 42 } })
      }
    }

    const result = await new TangleSandboxCodeModeRunner({ client }).run({
      code: 'return await api.double(21)',
      bindings: {
        double: async (value) => {
          calls.push(value)
          return (value as number) * 2
        },
      },
      signal: new AbortController().signal,
    })

    expect(result).toEqual({ result: { answer: 42 }, logs: ['doubled 21'] })
    expect(calls).toEqual([21])
    expect(client.create).toHaveBeenCalledWith({
      agent: false,
      ephemeral: true,
      egressPolicy: { mode: 'blocked' },
    })
    expect(sandbox.egress.get).toHaveBeenCalledOnce()
    expect(sandbox.terminals.attach).toHaveBeenCalledOnce()
    expect(sandbox.delete).toHaveBeenCalledOnce()
  })

  it('allows two concurrent callbacks only through the granted binding names', async () => {
    const { client, terminal } = fakeSandbox()
    const calls: unknown[] = []
    let responses = 0
    terminal.onWrite = (message) => {
      if (message.type === 'start') {
        terminal.emit({ type: 'call', id: 'call-a', name: 'spawn_worker', args: { task: 'a' } })
        terminal.emit({ type: 'call', id: 'call-b', name: 'spawn_worker', args: { task: 'b' } })
        return
      }
      if (message.type === 'response') {
        responses += 1
        if (responses === 2) terminal.emit({ type: 'result', value: 'two calls returned' })
      }
    }

    const result = await new TangleSandboxCodeModeRunner({ client }).run({
      code: 'return await Promise.all([api.spawn_worker({ task: "a" }), api.spawn_worker({ task: "b" })])',
      bindings: {
        spawn_worker: async (input) => {
          calls.push(input)
          return { workerId: String((input as { task: string }).task) }
        },
      },
      signal: new AbortController().signal,
    })

    expect(result.result).toBe('two calls returned')
    expect(calls).toEqual([{ task: 'a' }, { task: 'b' }])
  })

  it('does not report success while a program-started Runtime call is still pending', async () => {
    const { client, terminal } = fakeSandbox()
    let release: ((value: number) => void) | undefined
    const binding = new Promise<number>((resolve) => {
      release = resolve
    })
    terminal.onWrite = (message) => {
      if (message.type === 'start') {
        terminal.emit({ type: 'call', id: 'abandoned', name: 'spawn_worker', args: {} })
        terminal.emit({ type: 'result', value: 'program returned early' })
      }
    }

    let settled = false
    const run = new TangleSandboxCodeModeRunner({ client })
      .run({
        code: 'void api.spawn_worker({}); return "program returned early"',
        bindings: { spawn_worker: async () => binding },
        signal: new AbortController().signal,
      })
      .finally(() => {
        settled = true
      })

    await vi.waitFor(() => expect(terminal.write).toHaveBeenCalled())
    await Promise.resolve()
    expect(settled).toBe(false)
    release?.(1)
    await expect(run).resolves.toMatchObject({ result: 'program returned early' })
  })

  it('fails when a program returns before an abandoned Runtime call rejects', async () => {
    const { client, terminal } = fakeSandbox()
    terminal.onWrite = (message) => {
      if (message.type === 'start') {
        terminal.emit({ type: 'call', id: 'abandoned', name: 'spawn_worker', args: {} })
        terminal.emit({ type: 'result', value: 'must not pass' })
      }
    }

    await expect(
      new TangleSandboxCodeModeRunner({ client }).run({
        code: 'void api.spawn_worker({}); return "must not pass"',
        bindings: { spawn_worker: async () => Promise.reject(new Error('spawn refused')) },
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/returned before api\.spawn_worker failed: spawn refused/)
  })

  it('refuses an ungranted protocol call before it can invoke any host function', async () => {
    const { client, sandbox, terminal } = fakeSandbox()
    const ambient = vi.fn(async () => 'should never run')
    terminal.onWrite = (message) => {
      if (message.type === 'start') {
        terminal.emit({ type: 'call', id: 'attack', name: 'process', args: {} })
      }
    }

    await expect(
      new TangleSandboxCodeModeRunner({ client }).run({
        code: 'return 1',
        bindings: { declared: ambient },
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/ungranted api\.process/)
    expect(ambient).not.toHaveBeenCalled()
    expect(sandbox.delete).toHaveBeenCalledOnce()
  })

  it('fails closed when the effective platform policy is not blocked', async () => {
    const { client, sandbox } = fakeSandbox({ mode: 'open' })

    await expect(
      new TangleSandboxCodeModeRunner({ client }).run({
        code: 'return 1',
        bindings: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/requires effective blocked egress/)
    expect(sandbox.terminals.attach).not.toHaveBeenCalled()
    expect(sandbox.delete).toHaveBeenCalledOnce()
  })

  it('refuses imports, process, filesystem, and network syntax before a box is allocated', async () => {
    const { client } = fakeSandbox()
    const runner = new TangleSandboxCodeModeRunner({ client })
    const signal = new AbortController().signal

    for (const code of [
      "import { readFile } from 'node:fs'",
      'return process.cwd()',
      "return require('node:fs')",
      "return await import('node:net')",
      "return await fetch('https://example.test')",
    ]) {
      await expect(runner.run({ code, bindings: {}, signal })).rejects.toThrow(/rejected/)
    }
    expect(client.create).not.toHaveBeenCalled()
  })

  it('kills the disposable box on cancellation without waiting for a terminal result', async () => {
    const { client, sandbox, terminal } = fakeSandbox()
    const controller = new AbortController()
    terminal.onWrite = () => {
      // Keep the simulated program running until the manager cancels it.
    }

    const pending = new TangleSandboxCodeModeRunner({ client }).run({
      code: 'await new Promise(() => {})',
      bindings: {},
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(terminal.write).toHaveBeenCalled())
    controller.abort(new Error('manager cancelled'))

    await expect(pending).rejects.toThrow(/manager cancelled/)
    await vi.waitFor(() => expect(sandbox.delete).toHaveBeenCalledOnce())
  })

  it('deletes a box that finishes creating after cancellation', async () => {
    const { sandbox } = fakeSandbox()
    let resolveCreate: ((box: SandboxInstance) => void) | undefined
    const creating = new Promise<SandboxInstance>((resolve) => {
      resolveCreate = resolve
    })
    const client = {
      create: vi.fn(() => creating),
    } as unknown as TangleSandboxCodeModeClient
    const controller = new AbortController()
    const pending = new TangleSandboxCodeModeRunner({ client }).run({
      code: 'return 1',
      bindings: {},
      signal: controller.signal,
    })

    await vi.waitFor(() => expect(client.create).toHaveBeenCalledOnce())
    controller.abort(new Error('manager cancelled during create'))
    await expect(pending).rejects.toThrow(/manager cancelled during create/)
    resolveCreate?.(sandbox)
    await vi.waitFor(() => expect(sandbox.delete).toHaveBeenCalledOnce())
  })

  it('fails rather than hanging when the submitted program exceeds the protocol frame bound', async () => {
    const { client, sandbox } = fakeSandbox()

    await expect(
      new TangleSandboxCodeModeRunner({ client, maxFrameBytes: 20 }).run({
        code: 'return 1',
        bindings: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/protocol frame exceeds 20 bytes/)
    expect(sandbox.delete).toHaveBeenCalledOnce()
  })

  it('does not accept a terminal exit as a program result', async () => {
    const { client, terminal } = fakeSandbox()
    terminal.onWrite = (message) => {
      if (message.type === 'start') terminal.exit({ exitCode: 0 })
    }

    await expect(
      new TangleSandboxCodeModeRunner({ client }).run({
        code: 'return 1',
        bindings: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/exited before a result/)
  })

  it('routes two code-mode spawns through the one live pool and journal', async () => {
    const { client, terminal } = fakeSandbox()
    const journal = new InMemorySpawnJournal()
    let spawnResponses = 0
    let settledEvents = 0
    const requestNextSettlement = (): void => {
      terminal.emit({
        type: 'call',
        id: `wait-${settledEvents + 1}`,
        name: 'await_event',
        args: {},
      })
    }
    terminal.onWrite = (message) => {
      if (message.type === 'start') {
        terminal.emit({
          type: 'call',
          id: 'spawn-a',
          name: 'spawn_worker',
          args: { profile: { name: 'sandbox-a' }, task: 'build a' },
        })
        terminal.emit({
          type: 'call',
          id: 'spawn-b',
          name: 'spawn_worker',
          args: { profile: { name: 'sandbox-b' }, task: 'build b' },
        })
        return
      }
      if (message.type !== 'response') return
      if (message.id === 'spawn-a' || message.id === 'spawn-b') {
        spawnResponses += 1
        if (spawnResponses === 2) requestNextSettlement()
        return
      }
      if (typeof message.id === 'string' && message.id.startsWith('wait-')) {
        const event = message.value as { type?: unknown } | undefined
        if (event?.type === 'settled') settledEvents += 1
        if (settledEvents < 2) requestNextSettlement()
        else terminal.emit({ type: 'result', value: { settledEvents } })
      }
    }

    const result = await superviseWithTestBrain(
      testAgentProfile('root', {
        harness: 'cli-base',
        tools: {
          agent_runtime_coordination_spawn_worker: true,
          agent_runtime_coordination_await_event: true,
          agent_runtime_coordination_search: true,
          agent_runtime_coordination_execute: true,
        },
      }),
      'coordinate two isolated workers',
      {
        budget: { maxIterations: 30, maxTokens: 100_000 },
        journal,
        runId: 'sandbox-code-mode-journal',
        makeWorkerAgent: leafSeam,
        resolveSupervisorTools: codeModeSupervisorTools(
          new TangleSandboxCodeModeRunner({ client }),
        ),
        brain: scriptedBrain([
          {
            toolCalls: [
              {
                name: 'execute',
                arguments: {
                  code: 'return await Promise.all([api.spawn_worker({}), api.spawn_worker({})])',
                },
              },
            ],
          },
          { content: 'done' },
        ]),
      },
    )

    expect(result.kind).toBe('winner')
    expect(result.spentTotal.iterations).toBeGreaterThanOrEqual(2)
    const events = (await journal.loadTree('sandbox-code-mode-journal')) ?? []
    const children = events.filter((event) => event.id !== 'sandbox-code-mode-journal')
    expect(children.filter((event) => event.kind === 'spawned')).toHaveLength(2)
    expect(children.filter((event) => event.kind === 'settled')).toHaveLength(2)
  })
})
