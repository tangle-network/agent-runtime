/**
 * Settle the session-context confound: resources.* may materialize into the TASK's session
 * workspace, which a bare box.exec (no sessionId) does NOT see (SDK ExecOptions docs). The agent
 * runs IN the session, so ask the IN-SESSION agent to cat the exact mounted path. This is the
 * definitive view: if the agent sees it, resources work (bare-exec was the wrong FS view); if the
 * in-session agent ALSO can't see it, resources.* is genuinely a no-op via client.create.
 *
 * Run: dotenvx run -f ~/company/devops/secrets/.env.keys -- pnpm exec tsx bench/src/skill-session-view-check.mts
 */
import { Sandbox, defineInlineResource } from '@tangle-network/sandbox'

const must = (k: string): string => { const v = process.env[k]; if (!v) throw new Error(`env ${k} required`); return v }

const probe = 'zzzprobe'
const marker = 'PROBE-BODY-8842'
const skillMd = ['---', `name: ${probe}`, 'description: probe.', '---', '', marker].join('\n')
const ref = defineInlineResource(probe, skillMd)
// opencode's native skill discovery dir is ~/.opencode/skill/<name>/SKILL.md (singular
// "skill"); resources.skills materializes here, visible only in the agent's SESSION view.
const filePath = `/home/agent/.opencode/skill/${probe}/SKILL.md`

async function main(): Promise<void> {
  const client = new Sandbox({ baseUrl: process.env.SANDBOX_BASE_URL ?? 'https://sandbox.tangle.tools', apiKey: must('TANGLE_API_KEY'), timeoutMs: 600_000 } as never)
  console.error('[session] box with BOTH resources.skills AND resources.files…')
  const box = (await client.create({
    backend: {
      type: 'opencode',
      model: { provider: process.env.WORKER_PROVIDER ?? 'openai', model: process.env.WORKER_MODEL ?? 'gpt-4.1', baseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1' },
      profile: { name: 'session-view', resources: { skills: [ref] } },
    },
  } as never)) as Record<string, (...a: never[]) => unknown> & { id?: string }
  await box.waitFor('running' as never, { timeoutMs: 180_000 } as never)
  console.error('[session] running; asking the IN-SESSION agent to cat the exact mounted path…')

  const prompt =
    `First, what skills do you have available to you? List them.\n` +
    `Then run exactly this and paste the raw output:\n` +
    `\`cat ${filePath} 2>&1; echo "==="; find / -name SKILL.md 2>/dev/null | grep -vi nix | grep -i ${probe} || echo "PROBE-ABSENT"\``
  let out = ''
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 220_000)
  try {
    for await (const ev of box.streamPrompt(prompt as never, { signal: ac.signal } as never) as AsyncGenerator<unknown>) {
      out += (typeof ev === 'string' ? ev : JSON.stringify(ev)) + '\n'
    }
  } finally { clearTimeout(timer) }
  console.error('[session] tail:\n' + out.slice(-2000))
  try { await box.delete?.() } catch { /* best-effort */ }

  const sawBody = out.includes(marker)
  const sawAbsent = out.includes('PROBE-ABSENT')
  console.error(`\n[session] marker(${marker}) seen in-session: ${sawBody} | PROBE-ABSENT seen: ${sawAbsent}`)
  console.error(`[session] VERDICT: ${sawBody ? 'PASS — resources materialized into the SESSION workspace (bare-exec was the wrong view)' : 'FAIL — even the in-session agent cannot see the resource; resources.* is a no-op via client.create'}`)
  process.exit(sawBody ? 0 : 2)
}
main().catch((e) => { console.error('[session] FAILED:', e instanceof Error ? (e.stack ?? e.message) : e); process.exit(1) })
