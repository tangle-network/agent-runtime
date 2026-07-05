/**
 * Grade an AI's answers, then let it retry until they're right.
 *
 * The "task" is three word problems; the "check" is one function that scores the final
 * number by exact match. `createVerifierEnvironment` turns that single check into a full
 * benchmark, and the toolkit compares ways of spending the compute budget: sample (N blind
 * attempts, keep the best), refine (a critic reads the failure and steers the retry), and
 * sampleThenRefine (both). Swap the `check` and this same file grades a tax return value,
 * a rubric score, anything answer-shaped.
 *
 * Run from bench/ (needs a router key; default model deepseek-v4-flash):
 *   TANGLE_API_KEY=... WORKER_MODEL=gpt-4o-mini BUDGET=3 tsx src/examples/math-demo.mts
 */
import {
  type AgenticTask,
  createVerifierEnvironment,
  printBenchmarkReport,
  refine,
  runBenchmark,
  sample,
  sampleThenRefine,
} from '@tangle-network/agent-runtime/loops'

// GSM8K-style problems; meta.answer is the ground truth the deployable check compares to.
const problems: Array<{ q: string; answer: number }> = [
  {
    q: 'A bakery sells loaves for $4 each. On Monday it sold 23 loaves, on Tuesday twice as many as Monday, and on Wednesday 11 fewer than Tuesday. How many dollars did the bakery earn across the three days?',
    answer: (23 + 46 + 35) * 4, // 416
  },
  {
    q: 'Tickets cost $12 for adults and $7 for children. A group of 9 people paid $83. How many children were in the group?',
    answer: 5,
  },
  {
    q: 'A tank holds 2400 liters. Pump A fills 40 L/min and pump B drains 25 L/min. Both run together starting from an empty tank. After how many minutes is the tank exactly half full?',
    answer: 80,
  },
]

const tasks: AgenticTask[] = problems.map((p, i) => ({
  id: `math-${i + 1}`,
  systemPrompt:
    'You are a careful mathematician. Work step by step, use the calculator tool for arithmetic, then submit ONLY the final number with submit_answer.',
  userPrompt: p.q,
  meta: { answer: p.answer },
}))

/** Last number in the submission — tolerant of "The answer is 416." */
function extractNumber(answer: string): number | null {
  const m = answer.replace(/,/g, '').match(/-?\d+(?:\.\d+)?(?!.*-?\d)/s)
  return m ? Number(m[0]) : null
}

const mathEnv = createVerifierEnvironment({
  name: 'math',
  check: (task, answer) => {
    const got = extractNumber(answer)
    const want = (task.meta as { answer: number }).answer
    return { passes: got !== null && Math.abs(got - want) < 1e-6 ? 1 : 0, total: 1, errored: 0 }
  },
  extraTools: [
    {
      type: 'function',
      function: {
        name: 'calculator',
        description: 'Evaluate an arithmetic expression (numbers and + - * / ( ) only).',
        parameters: {
          type: 'object',
          properties: { expression: { type: 'string' } },
          required: ['expression'],
        },
      },
    },
  ],
  callExtra: (_task, name, args) => {
    if (name !== 'calculator') return `ERROR: unknown tool ${name}`
    const expr = String(args.expression ?? '')
    if (!/^[\d\s+\-*/().]+$/.test(expr)) return 'ERROR: arithmetic only'
    try {
      // The whitelist above admits only arithmetic — no identifiers can reach Function.
      const value = new Function(`return (${expr})`)() as number
      return Number.isFinite(value) ? String(value) : 'ERROR: not finite'
    } catch (e) {
      return `ERROR: ${e instanceof Error ? e.message : String(e)}`
    }
  },
})

async function main(): Promise<void> {
  const routerKey = process.env.TANGLE_API_KEY
  if (!routerKey) throw new Error('set TANGLE_API_KEY')
  const report = await runBenchmark({
    environment: mathEnv,
    tasks,
    worker: {
      routerBaseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1',
      routerKey,
      model: process.env.WORKER_MODEL ?? 'deepseek-v4-flash',
      innerTurns: 6,
      temperature: 0.6,
    },
    strategies: [sample, refine, sampleThenRefine],
    budget: Number(process.env.BUDGET ?? 3),
    concurrency: 3,
  })
  printBenchmarkReport(report)
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
