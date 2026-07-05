/**
 * The deterministic Lean 4 verifier — the ground-truth judge for the prover-verifier gate.
 *
 * It assembles `${header} := ${proof}`, compiles it with the real Lean compiler in a cached,
 * network-isolated Docker image, and passes ONLY when Lean accepts it AND the proof uses no
 * trust-escape (`sorry`/`admit`/`native_decide`). There is no LLM in this path: a wrong proof
 * fails with Lean's own type error, which the loop feeds back verbatim for the next attempt.
 *
 * Proven real (Lean 4.31.0): `⟨h.2, h.1⟩` compiles (PASS); `⟨h.1, h.2⟩` fails with
 * "argument h.left has type p but is expected to have type q" (FAIL). No mocks anywhere.
 */

import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const pexec = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))
const IMAGE = process.env.LEAN_IMAGE ?? 'agent-runtime-lean-verify:local'

/** A proof that reaches acceptance via an unchecked escape is not a proof — reject it. */
const TRUST_ESCAPE = /\b(sorry|admit|sorryAx|native_decide)\b/

export interface LeanResult {
  /** Lean accepted the proof AND it used no trust-escape. */
  readonly passed: boolean
  /** Lean's compiler output on failure — feed this back to the prover verbatim. */
  readonly error: string
}

let imagePromise: Promise<void> | undefined

/** Build the Lean toolchain image once (idempotent), or fail loud with the fix. Never fabricates. */
export function ensureLeanImage(): Promise<void> {
  if (!imagePromise) {
    imagePromise = (async () => {
      try {
        await pexec('docker', ['image', 'inspect', IMAGE])
        return // already built
      } catch {
        // not present — build it
      }
      try {
        await pexec('docker', ['--version'])
      } catch {
        throw new Error(
          'Lean verifier needs Docker. Install/start Docker, or set LEAN_IMAGE to a prebuilt Lean 4 image. (This gate never fabricates a pass.)',
        )
      }
      await pexec(
        'docker',
        ['build', '-t', IMAGE, '-f', join(HERE, 'lean.Dockerfile'), HERE],
        { maxBuffer: 1 << 26 },
      )
    })()
  }
  return imagePromise
}

/**
 * Compile `${header} := ${proof}` with real Lean. Returns `{ passed, error }` — `error` is the
 * Lean output on failure (empty on pass), suitable to feed straight back to the prover.
 */
export async function leanCheck(header: string, proof: string): Promise<LeanResult> {
  const body = proof.trim()
  if (TRUST_ESCAPE.test(body)) {
    return { passed: false, error: `rejected: the proof uses a trust-escape (sorry/admit/native_decide) — prove it for real` }
  }
  await ensureLeanImage()
  const dir = await mkdtemp(join(tmpdir(), 'leanchk-'))
  try {
    await writeFile(join(dir, 'T.lean'), `${header} := ${body}\n`, 'utf8')
    try {
      const { stdout, stderr } = await pexec(
        'docker',
        ['run', '--rm', '--network', 'none', '-v', `${dir}:/w`, '-w', '/w', IMAGE, 'lean', 'T.lean'],
        { timeout: 90_000, maxBuffer: 1 << 26 },
      )
      // Lean emits a WARNING (exit 0) for `sorry`; treat that as not-proven too.
      if (/declaration uses 'sorry'/.test(stdout + stderr)) {
        return { passed: false, error: "rejected: Lean reports the proof still uses 'sorry'" }
      }
      return { passed: true, error: '' }
    } catch (e) {
      const r = e as { stdout?: string; stderr?: string; killed?: boolean }
      if (r.killed) return { passed: false, error: 'Lean timed out (90s) — the proof did not compile in time' }
      return { passed: false, error: (r.stderr || r.stdout || String(e)).slice(0, 2500) }
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
