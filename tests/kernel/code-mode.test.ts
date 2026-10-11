import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
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
