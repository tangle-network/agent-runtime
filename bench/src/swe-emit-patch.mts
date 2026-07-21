/**
 * Judge-FREE patch emitter for the SWE scaffold — the FIXED measurement entrypoint.
 *
 * Given ONE instance id (IDS) + worker model + router env, this runs the candidate scaffold's OWN
 * `createSweBenchEnvironment` + `runAgentic` IN THIS worktree and prints the unified `git diff` of
 * the agent's edits to STDOUT. It does NOT judge — the swebench Docker judge is held OUTSIDE the
 * candidate (in swe-code-improve.mts) so the scaffold can never grade its own axis.
 *
 * This is the seam the code-aware improve() agent shells into. Its I/O contract is FIXED and the
 * scaffold proposer must NOT change it:
 *   IN  (env):  IDS=<one instance id>, WORKER_MODEL, MAX_TOKENS, ROUTER_BASE, TANGLE_API_KEY,
 *               INNER_TURNS, BUDGET, RUN_TOOL
 *   OUT (fd1):  the unified diff (empty string when the agent made no edit)
 *   diagnostics go to STDERR only, so stdout stays a clean patch.
 *
 * SWE_EMIT_SMOKE=1 → import/wiring check only: the module (and swe-bench-env) loaded, print READY on
 * stderr and exit 0 WITHOUT a clone / model call / dataset read. This is what the candidate verifier
 * runs to discard a scaffold edit that no longer imports.
 *
 * Command examples in prompts are kept OUT of backticks on purpose (router WAF 403s backtick-wrapped
 * command text) — see swe-bench-env.ts.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AgenticSurface, ArtifactHandle, SurfaceScore } from '@tangle-network/agent-runtime/loops'
import { refine, runAgentic } from '@tangle-network/agent-runtime/loops'
import { createSweBenchEnvironment, SWE_SEED_PROMPT, SWE_SEED_PROMPT_WITH_RUN } from './swe-bench-env'

const exec = promisify(execFile)

async function main(): Promise<void> {
  const smoke = ['1', 'true', 'yes'].includes((process.env.SWE_EMIT_SMOKE ?? '').toLowerCase())
  if (smoke) {
    // The import graph (this file + swe-bench-env + the linked runtime) resolved by the time we get
    // here. That is the whole check — no clone, no model call, no dataset read.
    console.error('SWE_EMIT_SMOKE ok: swe-emit-patch + swe-bench-env import graph loaded')
    return
  }

  const routerKey = process.env.TANGLE_API_KEY
  if (!routerKey) throw new Error('TANGLE_API_KEY required (the worker calls the router)')
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const model = process.env.WORKER_MODEL ?? 'glm-5.2'
  const ids = (process.env.IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (ids.length !== 1) throw new Error(`swe-emit-patch: exactly one IDS required, got [${ids.join(', ')}]`)
  const id = ids[0]!
  const innerTurns = Number(process.env.INNER_TURNS ?? 40)
  const maxTokens = Number(process.env.MAX_TOKENS ?? 12000)
  const budget = Number(process.env.BUDGET ?? 1)
  const enableRun = ['1', 'true', 'yes'].includes((process.env.RUN_TOOL ?? '').toLowerCase())

  const { environment, adapter } = await createSweBenchEnvironment(1, { ids, enableRun })
  const pool = await adapter.loadTasks({ ids, split: 'test' })
  const bt = pool.find((t) => t.id === id)
  if (!bt) throw new Error(`swe-emit-patch: instance not found in Verified: ${id}`)

  const task = {
    id: bt.id,
    systemPrompt: enableRun ? SWE_SEED_PROMPT_WITH_RUN : SWE_SEED_PROMPT,
    userPrompt: bt.prompt,
    meta: { instanceId: bt.id },
  }

  // Capture the patch from inside score() (called during the refine loop, BEFORE the surface closes
  // and rms the checkout). Keep the LATEST non-empty diff so accumulated refinements win and a later
  // empty read never clobbers a real patch.
  let capturedPatch = ''
  const proxy: AgenticSurface = {
    ...environment,
    async score(_t, handle: ArtifactHandle): Promise<SurfaceScore> {
      try {
        const d = await exec('git', ['-C', handle.id, 'diff'], { maxBuffer: 40_000_000, timeout: 60_000 })
        if (d.stdout.trim()) capturedPatch = d.stdout
      } catch {
        /* workspace gone or git error → keep whatever we already captured */
      }
      return { passes: capturedPatch.trim() ? 1 : 0, total: 1, errored: 0 }
    },
  }

  const t0 = Date.now()
  const r = await runAgentic({
    surface: proxy,
    task,
    strategy: refine,
    routerBaseUrl,
    routerKey,
    model,
    maxTokens,
    innerTurns,
    budget,
  })
  const files = capturedPatch ? [...capturedPatch.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]) : []
  console.error(
    `[emit] ${id} shots=${r.shots} completions=${r.completions} tok=in:${r.tokens.input}/out:${r.tokens.output} ` +
      `patch=${capturedPatch.length}b files=[${files.join(', ') || 'none'}] ${Math.round((Date.now() - t0) / 1000)}s`,
  )
  process.stdout.write(capturedPatch)
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
