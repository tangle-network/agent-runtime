/**
 * codemode — the same job done twice: as JSON tool calls, and as CODE.
 *
 * A tool-calling agent acts one call per turn. To total the value of in-stock SKUs it must ask for
 * a stock level, get an answer, ask for a price, get an answer, and repeat — one model round trip
 * per step, every intermediate value passing back through the context window. A `codemode` node
 * asks the model ONCE for a program written against the operations this node grants, then runs it:
 * the loop and the branch happen inside the program, and only the answer comes back.
 *
 * This example runs both arms over the SAME operations table and prints the difference. The
 * "model" is scripted, so the run is offline, deterministic and free — what it demonstrates is the
 * shape of the two action spaces, not a model's cleverness.
 *
 * WHAT MAKES THIS SAFE TO OFFER, and why it is not a prompt:
 *   - the API the model is shown is GENERATED from the operations granted, so a documented call
 *     that was never granted cannot exist
 *   - the node declares a `codeRunner` EFFECT and runs nothing itself: the host decides whether
 *     that is an in-process function or a jail, and the engine refuses before spending if no
 *     runner was supplied
 *   - each operation reports its own spend, and the node totals it into the settlement the kernel
 *     journals — so code mode cannot spend outside the budget the way loose tool code would
 *
 * `inlineCodeRunner` is a LINT plus a function call, not a sandbox. It is for code you wrote or
 * trust. Give a jailed runner for anything else.
 *
 * Run:  pnpm tsx examples/engine/codemode.ts
 */

import { InMemoryResultBlobStore } from '../../src/durable/spawn-journal'
import {
  agentKind,
  type CodeAuthor,
  type CodeOperation,
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

const CATALOG: Record<string, { price: number; stock: number }> = {
  'sku-a': { price: 3, stock: 2 },
  'sku-b': { price: 5, stock: 0 },
  'sku-c': { price: 7, stock: 4 },
  'sku-d': { price: 11, stock: 1 },
}

/** The grant: two operations, and a counter so both arms can be compared by calls made. */
function inventoryOperations(log: string[]): CodeOperation[] {
  return [
    {
      name: 'stockOf',
      signature: 'stockOf(sku: string): Promise<number>',
      description: 'units on hand for a sku',
      call: async (...args) => {
        log.push(`stockOf(${String(args[0])})`)
        return { value: CATALOG[String(args[0])]?.stock ?? 0 }
      },
    },
    {
      name: 'priceOf',
      signature: 'priceOf(sku: string): Promise<number>',
      description: 'unit price for a sku',
      call: async (...args) => {
        log.push(`priceOf(${String(args[0])})`)
        return { value: CATALOG[String(args[0])]?.price ?? 0 }
      },
    },
  ]
}

/** What a competent model writes when shown that API and asked for the total. */
const AUTHORED_PROGRAM = `
  const skus = ['sku-a', 'sku-b', 'sku-c', 'sku-d']
  let total = 0
  for (const sku of skus) {
    const stock = await stockOf(sku)
    if (stock === 0) continue          // the branch never reaches the model
    total += stock * (await priceOf(sku))
  }
  return { total }
`

/** A scripted author: one reply, no credentials. Reports what the turn cost. */
function scriptedAuthor(text: string): CodeAuthor {
  return {
    complete: async () => ({
      text,
      spend: { iterations: 1, tokens: { input: 420, output: 96 }, usd: 0, ms: 0 },
    }),
  }
}

export function codemodeEngine(operations: CodeOperation[]) {
  return createGraphEngine({
    coreKinds: [
      agentKind({}),
      supervisorKind({
        blobs: new InMemoryResultBlobStore(),
        makeWorkerAgent: () => ({ name: 'unused-offline', act: async () => null }),
      }),
      scriptKind(),
      subgraphKind(),
    ],
    kinds: [codemodeKind()],
    effects: {
      model: scriptedAuthor(`\`\`\`js\n${AUTHORED_PROGRAM}\n\`\`\``),
      // Swap this for a jailed runner and NOTHING else about the graph changes.
      codeRunner: inlineCodeRunner(),
      _operations: operations,
    },
  })
}

export function codemodeGraph(operations: CodeOperation[]): EngineGraphSpec {
  return {
    nodes: [
      {
        id: 'value-inventory',
        kind: 'codemode/v1',
        config: { task: 'Total the value of every sku that is in stock.', operations },
        deliverable: {
          check: (out: unknown) => typeof (out as { total?: number }).total === 'number',
          describe: 'a numeric inventory total',
        },
      },
    ],
    edges: [],
  }
}

/** The tool-calling arm, simulated honestly: one model round trip per operation call. */
async function toolCallingArm(): Promise<{ turns: number; calls: string[]; total: number }> {
  const log: string[] = []
  const [stockOf, priceOf] = inventoryOperations(log)
  let turns = 0
  let total = 0
  for (const sku of Object.keys(CATALOG)) {
    turns += 1 // the model asks for stock
    const stock = (await stockOf?.call(sku))?.value as number
    if (stock === 0) continue
    turns += 1 // ...sees the answer, then asks for price
    total += stock * ((await priceOf?.call(sku))?.value as number)
  }
  turns += 1 // ...and one more turn to state the total
  return { turns, calls: log, total }
}

export async function main(): Promise<void> {
  const codeLog: string[] = []
  const operations = inventoryOperations(codeLog)

  console.log('\nThe API the model is shown (generated from the grant, not written by hand):')
  console.log(
    renderCodeApi({ task: 'Total the value of every sku that is in stock.', operations })
      .split('\n')
      .map((line) => `  │ ${line}`)
      .join('\n'),
  )

  const result = await runEngineGraph(codemodeEngine(operations), codemodeGraph(operations), 'go', {
    budget: { maxIterations: 40, maxTokens: 100_000 },
    perNode: { maxIterations: 6, maxTokens: 20_000 },
  })
  const tools = await toolCallingArm()

  console.log('\n  code mode : 1 model turn ')
  console.log(`              ${codeLog.length} operation calls: ${codeLog.join(' ')}`)
  console.log(`              → ${JSON.stringify(result.kind === 'winner' ? result.out : result)}`)
  console.log(`\n  tool calls: ${tools.turns} model turns`)
  console.log(`              ${tools.calls.length} operation calls: ${tools.calls.join(' ')}`)
  console.log(`              → ${JSON.stringify({ total: tools.total })}`)
  console.log(
    `\n  same answer, same operations, ${tools.turns}× the model round trips.\n  The skipped sku-b costs a turn in the tool-calling arm and a \`continue\` in the program.\n`,
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
