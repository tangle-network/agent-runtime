import type { AgentProfile } from '@tangle-network/agent-interface'
import type {
  AgentEnvironmentCapabilities,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import type { SharedBoxHandle, SharedBoxProcess } from './shared-box'
import {
  ROUTER_CLIENT_HEADER,
  sharedBoxPlacement,
  sharedBoxRefusal,
  sharedWorkerClientName,
} from './shared-box'
import { createExecutor } from './supervise/runtime'
import type { SandboxClient } from './types'

const leaf = (overrides: Partial<AgentProfile> = {}): AgentProfile =>
  ({
    name: 'leaf',
    harness: 'opencode',
    model: { provider: 'tangle-router', default: 'deepseek/deepseek-v4.1-flash' },
    prompt: { instructions: ['Your code word is ALPHA.'] },
    resources: {
      files: [
        {
          path: 'inputs/brief.md',
          resource: { kind: 'inline', name: 'inputs/brief.md', content: '# brief\n' },
        },
      ],
    },
    ...overrides,
  }) as AgentProfile

interface Spawn {
  readonly executable: string
  readonly args: readonly string[]
  readonly options: { cwd?: string; env?: Record<string, string>; timeoutMs?: number }
  killed: boolean
}

/** A fake Sandbox box: a file map, scripted opencode output, and a record of every spawn. */
class FakeBox implements SharedBoxHandle {
  readonly files = new Map<string, string>()
  readonly spawns: Spawn[] = []
  readonly execs: string[] = []
  deleted = false
  constructor(
    readonly id: string,
    private readonly script: (spawn: Spawn) => { stdout: string[]; exit: number },
  ) {}

  async exec(command: string) {
    this.execs.push(command)
    return { exitCode: 0, stdout: '', stderr: '' }
  }

  readonly fs = {
    read: async (path: string) => {
      const content = this.files.get(path)
      if (content === undefined) throw new Error(`no file ${path}`)
      return content
    },
    write: async (path: string, content: string) => {
      const refused = this.failNext.write.shift()
      if (refused !== undefined) throw refused
      this.files.set(path, content)
    },
  }

  /** Failures to throw from the next calls, by operation. */
  readonly failNext: { spawn: unknown[]; spawnAfterLaunch: unknown[]; write: unknown[] } = {
    spawn: [],
    spawnAfterLaunch: [],
    write: [],
  }
  private readonly launched = new Map<number, SharedBoxProcess & { cwd?: string }>()

  readonly process = {
    list: async () =>
      [...this.launched.entries()].map(([pid, process]) => ({
        pid,
        command: '/usr/bin/env',
        cwd: process.cwd,
      })),
    get: async (pid: number) => this.launched.get(pid) ?? null,
    spawnExact: async (
      executable: string,
      args: readonly string[],
      options: Spawn['options'] = {},
    ): Promise<SharedBoxProcess> => {
      const refused = this.failNext.spawn.shift()
      if (refused !== undefined) throw refused
      const spawn: Spawn = { executable, args, options, killed: false }
      this.spawns.push(spawn)
      const home = args.find((arg) => arg.startsWith('HOME='))?.slice('HOME='.length)
      const exportAt = args.indexOf('export-session')
      let stdout: string[] = []
      let exit = 0
      if (exportAt >= 0) {
        this.files.set(args[exportAt + 2]!, JSON.stringify({ info: { id: args[exportAt + 1] } }))
      } else if (args.includes('/bin/sh')) {
        // The transcript capture's enumeration: list the worker's own export files.
        const listing = [...this.files.keys()]
          .filter((path) => home !== undefined && path.startsWith(`${home}/`))
          .map((path) => `${this.files.get(path)!.length}\t${path}`)
        stdout = [listing.join('\n')]
      } else {
        ;({ stdout, exit } = this.script(spawn))
      }
      const process = {
        pid: this.spawns.length,
        cwd: options.cwd,
        wait: async () => exit,
        kill: async () => {
          spawn.killed = true
        },
        async *stdout() {
          for (const chunk of stdout) yield chunk
        },
        async *stderr() {},
      }
      this.launched.set(process.pid, process)
      const lost = this.failNext.spawnAfterLaunch.shift()
      if (lost !== undefined) throw lost
      return process
    },
  }

  async delete() {
    this.deleted = true
  }
}

const opencodeRun = (text: string, tokens = { input: 100, output: 20 }) => [
  `${JSON.stringify({ type: 'step_start', sessionID: 'ses_abc', part: { type: 'step-start', messageID: 'm1' } })}\n`,
  `${JSON.stringify({ type: 'tool_use', sessionID: 'ses_abc', part: { type: 'tool', tool: 'bash', callID: 'c1', messageID: 'm1', state: { status: 'completed', input: { command: 'pwd' }, output: '/w' } } })}\n`,
  // A line split across two chunks, as a stream delivers it.
  `${JSON.stringify({ type: 'step_finish', sessionID: 'ses_abc', part: { id: 'p1', type: 'step-finish', messageID: 'm1', tokens: { ...tokens, reasoning: 0, cache: { read: 50, write: 0 } } } })}\n{"type":"te`,
  `xt","sessionID":"ses_abc","part":{"type":"text","messageID":"m2","text":${JSON.stringify(text)}}}\n`,
  `${JSON.stringify({ type: 'step_finish', sessionID: 'ses_abc', part: { id: 'p2', type: 'step-finish', messageID: 'm2', tokens } })}\n`,
]

function fakeClient(script: (spawn: Spawn) => { stdout: string[]; exit: number }) {
  const boxes: FakeBox[] = []
  const client: SandboxClient = {
    async create() {
      const box = new FakeBox(`sandbox-${boxes.length}`, script)
      boxes.push(box)
      return box as never
    },
  }
  return { client, boxes }
}

describe('sharedBoxRefusal', () => {
  it('accepts a leaf opencode profile with inline files and instructions', () => {
    expect(sharedBoxRefusal(leaf())).toBeUndefined()
  })

  it.each([
    ['another harness', { harness: 'claude-code' }, /harness claude-code/],
    ['a replaced system prompt', { prompt: { systemPrompt: 'x' } }, /systemPrompt/],
    ['tool grants', { tools: { agent_runtime_coordination_spawn_worker: true } }, /grants tools/],
    ['MCP servers', { mcp: { x: { transport: 'http', url: 'https://x' } } }, /mcp/],
    ['no model provider', { model: { default: 'm' } }, /model provider/],
  ])('refuses %s', (_label, overrides, reason) => {
    expect(sharedBoxRefusal(leaf(overrides as Partial<AgentProfile>))).toMatch(reason)
  })
})

describe('sharedBoxPlacement', () => {
  it('runs each worker as its own opencode process in its own directory and HOME', async () => {
    const { client, boxes } = fakeClient(() => ({ stdout: opencodeRun('ALPHA'), exit: 0 }))
    const placement = sharedBoxPlacement({ client, workersPerBox: 4 })
    const environment = await placement.providerFor().create({ profile: leaf() })
    const events = []
    for await (const event of environment.stream({ prompt: 'what is your code word?' })) {
      events.push(event)
    }
    const box = boxes[0]!
    const run = box.spawns.find((spawn) => spawn.args.includes('run'))!
    const dir = run.options.cwd!
    expect(dir).toMatch(/^\/home\/agent\/workers\/w-/)
    expect(run.executable).toBe('/usr/bin/env')
    expect(run.args).toEqual(
      expect.arrayContaining([
        'OPENCODE_DISABLE_PROJECT_CONFIG=1',
        `PWD=${dir}`,
        `HOME=${dir}/.home`,
        'opencode',
        'run',
        'what is your code word?',
        '--auto',
        '--format',
        'json',
        '-m',
        'tangle-router/deepseek/deepseek-v4.1-flash',
      ]),
    )
    const config = JSON.parse(run.options.env!.OPENCODE_CONFIG_CONTENT!)
    expect(config.instructions).toEqual([`${dir}/.opencode/profile-instructions.md`])
    expect(config.provider['tangle-router'].options.apiKey).toBe('{env:OPENCODE_MODEL_API_KEY}')
    // No node, no client name: the worker's router calls stay charged to the box.
    expect(config.provider['tangle-router'].options.headers).toBeUndefined()
    expect(box.files.get(`${dir}/.opencode/profile-instructions.md`)).toContain('ALPHA')
    expect(box.files.get(`${dir}/inputs/brief.md`)).toBe('# brief\n')
    // The harness's own session record lands where the transcript capture reads.
    expect(box.files.has(`${dir}/.home/.local/share/opencode/export/ses_abc.json`)).toBe(true)
    const types = events.map((event) => event.type)
    expect(types.filter((type) => type === 'message.part.updated')).toHaveLength(5)
    expect(types.filter((type) => type === 'llm_call')).toHaveLength(2)
    expect(types.at(-1)).toBe('done')
    await environment.destroy?.()
    expect(box.execs.some((command) => command.includes(`rm -rf '${dir}'`))).toBe(true)
    expect(box.deleted).toBe(true)
  })

  it('exports each harness subagent session its task parts name, beside the parent session', async () => {
    const task = (callID: string, state: Record<string, unknown>) =>
      `${JSON.stringify({ type: 'tool_use', sessionID: 'ses_abc', part: { type: 'tool', tool: 'task', callID, messageID: 'm1', state } })}\n`
    const subagents = [
      // opencode 1.18 result header, the running part's metadata, and a failure.
      task('t1', {
        status: 'completed',
        input: { description: 'verify' },
        output:
          '<task id="ses_child1" state="completed">\n<task_result>\nok\n</task_result>\n</task>',
      }),
      task('t2', { status: 'running', input: {}, metadata: { sessionId: 'ses_child2' } }),
      task('t2', {
        status: 'completed',
        input: {},
        output: '<task id="ses_child2" state="completed">\n<task_result>x</task_result>\n</task>',
      }),
      task('t3', {
        status: 'error',
        input: {},
        error: 'Subagent failed (task_id: ses_child3): boom',
      }),
      // Not a subagent: another tool, and a task whose id would escape the export path.
      `${JSON.stringify({ type: 'tool_use', sessionID: 'ses_abc', part: { type: 'tool', tool: 'bash', callID: 'b1', messageID: 'm1', state: { status: 'completed', output: '<task id="ses_nope" state="completed">' } } })}\n`,
      task('t4', { status: 'running', input: {}, metadata: { sessionId: '../../etc' } }),
    ]
    const { client, boxes } = fakeClient(() => ({
      stdout: [...opencodeRun('ok'), ...subagents],
      exit: 0,
    }))
    const placement = sharedBoxPlacement({ client })
    const environment = await placement.providerFor().create({ profile: leaf() })
    for await (const _ of environment.stream({ prompt: 'go' })) {
      // drain
    }
    const box = boxes[0]!
    const dir = box.spawns.find((spawn) => spawn.args.includes('run'))!.options.cwd!
    const exported = box.spawns
      .filter((spawn) => spawn.args.includes('export-session'))
      .map((spawn) => spawn.args[spawn.args.indexOf('export-session') + 1])
    expect(exported).toEqual(['ses_abc', 'ses_child1', 'ses_child2', 'ses_child3'])
    for (const id of exported) {
      expect(box.files.has(`${dir}/.home/.local/share/opencode/export/${id}.json`)).toBe(true)
    }
    await placement.close()
  })

  it('names each worker to the router by its node on the key its box shares', async () => {
    const { client, boxes } = fakeClient(() => ({ stdout: opencodeRun('ok'), exit: 0 }))
    const placement = sharedBoxPlacement({ client })
    for (const nodeId of ['node-a', 'node-b']) {
      const environment = await placement.providerFor({ nodeId }).create({ profile: leaf() })
      for await (const _ of environment.stream({ prompt: 'go' })) {
        // drain
      }
    }
    const headers = boxes[0]!.spawns
      .filter((spawn) => spawn.args.includes('run'))
      .map(
        (spawn) =>
          JSON.parse(spawn.options.env!.OPENCODE_CONFIG_CONTENT!).provider['tangle-router'].options
            .headers,
      )
    expect(headers).toEqual([
      { [ROUTER_CLIENT_HEADER]: 'agent-runtime-node/node-a' },
      { [ROUTER_CLIENT_HEADER]: 'agent-runtime-node/node-b' },
    ])
    expect(() => sharedWorkerClientName('node a')).toThrow(/visible ASCII/)
    expect(() => sharedWorkerClientName('')).toThrow(/visible ASCII/)
    await placement.close()
  })

  it('packs workers into as few boxes as the per-box cap allows and deletes an empty box', async () => {
    const { client, boxes } = fakeClient(() => ({ stdout: opencodeRun('ok'), exit: 0 }))
    const placement = sharedBoxPlacement({ client, workersPerBox: 2 })
    const environments = await Promise.all(
      Array.from({ length: 5 }, () => placement.providerFor().create({ profile: leaf() })),
    )
    expect(boxes).toHaveLength(3)
    expect(placement.stats()).toMatchObject({
      boxesCreated: 3,
      workersPlaced: 5,
      workersLive: 5,
      peakWorkersPerBox: 2,
    })
    await environments[0]!.destroy?.()
    expect(boxes[0]!.deleted).toBe(false)
    await environments[1]!.destroy?.()
    expect(boxes[0]!.deleted).toBe(true)
    const receipts = await placement.close()
    expect(receipts.map((receipt) => receipt.deleted)).toEqual([true, true])
    expect(boxes.every((box) => box.deleted)).toBe(true)
  })

  it('reports a failed turn when opencode exits non-zero', async () => {
    const { client } = fakeClient(() => ({ stdout: [], exit: 3 }))
    const placement = sharedBoxPlacement({ client })
    const environment = await placement.providerFor().create({ profile: leaf() })
    const events = []
    for await (const event of environment.stream({ prompt: 'go' })) events.push(event)
    const result = events.find((event) => event.type === 'result')
    expect(result?.data).toMatchObject({ success: false, status: 'failed' })
    expect(String(result?.data.error)).toMatch(/opencode exited 3/)
    await placement.close()
  })

  it('repeats a Sandbox call the platform refused transiently', async () => {
    const { client, boxes } = fakeClient(() => ({ stdout: opencodeRun('ALPHA'), exit: 0 }))
    const placement = sharedBoxPlacement({ client, retryDelayMs: 0 })
    const environment = await placement.providerFor().create({ profile: leaf() })
    const refusal = Object.assign(new Error('Platform key verification unavailable'), {
      status: 502,
      code: 'platform_unavailable',
    })
    boxes[0]!.failNext.write.push(refusal)
    boxes[0]!.failNext.spawn.push(refusal)
    const events = []
    for await (const event of environment.stream({ prompt: 'go' })) events.push(event)
    expect(events.find((event) => event.type === 'result')?.data).toMatchObject({ success: true })
    expect(boxes[0]!.spawns.filter((spawn) => spawn.args.includes('run'))).toHaveLength(1)
    await placement.close()
  })

  it('adopts a launch whose answer was lost instead of starting a second one', async () => {
    const { client, boxes } = fakeClient(() => ({ stdout: opencodeRun('ALPHA'), exit: 0 }))
    const placement = sharedBoxPlacement({ client, retryDelayMs: 0 })
    const environment = await placement.providerFor().create({ profile: leaf() })
    boxes[0]!.failNext.spawnAfterLaunch.push(
      Object.assign(new Error('fetch failed'), { name: 'TypeError' }),
    )
    const events = []
    for await (const event of environment.stream({ prompt: 'go' })) events.push(event)
    expect(boxes[0]!.spawns.filter((spawn) => spawn.args.includes('run'))).toHaveLength(1)
    expect(events.find((event) => event.type === 'result')?.data).toMatchObject({
      success: true,
      finalText: 'ALPHA',
    })
    await placement.close()
  })

  it('does not repeat a failure the platform will not change', async () => {
    const { client, boxes } = fakeClient(() => ({ stdout: opencodeRun('ALPHA'), exit: 0 }))
    const placement = sharedBoxPlacement({ client, retryDelayMs: 0 })
    const environment = await placement.providerFor().create({ profile: leaf() })
    boxes[0]!.failNext.spawn.push(Object.assign(new Error('bad request'), { status: 400 }))
    const drained = (async () => {
      for await (const _ of environment.stream({ prompt: 'go' })) {
        // drain
      }
    })()
    await expect(drained).rejects.toThrow(/bad request/)
    await placement.close()
  })

  it('refuses a worker create that asks for box-level settings', async () => {
    const { client } = fakeClient(() => ({ stdout: [], exit: 0 }))
    const placement = sharedBoxPlacement({ client })
    await expect(
      placement.providerFor().create({ profile: leaf(), env: { SECRET_THING: 'x' } }),
    ).rejects.toThrow(/cannot set env/)
    await expect(
      placement.providerFor().create({ profile: leaf(), resources: { memoryMb: 4096 } }),
    ).rejects.toThrow(/cannot set resources/)
  })
})

describe('createExecutor with a shared placement', () => {
  const dedicatedProvider = (): AgentEnvironmentProvider & { created: number } => {
    const provider = {
      name: 'dedicated',
      created: 0,
      capabilities: () =>
        ({
          profile: { namedProfiles: false, systemPrompt: { replace: false, append: false } },
          streaming: { live: true, replay: false, detach: false, turnIdempotency: false },
          sessions: { continue: false, list: false, messages: false },
          workspace: {
            read: false,
            write: false,
            exec: false,
            git: false,
            upload: false,
            download: false,
          },
          branching: { checkpoint: false, fork: false },
          placement: false,
          usage: true,
          confidential: false,
        }) as unknown as AgentEnvironmentCapabilities,
      async create() {
        provider.created += 1
        return {
          id: `dedicated-${provider.created}`,
          provider: 'dedicated',
          status: async () => 'running' as const,
          async *stream() {
            yield { type: 'result', data: { finalText: 'dedicated', success: true } }
            yield { type: 'done', data: {} }
          },
          async destroy() {},
        } as never
      },
    }
    return provider
  }

  it('runs an accepted leaf in a shared box, meters it, and captures only its own transcript', async () => {
    const { client, boxes } = fakeClient(() => ({ stdout: opencodeRun('ALPHA'), exit: 0 }))
    const placement = sharedBoxPlacement({ client })
    const dedicated = dedicatedProvider()
    const factory = createExecutor({ backend: 'provider', provider: dedicated, shared: placement })
    const controller = new AbortController()
    const node = { rootId: 'root', parentId: 'root', nodeId: 'leaf-3', attemptId: 'leaf-3:1' }
    const executor = factory(
      { profile: leaf(), harness: null },
      { signal: controller.signal, seams: {}, node: node as never },
    )
    for await (const _ of executor.execute(
      'what is your code word?',
      controller.signal,
    ) as AsyncIterable<unknown>) {
      // drain
    }
    const artifact = executor.resultArtifact()
    expect((artifact.out as { content: string }).content).toBe('ALPHA')
    // Two steps: 100 uncached + 50 cached prompt tokens, then 100 uncached.
    expect(artifact.spent.tokens.input).toBe(250)
    expect(artifact.spent.tokens.output).toBe(40)
    expect(artifact.spent.usdKnown).toBe(false)
    expect(dedicated.created).toBe(0)
    const transcript = executor.harnessTranscript?.()
    expect(transcript?.status).toBe('captured')
    if (transcript?.status === 'captured') {
      expect(transcript.artifact.files.map((file) => file.path)).toEqual([
        expect.stringMatching(/\/\.home\/\.local\/share\/opencode\/export\/ses_abc\.json$/),
      ])
    }
    // The supervised node names the worker to the router on the box's key.
    const run = boxes[0]!.spawns.find((spawn) => spawn.args.includes('run'))!
    expect(
      JSON.parse(run.options.env!.OPENCODE_CONFIG_CONTENT!).provider['tangle-router'].options
        .headers,
    ).toEqual({ [ROUTER_CLIENT_HEADER]: 'agent-runtime-node/leaf-3' })
    expect(boxes).toHaveLength(1)
    expect(boxes[0]!.deleted).toBe(true)
  })

  it('keeps a dedicated environment for a profile the shared box refuses', async () => {
    const { client, boxes } = fakeClient(() => ({ stdout: opencodeRun('x'), exit: 0 }))
    const placement = sharedBoxPlacement({ client })
    const dedicated = dedicatedProvider()
    const factory = createExecutor({ backend: 'provider', provider: dedicated, shared: placement })
    const controller = new AbortController()
    const profile = leaf({
      harness: 'claude-code',
      model: { provider: 'anthropic', default: 'claude-sonnet-5' },
    })
    const executor = factory({ profile, harness: null }, { signal: controller.signal, seams: {} })
    for await (const _ of executor.execute('go', controller.signal) as AsyncIterable<unknown>) {
      // drain
    }
    expect((executor.resultArtifact().out as { content: string }).content).toBe('dedicated')
    expect(dedicated.created).toBe(1)
    expect(boxes).toHaveLength(0)
  })

  it('refuses shared placement combined with provider placements', () => {
    const { client } = fakeClient(() => ({ stdout: [], exit: 0 }))
    expect(() =>
      createExecutor({
        backend: 'provider',
        provider: dedicatedProvider(),
        shared: sharedBoxPlacement({ client }),
        placements: [],
      }),
    ).toThrow(/shared placement cannot combine/)
  })
})
