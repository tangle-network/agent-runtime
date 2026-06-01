/**
 * Smoke: our @tangle-network/sandbox SDK → staging-sandbox.tangle.tools → a
 * coding-agent backend → a model call via the router. Validates the worker path
 * (and exercises staging provisioning/autoscaling) before building the SWE-bench
 * worker on top. One sandbox, one trivial coding task, then delete.
 */
import { Sandbox } from '@tangle-network/sandbox'

const KEY = process.env.SANDBOX_KEY
if (!KEY) throw new Error('SANDBOX_KEY required (sk-tan- sandbox-scoped key)')
const BASE = process.env.SANDBOX_BASE_URL ?? 'https://staging-sandbox.tangle.tools'
const MODEL = process.env.SANDBOX_MODEL ?? 'claude-haiku-4-5-20251001'

const client = new Sandbox({ baseUrl: BASE, apiKey: KEY })
console.log(`creating sandbox on ${BASE} (backend=opencode model=${MODEL})…`)

let box
try {
  box = await client.create({
    environment: 'universal',
    backend: {
      type: 'opencode',
      model: {
        provider: 'openai', // router is OpenAI-compatible at /v1
        model: MODEL,
        baseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1',
        apiKey: process.env.ROUTER_KEY,
      },
    },
  })
  console.log(`✅ sandbox created: id=${box.id ?? '(no id)'}`)

  console.log('→ streamPrompt (trivial git task)…')
  let lastText = ''
  for await (const ev of box.streamPrompt(
    'In a fresh temp dir, run: `git init -q && echo hello-from-staging > f.txt && git add f.txt && git diff --cached`. Then report the exact diff you saw.',
    {},
  )) {
    const data = ev?.data
    const t = ev?.type
    const preview = typeof data === 'string' ? data : JSON.stringify(data)
    if (preview && preview.length > 2) lastText = preview
    console.log(`   [${t}] ${preview ? preview.slice(0, 160) : ''}`)
  }
  console.log(`\n✅ agent responded (model call via router worked). last: ${lastText.slice(0, 200)}`)
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
