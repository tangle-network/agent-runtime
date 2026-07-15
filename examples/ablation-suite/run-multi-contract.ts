/**
 * Search-value ablation on the long-horizon multi-contract task.
 *
 * ARM = the `search` env knob: worker WITH the you.com web_search tool vs WITHOUT (native
 * read/write/run_tests/bash ON in both — additive isolation). Strategy = `refine` (continuous
 * multi-round worker, budget rounds), the long-horizon loop. Coder = glm-5.2 via the router.
 *
 * PRE-REGISTERED GATES (enforced here, not narrated past):
 *   ARMS=cal (default) → run NO-SEARCH only. resolve MUST be <0.40, else the task is too easy —
 *     harden it (add/harder contracts), do NOT pay for the paired run.
 *   full → both arms, paired per-task; report resolve delta + paired-bootstrap 95% CI + search
 *     firing. A run where the search arm never called web_search is INVALID (not a tie).
 *
 * Env knobs: WORKER_MODEL (default glm-5.2), N (holdout size), BUDGET (refine rounds), ARMS=cal|full.
 */
import { refine, runAgentic } from '@tangle-network/agent-runtime/loops'
import {
  makeMultiContractSurface,
  multiContractTasks,
  resetSearchCalls,
  searchCalls,
} from './multi-contract-env.js'

const ROUTER = process.env.ROUTER_BASE_URL ?? 'https://router.tangle.tools/v1'
const KEY = process.env.TANGLE_API_KEY ?? ''
const MODEL = process.env.WORKER_MODEL ?? 'glm-5.2'
const N = Number(process.env.N ?? (process.env.ARMS === 'full' ? 20 : 6))
const BUDGET = Number(process.env.BUDGET ?? 8)
const MODE = process.env.ARMS ?? 'cal'
if (!KEY) {
  console.error('TANGLE_API_KEY unset')
  process.exit(1)
}

interface ArmOut {
  resolve: number
  scoreMean: number
  perTask: number[]
  perScore: number[]
  valid: boolean[]
  fired: number
  usd: number
}

async function runArm(
  search: boolean,
  tasks: Awaited<ReturnType<typeof multiContractTasks>>,
): Promise<ArmOut> {
  const surface = makeMultiContractSurface({ search })
  const perTask: number[] = []
  const perScore: number[] = []
  const valid: boolean[] = []
  let fired = 0
  let usd = 0
  for (const t of tasks) {
    // runAgentic opens its OWN handle (the worker's workspace); use ITS result. The router
    // occasionally returns an empty (0-token) run — retry up to twice, then mark the task INVALID
    // so it's dropped from the paired vectors instead of counting as a fake 0.
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
          innerTurns: 14,
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
      perScore.push(0)
      valid.push(false)
      console.error(
        `  [${search ? '+search' : 'no-search'}] ${t.id}: INVALID (empty run after retries) — dropped`,
      )
      continue
    }
    perTask.push(r.resolved ? 1 : 0)
    perScore.push(Math.max(0, Math.min(1, r.score)))
    valid.push(true)
    if (search && searchCalls() > 0) fired++
    usd += r.usd
    console.error(
      `  [${search ? '+search' : 'no-search'}] ${t.id}: score=${(100 * r.score).toFixed(0)}% resolved=${r.resolved}${search ? ` search-calls=${searchCalls()}` : ''} tokens=${tokens} shots=${(r as { shots?: number }).shots ?? '?'}`,
    )
  }
  const vIdx = valid.map((v, i) => (v ? i : -1)).filter((i) => i >= 0)
  const vResolve = vIdx.length ? vIdx.reduce((a, i) => a + perTask[i], 0) / vIdx.length : 0
  const vScore = vIdx.length ? vIdx.reduce((a, i) => a + perScore[i], 0) / vIdx.length : 0
  return { resolve: vResolve, scoreMean: vScore, perTask, perScore, valid, fired, usd }
}

// paired bootstrap CI of (search − nosearch) on the aligned per-task vectors — no random seed
// available in this env, so use a deterministic jackknife-style spread as a conservative CI proxy.
function pairedDeltaCI(a: number[], b: number[]): { delta: number; lo: number; hi: number } {
  const d = a.map((x, i) => x - b[i])
  const mean = d.reduce((s, x) => s + x, 0) / d.length
  const v = d.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, d.length - 1)
  const se = Math.sqrt(v / d.length)
  return { delta: mean, lo: mean - 1.96 * se, hi: mean + 1.96 * se }
}

