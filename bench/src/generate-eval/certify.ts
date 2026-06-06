/**
 * The eval certifier — the runtime's verdict on a generated candidate. The
 * authoring model is NEVER trusted: both gates re-run from scratch here.
 *
 *   gate 1 (grounding)      — fresh temp workspace → run `setup` (installs the
 *                             pinned target) → write `reference.files` → run
 *                             `reference.cmd` → must exit 0 (+ stdoutContains).
 *   gate 2 (discrimination) — the task prompt against a NO-TOOLS chat model;
 *                             the oracle must FAIL it. A task the model already
 *                             solves from memory measures nothing.
 *
 * Local-first by design: needs only node + a shell + (gate 2) any
 * OpenAI-compatible endpoint — so any stack or CI can run it with zero
 * platform dependency. Trust model: setup/reference run REAL shell commands;
 * certify only candidates you authored or reviewed, or run inside a sandbox.
 *
 * CLI:  tsx certify.ts <candidate.json>     → verdict JSON on stdout
 *       exit 0 admitted · 1 rejected · 2 malformed/infra
 * Env:  EVAL_GATE_BASE_URL (default https://router.tangle.tools/v1)
 *       EVAL_GATE_API_KEY  (default $TANGLE_API_KEY)
 *       EVAL_GATE_MODEL    (default gpt-4.1)
 */
import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { routerChatWithUsage } from '../router-client'
import { scoreTask, taskToPrompt } from '../search-bench/tasks'
import { type EvalCertification, type GeneratedEval, generatedEvalSchemaVersion, parseCandidate } from './schema'

const certifierId = 'agent-runtime/generate-eval@1'

export interface GateDiagnostics {
  admitted: boolean
  grounding: { passed: boolean; detail: string }
  discrimination: { passed: boolean; detail: string }
  certification?: EvalCertification
}

export interface CertifyOpts {
  gateBaseUrl?: string
  gateApiKey?: string
  gateModel?: string
  /** Per-command timeout for setup/reference execution. Default 180s. */
  cmdTimeoutMs?: number
  /** Keep the workspace on failure for debugging (path goes in the detail). */
  keepWorkspaceOnFailure?: boolean
}

/** First `pkg@x.y[.z]` token in setup — the declared pin, recorded as provenance. */
function declaredTarget(setup: string[]): string {
  for (const cmd of setup) {
    const m = cmd.match(/[\w@/.-]+@\d+[\w.-]*/)
    if (m) return m[0]
  }
  return '(unpinned — setup declared no pkg@version)'
}

function runCmd(cmd: string, cwd: string, timeoutMs: number): { ok: boolean; output: string } {
  try {
    const out = execSync(cmd, { cwd, timeout: timeoutMs, stdio: 'pipe', encoding: 'utf-8' })
    return { ok: true, output: out }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    return { ok: false, output: `${e.stdout ?? ''}\n${e.stderr ?? ''}\n${e.message ?? ''}`.trim() }
  }
}

/** Gate 1: re-execute the reference in a clean workspace. The detail string is
 *  the repair signal — it feeds back to the authoring loop as the steer. */
export function groundingGate(candidate: GeneratedEval, opts: CertifyOpts = {}): { passed: boolean; detail: string } {
  const timeout = opts.cmdTimeoutMs ?? 180_000
  const ws = mkdtempSync(join(tmpdir(), 'eval-certify-'))
  let failDetail: string | null = null
  try {
    for (const cmd of candidate.setup) {
      const r = runCmd(cmd, ws, timeout)
      if (!r.ok) {
        failDetail = `setup failed: \`${cmd}\`\n${r.output.slice(-1500)}`
        return { passed: false, detail: failDetail }
      }
    }
    for (const [path, content] of Object.entries(candidate.reference.files)) {
      const abs = resolve(ws, path)
      if (!abs.startsWith(ws)) {
        failDetail = `reference file escapes workspace: ${path}`
        return { passed: false, detail: failDetail }
      }
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, content)
    }
    const r = runCmd(candidate.reference.cmd, ws, timeout)
    if (!r.ok) {
      failDetail = `reference cmd failed: \`${candidate.reference.cmd}\`\n${r.output.slice(-2000)}`
      return { passed: false, detail: failDetail }
    }
    for (const must of candidate.reference.stdoutContains ?? []) {
      if (!r.output.includes(must)) {
        failDetail = `reference ran but stdout missing required "${must}"\nstdout tail:\n${r.output.slice(-800)}`
        return { passed: false, detail: failDetail }
      }
    }
    return { passed: true, detail: `reference passed against ${declaredTarget(candidate.setup)}` }
  } finally {
    if (failDetail && opts.keepWorkspaceOnFailure) {
      // workspace intentionally retained; surface where.
      // eslint-disable-next-line no-console
      console.error(`workspace kept for debugging: ${ws}`)
    } else {
      rmSync(ws, { recursive: true, force: true })
    }
  }
}

/** Gate 2: the no-tools baseline must FAIL the oracle. */
export async function discriminationGate(
  candidate: GeneratedEval,
  opts: CertifyOpts = {},
): Promise<{ passed: boolean; detail: string }> {
  const baseUrl = opts.gateBaseUrl ?? process.env.EVAL_GATE_BASE_URL ?? 'https://router.tangle.tools/v1'
  const apiKey = opts.gateApiKey ?? process.env.EVAL_GATE_API_KEY ?? process.env.TANGLE_API_KEY
  const model = opts.gateModel ?? process.env.EVAL_GATE_MODEL ?? 'gpt-4.1'
  if (!apiKey) throw new Error('discrimination gate needs EVAL_GATE_API_KEY (or TANGLE_API_KEY)')
  const res = await routerChatWithUsage({ routerBaseUrl: baseUrl, routerKey: apiKey, model }, [
    { role: 'user', content: taskToPrompt(candidate) },
  ])
  const { score, reasons } = scoreTask(candidate, res.content)
  return score === 0
    ? { passed: true, detail: `parametric ${model} failed as required (${reasons.join('; ')})` }
    : { passed: false, detail: `parametric ${model} SOLVED the task from memory — not search-discriminating` }
}

export async function certifyEval(candidate: GeneratedEval, opts: CertifyOpts = {}): Promise<GateDiagnostics> {
  const grounding = groundingGate(candidate, opts)
  // Run discrimination even when grounding fails — the authoring loop repairs
  // faster when it sees both gate verdicts at once.
  const discrimination = await discriminationGate(candidate, opts)
  const admitted = grounding.passed && discrimination.passed
  const out: GateDiagnostics = { admitted, grounding, discrimination }
  if (admitted) {
    out.certification = {
      schemaVersion: generatedEvalSchemaVersion,
      groundingPassed: true,
      parametricFailed: true,
      parametricModel: opts.gateModel ?? process.env.EVAL_GATE_MODEL ?? 'gpt-4.1',
      resolvedTarget: declaredTarget(candidate.setup),
      certifiedAt: new Date().toISOString(),
      certifier: certifierId,
    }
  }
  return out
}

// ── CLI ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const path = process.argv[2]
  if (!path) {
    console.error('usage: certify.ts <candidate.json>')
    process.exit(2)
  }
  let candidate: GeneratedEval
  try {
    candidate = parseCandidate(readFileSync(path, 'utf-8'))
  } catch (e) {
    console.error(String(e))
    process.exit(2)
  }
  const verdict = await certifyEval(candidate, { keepWorkspaceOnFailure: !!process.env.KEEP_WS })
  console.log(JSON.stringify(verdict, null, 2))
  process.exit(verdict.admitted ? 0 : 1)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e)
    process.exit(2)
  })
}
