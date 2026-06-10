/**
 * The gym-free grid domain: verifier-shaped math with a deliberately VERBOSE system
 * prompt (the κ/compression factor needs something to compress; short prompts measure
 * noise). Shared by ablation-grid.mts; the same problems as prompt-compression-gate.
 */
import { type AgenticTask, createVerifierEnvironment, type Environment } from '@tangle-network/agent-runtime/loops'

const verbosePrompt = `You are an extremely careful and methodical mathematical reasoning assistant working on
quantitative word problems. Your approach to every single problem should always follow a disciplined,
step-by-step procedure: first, read the entire problem statement carefully from beginning to end,
making sure that you have correctly identified every quantity mentioned, every relationship between
the quantities, and exactly what the question is asking you to compute. Second, write out your
reasoning explicitly, one logical step at a time, double-checking each arithmetic operation as you
perform it, because small arithmetic slips are the most common source of incorrect final answers.
Third, before submitting, re-read the original question one final time and verify that the number you
are about to submit actually answers the question that was asked, in the units that were asked for,
rather than an intermediate quantity computed along the way. When you are fully confident, submit your
final numeric answer using the submit_answer tool with just the number, no units, no commas, and no
additional commentary or explanation attached to it.`

interface MathProblem {
  q: string
  a: number
}

const problems: MathProblem[] = [
  { q: 'A baker makes 24 muffins per tray and bakes 7 trays, then sells 109 muffins. How many remain?', a: 59 },
  { q: 'A train travels 84 km/h for 2.5 hours, then 60 km/h for 1.5 hours. Total distance in km?', a: 300 },
  { q: 'Tickets cost $14 for adults, $9 for children. 13 adults and 21 children attend. Total revenue?', a: 371 },
  { q: 'A tank holds 840 liters and drains at 35 liters/minute. After 18 minutes, how many liters remain?', a: 210 },
  { q: 'A worker earns $22/hour plus 1.5x overtime past 40 hours. They work 47 hours. Total pay?', a: 1111 },
  { q: 'A rectangle is 3x as long as wide; the perimeter is 96 cm. What is its area in square cm?', a: 432 },
  { q: 'A store discounts a $250 jacket by 30%, then adds 8% tax on the discounted price. Final price?', a: 189 },
  { q: 'Alice reads 45 pages/day, Bob 30 pages/day. A book is 600 pages. Reading together, days to finish (split optimally)?', a: 8 },
  { q: 'A car uses 7.5 liters per 100 km. Fuel costs $1.60/liter. Cost to drive 480 km?', a: 57.6 },
  { q: '3 pumps fill a pool in 8 hours. How many hours for 4 pumps at the same rate?', a: 6 },
  { q: 'An investment of $4000 grows 5% per year, simple interest. Value after 7 years?', a: 5400 },
  { q: 'A recipe for 6 servings needs 450g flour. How many grams for 16 servings?', a: 1200 },
  { q: 'A 144-page album holds 6 photos per page; 610 photos exist. How many photos do NOT fit?', a: 0 },
  { q: 'Two buses leave together; one every 12 min, one every 18 min. After how many minutes do they leave together again?', a: 36 },
  { q: 'A phone discounted 20% costs $480. What was the original price?', a: 600 },
  { q: 'A field 80m by 45m needs fencing on 3 sides (one 80m side is a wall). Total fence length in m?', a: 170 },
  { q: 'Score 78, 85, 91 on three tests. What is needed on the fourth for a 85 average?', a: 86 },
  { q: 'A printer prints 22 pages/min; a second prints 14 pages/min. Together, minutes for 540 pages?', a: 15 },
  { q: 'A 3:5 ratio of cats to dogs, 64 animals total. How many dogs?', a: 40 },
  { q: 'Water rises 2.5cm/hour for 6 hours then falls 1.5cm/hour for 4 hours. Net change in cm?', a: 9 },
  { q: 'A loan of $1200 charges 4% simple interest per month. Total owed after 5 months?', a: 1440 },
  { q: 'A factory output grows from 1500 to 1845 units. Percent increase?', a: 23 },
  { q: 'A hiker walks 4.2 km/h for 1.5h, rests, then 3.6 km/h for 2h. Total km?', a: 13.5 },
  { q: 'Seats in rows of 16; 23 rows; 332 tickets sold. How many empty seats?', a: 36 },
  { q: 'A $84 dinner is split among 4 friends; one pays an extra $6 tip share. What does that friend pay?', a: 27 },
  { q: 'A cyclist covers 36 km at 24 km/h then returns at 18 km/h. Total minutes riding?', a: 210 },
  { q: 'A class of 28 has 4 more girls than boys. How many girls?', a: 16 },
  { q: 'Paint covers 12 m² per liter; walls total 102 m²; paint sells in 2L cans. How many cans?', a: 5 },
  { q: 'A number tripled, then reduced by 14, gives 49. What is the number?', a: 21 },
  { q: 'A shop sells 3 pens for $2.40. Cost of 17 pens at the same unit price?', a: 13.6 },
  { q: 'A 25% antifreeze mix: how many liters of pure antifreeze in 48 liters of mix?', a: 12 },
  { q: 'Months with 31 days in a year times 4, minus 5?', a: 23 },
  { q: 'A worker packs 45 boxes/hour; a machine packs 4x as fast. Boxes packed together in 3 hours?', a: 675 },
  { q: 'A garden 9m square (9m sides) has a 1m path around it inside. Area of the path in m²?', a: 32 },
  { q: 'Sum of three consecutive even numbers is 132. What is the largest?', a: 46 },
  { q: 'A movie runs 2h 18min and starts at 7:50 PM. Minutes past 10 PM when it ends?', a: 8 },
]

