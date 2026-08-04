/** Single-shot lower-bound solver for trata-hedge-bench. */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { runBenchRouterTurn } from './router-turn'

const environment = process.argv[2]
if (!environment) throw new Error('usage: solve.mts <env-dir> [out.txt]')
const output = process.argv[3] ?? '/tmp/thb-answer.txt'
const model = process.env.WORKER_MODEL
if (!model) throw new Error('WORKER_MODEL is required')
const dataBudget = Number(process.env.DATA_BUDGET ?? 160_000)
const maxTokens = Number(process.env.MAX_TOKENS ?? 6_000)
const temperature = Number(process.env.TEMPERATURE ?? 0.5)
const routerKey = process.env.TANGLE_API_KEY
if (!routerKey) throw new Error('TANGLE_API_KEY is required')
const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'

for (const [name, value] of [
  ['DATA_BUDGET', dataBudget],
  ['MAX_TOKENS', maxTokens],
] as const) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
}
if (!Number.isFinite(temperature)) throw new Error('TEMPERATURE must be finite')

const root = resolve(environment)
const dataDir = join(root, 'environment', 'data')
const instruction = readFileSync(join(root, 'instruction.md'), 'utf8')

function filesUnder(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? filesUnder(path) : [path]
    })
}

function rank(path: string): number {
  if (path.includes('earnings_call')) return 0
  if (path.includes('financials')) return 1
  if (path.includes('company_profiles')) return 2
  if (path.includes('press_releases')) return 3
  return 4
}

let used = 0
const blocks: string[] = []
const files = filesUnder(dataDir).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
for (const path of files) {
  const content = readFileSync(path, 'utf8')
  if (used + content.length > dataBudget) continue
  used += content.length
  blocks.push(`\n=== FILE: data/${relative(dataDir, path)} ===\n${content}`)
}
process.stderr.write(`[solve] ${blocks.length}/${files.length} files in context (${used} chars)\n`)

const prompt =
  '--- AVAILABLE DATA (cite files by their `data/<path>` name inline) ---\n' +
  blocks.join('') +
  '\n\n--- END DATA ---\nWrite ONLY the full analysis (no preamble). Inline-cite every claim with its `data/<path>`.'

const result = await runBenchRouterTurn(
  {
    routerBaseUrl,
    routerKey,
    profile: {
      name: 'trata-hedge-solver',
      harness: 'cli-base',
      model: {
        provider: 'tangle-router',
        default: model,
        metadata: { temperature, maxTokens },
      },
      prompt: { systemPrompt: instruction },
    },
  },
  prompt,
)
writeFileSync(output, result.finalText)
process.stderr.write(`[solve] wrote ${result.finalText.length} chars -> ${output} (model=${model})\n`)
