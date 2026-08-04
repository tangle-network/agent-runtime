/**
 * Minimal HumanEval evaluator: given an INSTRUCTION (env) + a fixed task set, run the
 * worker model on each task and print the pass rate + the per-task result. Used to
 * measure a baseline instruction vs a proposer-supplied instruction on the SAME
 * held-out set (the proposer proposes; this grades — kept separate for honesty).
 *
 *   INSTRUCTION="..." IDS=HumanEval/55,... WORKER_MODEL=... ROUTER_BASE=... TANGLE_API_KEY=... \
 *     HUMANEVAL_GZ=/abs/HumanEval.jsonl.gz tsx src/hev-eval.mts
 */
import { readFileSync } from 'node:fs'
import { extractCode, loadHumanEval, runChecker, type HumanEvalTask } from './benchmarks/humaneval'
import { runBenchRouterTurn } from './router-turn'

const SEED_INSTRUCTION =
  'Complete the following Python function. Output the COMPLETE function definition (signature, docstring optional, body) inside a single ```python code block. Include any imports the function needs. Do not write tests or example calls.'

async function complete(
  base: string,
  key: string,
  model: string,
  instruction: string,
  prompt: string,
  maxTokens: number,
): Promise<string> {
  try {
    const turn = await runBenchRouterTurn(
      {
        routerBaseUrl: base,
        routerKey: key,
        profile: {
          name: 'humaneval-worker',
          harness: 'cli-base',
          model: {
            provider: 'tangle-router',
            default: model,
            metadata: { temperature: 0.2, maxTokens },
          },
          prompt: { systemPrompt: instruction },
        },
      },
      prompt,
    )
    return turn.finalText
  } catch {
    return ''
  }
}

async function main(): Promise<void> {
  const key = process.env.TANGLE_API_KEY
  if (!key) throw new Error('TANGLE_API_KEY required')
  const apiKey: string = key
  const base = process.env.ROUTER_BASE ?? 'https://api.together.xyz/v1'
  const model = process.env.WORKER_MODEL ?? 'meta-llama/Meta-Llama-3-8B-Instruct-Lite'
  const instruction = process.env.INSTRUCTION_FILE
    ? readFileSync(process.env.INSTRUCTION_FILE, 'utf8')
    : (process.env.INSTRUCTION ?? SEED_INSTRUCTION)
  const maxTokens = Number(process.env.MAX_TOKENS ?? 2500)
  const conc = Number(process.env.CONC ?? 6)
  const offset = Number(process.env.OFFSET ?? 55)
  const n = Number(process.env.N ?? 40)
  const idsEnv = (process.env.IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)

  const all = await loadHumanEval(164, 0)
  const byId = new Map(all.map((t) => [t.taskId, t]))
  const tasks: HumanEvalTask[] = idsEnv.length
    ? idsEnv.map((id) => byId.get(id)).filter((t): t is HumanEvalTask => !!t)
    : all.slice(offset, offset + n)

  console.log(`eval model=${model} n=${tasks.length} instr_len=${instruction.length}`)
  let pass = 0
  const fails: string[] = []
  // simple concurrency pool
  let i = 0
  async function worker(): Promise<void> {
    while (i < tasks.length) {
      const t = tasks[i]
      i += 1
      if (!t) continue
      const reply = await complete(
        base,
        apiKey,
        model,
        instruction,
        `\`\`\`python\n${t.prompt}\`\`\``,
        maxTokens,
      )
      const { pass: p } = await runChecker(t, extractCode(reply))
      if (p === 1) pass += 1
      else fails.push(t.taskId)
    }
  }
  await Promise.all(Array.from({ length: conc }, () => worker()))
  console.log(`PASS ${pass}/${tasks.length} = ${((100 * pass) / tasks.length).toFixed(1)}%`)
  console.log(`FAILED: ${fails.sort().join(', ')}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
