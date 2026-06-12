/**
 * Sandbox->router egress probe: spins a box and makes one authed chat call to
 * https://router.tangle.tools/v1 using the BOX-PROVISIONED key (OPENCODE_MODEL_API_KEY
 * inside the box). That is the sanctioned flow: the egress proxy validates/injects
 * credentials at the boundary and 403s foreign keys passed in from outside — a raw
 * external key in this probe would report a false "blocked".
 *   dotenvx run -f ~/company/devops/secrets/.env.keys -f ~/company/devops/secrets/agent-state.env -- npx tsx src/egress-probe.mts
 */
import { Sandbox } from '@tangle-network/sandbox'

const key = process.env.SANDBOX_KEY ?? process.env.TANGLE_API_KEY
if (!key) throw new Error('no SANDBOX_KEY/TANGLE_API_KEY')
const client = new Sandbox({ baseUrl: process.env.SANDBOX_BASE_URL ?? 'https://sandbox.tangle.tools', apiKey: key, timeoutMs: 300_000 } as never)
const box = await client.create({ name: 'egress-probe' } as never)
console.log('sandbox up:', box.id)
const out = (r: unknown) => ((r as { stdout?: string }).stdout ?? '').trim()
try {
  for (const h of ['router.tangle.tools', 'id.tangle.tools']) {
    const r = await box.exec(`curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://${h}/ || echo FAIL`)
    console.log(h, '→', out(r))
  }
  const chat = await box.exec(`curl -s --max-time 30 -X POST https://router.tangle.tools/v1/chat/completions -H "Authorization: Bearer $OPENCODE_MODEL_API_KEY" -H 'Content-Type: application/json' -d '{"model":"deepseek-v4-flash","messages":[{"role":"user","content":"say ok"}],"max_tokens":5}' -o /tmp/b -w '%{http_code}'; echo ' |'; head -c 250 /tmp/b`)
  console.log('chat (box-provisioned key):', out(chat) || 'EMPTY — egress broken')
} finally {
  await box.delete()
}
