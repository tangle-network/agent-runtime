/**
 * Code mode over the coordination verbs — the Cloudflare/Anthropic pattern, held to its own
 * definition: an API GENERATED from the live grant, exactly TWO tools (`search`, `execute`), a
 * sandbox whose only capability is the bindings, and every call the code makes crossing the same
 * kernel path the MCP verb crosses. The last test is the point: one `execute` call orchestrates
 * two worker spawns, and the JOURNAL — not the program — is what proves they ran.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import {
  codeModeSupervisorTools,
  renderCodeModeApi,
  renderJsonSchemaType,
  unsafeInProcessRunner,
} from '../../src/runtime/supervise/code-mode'
import { superviseWithTestBrain } from '../../src/runtime/supervise/supervise'
import type {
  Agent,
  AgentSpec,
  Executor,
  ExecutorResult,
  Spend,
} from '../../src/runtime/supervise/types'
import { scriptedBrain } from './scripted-brain'
import { testAgentProfile } from './test-agent-profile'

const SPEND: Spend = { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 0 }

/** An offline leaf: settles with `{ built: <name> }`, valid, through the kernel's own path. */
function leafSeam(profileRaw: unknown): Agent<unknown, unknown> {
  const profile = profileRaw as AgentProfile
  const name = profile.name ?? 'worker'
  let artifact: ExecutorResult<unknown> | undefined
  const executor: Executor<unknown> = {
    runtime: 'inline',
    async execute() {
      artifact = {
        outRef: `w:${name}`,
        out: { built: name },
        verdict: { valid: true, score: 1 },
        spent: SPEND,
      }
      return artifact
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: () => {
      if (!artifact) throw new Error('leaf: resultArtifact before drain')
      return artifact
    },
  }
  return {
    name,
    act: async () => '',
    executorSpec: { profile, harness: null, executor } as AgentSpec,
  } as Agent<unknown, unknown> & { executorSpec: AgentSpec }
}

describe('codeModeSupervisorTools requires an explicit runner — no silent in-process default', () => {
  it('throws without a runner, naming the trusted and jailed choices', () => {
    // The runtime ships no isolate, so the boundary is the caller's deliberate choice.
    expect(() => codeModeSupervisorTools(undefined as never)).toThrow(
      /a CodeModeRunner is required/,
    )
  })
})

describe('the generated API — rendered from schemas, never prose', () => {
  it('renders a JSON Schema as TypeScript, structurally', () => {
    expect(
      renderJsonSchemaType({
        type: 'object',
        properties: {
          task: { type: 'string', description: 'What to do.' },
          continuity: { type: 'string', enum: ['fresh', 'resume'] },
          budget: { type: 'object', properties: { maxTokens: { type: 'integer' } } },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['task'],
      }),
    ).toBe(
      `{
  /** What to do. */ task: string
  continuity?: "fresh" | "resume"
  budget?: {
    maxTokens?: number
  }
  tags?: Array<string>
}`,
    )
    expect(renderJsonSchemaType(undefined)).toBe('unknown')
    expect(renderJsonSchemaType({ anyOf: [{ type: 'string' }, { type: 'null' }] })).toBe(
      'string | null',
    )
  })

  it('renders declare-function blocks and filters by query; lifecycle verbs are named as excluded', () => {
    const faces = [
      { name: 'spawn_worker', description: 'Start a worker.', inputSchema: { type: 'object' } },
      { name: 'await_event', description: 'Wait for the next event.' },
    ]
    const all = renderCodeModeApi(faces)
    expect(all).toContain('declare function spawn_worker(')
    expect(all).toContain('declare function await_event(')
    expect(all).toContain('NOT callable from code: submit_result, stop, ask_parent')
    const filtered = renderCodeModeApi(faces, 'spawn')
    expect(filtered).toContain('spawn_worker')
    expect(filtered).not.toContain('declare function await_event')
  })
})

describe('the sandbox — bindings are the only capability', () => {
  const run = (code: string, bindings = {}, signal = new AbortController().signal) =>
    unsafeInProcessRunner().run({ code, bindings, signal })

  it('runs a program against the bindings and captures logs beside the result', async () => {
    const calls: unknown[] = []
    const { result, logs } = await run(
      `const a = await api.double(2)
       console.log('doubled to', a)
       return a + (await api.double(a))`,
      {
        double: async (args: unknown) => {
          calls.push(args)
          return (args as number) * 2
        },
      },
    )
    expect(result).toBe(12)
    expect(logs).toEqual(['doubled to 4'])
    expect(calls).toEqual([2, 4])
  })

  it('an unknown api member fails with guidance; a lifecycle verb fails with the WHY', async () => {
    await expect(run('return api.frobnicate({})')).rejects.toThrow(
      /not in the granted API — call search/,
    )
    await expect(run('return api.submit_result({})')).rejects.toThrow(/second brain|lifecycle verb/)
  })

  it('the context has no require, no process, and code generation is disabled inside it', async () => {
    // `process`/`fetch` are refused by the lint before the vm; the vm itself has no `require`,
    // and eval-in-the-sandbox is off at the context level (codeGeneration: strings: false).
    await expect(run('return require("node:fs")')).rejects.toThrow()
    await expect(run('return eval("1+1")')).rejects.toThrow()
  })

  it('an aborted signal ends a program that would otherwise never resolve', async () => {
    const controller = new AbortController()
    controller.abort(new Error('scope cancelled'))
    await expect(run('await new Promise(() => {})', {}, controller.signal)).rejects.toThrow(
      /scope cancelled/,
    )
  })

  it('HONESTLY not a boundary: the in-process runner does NOT contain host-reaching code', async () => {
    // Documented escape, asserted so nobody is surprised: node:vm shares the host realm, so a
    // host binding's `.constructor` is the host Function. This is WHY the runner is named unsafe
    // and why untrusted models need a jailed runner. api.constructor itself is closed (own-only
    // null-proto target), but api.<binding>.constructor is not — and cannot be, inside vm.
    const reached = await run("return typeof api.noop.constructor.constructor === 'function'", {
      noop: async () => null,
    })
    expect(reached.result).toBe(true)
  })
})

describe('the execute deadline gates api calls — no work outlives the call (surgical)', () => {
  /** A minimal invocation context: a call-counting `verbs`, a live signal, a coordinationTools
   *  face. Enough to drive the execute handler without a full supervise run. */
  function fakeContext(signal: AbortSignal, onSpawn: () => void) {
    const noop = async () => ({ ok: true })
    return {
      runId: 'r',
      runNamespace: 'r',
      nodeId: 'n',
      ownerId: 'n',
      depth: 0,
      identity: {},
      profile: { name: 'm' },
      task: 't',
      signal,
      verbs: {
        spawnAgent: async () => {
          onSpawn()
          // A real macrotask yield: a pure-microtask loop would starve the deadline timer, which
          // is the honest limit of in-process execution (see unsafeInProcessRunner's doc).
          await new Promise((resolve) => setTimeout(resolve, 1))
          return { workerId: 'w' }
        },
        awaitEvent: noop,
        steerAgent: noop,
        observeAgent: noop,
        listQuestions: noop,
        answerQuestion: noop,
        runAnalyst: noop,
      },
      coordinationTools: () => [{ name: 'spawn_worker', inputSchema: { type: 'object' } }],
    } as unknown as Parameters<
      Extract<
        ReturnType<ReturnType<typeof codeModeSupervisorTools>>[number],
        { name: 'execute' }
      >['handler']
    >[1]
  }

  it('a program that spawns in a loop is halted by the deadline; the count is bounded and it rejects', async () => {
    const tools = codeModeSupervisorTools(unsafeInProcessRunner(), { timeoutMs: 30 })([] as never)
    const execute = tools.find((tool) => tool.name === 'execute')
    if (!execute) throw new Error('no execute tool')
    let spawns = 0
    const controller = new AbortController()
    // Each iteration awaits a real 5ms tick, so ~30ms admits a handful, then the gate refuses.
    const program = `
      for (;;) {
        await api.spawn_worker({ profile: { name: 'w' }, task: 't' })
      }
    `
    await expect(
      execute.handler(
        { code: program },
        fakeContext(controller.signal, () => {
          spawns += 1
        }),
      ),
    ).rejects.toThrow(/deadline passed|timed out/)
    // Bounded: the loop cannot spawn forever. Exact count is timing-dependent; the invariant is
    // that it STOPPED, not how many it managed before 30ms.
    expect(spawns).toBeGreaterThan(0)
    expect(spawns).toBeLessThan(5_000)
  })

  it('once aborted, the manager scope signal refuses further api calls immediately', async () => {
    const tools = codeModeSupervisorTools(unsafeInProcessRunner())([] as never)
    const execute = tools.find((tool) => tool.name === 'execute')
    if (!execute) throw new Error('no execute tool')
    let spawns = 0
    const controller = new AbortController()
    controller.abort(new Error('scope cancelled'))
    await expect(
      execute.handler(
        { code: 'return await api.spawn_worker({ profile: { name: 42 }, task: 42 })' },
        fakeContext(controller.signal, () => {
          spawns += 1
        }),
      ),
    ).rejects.toThrow(/deadline passed|scope cancelled/)
    expect(spawns).toBe(0)
  })
})

describe('code mode over a REAL supervise() — the dynamic workflow, kernel-metered', () => {
  it('ONE execute call spawns two workers, awaits both, and the JOURNAL proves the kernel path', async () => {
    const journal = new InMemorySpawnJournal()
    const program = `
      const spawned = []
      for (const name of ['builder-a', 'builder-b']) {
        spawned.push(await api.spawn_worker({ profile: { name }, task: 'build ' + name }))
      }
      const settled = []
      while (settled.length < 2) {
        const event = await api.await_event({})
        if (event && event.type === 'settled') settled.push(event)
      }
      console.log('both settled')
      return { workers: spawned.length, outputs: settled.map((event) => event.status) }
    `
    const res = await superviseWithTestBrain(
      testAgentProfile('root', { harness: 'cli-base' }),
      'coordinate the build',
      {
        budget: { maxIterations: 30, maxTokens: 100_000 },
        journal,
        runId: 'code-mode-run',
        makeWorkerAgent: leafSeam,
        resolveSupervisorTools: codeModeSupervisorTools(unsafeInProcessRunner()),
        brain: scriptedBrain([
          { toolCalls: [{ name: 'search', arguments: {} }] },
          { toolCalls: [{ name: 'execute', arguments: { code: program } }] },
          { content: 'done' },
        ]),
      },
    )
    expect(res.kind).toBe('winner')

    // THE claim: the program's spawns crossed the kernel — two spawned + two settled child
    // records in the journal, reserved from the conserved pool, exactly as MCP-verb spawns would.
    const events = (await journal.loadTree('code-mode-run')) ?? []
    const spawnedChildren = events.filter(
      (event) => event.kind === 'spawned' && event.id !== 'code-mode-run',
    )
    const settledChildren = events.filter(
      (event) => event.kind === 'settled' && event.id !== 'code-mode-run',
    )
    expect(spawnedChildren.length).toBeGreaterThanOrEqual(2)
    expect(settledChildren.length).toBeGreaterThanOrEqual(2)
  })

  it('search answers the LIVE grant: the rendered API is the spawn_worker the verbs actually serve', async () => {
    let rendered = ''
    const res = await superviseWithTestBrain(
      testAgentProfile('root', { harness: 'cli-base' }),
      'look around',
      {
        budget: { maxIterations: 10, maxTokens: 50_000 },
        journal: new InMemorySpawnJournal(),
        makeWorkerAgent: leafSeam,
        resolveSupervisorTools: () => {
          const [search] = codeModeSupervisorTools(unsafeInProcessRunner())(
            undefined as never,
          ) as never[]
          const wrapped = search as {
            handler: (raw: unknown, context: unknown) => Promise<unknown>
          }
          return [
            {
              ...(search as object),
              handler: async (raw: unknown, context: unknown) => {
                const out = await wrapped.handler(raw, context)
                rendered = String(out)
                return out
              },
            },
          ] as never
        },
        brain: scriptedBrain([
          { toolCalls: [{ name: 'search', arguments: { query: 'spawn' } }] },
          { content: 'done' },
        ]),
      },
    )
    expect(res.kind).not.toBe('error')
    expect(rendered).toContain('declare function spawn_worker(')
    // Generated from the live descriptor's schema — a field only the real schema carries.
    expect(rendered).toContain('continuity')
  })
})
