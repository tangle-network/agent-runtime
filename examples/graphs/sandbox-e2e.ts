/**
 * sandbox-e2e — the one LIVE graph example: a real Tangle Sandbox box, a real router-brained
 * root, a worker graded by an executable check, and two skeptics on different model families.
 *
 * Every other example in this directory is offline. This one proves the same graph shape on the
 * real path: `backend: { backend: 'sandbox', sandboxClient, validator }` places the worker (and
 * each skeptic, since an analyst node runs through the same spawn machinery) in its own box, and
 * the validator runs `cat /work/answer.txt` INSIDE the worker's live box before it is torn down.
 * It prints the edge ledger, each node's measured cost, and the run's result kind. The skeptics'
 * findings reach the root as `analyzes` rows; this example does not tally them into a decision
 * (`skeptic-majority.ts` is the offline form that does).
 *
 * It spends real money, so it is opt-in and it SKIPS CLEANLY: with any variable below unset it
 * prints which ones and exits 0 without creating anything. Credentials are read from the
 * environment only and are never printed.
 *
 *   TANGLE_API_KEY      sandbox + router key
 *   SANDBOX_BASE_URL    sandbox API base URL
 *   ROOT_MODEL          the router-brained root's model
 *   WORKER_MODEL        the worker's model
 *   SKEPTIC_A_MODEL     skeptic A's model (a different family from B)
 *   SKEPTIC_B_MODEL     skeptic B's model
 *   WORKER_HARNESS      optional, default `pi`
 *   ROUTER_URL          optional, default https://router.tangle.tools/v1
 *
 * Run:  TANGLE_API_KEY=... SANDBOX_BASE_URL=... ROOT_MODEL=... WORKER_MODEL=... \
 *       SKEPTIC_A_MODEL=... SKEPTIC_B_MODEL=... pnpm tsx examples/graphs/sandbox-e2e.ts
 */

import { type AgentProfile, harnessTypeSchema } from '@tangle-network/agent-interface'
import {
  type AgentGraph,
  type ExecutorConfig,
  promptHandle,
  runGraph,
  type SandboxClient,
} from '@tangle-network/agent-runtime/kernel'
import { printLedger, SPAWN_TOOL } from './shared'

const brief = promptHandle('delegates/worker-brief/v1')
const report = promptHandle('analyzes/findings-report/v1')

const REQUIRED = [
  'TANGLE_API_KEY',
  'SANDBOX_BASE_URL',
  'ROOT_MODEL',
  'WORKER_MODEL',
  'SKEPTIC_A_MODEL',
  'SKEPTIC_B_MODEL',
] as const

const ANSWER = '42'

type SandboxBackend = Extract<ExecutorConfig, { backend: 'sandbox' }>

function profile(name: string, model: string, system: string, harness: string): AgentProfile {
  return {
    name,
    harness: harnessTypeSchema.parse(harness),
    model: { provider: 'tangle-router', default: model },
    prompt: { systemPrompt: system },
  }
}

/** The graph: one worker plus two skeptic analyst nodes. Pure data, built from model names. */
export function sandboxE2eGraph(models: {
  root: string
  worker: string
  skepticA: string
  skepticB: string
  harness?: string
}): AgentGraph {
  const harness = models.harness ?? 'pi'
  return {
    nodes: [
      {
        id: 'lead',
        profile: {
          ...profile(
            'lead',
            models.root,
            'Spawn the worker, wait for the skeptics, then answer.',
            'cli-base',
          ),
          tools: { [SPAWN_TOOL]: true },
        },
      },
      {
        id: 'worker',
        profile: profile('worker', models.worker, `Write ${ANSWER} to /work/answer.txt.`, harness),
      },
      {
        id: 'skeptic-a',
        profile: profile('skeptic-a', models.skepticA, 'Try to refute the worker result.', harness),
      },
      {
        id: 'skeptic-b',
        profile: profile('skeptic-b', models.skepticB, 'Try to refute the worker result.', harness),
      },
    ],
    edges: [
      { kind: 'delegates', from: 'lead', to: 'worker', directive: brief, maxTraversals: 1 },
      { kind: 'analyzes', analyst: 'skeptic-a', over: ['worker'], to: 'lead', directive: report },
      { kind: 'analyzes', analyst: 'skeptic-b', over: ['worker'], to: 'lead', directive: report },
    ],
    deliverable: {
      describe: `/work/answer.txt contains ${ANSWER}`,
      check: (out) => out !== undefined,
    },
    budget: { maxIterations: 40, maxTokens: 400_000, maxUsd: 2 },
  }
}

export type SandboxE2eOutcome =
  | { status: 'skipped'; missing: string[] }
  | { status: 'ran'; kind: string }

/** Run the live graph, or skip cleanly when `env` lacks a credential or a model. */
export async function sandboxE2e(env: NodeJS.ProcessEnv = process.env): Promise<SandboxE2eOutcome> {
  const missing = REQUIRED.filter((name) => !env[name])
  if (missing.length > 0) {
    console.log(`sandbox-e2e: skipped, set ${missing.join(', ')} to run it against a real box`)
    return { status: 'skipped', missing: [...missing] }
  }
  const { Sandbox } = await import('@tangle-network/sandbox')
  const sandboxClient = new Sandbox({
    apiKey: env.TANGLE_API_KEY as string,
    baseUrl: env.SANDBOX_BASE_URL as string,
  }) as unknown as SandboxClient
  const validator: SandboxBackend['validator'] = {
    async validate(_output, ctx) {
      const read = ctx.box ? await ctx.box.exec('cat /work/answer.txt') : undefined
      const passed = read?.exitCode === 0 && read.stdout.trim() === ANSWER
      return {
        valid: passed,
        score: passed ? 1 : 0,
        notes: `in-box answer: ${read?.stdout.trim()}`,
      }
    },
  }
  const graph = sandboxE2eGraph({
    root: env.ROOT_MODEL as string,
    worker: env.WORKER_MODEL as string,
    skepticA: env.SKEPTIC_A_MODEL as string,
    skepticB: env.SKEPTIC_B_MODEL as string,
    ...(env.WORKER_HARNESS ? { harness: env.WORKER_HARNESS } : {}),
  })
  const res = await runGraph(graph, {
    runId: `sandbox-e2e-${Date.now()}`,
    backend: { backend: 'sandbox', sandboxClient, validator },
    router: {
      routerBaseUrl: env.ROUTER_URL ?? 'https://router.tangle.tools/v1',
      routerKey: env.TANGLE_API_KEY as string,
    },
  })
  printLedger('sandbox-e2e', res)
  console.log('PER-NODE COST:')
  for (const node of res.result.tree.nodes) {
    const t = node.spent.tokens
    console.log(`  ${node.id} (${node.label}): ${t.input + t.output} tokens, $${node.spent.usd}`)
  }
  const total = res.result.spentTotal
  console.log(`total: ${total.tokens.input + total.tokens.output} tokens, $${total.usd}`)
  console.log(`result.kind: ${res.result.kind}`)
  return { status: 'ran', kind: res.result.kind }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  sandboxE2e().catch((err) => {
    // Only the message: a thrown request or client error can carry headers or config with the key.
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
