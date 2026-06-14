/**
 * Generalized AgentProfile-coordinate optimizer on the sandbox surface. ONE runner for EVERY
 * coordinate of the genome — skills, hooks, tools, prompt, subagents, mcp — over a real sandboxed
 * harness agent. It measures the agent's task success WITH the coordinate's candidates injected
 * vs WITHOUT (the frozen base profile), paired by task, on a deterministic-judge coding bench.
 *
 * Hold any coordinate fixed = don't select it (COORDINATE picks the one varied; everything else
 * stays in the base profile). Combine = run several, or extend the base with a prior winner.
 *
 * Applies to ANY agent in the supervisor flow: AGENT=worker injects the profile into the
 * sandboxed worker (wired); AGENT=driver injects it into the driver/steer agent (same compose,
 * the seam is marked below) — because a driver, a worker, and a subagent are all AgentProfiles.
 *
 *   COORDINATE=skills BENCH=humaneval N=8 WORKER_MODEL=gpt-4.1 \
 *     dotenvx run -f …/.env.keys -- tsx src/profile-coord-sandbox.mts
 */
import type { AgentProfile } from '@tangle-network/sandbox'
import { Sandbox } from '@tangle-network/sandbox'
import { ADAPTERS } from './adapters'
import { type Arm, randomArm, runExperiment, sandboxAgentRun } from './experiment'
import { getCoordinate } from './profile-coordinates'

const must = (k: string): string => {
  const v = process.env[k]
  if (!v) throw new Error(`env ${k} is required`)
  return v
}

async function main(): Promise<void> {
  const coordinate = getCoordinate(process.env.COORDINATE ?? 'skills')
  const make = ADAPTERS[process.env.BENCH ?? 'humaneval']
  if (!make) throw new Error(`unknown BENCH=${process.env.BENCH} (have: ${Object.keys(ADAPTERS).join(', ')})`)
  const adapter = make()
  const model = process.env.WORKER_MODEL ?? 'deepseek-v4-flash'
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const routerKey = must('TANGLE_API_KEY')
  const backendType = (process.env.BACKEND as 'opencode' | 'claude-code' | undefined) ?? 'opencode'
  const agentTarget = process.env.AGENT ?? 'worker' // worker (wired) | driver (seam below)
  const rounds = Number(process.env.ROUNDS ?? 1)
  const n = Number(process.env.N ?? 8)
  const concurrency = Number(process.env.CONCURRENCY ?? 3)
  const ids = process.env.IDS ? process.env.IDS.split(',') : undefined

  // The frozen base genome. Everything NOT under optimization lives here, untouched. Extend it
  // (PROFILE_JSON) to carry a prior winner from another coordinate — that is how coordinates
  // combine: each run freezes the others by leaving them in the base.
  const baseProfile: AgentProfile = {
    name: `${coordinate.name}-base`,
    ...(process.env.PROFILE_JSON ? (JSON.parse(process.env.PROFILE_JSON) as AgentProfile) : {}),
  }
  const candidates = coordinate.candidates()
  const withProfile = coordinate.compose(baseProfile, candidates)

  console.error(
    `=== PROFILE-COORD · coordinate=${coordinate.name} · agent=${agentTarget} · bench=${adapter.name} · ` +
      `backend=${backendType} · model=${model} · n=${n} ===\n` +
      `  candidates injected (held against the frozen base): ${candidates.join(', ')}\n`,
  )
  if (agentTarget !== 'worker') {
    throw new Error(`AGENT=${agentTarget} not yet wired — the compose is identical, but routing a profile into the driver/steer agent is the next seam (createExecutor backend for the driver). Run AGENT=worker.`)
  }

  const client = new Sandbox({
    baseUrl: process.env.SANDBOX_BASE_URL ?? 'https://sandbox.tangle.tools',
    apiKey: routerKey,
    timeoutMs: 1_200_000,
  } as never)

  const control: [Arm, ...Arm[]] = [randomArm('solve')]
  const run = (profile: AgentProfile) =>
    runExperiment({
      adapter,
      sandboxClient: client,
      agentRun: sandboxAgentRun({
        model,
        routerBaseUrl,
        backendType,
        ...(process.env.WORKER_PROVIDER ? { provider: process.env.WORKER_PROVIDER } : {}),
        profile,
      }),
      arms: control,
      model,
      rounds,
      n,
      ...(ids ? { ids } : {}),
      concurrency,
      ...(adapter.output ? { output: adapter.output } : {}),
      infraRetries: Number(process.env.INFRA_RETRIES ?? 2),
    })

  console.error(`[arm: WITHOUT ${coordinate.name}] (frozen base) running…`)
  const without = await run(baseProfile)
  console.error(`  without resolved: ${without.arms[0]?.resolved ?? 0}/${without.n}\n`)

  console.error(`[arm: WITH ${coordinate.name}] running…`)
  const withC = await run(withProfile)
  console.error(`  with resolved: ${withC.arms[0]?.resolved ?? 0}/${withC.n}\n`)

  const a = without.arms[0]?.resolved ?? 0
  const b = withC.arms[0]?.resolved ?? 0
  const pct = (x: number, nn: number) => (nn > 0 ? `${((x / nn) * 100).toFixed(1)}%` : 'n/a')
  console.error(`${'='.repeat(72)}\n${coordinate.name.toUpperCase()} COORDINATE (sandboxed ${backendType} ${agentTarget}, ${adapter.name}):`)
  console.error(`  WITHOUT (base): ${a}/${without.n} (${pct(a, without.n)})`)
  console.error(`  WITH         : ${b}/${withC.n} (${pct(b, withC.n)})`)
  console.error(`  delta        : ${b - a > 0 ? '+' : ''}${b - a} instances`)
}

main().catch((e) => {
  console.error(`profile-coord-sandbox: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
  process.exit(1)
})
