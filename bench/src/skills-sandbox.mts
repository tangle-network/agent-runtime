/**
 * The skills coordinate on the RIGHT surface: a sandboxed coding harness worker (opencode/
 * claude-code in a real box), with real SKILL.md skills materialized to disk via the
 * AgentProfile (`resources.skills`), invoked by the agent the standard way. Measures the agent's
 * task completion WITH the skills vs WITHOUT, paired by task — the honest skills-lever test that
 * the router prompt-text experiment could not give.
 *
 * Skills are NOT pasted into a prompt; they are mounted as discoverable SKILL.md packages the
 * harness loads itself (proven on disk by skill-sandbox-smoke.mts). Equal-k by construction:
 * same backend, same model, same rounds — the only difference is whether the skills exist.
 *
 *   BENCH=commit0 COMMIT0_FIXTURES=1 N=8 WORKER_MODEL=gpt-4.1 \
 *     dotenvx run -f …/.env.keys -- tsx src/skills-sandbox.mts
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type AgentProfileResourceRef, Sandbox, defineInlineResource } from '@tangle-network/sandbox'
import { ADAPTERS } from './adapters'
import { type Arm, randomArm, runExperiment, sandboxAgentRun } from './experiment'

const must = (k: string): string => {
  const v = process.env[k]
  if (!v) throw new Error(`env ${k} is required`)
  return v
}

/** Load the coding skills as SKILL.md resource refs — name = filename, content = full file. */
function loadSkillResources(dir: string): AgentProfileResourceRef[] {
  const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort()
  if (files.length === 0) throw new Error(`no skills in ${dir}`)
  return files.map((f) => defineInlineResource(f.replace(/\.md$/, ''), readFileSync(join(dir, f), 'utf8')))
}

async function main(): Promise<void> {
  const make = ADAPTERS[process.env.BENCH ?? 'commit0']
  if (!make) throw new Error(`unknown BENCH=${process.env.BENCH} (have: ${Object.keys(ADAPTERS).join(', ')})`)
  const adapter = make()
  const model = process.env.WORKER_MODEL ?? 'deepseek-v4-flash'
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const routerKey = must('TANGLE_API_KEY')
  const backendType = (process.env.BACKEND as 'opencode' | 'claude-code' | undefined) ?? 'opencode'
  const rounds = Number(process.env.ROUNDS ?? 1)
  const n = Number(process.env.N ?? 8)
  const concurrency = Number(process.env.CONCURRENCY ?? 3)
  const ids = process.env.IDS ? process.env.IDS.split(',') : undefined

  const skillsDir = join(dirname(fileURLToPath(import.meta.url)), 'coding-skills')
  const skills = loadSkillResources(skillsDir)
  console.error(
    `=== SKILLS-ON-SANDBOX · bench=${adapter.name} · backend=${backendType} · model=${model} · n=${n} · rounds=${rounds} ===\n` +
      `  agent-under-test skills (materialized to disk in the box): ${skills.map((s) => (s.kind === 'inline' ? s.name : s.path)).join(', ')}\n`,
  )

  const client = new Sandbox({
    baseUrl: process.env.SANDBOX_BASE_URL ?? 'https://sandbox.tangle.tools',
    apiKey: routerKey,
    timeoutMs: 1_200_000,
  } as never)

  const control: [Arm, ...Arm[]] = [randomArm('solve')]
  const run = (withSkills: boolean) =>
    runExperiment({
      adapter,
      sandboxClient: client,
      // The ONE difference between the two arms: resources.skills present or absent.
      agentRun: sandboxAgentRun({
        model,
        routerBaseUrl,
        backendType,
        ...(process.env.WORKER_PROVIDER ? { provider: process.env.WORKER_PROVIDER } : {}),
        profile: withSkills ? { name: 'skills-worker', resources: { skills } } : { name: 'no-skills-worker' },
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

  // Run WITHOUT first (baseline), then WITH, on the SAME task ids (paired).
  console.error('[arm: NO skills] running…')
  const without = await run(false)
  console.error(`  no-skills resolved: ${without.arms[0]?.resolved ?? 0}/${without.n}\n`)

  console.error('[arm: WITH skills] running…')
  const withS = await run(true)
  console.error(`  with-skills resolved: ${withS.arms[0]?.resolved ?? 0}/${withS.n}\n`)

  const a = without.arms[0]?.resolved ?? 0
  const b = withS.arms[0]?.resolved ?? 0
  const pct = (x: number, nn: number) => (nn > 0 ? `${((x / nn) * 100).toFixed(1)}%` : 'n/a')
  console.error(`${'='.repeat(72)}\nSKILLS LEVER (sandboxed ${backendType} worker, ${adapter.name}):`)
  console.error(`  no-skills : ${a}/${without.n} (${pct(a, without.n)})`)
  console.error(`  with-skills: ${b}/${withS.n} (${pct(b, withS.n)})`)
  console.error(`  delta     : ${b - a > 0 ? '+' : ''}${b - a} instances (${pct(b, withS.n)} vs ${pct(a, without.n)})`)
}

main().catch((e) => {
  console.error(`skills-sandbox: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
  process.exit(1)
})