/** The grid's gym-free domain: tasks are sliced by offset (disjoint slices by index). */
export function mathEnvironment(): {
  environment: Environment
  tasks: (offset: number, n: number) => Promise<AgenticTask[]>
} {
  const environment = createVerifierEnvironment({
    name: 'verbose-math',
    check: (task, answer) => {
      const expected = (task.meta as MathProblem | undefined)?.a
      const got = Number.parseFloat(String(answer).replace(/[$,\s]/g, ''))
      const pass = expected !== undefined && Number.isFinite(got) && Math.abs(got - expected) < 0.01
      return { passes: pass ? 1 : 0, total: 1, errored: 0 }
    },
  })
  const tasks = async (offset: number, n: number): Promise<AgenticTask[]> => {
    const slice = problems.slice(offset, offset + n)
    if (slice.length < n) throw new Error(`math slice [${offset}, ${offset + n}) has only ${slice.length} problems`)
    return slice.map((p, i) => ({
      id: `math-${offset + i}`,
      systemPrompt: verbosePrompt,
      userPrompt: p.q,
      meta: p as unknown as Record<string, unknown>,
    }))
  }
  return { environment, tasks }
}

/** The HARD band domain: AIME competition problems (AI-MO/aimo-validation-aime, 90
 *  rows, integer answers => a clean deployable check) behind the same verbose prompt.
 *  Stateless multishot: pair with INNER_TURNS=2 (one completion + the submit call) —
 *  the degenerate maxTurns=0 rollout shape at budget k. */
export function aimeEnvironment(): {
  environment: Environment
  tasks: (offset: number, n: number) => Promise<AgenticTask[]>
} {
  const environment = createVerifierEnvironment({
    name: 'aime',
    check: (task, answer) => {
      const expected = String((task.meta as { answer?: string } | undefined)?.answer ?? '').trim()
      const got = String(answer).replace(/[,\s]/g, '')
      const pass =
        expected.length > 0 &&
        (got === expected || Number.parseFloat(got) === Number.parseFloat(expected))
      return { passes: pass ? 1 : 0, total: 1, errored: 0 }
    },
  })
  const tasks = async (offset: number, n: number): Promise<AgenticTask[]> => {
    const url = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent('AI-MO/aimo-validation-aime')}&config=default&split=train&offset=${offset}&length=${n}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`AIME HF rows HTTP ${res.status}`)
    const body = (await res.json()) as {
      rows?: Array<{ row: { id: number; problem: string; answer: string } }>
    }
    const rows = (body.rows ?? []).slice(0, n)
    if (rows.length < n) throw new Error(`AIME slice [${offset}, ${offset + n}) returned only ${rows.length}`)
    return rows.map(({ row }) => ({
      id: `aime-${row.id}`,
      systemPrompt: verbosePrompt,
      userPrompt: row.problem,
      meta: { answer: row.answer },
    }))
  }
  return { environment, tasks }
}
