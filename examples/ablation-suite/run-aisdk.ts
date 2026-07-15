/**
 * Search-value A/B on the current-ai-SDK task (aisdk-env). Coder = glm-5.2 via the router, strategy
 * = refine (multi-round, sees the tsc errors each round). ARM = the `search` knob (you.com web_search
 * on/off; read/write/run_tests on in both — additive isolation).
 *
 * NO-SEARCH arm is the CONTROL: with compiler feedback but no web, does the coder recover the current
 * tool() shape on its own? If no-search resolve is low and +search lifts it (paired CI excludes 0),
 * search is the differentiator. Empty (0-token) router runs are retried, then dropped as INVALID.
 *
 * Env: WORKER_MODEL (glm-5.2), N (tasks/arm), BUDGET (refine rounds), ARMS=cal|full.
 */
import { refine, runAgentic } from '@tangle-network/agent-runtime/loops'
import { aiSdkTasks, makeAiSdkSurface, resetSearchCalls, searchCalls } from './aisdk-env.js'

const ROUTER = process.env.ROUTER_BASE_URL ?? 'https://router.tangle.tools/v1'
const KEY = process.env.TANGLE_API_KEY ?? ''
const MODEL = process.env.WORKER_MODEL ?? 'glm-5.2'
const N = Number(process.env.N ?? (process.env.ARMS === 'full' ? 12 : 6))
const BUDGET = Number(process.env.BUDGET ?? 6)
const MODE = process.env.ARMS ?? 'cal'
if (!KEY) {
  console.error('TANGLE_API_KEY unset')
  process.exit(1)
}

interface ArmOut {
  resolve: number
  perTask: number[]
  valid: boolean[]
  fired: number
  usd: number
}

async function runArm(
  search: boolean,
  tasks: Awaited<ReturnType<typeof aiSdkTasks>>,
): Promise<ArmOut> {
  const surface = makeAiSdkSurface({ search })
  const perTask: number[] = []
  const valid: boolean[] = []
  let fired = 0
  let usd = 0
  for (const t of tasks) {
    let r: Awaited<ReturnType<typeof runAgentic>> | null = null
    let tokens = 0
    for (let attempt = 0; attempt < 3; attempt++) {
      resetSearchCalls()
      try {
        const rr = await runAgentic({
          surface,
          task: t,
          strategy: refine,
          budget: BUDGET,
          routerBaseUrl: ROUTER,
          routerKey: KEY,
          model: MODEL,
          maxTokens: 8000,
          innerTurns: 12,
        })
        const tok = (rr as { tokens?: { input?: number; output?: number } }).tokens
        tokens = (tok?.input ?? 0) + (tok?.output ?? 0)
        if (tokens > 0) {
          r = rr
          break
        }
      } catch (e) {
        console.error(
          `  [${search ? '+search' : 'no-search'}] ${t.id}: attempt ${attempt} ERROR ${e instanceof Error ? e.message : e}`,
        )
      }
    }
    if (!r || tokens === 0) {
      perTask.push(0)
      valid.push(false)
      console.error(
        `  [${search ? '+search' : 'no-search'}] ${t.id}: INVALID (empty run) — dropped`,
      )
      continue
    }
    perTask.push(r.resolved ? 1 : 0)
    valid.push(true)
    if (search && searchCalls() > 0) fired++
    usd += r.usd
    console.error(
      `  [${search ? '+search' : 'no-search'}] ${t.id}: resolved=${r.resolved}${search ? ` search-calls=${searchCalls()}` : ''} tokens=${tokens}`,
    )
  }
  const vIdx = valid.map((v, i) => (v ? i : -1)).filter((i) => i >= 0)
  const resolve = vIdx.length ? vIdx.reduce((a, i) => a + (perTask[i] ?? 0), 0) / vIdx.length : 0
  return { resolve, perTask, valid, fired, usd }
}

function pairedDeltaCI(a: number[], b: number[]): { delta: number; lo: number; hi: number } {
  const d = a.map((x, i) => x - (b[i] ?? 0))
  const mean = d.reduce((s, x) => s + x, 0) / d.length
  const v = d.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, d.length - 1)
  const se = Math.sqrt(v / d.length)
  return { delta: mean, lo: mean - 1.96 * se, hi: mean + 1.96 * se }
}

const tasks = await aiSdkTasks(N)
console.error(
  `aisdk-v7 search ablation · model=${MODEL} · N=${N} · budget=${BUDGET} · mode=${MODE}\n`,
)

const noSearch = await runArm(false, tasks)
console.error(
  `\nNO-SEARCH (control): resolve=${(100 * noSearch.resolve).toFixed(0)}%  $${noSearch.usd.toFixed(2)}`,
)

if (MODE === 'cal') {
  console.error(`\n=== CONTROL READ ===`)
  if (noSearch.resolve >= 0.6)
    console.error(
      `No-search recovers ${(100 * noSearch.resolve).toFixed(0)}% from compiler feedback ALONE — search has little room. Weak candidate.`,
    )
  else
    console.error(
      `No-search stuck at ${(100 * noSearch.resolve).toFixed(0)}% with compiler feedback but no web — room for search. Run ARMS=full.`,
    )
  process.exit(0)
}

const search = await runArm(true, tasks)
console.error(
  `\n+SEARCH: resolve=${(100 * search.resolve).toFixed(0)}%  fired=${search.fired}/${N}  $${search.usd.toFixed(2)}`,
)

const both = tasks.map((_, i) => i).filter((i) => noSearch.valid[i] && search.valid[i])
const nsT = both.map((i) => noSearch.perTask[i] ?? 0)
const seT = both.map((i) => search.perTask[i] ?? 0)
const ci = pairedDeltaCI(seT, nsT)
console.error(`\n=== VERDICT (pre-registered) ===`)
console.error(`paired tasks valid in both arms: ${both.length}/${N}`)
if (search.fired === 0) {
  console.error(`INVALID: search arm never called web_search — broken arm, not a tie.`)
  process.exit(0)
}
if (both.length < 5) {
  console.error(`INVALID: only ${both.length} both-valid tasks — raise N or fix empty-run rate.`)
  process.exit(0)
}
console.error(
  `no-search resolve ${((100 * nsT.reduce((a, b) => a + b, 0)) / nsT.length).toFixed(0)}% | +search resolve ${((100 * seT.reduce((a, b) => a + b, 0)) / seT.length).toFixed(0)}%`,
)
console.error(
  `resolve delta (search−nosearch): ${(100 * ci.delta).toFixed(0)}pt  95% CI [${(100 * ci.lo).toFixed(0)}, ${(100 * ci.hi).toFixed(0)}]`,
)
console.error(
  ci.lo > 0
    ? `SEARCH HELPS — CI excludes 0.`
    : `NO significant search benefit at n=${both.length} (CI includes 0).`,
)