const tasks = await multiContractTasks(0, N)
console.error(
  `multi-contract search ablation · model=${MODEL} · N=${N} · budget=${BUDGET} · mode=${MODE}\n`,
)

const noSearch = await runArm(false, tasks)
console.error(
  `\nNO-SEARCH: resolve=${(100 * noSearch.resolve).toFixed(0)}%  contracts-mean=${(100 * noSearch.scoreMean).toFixed(0)}%  $${noSearch.usd.toFixed(2)}`,
)

if (MODE === 'cal') {
  console.error(`\n=== CALIBRATION GATE (pre-registered) ===`)
  if (noSearch.resolve >= 0.4) {
    console.error(
      `FAIL: no-search resolve ${(100 * noSearch.resolve).toFixed(0)}% ≥ 40% — task TOO EASY, no room for search to win. HARDEN it (more/harder contracts) before the paired run. Do NOT report a search delta from this.`,
    )
  } else if (noSearch.scoreMean >= 0.98) {
    console.error(
      `FAIL: contracts-mean ${(100 * noSearch.scoreMean).toFixed(0)}% — aces the contracts without search. Harden.`,
    )
  } else {
    console.error(
      `PASS: no-search resolve ${(100 * noSearch.resolve).toFixed(0)}% < 40% (contracts-mean ${(100 * noSearch.scoreMean).toFixed(0)}%) — middle band, room for search. Run ARMS=full for the paired verdict.`,
    )
  }
  process.exit(0)
}

const search = await runArm(true, tasks)
console.error(
  `\n+SEARCH:   resolve=${(100 * search.resolve).toFixed(0)}%  contracts-mean=${(100 * search.scoreMean).toFixed(0)}%  fired=${search.fired}/${N}  $${search.usd.toFixed(2)}`,
)

// paired on tasks VALID in BOTH arms only (drop empty-run flukes so the pairing is honest)
const both = tasks.map((_, i) => i).filter((i) => noSearch.valid[i] && search.valid[i])
const nsT = both.map((i) => noSearch.perTask[i])
const seT = both.map((i) => search.perTask[i])
const nsS = both.map((i) => noSearch.perScore[i])
const seS = both.map((i) => search.perScore[i])
const ci = pairedDeltaCI(seT, nsT)
const sci = pairedDeltaCI(seS, nsS)
console.error(`\n=== VERDICT (pre-registered) ===`)
console.error(`paired tasks valid in both arms: ${both.length}/${N}`)
if (search.fired === 0) {
  console.error(
    `INVALID: search arm never called web_search (0/${N} fired) — not a tie, a broken arm.`,
  )
  process.exit(0)
}
if (both.length < 5) {
  console.error(
    `INVALID: only ${both.length} both-valid tasks — too few for a verdict (raise N or fix empty-run rate).`,
  )
  process.exit(0)
}
console.error(
  `no-search resolve ${((100 * nsT.reduce((a, b) => a + b, 0)) / nsT.length).toFixed(0)}% score ${((100 * nsS.reduce((a, b) => a + b, 0)) / nsS.length).toFixed(0)}% | +search resolve ${((100 * seT.reduce((a, b) => a + b, 0)) / seT.length).toFixed(0)}% score ${((100 * seS.reduce((a, b) => a + b, 0)) / seS.length).toFixed(0)}%`,
)
console.error(
  `resolve delta (search−nosearch): ${(100 * ci.delta).toFixed(0)}pt  95% CI [${(100 * ci.lo).toFixed(0)}, ${(100 * ci.hi).toFixed(0)}]`,
)
console.error(
  `contract-mean delta:            ${(100 * sci.delta).toFixed(0)}pt  95% CI [${(100 * sci.lo).toFixed(0)}, ${(100 * sci.hi).toFixed(0)}]`,
)
console.error(
  ci.lo > 0 || sci.lo > 0
    ? `SEARCH HELPS — CI excludes 0.`
    : `NO significant search benefit (CI includes 0). Honest null at n=${N}.`,
)
