/**
 * Proof that a SKILL.md from an AgentProfile actually lands on disk inside the sandbox where
 * the coding harness (opencode) loads it — the "are we on the right surface" check before any
 * benchmark. Creates one opencode box with resources.skills=[reproduce-first], then execs the
 * box to find the materialized SKILL.md. No model call needed: skills materialize before boot.
 *
 * Run: dotenvx run -f ~/company/devops/secrets/.env.keys -- npx tsx src/skill-sandbox-smoke.mts
 */
import { Sandbox, defineInlineResource } from '@tangle-network/sandbox'

const must = (k: string): string => {
  const v = process.env[k]
  if (!v) throw new Error(`env ${k} required`)
  return v
}

const skillMd = [
  '---',
  'name: reproduce-first',
  'description: Reproduce the failing test before changing any code.',
  '---',
  '',
  'When fixing a bug: run the failing test FIRST to observe the real error, make the smallest',
  'change that turns it green, then re-run to confirm.',
].join('\n')

async function main(): Promise<void> {
  const client = new Sandbox({
    baseUrl: process.env.SANDBOX_BASE_URL ?? 'https://sandbox.tangle.tools',
    apiKey: must('TANGLE_API_KEY'),
    timeoutMs: 600_000,
  } as never)

  console.error('[smoke] creating opencode box with resources.skills=[reproduce-first]…')
  const box: Record<string, (...a: never[]) => unknown> & { id?: string } = (await client.create({
    backend: {
      type: 'opencode',
      model: {
        provider: process.env.WORKER_PROVIDER ?? 'openai',
        model: process.env.WORKER_MODEL ?? 'gpt-4.1',
        baseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1',
      },
      profile: { name: 'skill-smoke', resources: { skills: [defineInlineResource('reproduce-first', skillMd)] } },
    },
  } as never)) as never
  console.error('[smoke] box id:', box.id, '— waiting for running…')
  await box.waitFor('running' as never, { timeoutMs: 180_000 } as never)
  console.error('[smoke] box running; asking the IN-BOX agent to report its skills (streamPrompt/SSE — the bench path)…')

  const prompt =
    'Run this exact shell command and paste its full output verbatim:\n' +
    '`ls -la ~/.claude/skills ~/.config/opencode/skills 2>/dev/null; echo "--FIND--"; find / -name SKILL.md 2>/dev/null | head -20; echo DONE`\n' +
    'Then tell me the names of the skills available to you.'
  let out = ''
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 220_000)
  try {
    for await (const ev of box.streamPrompt(prompt as never, { signal: ac.signal } as never) as AsyncGenerator<unknown>) {
      out += (typeof ev === 'string' ? ev : JSON.stringify(ev)) + '\n'
    }
  } finally {
    clearTimeout(timer)
  }
  console.error(`[smoke] stream chars: ${out.length}`)
  console.error('[smoke] tail of stream:\n' + out.slice(-1500))

  try {
    await box.delete?.()
  } catch {
    /* best-effort cleanup */
  }
  const landed = /reproduce-first/i.test(out) && /SKILL\.md/i.test(out)
  console.error(`\n[smoke] VERDICT: ${landed ? 'PASS — skill materialized on disk in the box (right surface)' : 'FAIL — skill NOT found on disk; check the resources.skills path/shape'}`)
  process.exit(landed ? 0 : 2)
}

main().catch((e) => {
  console.error('[smoke] FAILED:', e instanceof Error ? (e.stack ?? e.message) : e)
  process.exit(1)
})
