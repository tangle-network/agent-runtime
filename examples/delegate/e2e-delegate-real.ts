/**
 * REAL e2e proof that `delegate(intent)` replaces a hardcoded coder: a router-brained supervisor
 * AUTHORS + spawns a worker (no baked-in coder profile), the worker does real filesystem work via a
 * granted `write_file` tool, and the deliverable gate settles ONLY when the file actually exists on
 * disk. `result.spentTotal` carries the real conserved cost (tokens + usd) — the channel delegate_code
 * lacks. Proves on BOTH paths: a winner carries the worker's spend; a no-winner carries the spend
 * incurred before it failed.
 *
 * Run: TANGLE_API_KEY=<router key> pnpm tsx examples/delegate/e2e-delegate-real.ts
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { delegate, type ExecutorConfig } from '../../dist/loops.js'

const routerBaseUrl = process.env.TANGLE_ROUTER_URL ?? 'https://router.tangle.tools/v1'
const routerKey = process.env.TANGLE_API_KEY
if (!routerKey) throw new Error('set TANGLE_API_KEY (your Tangle router key)')
// Two distinct roles: the WORKER does the filesystem task (cheap model is fine); the supervisor
// BRAIN must reliably tool-call `spawn_agent` / `await_event`, so it defaults to a stronger
// delegator model. Override either with WORKER_MODEL / BRAIN_MODEL (or MODEL for both).
const model = process.env.MODEL ?? process.env.WORKER_MODEL ?? 'deepseek-v4-flash'
const brainModel = process.env.MODEL ?? process.env.BRAIN_MODEL ?? model

// An isolated scratch dir so the deliverable check reads ground truth, not the model's claim.
const workDir = mkdtempSync(join(tmpdir(), 'delegate-e2e-'))
const target = 'out.txt'
const targetAbs = join(workDir, target)

// The WORKER's granted tool: a real filesystem write, sandboxed to workDir. The supervisor authors
// the worker profile and decides to call this; the implementation lives here (the backend host).
const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'write_file',
      description: 'Write text content to a file path (relative to the working directory).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path, e.g. out.txt' },
          content: { type: 'string', description: 'The exact text to write' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
  },
]

async function writeFileTool(args: Record<string, unknown>): Promise<string> {
  const rel = String(args.path ?? '')
  const content = String(args.content ?? '')
  // Confine to workDir — never escape the scratch dir.
  const abs = resolve(workDir, rel)
  if (!abs.startsWith(resolve(workDir))) return `error: path escapes the working directory`
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content, 'utf8')
  return `wrote ${content.length} bytes to ${rel}`
}

const backend: ExecutorConfig = {
  backend: 'router-tools',
  routerBaseUrl,
  routerKey,
  model,
  tools,
  executeToolCall: async (name, args) => {
    if (name === 'write_file') return writeFileTool(args)
    return `unknown tool ${name}`
  },
  maxTurns: 8,
}

const result = await delegate(
  `Create a file named ${target} containing exactly the word hello (lowercase, no quotes). ` +
    `Call the write_file tool exactly once with path="${target}" and content="hello", then reply ` +
    `with the single word DONE and STOP — do not call any more tools after the file is written.`,
  {
    backend,
    router: { routerBaseUrl, routerKey, model: brainModel },
    model: brainModel,
    // The deployable completion oracle: settle ONLY when the file actually exists with the right
    // content. This reads disk — ground truth — never the worker judging itself.
    deliverable: {
      check: () => existsSync(targetAbs) && readFileSync(targetAbs, 'utf8').trim() === 'hello',
      describe: `file ${target} exists and contains "hello"`,
    },
    // A real budget — enough for the supervisor to author+spawn a worker and the worker to finish.
    budget: { maxIterations: 40, maxTokens: 200_000, maxUsd: 0.5 },
  },
)

const fileExists = existsSync(targetAbs)
const fileContent = fileExists ? readFileSync(targetAbs, 'utf8') : '<missing>'

console.log('=== delegate() REAL e2e ===')
console.log('brain / worker  :', brainModel, '/', model)
console.log('result.kind     :', result.kind)
console.log('file exists     :', fileExists, '@', targetAbs)
console.log('file content    :', JSON.stringify(fileContent))
console.log('spentTotal      :', JSON.stringify(result.spentTotal))
if (result.kind === 'winner') {
  console.log('winner.outRef   :', result.outRef)
  console.log('worker out (text):', JSON.stringify(String(result.out).slice(0, 200)))
}
if (result.kind === 'no-winner') {
  console.log('no-winner reason:', result.reason, '| downCount:', result.downCount)
  // Surface each child node's terminal status + its own spend so a transient infra flake is
  // distinguishable from a real failure to deliver.
  for (const n of result.tree.nodes) {
    console.log('  node:', JSON.stringify({ id: n.id, status: n.status, spent: n.spent }))
  }
}

// The proof gates: file met by the WORKER, real cost rode through, supervisor authored (not hardcoded).
const tokensReal = result.spentTotal.tokens.input + result.spentTotal.tokens.output > 0
const costRodeThrough = result.spentTotal.usd > 0 || tokensReal
const delivered = result.kind === 'winner' && fileExists && fileContent.trim() === 'hello'

console.log('--- gates ---')
console.log('PROOF worker completed the task (file delivered):', delivered)
console.log('PROOF cost rode through (real tokens/usd)       :', costRodeThrough)
if (!delivered || !costRodeThrough) {
  console.error('E2E FAILED: deliverable not met or cost did not ride through')
  process.exit(1)
}
console.log('E2E PASSED')
