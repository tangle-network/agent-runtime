/**
 * generate-eval — author → certify → repair, through the REAL kernel.
 *
 * This is `runLoop` end-to-end, not a hand-rolled retry loop:
 *   - executor  = a bridge-backed `SandboxClient` (mirrors router-executor.ts:
 *                 one cli-bridge chat per `streamPrompt`, terminal `{finalText}`)
 *   - validator = the eval CERTIFIER (grounding + discrimination gates re-run
 *                 from scratch; the model is never trusted)
 *   - steer     = the kernel's own across-round repair: the certifier's gate
 *                 diagnostics ride `verdict.notes` and the arm splices them
 *                 into the next round's prompt
 *   - stop      = the arm shell's valid-or-budget (admission ends the loop)
 *
 * Admission is guaranteed-sound (only machine-certified evals are written);
 * production is budget-bounded (MAX_ATTEMPTS rounds); exhaustion is recorded
 * loudly, never silently admitted.
 *
 * Run:
 *   export BRIDGE_BEARER=…   # keep it off the argv (failure echoes print argv)
 *   dotenvx run … -- env TARGET="zod@4 (v4 API changes vs v3)" \
 *     MODEL=claude-code/sonnet MAX_ATTEMPTS=4 OUT=/tmp/minted-evals.jsonl \
 *     pnpm exec tsx src/generate-eval/run.mts
 */
import { appendFileSync, readFileSync } from 'node:fs'
import {
  createDriver,
  createExecutor,
  type DefaultVerdict,
  inlineSandboxClient,
  runLoop,
  type Validator,
} from '@tangle-network/agent-runtime/loops'
import { answerOutput, arm, type Steer } from '../experiment'
import { certifyEval, type GateDiagnostics } from './certify'
import { type GeneratedEval, parseCandidate } from './schema'

const skillPath = new URL('../../../skills/generate-eval/SKILL.md', import.meta.url).pathname

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback
  if (v === undefined) throw new Error(`missing env ${name}`)
  return v
}

// ── validator: the certifier, with gate diagnostics on `verdict.notes` ───────
/** The only fenced ```json block in the answer = the candidate. */
function extractJsonBlock(answer: string): string {
  const blocks = [...answer.matchAll(/```json\s*([\s\S]*?)```/g)].map((m) => m[1].trim())
  if (blocks.length === 0) throw new Error('no ```json block in the answer')
  if (blocks.length > 1) throw new Error(`expected exactly one \`\`\`json block, got ${blocks.length}`)
  return blocks[0]
}

function repairFromGates(v: GateDiagnostics): string {
  return [
    `grounding gate: ${v.grounding.passed ? 'PASSED' : 'FAILED'} — ${v.grounding.detail}`,
    `discrimination gate: ${v.discrimination.passed ? 'PASSED' : 'FAILED'} — ${v.discrimination.detail}`,
  ].join('\n')
}

function certifierValidator(minted: GeneratedEval[]): Validator<string> {
  return {
    async validate(answer) {
      let candidate: GeneratedEval
      try {
        candidate = parseCandidate(extractJsonBlock(answer))
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err)
        console.error(`  round verdict: UNUSABLE — ${why}`)
        return { valid: false, score: 0, notes: `unusable output: ${why}. Re-read the schema; emit exactly one valid \`\`\`json candidate.` }
      }
      console.error(`  candidate ${candidate.id} → certifying…`)
      const verdict = await certifyEval(candidate, { keepWorkspaceOnFailure: false })
      console.error(`  ${verdict.admitted ? '✅ ADMITTED' : '❌ rejected'} ${candidate.id}\n${repairFromGates(verdict).split('\n').map((l) => `    ${l}`).join('\n')}`)
      if (verdict.admitted && verdict.certification) {
        minted.push({ ...candidate, certification: verdict.certification })
      }
      return { valid: verdict.admitted, score: verdict.admitted ? 1 : 0, notes: repairFromGates(verdict) }
    },
  }
}

// ── steer: kernel-native repair from the prior verdict's notes ───────────────
const authorSteer: Steer = (rootPrompt, history) => {
  const last = history.at(-1)
  const notes = (last?.verdict as DefaultVerdict | undefined)?.notes
  if (!notes) return rootPrompt
  return `${rootPrompt}\n\n=== CERTIFIER FEEDBACK ON YOUR PREVIOUS CANDIDATE (repair and re-emit) ===\n${notes}`
}

function buildRootPrompt(target: string): string {
  // Strip registry frontmatter and lead with prose — several harness CLIs take
  // the message as a positional arg, where a leading `-` parses as a flag.
  const skill = readFileSync(skillPath, 'utf-8').replace(/^---[\s\S]*?\n---\n/, '')
  return [
    'You are executing the generate-eval skill below. Follow it exactly.',
    '',
    skill,
    '',
    `TARGET: ${target}`,
    '',
    'Surface adaptation: instead of writing to OUT, emit the candidate as the',
    'ONLY fenced ```json block in your final answer. You have a shell — run the',
    'setup + reference yourself before emitting (hard rule 3).',
  ].join('\n')
}

// ── main: the kernel run ──────────────────────────────────────────────────────
async function main(): Promise<void> {
  const target = env('TARGET')
  const out = env('OUT', '/tmp/minted-evals.jsonl')
  const maxAttempts = Number(env('MAX_ATTEMPTS', '4'))
  // The authoring harness is the cli-bridge backend behind the unified executor;
  // wrapped once into a SandboxClient for the round-synchronous kernel.
  const sandboxClient = inlineSandboxClient(
    createExecutor({
      backend: 'bridge',
      bridgeUrl: env('BRIDGE_URL', 'http://127.0.0.1:3355'),
      bridgeBearer: env('BRIDGE_BEARER'),
      model: env('MODEL', 'claude-code/sonnet'),
      timeoutMs: Number(env('TIMEOUT_MS', '600000')),
    }),
  )

  const rootPrompt = buildRootPrompt(target)
  const minted: GeneratedEval[] = []

  const result = await runLoop<string, string, 'continue' | 'done'>({
    driver: createDriver<string, string>({
      planner: arm('certify-repair', authorSteer).planner(rootPrompt, maxAttempts),
      maxIterations: maxAttempts,
    }),
    agentRun: { name: 'generate-eval-author', profile: { name: 'generate-eval-author' }, taskToPrompt: (t: string) => t },
    output: answerOutput,
    validator: certifierValidator(minted),
    task: rootPrompt,
    ctx: { sandboxClient },
    maxIterations: maxAttempts,
  })

  if (minted.length > 0) {
    appendFileSync(out, `${JSON.stringify(minted[0])}\n`)
    console.error(
      `✅ ADMITTED ${minted[0].id} (${minted[0].certification?.resolvedTarget}) after ${result.iterations.length} round(s) → ${out}`,
    )
    return
  }
  appendFileSync(out, `${JSON.stringify({ target, exhausted: true, attempts: result.iterations.length, at: new Date().toISOString() })}\n`)
  console.error(`EXHAUSTED: no admissible eval for "${target}" after ${result.iterations.length} round(s)`)
  process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
