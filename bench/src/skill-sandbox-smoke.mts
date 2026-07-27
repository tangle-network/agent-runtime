/**
 * Proof that a SKILL.md from an AgentProfile actually materializes inside the sandbox where the
 * coding harness loads it — the "are we on the right surface" check before any benchmark.
 * Creates one opencode box with resources.skills, then asks the IN-SESSION agent to read the
 * skill back. PASS keys on a UNIQUE MARKER in the skill body, so a hit is unambiguously OUR
 * skill — not opencode's bundled /nix/store skills and not the agent's prose.
 *
 * Two gotchas this guards against (both produced false readings during bring-up):
 *   1. PATH: opencode's discovery dir is ~/.opencode/skill/<name>/SKILL.md (SINGULAR "skill");
 *      claude-code uses ~/.claude/skills/. resources.skills lands in the backend's own dir.
 *   2. VIEW: a bare box.exec() WITHOUT a sessionId sees a DIFFERENT filesystem than the agent
 *      session (SDK ExecOptions docs). So we verify through the in-SESSION agent (streamPrompt),
 *      the path the bench actually runs — not a detached exec.
 *
 * Run: dotenvx run -f ~/company/devops/secrets/.env.keys -- pnpm exec tsx bench/src/skill-sandbox-smoke.mts
 */
import { defineInlineResource } from '@tangle-network/agent-interface'
import { Sandbox } from '@tangle-network/sandbox'

const must = (k: string): string => {
  const v = process.env[k]
  if (!v) throw new Error(`env ${k} required`)
  return v
}

const skillName = 'reproduce-first'
// A unique token that cannot occur in opencode's bundled skills or in plausible prose.
const marker = 'SKILLMAT-OK-7f3c91'
const skillMd = [
  '---',
  `name: ${skillName}`,
  'description: Reproduce the failing test before changing any code.',
  '---',
  '',
  `Materialization proof token: ${marker}`,
  'When fixing a bug: run the failing test FIRST to observe the real error, make the smallest',
  'change that turns it green, then re-run to confirm.',
].join('\n')

async function main(): Promise<void> {
  const client = new Sandbox({
    baseUrl: process.env.SANDBOX_BASE_URL ?? 'https://sandbox.tangle.tools',
    apiKey: must('TANGLE_API_KEY'),
    timeoutMs: 600_000,
  } as never)

  console.error(`[smoke] creating opencode box with resources.skills=[${skillName}]…`)
  const box: Record<string, (...a: never[]) => unknown> & { id?: string } = (await client.create({
    backend: {
      type: 'opencode',
      model: {
        provider: process.env.WORKER_PROVIDER ?? 'openai',
        model: process.env.WORKER_MODEL ?? 'deepseek-v4-flash',
        baseUrl: process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1',
      },
      profile: { name: 'skill-smoke', resources: { skills: [defineInlineResource(skillName, skillMd)] } },
    },
  } as never)) as never
  console.error('[smoke] box id:', box.id, '— waiting for running…')
  await box.waitFor('running' as never, { timeoutMs: 180_000 } as never)
  console.error('[smoke] box running; asking the IN-SESSION agent to read the materialized skill back…')

  // cat the skill at BOTH backend discovery dirs (opencode singular, claude-code plural) + a
  // name-scoped find; the marker appears wherever resources.skills actually landed it.
  const prompt =
    'Run this exact shell command and paste its raw output verbatim, nothing else:\n' +
    `\`cat ~/.opencode/skill/${skillName}/SKILL.md ~/.claude/skills/${skillName}/SKILL.md 2>/dev/null; ` +
    `echo "--FIND--"; find / -name SKILL.md 2>/dev/null | grep -i ${skillName} | grep -vi /nix/store || echo NOFILE\``
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

  // Deterministic: PASS only if the agent read OUR unique marker out of the file — not a loose
  // match on the skill name (which appears in the prompt/prose) or on "SKILL.md" (bundled skills).
  const landed = out.includes(marker)
  const path = /\.opencode\/skill\//.test(out) ? '~/.opencode/skill (opencode)' : /\.claude\/skills\//.test(out) ? '~/.claude/skills (claude-code)' : '(path not surfaced)'
  console.error(
    `\n[smoke] VERDICT: ${landed ? `PASS — resources.skills materialized + the in-session agent read the marker at ${path}` : 'FAIL — marker NOT read back; resources.skills did not land where the harness reads (check backend discovery dir)'}`,
  )
  process.exit(landed ? 0 : 2)
}

main().catch((e) => {
  console.error('[smoke] FAILED:', e instanceof Error ? (e.stack ?? e.message) : e)
  process.exit(1)
})
