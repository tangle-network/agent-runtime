/**
 * Smoke: our @tangle-network/sandbox SDK → staging-sandbox.tangle.tools → a
 * coding-agent backend with a Sandbox-managed model. Validates the worker path
 * (and exercises staging provisioning/autoscaling) before building the SWE-bench
 * worker on top. One sandbox, one trivial coding task, then delete.
 */
import { Sandbox } from '@tangle-network/sandbox'

const KEY = process.env.SANDBOX_KEY ?? process.env.TANGLE_API_KEY
if (!KEY) throw new Error('SANDBOX_KEY or TANGLE_API_KEY required (sk-tan- key)')
const BASE = process.env.SANDBOX_BASE_URL ?? 'https://staging-sandbox.tangle.tools'
const MODEL = process.env.SANDBOX_MODEL ?? 'zai/glm-4.7'
const EXPECTED = 'provider-git-from-staging'

const client = new Sandbox({ baseUrl: BASE, apiKey: KEY })
console.log(`creating sandbox on ${BASE} (backend=opencode model=${MODEL})…`)

let box
try {
  box = await client.create({
    environment: 'universal',
    backend: {
      type: 'opencode',
      model: {
        provider: 'openai-compat',
        model: MODEL,
      },
    },
  })
  console.log(`✅ sandbox created: id=${box.id ?? '(no id)'}`)

  console.log('→ streamPrompt (trivial git task)…')
  let lastText = ''
  let sawTerminal = false
  let sawExpected = false
  let errorMessage = ''
  for await (const ev of box.streamPrompt(
    `In a fresh temp dir, run: \`git init -q && echo ${EXPECTED} > f.txt && git add f.txt && git diff --cached\`. Then report the exact diff you saw.`,
    { timeoutMs: 120000 },
  )) {
    const data = ev?.data
    const t = ev?.type
    const preview = typeof data === 'string' ? data : JSON.stringify(data)
    if (preview && preview.length > 2) lastText = preview
    if (preview?.includes(EXPECTED) || preview?.includes('diff --git')) sawExpected = true
    if (t === 'done' || t === 'result' || t === 'completed' || t === 'execution.completed') {
      sawTerminal = true
    }
    if (t === 'error') {
      errorMessage = preview ?? 'sandbox emitted error event'
    }
    console.log(`   [${t}] ${preview ? preview.slice(0, 160) : ''}`)
  }
  if (errorMessage) throw new Error(errorMessage)
  if (!sawTerminal) throw new Error('stream ended without a terminal done/result event')
  if (!sawExpected) throw new Error(`stream ended without expected git diff text '${EXPECTED}'`)
  console.log(`\n✅ agent completed real git task. last: ${lastText.slice(0, 200)}`)
} catch (err) {
  console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
} finally {
  if (box) {
    try {
      if (typeof box.delete === 'function') await box.delete()
      else if (typeof client.delete === 'function') await client.delete(box.id)
      console.log('🧹 sandbox deleted')
    } catch (e) {
      console.log(`(cleanup: ${e instanceof Error ? e.message : String(e)})`)
    }
  }
}
