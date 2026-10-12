import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import * as codeModeModule from '../../src/runtime/code-mode'
import { createCodeModeTools, runCodeMode } from '../../src/runtime/code-mode'
import { createExecutor } from '../../src/runtime/supervise/runtime'
import type { AgentSpec } from '../../src/runtime/supervise/types'
import { runBrainLoop } from '../../src/runtime/tool-loop'

const context = (callId = 'program') => ({
  signal: new AbortController().signal,
  callId,
  parentCallId: callId,
})
const readTool = {
  type: 'function' as const,
  function: {
    name: 'read',
    description: 'Read a permitted record.',
    parameters: { type: 'object' },
    outputSchema: { type: 'object', properties: { value: { type: 'number' } } },
  },
}

describe('Runtime code mode over the real QuickJS worker', () => {
  it('batches real file reads and keeps intermediate data outside the model conversation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'runtime-codemode-'))
    try {
      await writeFile(
        join(dir, 'a.json'),
        JSON.stringify({ value: 20, privateIntermediate: 'not a model message' }),
      )
      await writeFile(
        join(dir, 'b.json'),
        JSON.stringify({ value: 22, privateIntermediate: 'not a model message' }),
      )
      let turn = 0
      const calls: string[] = []
      const result = await runBrainLoop({
        codeMode: { concurrency: 1 },
        tools: [readTool],
        initialMessages: [],
        maxTurns: 3,
        execute: async (name, args, ctx) => {
          expect(name).toBe('read')
          if (!['a.json', 'b.json'].includes(String(args.path))) throw new Error('not authorized')
          calls.push(ctx.callId)
          return JSON.parse(await readFile(join(dir, String(args.path)), 'utf8'))
        },
        chat: async (messages, tools) => {
          expect(tools.map((tool) => tool.function.name)).toEqual(['tool_search', 'codemode'])
          if (++turn === 1)
            return {
              content: '',
              toolCalls: [
                {
                  id: 'batch',
                  name: 'codemode',
                  arguments: JSON.stringify({
                    code: `
            const rows = await Promise.all(['a.json','b.json'].map(path => tools.read({path})));
            store('count', rows.length);
            return rows.reduce((sum, row) => sum + row.value, 0);
          `,
                  }),
                },
              ],
            }
          expect(JSON.stringify(messages)).not.toContain('privateIntermediate')
          expect(JSON.parse(String(messages.at(-1)?.content))).toMatchObject({
            ok: true,
            value: 42,
          })
          return { content: '42', toolCalls: [], usage: { input: 3, output: 1 } }
        },
      })
      expect(result.final).toBe('42')
      expect(result.codeModeStore).toEqual({ count: 2 })
      expect(calls).toEqual(['batch/tool/1', 'batch/tool/2'])
      expect(result.toolTrace.filter((call) => call.name === 'read')).toHaveLength(2)
      // The evidence trace retains real calls; only the model's conversation is reduced.
      expect(JSON.stringify(result.toolTrace)).toContain('privateIntermediate')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('preserves dispatch authorization rather than accepting every name in the source', async () => {
    let calls = 0
    const result = await runCodeMode('return await tools.secret({})', {
      callId: 'denied',
      tools: [
        {
          name: 'allowed',
          execute: () => {
            calls++
            return true
          },
        },
      ],
    })
    expect(result.ok).toBe(false)
    expect(calls).toBe(0)
    const refused = await runCodeMode('return await tools.allowed({})', {
      callId: 'policy-denied',
      tools: [
        {
          name: 'allowed',
          execute: () => {
            throw new Error('approval required')
          },
        },
      ],
    })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error.message).toContain('approval required')
  })

  it('preserves host schema validation before a nested external effect', async () => {
    const schema = z.object({ id: z.string().min(1) }).strict()
    let effects = 0
    const result = await runCodeMode('return await tools.write({id: 42})', {
      callId: 'invalid-schema',
      tools: [
        {
          name: 'write',
          inputSchema: z.toJSONSchema(schema),
          execute: (raw) => {
            schema.parse(raw)
            effects++
            return 'written'
          },
        },
      ],
    })
    expect(result.ok).toBe(false)
    expect(effects).toBe(0)
  })

  it('places native images after all tool replies without exposing base64 in tool text', async () => {
    const data =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC'
    let turn = 0
    await runBrainLoop({
      codeMode: true,
      tools: [],
      initialMessages: [],
      maxTurns: 2,
      execute: async () => {
        throw new Error('no granted tools')
      },
      chat: async (messages) => {
        if (++turn === 1)
          return {
            content: '',
            toolCalls: [
              {
                id: 'image',
                name: 'codemode',
                arguments: JSON.stringify({
                  code: `image({type:"image",data:"${data}",mimeType:"image/png"})`,
                }),
              },
              { id: 'search', name: 'tool_search', arguments: '{}' },
            ],
          }
        expect(messages.slice(-3).map((message) => message.role)).toEqual(['tool', 'tool', 'user'])
        expect(String(messages.at(-3)?.content)).not.toContain(data)
        expect(messages.at(-1)?.content).toContainEqual({
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${data}` },
        })
        return { content: 'image seen', toolCalls: [] }
      },
    })
    expect(turn).toBe(2)
  })

  it('uses generated output declarations and refuses nested code-mode toolsets', async () => {
    const native = {
      name: 'read',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'number' },
      execute: () => 42,
    }
    const set = createCodeModeTools([native])
    expect(await set.tools[0]!.execute({}, context())).toContain('Promise<number>')
    expect(() => createCodeModeTools(set.tools)).toThrow(/do not nest/)
    expect(() => createCodeModeTools([native, native])).toThrow(/duplicate/)
  })

  it('refuses normalized-name collisions instead of dispatching the wrong handler', async () => {
    const effects: string[] = []
    const tools = ['send-email', 'send_email'].map((name) => ({
      name,
      execute: () => {
        effects.push(name)
        return name
      },
    }))
    await expect(
      runCodeMode('return await tools["send_email"]({})', {
        callId: 'ambiguous-name',
        tools,
      }),
    ).rejects.toThrow(/ambiguous tool name/)
    expect(effects).toEqual([])
  })

  it('keeps host-selected direct-only lifecycle tools out of programs', async () => {
    let settled = false
    const set = createCodeModeTools(
      [
        {
          name: 'finish',
          execute: () => {
            settled = true
          },
        },
      ],
      { directTools: ['finish'] },
    )
    expect(set.tools.map((tool) => tool.name)).toEqual(['tool_search', 'codemode', 'finish'])
    expect(
      await set.tools[1]!.execute({ code: 'await tools.finish({})' }, context()),
    ).toMatchObject({ ok: false })
    expect(settled).toBe(false)
    await set.tools[2]!.execute({}, context())
    expect(settled).toBe(true)
  })

  it('retains successful small state, restores it explicitly, and does not commit a failed program', async () => {
    const set = createCodeModeTools([])
    const execute = set.tools[1]!.execute
    await execute({ code: 'store("n", 4)' }, context('one'))
    const failed = await execute(
      { code: 'store("n", 99); throw new Error("failed")' },
      context('two'),
    )
    expect(failed).toMatchObject({ ok: false })
    expect(set.snapshotStore()).toEqual({ n: 4 })
    const resumed = createCodeModeTools([], { store: set.snapshotStore() })
    expect(
      await resumed.tools[1]!.execute({ code: 'return load("n") + 1' }, context('three')),
    ).toMatchObject({ ok: true, value: 5 })
  })

  it('never reruns an external effect when code later throws', async () => {
    let effects = 0
    const set = createCodeModeTools([
      {
        name: 'effect',
        execute: () => {
          effects++
          return 'accepted'
        },
      },
    ])
    const result = await set.tools[1]!.execute(
      { code: 'await tools.effect({}); throw new Error("after effect")' },
      context(),
    )
    expect(result).toMatchObject({ ok: false })
    expect(effects).toBe(1)
  })

  it('treats invalid wrapper arguments as errors before any tool effect', async () => {
    const set = createCodeModeTools([])
    await expect(set.tools[1]!.execute(null, context())).rejects.toThrow(/JSON object/)
    await expect(set.tools[1]!.execute({ code: 123 }, context())).rejects.toThrow(/code: string/)
  })

  it('revokes the program when it catches a total-call limit error', async () => {
    let effects = 0
    const result = await runCodeMode(
      `
      for (let i = 0; i < 10; i++) {
        try { await tools.effect({}) } catch {}
      }
      store('bypassed', true);
    `,
      {
        callId: 'caught-limit',
        maxCalls: 2,
        tools: [{ name: 'effect', execute: () => ++effects }],
      },
    )
    expect(result.ok).toBe(false)
    expect(result.calls.length).toBeLessThanOrEqual(3)
    expect(effects).toBe(2)
    expect('storeWrites' in result).toBe(false)
  })

  it('enforces the total call budget', async () => {
    let effects = 0
    const result = await runCodeMode('for (let i=0;i<5;i++) await tools.effect({})', {
      callId: 'bounded',
      maxCalls: 2,
      tools: [{ name: 'effect', execute: () => ++effects }],
    })
    expect(result.ok).toBe(false)
    expect(effects).toBe(2)
  })
})

describe('code mode in the existing public createExecutor(router-tools) path', () => {
  it('runs real isolated programs through profile-authorized handlers and retains their native identity', async () => {
    let turn = 0
    const seen: string[] = []
    const steps: string[] = []
    let stored: unknown
    const factory = createExecutor({
      backend: 'router-tools',
      routerBaseUrl: 'https://router.test/v1',
      routerKey: 'offline',
      tools: [readTool],
      codeMode: { concurrency: 2 },
      executeToolCall: async (name, args, task, ctx) => {
        expect(name).toBe('read')
        expect(task).toBe('sum records')
        seen.push(ctx.callId)
        return { value: Number(args.value), hidden: 'large intermediate' }
      },
      onToolStep: (step) => {
        steps.push(step.toolName)
      },
      onMessages: (_messages, state) => {
        stored = state?.codeModeStore
      },
      complete: async (body) => {
        expect(
          (body.tools as Array<{ function: { name: string } }>).map((tool) => tool.function.name),
        ).toEqual(['tool_search', 'codemode'])
        const message =
          ++turn === 1
            ? {
                content: '',
                tool_calls: [
                  {
                    id: 'native-batch',
                    type: 'function',
                    function: {
                      name: 'codemode',
                      arguments: JSON.stringify({
                        code: `const rows = await Promise.all([20,22].map(value => tools.read({value}))); store('sum', rows.reduce((n,r)=>n+r.value,0)); return load('sum')`,
                      }),
                    },
                  },
                ],
              }
            : { content: '42' }
        if (turn > 1) expect(JSON.stringify(body.messages)).not.toContain('large intermediate')
        return {
          model: 'offline-model',
          choices: [{ message, finish_reason: turn === 1 ? 'tool_calls' : 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 2, cost: 0 },
        }
      },
    })
    const spec = {
      profile: {
        name: 'code-mode-runtime-user',
        harness: 'cli-base',
        model: { provider: 'tangle-router', default: 'offline-model', metadata: { maxTurns: 3 } },
        tools: { read: true },
      },
      harness: null,
    } as AgentSpec
    const signal = new AbortController().signal
    const executor = factory(spec, { signal, seams: {} })
    try {
      const result = await executor.execute('sum records', signal)
      expect(result.out).toMatchObject({
        content: '42',
        codeModeStore: { sum: 42 },
        modelToolNames: ['tool_search', 'codemode'],
      })
      expect(result.spent.iterations).toBe(2)
      expect(result.spent.tokens.input).toBe(10)
      expect(seen).toEqual(['native-batch/tool/1', 'native-batch/tool/2'])
      expect(steps).toEqual(['read', 'read'])
      expect(stored).toEqual({ sum: 42 })
      expect(
        (result.out as { toolCalls: Array<{ id: string }> }).toolCalls.map((call) => call.id),
      ).toEqual(['native-batch', ...seen])
    } finally {
      await executor.teardown(0)
    }
  })

  it('refuses a mismatched profile grant before model execution', () => {
    const factory = createExecutor({
      backend: 'router-tools',
      routerBaseUrl: 'https://router.test/v1',
      routerKey: 'offline',
      tools: [readTool],
      codeMode: true,
      executeToolCall: async () => 0,
    })
    const spec = {
      profile: {
        name: 'no-grant',
        harness: 'cli-base',
        model: { provider: 'tangle-router', default: 'offline-model' },
        tools: { read: false },
      },
      harness: null,
    } as AgentSpec
    expect(() => factory(spec, { signal: new AbortController().signal, seams: {} })).toThrow(
      /not enabled|disables/,
    )
  })
})

describe('runBrainLoop code-mode dispatch robustness', () => {
  const finishTool = {
    type: 'function' as const,
    function: {
      name: 'finish',
      description: 'Finish the task.',
      parameters: { type: 'object' },
    },
  }

  it('feeds invalid codemode arguments back to the model instead of failing the loop', async () => {
    const result = await runBrainLoop({
      codeMode: { concurrency: 1 },
      tools: [finishTool],
      initialMessages: [],
      maxTurns: 3,
      execute: async () => ({}),
      chat: async (_messages, _tools) => {
        if (
          _messages.some(
            (m) =>
              m.role === 'tool' && typeof m.content === 'string' && m.content.includes('error:'),
          )
        )
          return { content: 'recovered', toolCalls: [] }
        return {
          content: '',
          toolCalls: [
            {
              id: 'bad-args',
              name: 'codemode',
              // The model emits non-JSON-object arguments: the wrapper throws synchronously
              // on {code: string}; the loop must answer with an error tool message.
              arguments: JSON.stringify({ code: 123 }),
            },
          ],
        }
      },
    })
    expect(result.final).toBe('recovered')
    const errorReply = result.messages.find(
      (m) => m.role === 'tool' && typeof m.content === 'string' && m.content.startsWith('error:'),
    )
    expect(errorReply).toBeDefined()
    expect(String((errorReply as { content: string }).content)).toMatch(/code: string/)
  })

  it('records a direct tool call exactly once in toolTrace when codeMode presents it', async () => {
    const result = await runBrainLoop({
      codeMode: { concurrency: 1, directTools: ['finish'] },
      tools: [finishTool],
      initialMessages: [],
      maxTurns: 2,
      execute: async () => 'done',
      chat: async (_messages, _tools) =>
        _messages.some((m) => m.role === 'tool')
          ? { content: 'done', toolCalls: [] }
          : {
              content: '',
              toolCalls: [{ id: 'direct', name: 'finish', arguments: '{}' }],
            },
    })
    // Wrapper-executed nested calls record inside the wrapper; a DIRECT model call records
    // once at the outer loop. Two entries for one call double-counted behavior evidence.
    const finishEntries = result.toolTrace.filter((entry) => entry.name === 'finish')
    expect(finishEntries).toHaveLength(1)
  })

  it('stops a running program through the next-turn stopBefore predicate', async () => {
    let stopTurn = Number.POSITIVE_INFINITY
    const observedStops: number[] = []
    const result = await runBrainLoop({
      codeMode: { concurrency: 1 },
      tools: [finishTool],
      initialMessages: [],
      maxTurns: 5,
      hooks: {
        stopBefore: (turn) => {
          observedStops.push(turn)
          return turn >= stopTurn
        },
      },
      execute: async () => 'ok',
      chat: async (_messages, _tools) => {
        if (stopTurn === Number.POSITIVE_INFINITY) {
          stopTurn = 2 // the loop top admitted turn 1; only the NEXT turn can be stopped
          return {
            content: '',
            toolCalls: [
              {
                id: 'prog',
                name: 'codemode',
                arguments: JSON.stringify({
                  code: 'for (let i = 0; i < 50; i++) await tools.finish({}); "ran"',
                }),
              },
            ],
          }
        }
        return { content: 'stopped', toolCalls: [] }
      },
    })
    // The program ran under turn 1; a stop predicate that fires from turn 2 must revoke it
    // mid-program (the wrapper throws), which lands as an error tool reply, not a crash.
    expect(observedStops).toContain(2)
    expect(result.toolTrace.length).toBeLessThan(50)
  })
})

it('feeds an unknown tool name back to the model instead of failing the loop', async () => {
  const result = await runBrainLoop({
    codeMode: { concurrency: 1 },
    tools: [
      {
        type: 'function' as const,
        function: {
          name: 'finish',
          description: 'Finish the task.',
          parameters: { type: 'object' },
        },
      },
    ],
    initialMessages: [],
    maxTurns: 3,
    execute: async () => ({}),
    chat: async (messages, _tools) =>
      messages.some((m) => m.role === 'tool' && String(m.content).startsWith('error:'))
        ? { content: 'recovered', toolCalls: [] }
        : {
            content: '',
            toolCalls: [{ id: 'ghost', name: 'finish_typo', arguments: '{}' }],
          },
  })
  expect(result.final).toBe('recovered')
  expect(
    result.messages.find(
      (m) => m.role === 'tool' && String(m.content).includes('not in the model-visible tool set'),
    ),
  ).toBeDefined()
})

it('records a failed nested call in toolTrace with its error', async () => {
  const result = await runBrainLoop({
    codeMode: { concurrency: 1 },
    tools: [
      {
        type: 'function' as const,
        function: {
          name: 'effect',
          description: 'An effect that can fail.',
          parameters: { type: 'object' },
        },
      },
    ],
    initialMessages: [],
    maxTurns: 2,
    execute: async () => {
      throw new Error('effect failed after side effects')
    },
    chat: async (_messages, _tools) => ({
      content: 'done',
      toolCalls: [
        {
          id: 'prog',
          name: 'codemode',
          arguments: JSON.stringify({
            code: 'try { await tools.effect({}) } catch {} return "recovered"',
          }),
        },
      ],
    }),
  })
  // The program caught the failure, but the ATTEMPT stays in the trace — the handler
  // may have performed an external effect before throwing.
  const entry = result.toolTrace.find((item) => item.name === 'effect')
  expect(entry).toBeDefined()
  expect(String(entry?.result)).toMatch(/error: effect failed/)
})

it('a forceful interrupt revokes a running codemode program and its nested effects', async () => {
  let turn = 0
  let effects = 0
  const factory = createExecutor({
    backend: 'router-tools',
    routerBaseUrl: 'https://router.test/v1',
    routerKey: 'offline',
    tools: [
      {
        type: 'function' as const,
        function: {
          name: 'effect',
          description: 'An effect.',
          parameters: { type: 'object' },
        },
      },
    ],
    codeMode: { concurrency: 1 },
    executeToolCall: async () => {
      effects += 1
      await new Promise((resolve) => setTimeout(resolve, 15))
      return { ok: true }
    },
    complete: async (body) => {
      turn += 1
      if (turn === 1) {
        // Long-running program: without the per-turn interrupt signal linked into the
        // dispatch, this keeps calling effects to completion despite the forceful steer.
        return {
          model: 'offline-model',
          choices: [
            {
              message: {
                content: '',
                tool_calls: [
                  {
                    id: 'long-program',
                    type: 'function',
                    function: {
                      name: 'codemode',
                      arguments: JSON.stringify({
                        code: 'for (let i = 0; i < 200; i++) { try { await tools.effect({}) } catch {} } return "ran"',
                      }),
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 2, cost: 0 },
        }
      }
      return {
        model: 'offline-model',
        choices: [{ message: { content: 're-planned' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2, cost: 0 },
      }
    },
  })
  const spec = {
    profile: {
      name: 'code-mode-interrupt',
      harness: 'cli-base',
      model: { provider: 'tangle-router', default: 'offline-model', metadata: { maxTurns: 5 } },
      tools: { effect: true },
    },
    harness: null,
  } as AgentSpec
  const signal = new AbortController().signal
  const executor = factory(spec, { signal, seams: {} })
  try {
    const run = executor.execute('long task', signal)
    // Wait until the program is actually running effects, then force a re-plan.
    await vi.waitFor(() => expect(effects).toBeGreaterThan(0), { timeout: 5_000 })
    executor.deliver?.({ steer: 'stop everything', interrupt: true })
    const result = await run
    expect(result.out).toMatchObject({ content: 're-planned' })
    // The aborted program's nested effects stopped early: 200 sequential calls at
    // ~15ms each would run for seconds; an unrevoked program cannot finish under the
    // interrupt. Assert a hard ceiling well below the full program.
    expect(effects).toBeLessThan(150)
  } finally {
    await executor.teardown(0)
  }
})
describe('profile-declared code mode (the graph-node path)', () => {
  it("a node's profile metadata.codeMode presents code mode with no seam opt-in", async () => {
    // A graph node is its pinned AgentProfile; declaring code mode on the profile is
    // how ONE node in a graph becomes a code node while its siblings stay chat nodes.
    let turn = 0
    const seen: string[] = []
    const factory = createExecutor({
      backend: 'router-tools',
      routerBaseUrl: 'https://router.test/v1',
      routerKey: 'offline',
      tools: [readTool],
      // NOTE: no codeMode here — the profile below is the ONLY declaration.
      executeToolCall: async (name, args) => {
        seen.push(String(args.value))
        return { value: Number(args.value) }
      },
      complete: async (body) => {
        turn += 1
        if (turn === 1) {
          expect(
            (body.tools as Array<{ function: { name: string } }>).map((t) => t.function.name),
          ).toEqual(['tool_search', 'codemode'])
          return {
            model: 'offline-model',
            choices: [
              {
                message: {
                  content: '',
                  tool_calls: [
                    {
                      id: 'profile-node',
                      type: 'function',
                      function: {
                        name: 'codemode',
                        arguments: JSON.stringify({
                          code: 'const rows = await Promise.all([7,8].map(v => tools.read({value:v}))); return rows.reduce((n,r)=>n+r.value,0)',
                        }),
                      },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
            usage: { prompt_tokens: 5, completion_tokens: 2, cost: 0 },
          }
        }
        return {
          model: 'offline-model',
          choices: [{ message: { content: '15' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 2, cost: 0 },
        }
      },
    })
    const spec = {
      profile: {
        name: 'graph-code-node',
        harness: 'cli-base',
        model: {
          provider: 'tangle-router',
          default: 'offline-model',
          metadata: { maxTurns: 3, codeMode: { concurrency: 2 } },
        },
        tools: { read: true },
      },
      harness: null,
    } as AgentSpec
    const signal = new AbortController().signal
    const executor = factory(spec, { signal, seams: {} })
    try {
      const result = await executor.execute('sum two records', signal)
      expect(result.out).toMatchObject({
        content: '15',
        codeModeStore: {}, // store committed empty (no writes) but PRESENT = code mode ran
      })
      expect(seen).toEqual(['7', '8'])
      expect(result.spent.iterations).toBe(2) // author + settle — not one turn per read
    } finally {
      await executor.teardown(0)
    }
  })

  it('rejects a malformed profile code-mode declaration before any request', async () => {
    const factory = createExecutor({
      backend: 'router-tools',
      routerBaseUrl: 'https://router.test/v1',
      routerKey: 'offline',
      tools: [readTool],
      executeToolCall: async () => ({}),
      complete: async () => {
        throw new Error('must not be called')
      },
    })
    const spec = {
      profile: {
        name: 'bad-code-node',
        harness: 'cli-base',
        model: {
          provider: 'tangle-router',
          default: 'offline-model',
          metadata: { codeMode: { wasm: '/evil.wasm' } },
        },
        tools: { read: true },
      },
      harness: null,
    } as AgentSpec
    expect(() => factory(spec, { signal: new AbortController().signal, seams: {} })).toThrow(
      /codeMode/,
    )
  })
})

describe('profile code mode composes host execution policy', () => {
  const finish = {
    type: 'function' as const,
    function: { name: 'finish', parameters: { type: 'object' } },
  }
  async function executeNode(
    declared: unknown,
    hosted: Parameters<typeof createCodeModeTools>[1] | true,
    code?: string,
    expectedTools?: string[],
  ) {
    const calls: string[] = []
    let persisted: unknown
    let turn = 0
    const factory = createExecutor({
      backend: 'router-tools',
      routerBaseUrl: 'https://router.test/v1',
      routerKey: 'offline',
      tools: [readTool, finish],
      codeMode: hosted,
      executeToolCall: async (name) => {
        calls.push(name)
        return 1
      },
      onMessages: (_messages, state) => {
        persisted = state
      },
      complete: async (body) => {
        const names = (body.tools as Array<{ function: { name: string } }>).map(
          (tool) => tool.function.name,
        )
        expect(names).toEqual(
          expectedTools ??
            (declared === false ? ['read', 'finish'] : ['tool_search', 'codemode', 'finish']),
        )
        return {
          model: 'offline-model',
          choices: [
            {
              message:
                ++turn === 1 && code
                  ? {
                      content: '',
                      tool_calls: [
                        {
                          id: 'compose',
                          type: 'function',
                          function: {
                            name: declared === false ? 'read' : 'codemode',
                            arguments: declared === false ? '{}' : JSON.stringify({ code }),
                          },
                        },
                      ],
                    }
                  : { content: 'done' },
              finish_reason: turn === 1 && code ? 'tool_calls' : 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0 },
        }
      },
    })
    const spec = {
      profile: {
        name: 'composed-code-node',
        harness: 'cli-base',
        model: {
          provider: 'tangle-router',
          default: 'offline-model',
          metadata: { maxTurns: 3, codeMode: declared },
        },
        tools: { read: true, finish: true },
      },
      harness: null,
    } as AgentSpec
    const signal = new AbortController().signal
    const executor = factory(spec, { signal, seams: {} })
    try {
      return { result: await executor.execute('continue', signal), calls, persisted }
    } finally {
      await executor.teardown(0)
    }
  }

  it.each([true, {}, { concurrency: 2 }])(
    'retains host store and direct-only tools with profile %j',
    async (declared) => {
      const host = { store: { previous: 41 }, directTools: ['finish'], maxCalls: 1 }
      const { result, persisted, calls } = await executeNode(
        declared,
        host,
        'store("answer", load("previous") + await tools.read({})); return load("previous")',
      )
      expect(result.out).toMatchObject({ codeModeStore: { previous: 41, answer: 42 } })
      expect(persisted).toEqual({ codeModeStore: { previous: 41, answer: 42 } })
      expect(calls).toEqual(['read'])
      expect(host.store).toEqual({ previous: 41 })
    },
  )

  it('keeps a host direct-only tool outside programs after profile opt-in', async () => {
    const { result, calls } = await executeNode(
      true,
      { directTools: ['finish'] },
      'return await tools.finish({})',
    )
    expect(calls).toEqual([])
    expect(JSON.stringify(result.out)).toContain('tools.finish does not exist')
  })

  it('adds profile direct-only tools without removing host restrictions', async () => {
    const { calls } = await executeNode(
      { directTools: ['read'] },
      { directTools: ['finish'] },
      undefined,
      ['tool_search', 'codemode', 'read', 'finish'],
    )
    expect(calls).toEqual([])
  })

  it.each(['timeoutMs', 'memoryLimitBytes', 'concurrency', 'maxCalls'])(
    'refuses invalid host %s before any model request',
    async (key) => {
      await expect(
        executeNode({ [key]: 1 }, { [key]: NaN, directTools: ['finish'] }),
      ).rejects.toThrow(`codeMode.${key}`)
    },
  )

  it.each([
    [{ maxCalls: 20 }, { maxCalls: 1 }],
    [{ maxCalls: 1 }, { maxCalls: 20 }],
  ])('enforces the tighter call ceiling from either owner', async (declared, hosted) => {
    const { calls, result } = await executeNode(
      declared,
      { ...hosted, directTools: ['finish'] },
      'await tools.read({}); await tools.read({}); store("shouldNotCommit", true)',
    )
    expect(calls).toEqual(['read'])
    expect(result.out).toMatchObject({ codeModeStore: {} })
    expect(JSON.stringify(result.out)).toContain('call limit 1 exceeded')
  })

  it('composes each ceiling independently and unions direct-only capabilities', async () => {
    const spy = vi.spyOn(codeModeModule, 'createCodeModeTools')
    try {
      await executeNode(
        {
          timeoutMs: 50,
          memoryLimitBytes: 1000000,
          concurrency: 1,
          maxCalls: 100,
          directTools: ['finish'],
        },
        {
          timeoutMs: 100,
          memoryLimitBytes: 500000,
          concurrency: 4,
          maxCalls: 10,
          store: { n: 1 },
          directTools: ['finish'],
        },
      )
      expect(spy).toHaveBeenCalledWith(expect.anything(), {
        timeoutMs: 50,
        memoryLimitBytes: 500000,
        concurrency: 1,
        maxCalls: 10,
        store: { n: 1 },
        directTools: ['finish'],
      })
    } finally {
      spy.mockRestore()
    }
  })

  it('allows a profile to opt out without erasing host state', async () => {
    const host = { store: { previous: 41 }, directTools: ['finish'], maxCalls: 1 }
    const { result, persisted, calls } = await executeNode(false, host, 'direct')
    expect(result.out).not.toHaveProperty('codeModeStore')
    expect(calls).toEqual(['read'])
    expect(result.spent.iterations).toBe(2)
    expect(result.spent.tokens).toMatchObject({ input: 2, output: 2 })
    expect(persisted).toBeUndefined()
    expect(host.store).toEqual({ previous: 41 })
  })
})
