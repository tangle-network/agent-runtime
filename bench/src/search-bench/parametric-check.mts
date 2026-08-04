/**
 * Discrimination check: how many fresh-docs tasks does a model get WRONG from
 * memory (no tools, no search)? A high parametric fail-rate is the prerequisite
 * for the whole comparison — if the model already knows the answer, no search
 * backend can help. This is a pure router chat-completion per task, scored by
 * the same deterministic oracle the sandbox run uses. No sandbox, no deploy dep.
 *
 * Run:
 *   dotenvx run -f ~/company/devops/secrets/.env.keys -f ~/company/devops/secrets/agent-state.env -- \
 *     env MODEL=gpt-4.1 CONCURRENCY=4 pnpm exec tsx src/search-bench/parametric-check.mts
 */
import { writeFileSync } from 'node:fs'
import { runPool } from '../run-pool'
import { runBenchRouterTurn } from '../router-turn'
import { freshTasks } from './tasks-fresh'
import { scoreTask, taskToPrompt } from './tasks'

async function main(): Promise<void> {
  const model = process.env.MODEL ?? 'deepseek-v4-flash'
  const routerKey = process.env.TANGLE_API_KEY
  if (!routerKey) throw new Error('missing TANGLE_API_KEY')
  const cfg = {
    routerBaseUrl: process.env.ROUTER_BASE_URL ?? 'https://router.tangle.tools/v1',
    routerKey,
    model,
  }
  const conc = Number(process.env.CONCURRENCY ?? 4)

  const outcomes = await runPool(freshTasks, conc, async (task) => {
    try {
      const res = await runBenchRouterTurn(
        {
          routerBaseUrl: cfg.routerBaseUrl,
          routerKey: cfg.routerKey,
          profile: {
            name: 'search-parametric-check',
            model: { provider: 'tangle-router', default: model },
          },
        },
        taskToPrompt(task),
      )
      const { score } = scoreTask(task, res.finalText)
      return {
        id: task.id,
        score: score as 0 | 1 | null,
        cost: res.usage.usdKnown === false ? undefined : res.usage.costUsd,
        err: undefined as string | undefined,
      }
    } catch (err) {
      return { id: task.id, score: null as 0 | 1 | null, cost: undefined, err: err instanceof Error ? err.message : String(err) }
    }
  })
  const rows = outcomes.map((o) => o.value!).filter(Boolean)

  const scored = rows.filter((r) => r.score !== null)
  const passed = scored.filter((r) => r.score === 1).length
  const failed = scored.length - passed
  console.log(`\n=== Parametric (no-search) discrimination · ${model} · n=${scored.length} ===`)
  for (const r of rows.sort((a, b) => (a.score ?? -1) - (b.score ?? -1))) {
    console.log(`  ${r.score === null ? 'ERR ' : r.score === 1 ? 'KNEW' : 'MISS'}  ${r.id}${r.err ? ` (${r.err})` : ''}`)
  }
  console.log(
    `\nparametric FAIL (search-correctable headroom): ${failed}/${scored.length} = ${((failed / scored.length) * 100).toFixed(0)}%` +
      ` · model already knew: ${passed}/${scored.length}`,
  )
  if (process.env.PARAM_OUT) {
    writeFileSync(
      process.env.PARAM_OUT,
      rows.map((r) => JSON.stringify({ id: r.id, model, knewParametrically: r.score === 1, score: r.score })).join('\n') + '\n',
    )
    console.log(`wrote per-task baseline → ${process.env.PARAM_OUT}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
