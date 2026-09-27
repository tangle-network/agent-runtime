/**
 * Strategy evolution on the search kernel: an author model writes strategies as code, each
 * one is measured by the counter's own check, and the claim runs once on sealed test tasks.
 *
 *   pnpm build
 *   pnpm tsx examples/strategy-evolution/strategy-evolution.ts [outDir]
 *
 * Offline by default. The worker is the counter's deterministic transport, and each shot runs
 * at most 3 tool turns, so a strategy that keeps one counter across shots reaches targets a
 * fresh counter per shot cannot. The author is a scripted transport that answers with fixed
 * modules, including one the contract lint refuses and one reply with no module, so the run
 * shows every path a real author can take.
 *
 * Set BRIDGE_URL and BRIDGE_BEARER to have a real model write the strategies through
 * cli-bridge (`AUTHOR_MODEL`, default `claude-code/sonnet`), and BRIDGE_CWD to an empty
 * directory on the bridge host. The worker stays offline, so the scores measure the authored
 * strategies exactly.
 *
 * The ledger is the checkpoint: run again with the same outDir and the search continues; a
 * finished search returns its report without running anything.
 */

import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import type { EvaluationClaim } from '@tangle-network/agent-eval/experiment'
import { type AgentProfile, canonicalCandidateDigest } from '@tangle-network/agent-interface'
import {
  defaultAnalystInstruction,
  type EvolutionReport,
  type ExecutorConfig,
  runStrategyEvolution,
  sample,
  strategyAuthorSystemPrompt,
} from '@tangle-network/agent-runtime/kernel'
import {
  counterEnv,
  counterProfile,
  counterTask,
  offlineCounterComplete,
} from '../strategy-suite/counter-env'

/** Targets from 2 to 8, so a strategy limited to one fresh counter per shot tops out early. */
const tasks = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => counterTask(`${prefix}-${i}`, 2 + ((i * 3) % 7)))

export const train = tasks('train', 4)
export const selection = tasks('selection', 12)
export const test = tasks('test', 24)

export const claim: EvaluationClaim = {
  use: 'comparison',
  population: { id: 'counter-targets', description: 'counter tasks with targets from 2 to 8' },
  samplingFrame: 'every generated counter task',
  independentUnit: 'id',
  generalization: 'new-units',
  minimumEffect: 0.1,
}

const module = (name: string, body: string): string =>
  `\`\`\`ts
import { defineStrategy } from '@tangle-network/agent-runtime/kernel'
export default defineStrategy('${name}', async ({ surface, task, budget, shot }) => {
${body}
})
\`\`\``

/** What the scripted author writes, by how many strategies the search has already tried. */
const scripted: readonly string[] = [
  module(
    'one-shot',
    `  const out = await shot()
  const score = out ? out.score : 0
  return { score, resolved: score >= 1, completions: out?.completions ?? 0, progression: out ? [score] : [], shots: out ? 1 : 0 }`,
  ),
  module(
    'carry-forward',
    `  const handle = await surface.open(task)
  const progression: number[] = []
  let messages: Record<string, unknown>[] | undefined
  let completions = 0
  try {
    for (let i = 0; i < budget; i += 1) {
      const out = await shot({ handle, messages })
      if (!out) break
      completions += out.completions
      progression.push(out.score)
      messages = out.messages
      if (out.score >= 1) break
    }
  } finally {
    await surface.close(handle)
  }
  const score = progression.length ? Math.max(...progression) : 0
  return { score, resolved: score >= 1, completions, progression, shots: progression.length }`,
  ),
  `\`\`\`ts
import { readFileSync } from 'node:fs'
import { defineStrategy } from '@tangle-network/agent-runtime/kernel'
export default defineStrategy('peek', async () => ({ score: readFileSync('/dev/null').length, resolved: false, completions: 0, progression: [], shots: 0 }))
\`\`\``,
  'Continue one counter across every shot instead of opening a fresh one.',
  module(
    'carry-forward-steered',
    `  const handle = await surface.open(task)
  const progression: number[] = []
  let messages: Record<string, unknown>[] | undefined
  let completions = 0
  try {
    for (let i = 0; i < budget; i += 1) {
      const steer = i === 0 ? undefined : 'Continue from the current count; do not start over.'
      const out = await shot({ handle, messages, steer })
      if (!out) break
      completions += out.completions
      progression.push(out.score)
      messages = out.messages
      if (out.score >= 1) break
    }
  } finally {
    await surface.close(handle)
  }
  const score = progression.length ? Math.max(...progression) : 0
  return { score, resolved: score >= 1, completions, progression, shots: progression.length }`,
  ),
]

/** The offline author: the scripted reply for the number of strategies tried so far, which
 * the ledger fixes, so a resumed search asks for and gets the same module. */
