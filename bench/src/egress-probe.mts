/**
 * Sandbox->router egress probe (platform ticket #984): spins a box, curls the three
 * reference hosts, then makes one authed chat call to the router from inside the box.
 * Healthy = router 200 + a JSON chat body; the #984 signature = 403 / empty body.
 *   dotenvx run -f ~/company/devops/secrets/.env.keys -f ~/company/devops/secrets/agent-state.env -- npx tsx src/egress-probe.mts
 */
import { Sandbox } from '@tangle-network/sandbox'

const key = process.env.SANDBOX_KEY ?? process.env.TANGLE_API_KEY
if (!key) throw new Error('no SANDBOX_KEY/TANGLE_API_KEY')
const client = new Sandbox({ baseUrl: process.env.SANDBOX_BASE_URL ?? 'https://sandbox.tangle.tools', apiKey: key, timeoutMs: 300_000 } as never)
const box = await client.create({ name: 'egress-probe' } as never)
console.log('sandbox up:', box.id)
try {
  for (const h of ['router.tangle.tools', 'router-hz.tangle.tools', 'api.openai.com', 'id.tangle.tools']) {
    const r = await box.exec(`curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://${h}/ || echo FAIL`)
    console.log(h, '→', JSON.stringify(r).slice(0, 200))
  }
  const rk = process.env.ROUTER_KEY ?? process.env.TANGLE_API_KEY ?? key
  const chat = await box.exec(`curl -s --max-time 30 -X POST https://${process.env.PROBE_ROUTER_HOST ?? 'router.tangle.tools'}/v1/chat/completions -H 'Authorization: Bearer ${rk}' -H 'Content-Type: application/json' -d '{"model":"deepseek-v4-flash","messages":[{"role":"user","content":"say ok"}],"max_tokens":5}' | head -c 300`)
  console.log('chat:', JSON.stringify(chat).slice(0, 400))
} finally {
  await box.delete()
}