async function scriptedAuthor(body: Record<string, unknown>): Promise<unknown> {
  const messages = (body.messages ?? []) as Array<{ content?: string }>
  const prompt = messages.map((message) => message.content ?? '').join('\n')
  const tried = /STRATEGIES ALREADY TRIED[^:]*: ([^\n]*)/.exec(prompt)?.[1]?.split(', ') ?? []
  return {
    model: 'scripted-author',
    choices: [
      {
        message: { role: 'assistant', content: scripted[(tried.length - 1) % scripted.length] },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: Math.ceil(prompt.length / 4), completion_tokens: 200, cost: 0.0001 },
  }
}

function author(): { profile: AgentProfile; executor: ExecutorConfig } {
  const bridgeUrl = process.env.BRIDGE_URL
  const bridgeBearer = process.env.BRIDGE_BEARER
  if (bridgeUrl && bridgeBearer) {
    // A cli-bridge model id is `<harness>/<provider>/<model>`, or `<harness>/<model>` when the
    // harness is its own provider, for example `claude-code/sonnet`.
    const [harness, ...rest] = (process.env.AUTHOR_MODEL ?? 'claude-code/sonnet').split('/')
    const provider = rest.length > 1 ? rest.shift()! : harness!
    return {
      profile: {
        name: 'strategy-author',
        harness: harness as AgentProfile['harness'],
        model: { provider, default: rest.join('/') },
        // Additive instructions keep the harness's own system prompt, which some harnesses
        // cannot replace.
        prompt: { instructions: [strategyAuthorSystemPrompt] },
      },
      // The profile writes its instructions into the bridge's working directory and refuses
      // to replace a file already there, such as the CLAUDE.md of the checkout a bridge was
      // started from, so the author runs in an empty directory of its own.
      executor: {
        backend: 'bridge',
        bridgeUrl,
        bridgeBearer,
        ...(process.env.BRIDGE_CWD ? { cwd: process.env.BRIDGE_CWD } : {}),
      },
    }
  }
  return {
    profile: counterProfile('strategy-author', 'scripted-author', {
      systemPrompt: strategyAuthorSystemPrompt,
    }),
    executor: {
      backend: 'router',
      routerBaseUrl: 'https://router.tangle.tools/v1',
      routerKey: 'offline',
      complete: scriptedAuthor,
    },
  }
}

export async function runStrategyEvolutionExample(outDir: string): Promise<EvolutionReport> {
  return runStrategyEvolution({
    environment: counterEnv,
    train,
    selection,
    test,
    claim,
    executionRef: canonicalCandidateDigest({
      environment: 'examples/strategy-suite/counter-env',
      worker: 'offlineCounterComplete',
      author: process.env.BRIDGE_URL ? 'cli-bridge' : 'scriptedAuthor',
    }),
    worker: {
      routerBaseUrl: 'https://router.tangle.tools/v1',
      routerKey: 'offline',
      workerProfile: counterProfile('counter-worker', 'offline-counter', {
        maxTurns: 3,
        tools: true,
      }),
      analystProfile: counterProfile('counter-analyst', 'offline-counter', {
        systemPrompt: defaultAnalystInstruction,
      }),
      complete: offlineCounterComplete,
    },
    author: author(),
    root: sample,
    budget: 2,
    maxExpansions: Number(process.env.EXPANSIONS ?? 5),
    concurrency: 4,
    maxUsd: 1,
    cellUsd: 0.001,
    outDir,
  })
}

async function main(): Promise<void> {
  const outDir = process.argv[2] ?? mkdtempSync(join(process.cwd(), '.evolution-'))
  const report = await runStrategyEvolutionExample(outDir)
  console.log(`ledger: ${report.ledger}`)
  for (const strategy of report.strategies) {
    const estimate = strategy.selection
    const delta =
      estimate?.delta == null
        ? ''
        : ` selection Δ ${estimate.delta >= 0 ? '+' : ''}${estimate.delta.toFixed(3)} on ${estimate.pairs} tasks`
    console.log(
      `  ${strategy.name.padEnd(24)} ${String(strategy.status).padEnd(9)} parent ${strategy.parent ?? '-'}${delta}${strategy.refusal ? ` refused: ${strategy.refusal}` : ''}`,
    )
  }
  const shipped = report.claim.finalists.find((f) => f.nodeId === report.claim.selected)?.test
  console.log(`claim: ${report.claim.decision} (${report.claim.reason})`)
  if (shipped) {
    console.log(
      `test lift ${shipped.delta.toFixed(3)} [${shipped.interval[0].toFixed(3)}, ${shipped.interval[1].toFixed(3)}] on ${shipped.pairs} tasks`,
    )
  }
  console.log(`decision: ${report.decision} (${report.reason}); kept ${report.selected.name}`)
  const { spend } = report
  const unknown = spend.unknownCostCells + spend.unknownCostOperations
  console.log(
    `spend: $${spend.knownUsd.toFixed(4)} known${unknown > 0 ? `, ${unknown} unknown (floor $${spend.floorUsd.toFixed(4)})` : ''}`,
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
