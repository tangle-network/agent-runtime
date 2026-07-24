/**
 * META-HARNESS on the SWE scaffold — improve({ surface: 'code' }).
 *
 * A coding agent (Claude Code) REWRITES the scaffold LOGIC under bench/src (the seed prompt/playbook,
 * runAgentic strategy/params, context handling, retry/patch synthesis) with the MODEL (glm worker) +
 * the TOOL surface (list/read/edit[/run]) + the JUDGE held FIXED, judged on the official swebench
 * Docker verdict, gated on a held-out instance split. This is the DGM/meta-harness recipe: let the
 * SYSTEM find the scaffold lever from the RAW failure traces, not hand-build it.
 *
 * Wiring (all verified in this worktree):
 *   - improve()/codeProposerFor + rawTraceContext come from the LOCAL agent-runtime build, linked into
 *     this bench's node_modules (bench/node_modules/@tangle-network/agent-runtime -> /home/drew/code/agent-runtime).
 *   - The candidate proposer is agenticGenerator(harness:'claude'), BUT the shipped runLocalHarness
 *     spawns `claude --headless -p` and --headless is an unknown option on the current CLI (exit 1, no
 *     edits ever). We pass code.generator with a corrected runHarness that spawns
 *     `claude -p <prompt> --dangerously-skip-permissions` so the coding agent can actually edit the
 *     worktree. This is a harness-spawn fix, NOT a hand-authored scaffold edit — Claude still finds the
 *     lever itself from the traces.
 *   - Each candidate is a git worktree the driver forks off baseRef; Claude edits bench/src in place;
 *     `verify` (an import smoke of the edited scaffold) gates it before the expensive measurement.
 *   - MEASUREMENT: the code-aware agent fn shells into the candidate scaffold's OWN judge-free emit
 *     entrypoint (swe-emit-patch.mts) with cwd = the worktree, captures the unified diff, and returns
 *     it. improve()'s FIXED swebench judge scores that diff OUTSIDE the candidate, so the scaffold can
 *     never game its own axis. Baseline (empty surface) runs the UNEDITED scaffold from the main tree.
 *
 * Run (router WAF: keep example commands OUT of backticks):
 *   TANGLE_API_KEY=... dotenvx run --quiet -f .../agent-state.env --
 *     TRAIN_IDS=... HOLDOUT_IDS=... WORKER_MODEL=glm-4.6 GENERATIONS=1 POPULATION=2
 *     RUN_DIR=/abs/run BASE_REF=meta/swe-scaffold-baseline
 *     node_modules/.bin/tsx bench/src/swe-code-improve.mts
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { improve, agenticGenerator } from '@tangle-network/agent-runtime'
import type { DispatchContext, JudgeConfig, Scenario } from '@tangle-network/agent-eval/contract'
import { createSweBenchAdapter } from './benchmarks/swe-bench'
import type { BenchTask } from './benchmarks/types'

/** The agent-runtime repo the worktree adapter forks candidate checkouts from (agent-runtime-swe is a
 *  worktree of it, so bench/src is tracked here). */
const REPO_ROOT = process.env.REPO_ROOT ?? '/home/drew/code/agent-runtime'
/** The main working tree = the baseline scaffold (its bench has the linked node_modules). */
const SWE_MAIN_ROOT = process.env.SWE_MAIN_ROOT ?? '/home/drew/code/agent-runtime-swe'
const MAIN_BENCH = join(SWE_MAIN_ROOT, 'bench')
const TSX_BIN = join(MAIN_BENCH, 'node_modules/.bin/tsx')

/** A candidate worktree is a fresh checkout with NO node_modules. Symlink the main bench's (already
 *  carrying the linked local runtime) so both the verifier and the measurement can run the scaffold. */
function ensureNodeModules(rootDir: string): void {
  const target = join(rootDir, 'bench', 'node_modules')
  if (existsSync(target)) return
  try {
    symlinkSync(join(MAIN_BENCH, 'node_modules'), target, 'dir')
  } catch {
    /* concurrent create / already exists — fine */
  }
}

/** Run the scaffold's judge-free emit entrypoint on ONE instance, from `rootDir`'s bench/src. Returns
 *  the unified diff (stdout, kept clean of any banner) + the tokens the worker reported (parsed from
 *  the [emit] stderr line). NO judge — the judge is held outside, in this file. */
function runEmit(
  rootDir: string,
  id: string,
  env: Record<string, string>,
  timeoutMs: number,
): Promise<{ patch: string; tokIn: number; tokOut: number; usd: number; code: number | null }> {
  ensureNodeModules(rootDir)
  const benchDir = join(rootDir, 'bench')
  return new Promise((resolve) => {
    const child = spawn(TSX_BIN, [join(benchDir, 'src/swe-emit-patch.mts')], {
      cwd: benchDir,
      env: { ...process.env, ...env, IDS: id },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += String(d)))
    child.stderr.on('data', (d) => (err += String(d)))
    const timer = setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL')
    }, timeoutMs)
    ;(timer as { unref?: () => void }).unref?.()
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ patch: '', tokIn: 0, tokOut: 0, usd: 0, code: 1 })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const m = /tok=in:(\d+)\/out:(\d+)/.exec(err)
      const u = /usd=([0-9.]+)/.exec(err)
      if (code !== 0) console.error(`  [emit ${id}] exit=${code} stderr: ${err.slice(-400).replace(/\n/g, ' ')}`)
      resolve({
        patch: out,
        tokIn: m ? Number(m[1]) : 0,
        tokOut: m ? Number(m[2]) : 0,
        usd: u ? Number(u[1]) : 0,
        code,
      })
    })
  })
}

async function main(): Promise<void> {
  const routerKey = process.env.TANGLE_API_KEY
  if (!routerKey) throw new Error('TANGLE_API_KEY required (worker calls the router)')
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const workerModel = process.env.WORKER_MODEL ?? 'glm-4.6'
  const trainIds = (process.env.TRAIN_IDS ?? 'psf__requests-2931,pallets__flask-5014').split(',').map((s) => s.trim()).filter(Boolean)
  const holdoutIds = (process.env.HOLDOUT_IDS ?? 'psf__requests-1142,psf__requests-1921').split(',').map((s) => s.trim()).filter(Boolean)
  const generations = Number(process.env.GENERATIONS ?? 1)
  const population = Number(process.env.POPULATION ?? 2)
  const innerTurns = Number(process.env.INNER_TURNS ?? 40)
  const maxTokens = Number(process.env.MAX_TOKENS ?? 12000)
  const enableRun = ['1', 'true', 'yes'].includes((process.env.RUN_TOOL ?? '').toLowerCase())
  const baseRef = process.env.BASE_REF ?? 'meta/swe-scaffold-baseline'
  const worktreeDir = process.env.WORKTREE_DIR ?? '/tmp/claude-1000/-home-drew-code-supervisor-lab/9ee6a456-a94f-474c-9888-b4afc9bc26bd/scratchpad/mh-worktrees'
  const runDir = process.env.RUN_DIR ?? '/tmp/claude-1000/-home-drew-code-supervisor-lab/9ee6a456-a94f-474c-9888-b4afc9bc26bd/scratchpad/mh-run'
  const emitTimeoutMs = Number(process.env.EMIT_TIMEOUT_MS ?? 600_000)
  const harnessTimeoutMs = Number(process.env.HARNESS_TIMEOUT_MS ?? 900_000)
  mkdirSync(worktreeDir, { recursive: true })
  mkdirSync(runDir, { recursive: true })

  const allIds = [...new Set([...trainIds, ...holdoutIds])]

  console.log('=== META-HARNESS on the SWE scaffold — improve(surface:code) ===')
  console.log(`worker=${workerModel} router=${routerBaseUrl} runTool=${enableRun}`)
  console.log(`train=[${trainIds.join(', ')}] holdout=[${holdoutIds.join(', ')}]`)
  console.log(`generations=${generations} population=${population} innerTurns=${innerTurns} maxTokens=${maxTokens}`)
  console.log(`repoRoot=${REPO_ROOT} baseRef=${baseRef}`)
  console.log(`runDir=${runDir} worktreeDir=${worktreeDir}`)

  // Fixed swebench Docker judge (held OUTSIDE every candidate) + task pool.
  const adapter = createSweBenchAdapter()
  const pool = await adapter.loadTasks({ ids: allIds, split: 'test' })
  const byId = new Map<string, BenchTask>(pool.map((t) => [t.id, t]))
  for (const id of allIds) if (!byId.has(id)) throw new Error(`instance not found in Verified: ${id}`)

  const workerEnv: Record<string, string> = {
    WORKER_MODEL: workerModel,
    MAX_TOKENS: String(maxTokens),
    INNER_TURNS: String(innerTurns),
    ROUTER_BASE: routerBaseUrl,
    TANGLE_API_KEY: routerKey,
    RUN_TOOL: enableRun ? '1' : '0',
  }

  // The code-aware measurement agent. A CodeSurface -> run the candidate scaffold in its worktree; an
  // empty/string surface (the baseline arm) -> run the UNEDITED scaffold from the main tree. Same path,
  // so baseline and candidates are measured identically.
  const agent = async (surface: unknown, scenario: Scenario, ctx: DispatchContext): Promise<string | null> => {
    const isCode = !!surface && typeof surface === 'object' && (surface as { kind?: string }).kind === 'code'
    const worktreeRef = isCode ? String((surface as { worktreeRef?: string }).worktreeRef ?? '') : ''
    const rootDir = isCode && worktreeRef && existsSync(worktreeRef) ? worktreeRef : SWE_MAIN_ROOT
    const t0 = Date.now()
    const paid = await ctx.cost.runPaidCall({
      channel: 'agent',
      actor: 'swe-scaffold-worker',
      model: workerModel,
      execute: () => runEmit(rootDir, scenario.id, workerEnv, emitTimeoutMs),
      receipt: (result) => {
        const usageUnknown = result.tokIn === 0 && result.tokOut === 0
        return {
          model: workerModel,
          inputTokens: result.tokIn,
          outputTokens: result.tokOut,
          ...(result.usd > 0 ? { actualCostUsd: result.usd } : {}),
          ...(usageUnknown ? { usageUnknown: true, costUnknown: result.usd <= 0 } : {}),
        }
      },
    })
    if (!paid.succeeded) throw paid.error
    const r = paid.value
    const hasPatch = r.patch.trim().length > 0
    const files = hasPatch ? [...r.patch.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]) : []
    console.log(
      `  [measure] ${isCode ? 'cand' : 'base'} ${scenario.id} patch=${r.patch.length}b files=[${files.join(', ') || 'none'}] ` +
        `tok=in:${r.tokIn}/out:${r.tokOut} ${Math.round((Date.now() - t0) / 1000)}s${isCode ? ` @ ${worktreeRef}` : ''}`,
    )
    return hasPatch ? r.patch : null
  }

  const judge: JudgeConfig<string | null, Scenario> = {
    name: 'swebench-docker',
    dimensions: [{ key: 'resolved', description: 'FAIL_TO_PASS + PASS_TO_PASS resolved by the official swebench Docker harness' }],
    async score({ artifact, scenario }) {
      const patch = String(artifact ?? '')
      if (!patch.trim()) {
        console.log(`  [judge] ${scenario.id} resolved=0 (no patch)`)
        return { dimensions: { resolved: 0 }, composite: 0, notes: 'no patch emitted' }
      }
      const bt = byId.get(scenario.id)
      if (!bt) throw new Error(`judge: unknown scenario ${scenario.id}`)
      const s = await adapter.judge(bt, patch)
      console.log(`  [judge] ${scenario.id} resolved=${s.resolved ? 1 : 0}`)
      return { dimensions: { resolved: s.resolved ? 1 : 0 }, composite: s.resolved ? 1 : 0, notes: (s.detail ?? '').slice(0, 200) }
    },
  }

  // The corrected coding-harness spawn: `claude -p <prompt> --dangerously-skip-permissions`. The shipped
  // runLocalHarness uses `claude --headless -p` (unknown option on this CLI). agenticGenerator ignores
  // the return value (it reads worktree dirtiness), so a minimal result shape is enough.
  const runHarness = (o: { cwd: string; taskPrompt: string; timeoutMs?: number; signal?: AbortSignal }): Promise<{ exitCode: number | null; stdout: string; stderr: string; killedBySignal: NodeJS.Signals | null; durationMs: number; timedOut: boolean }> => {
    const started = Date.now()
    return new Promise((resolve) => {
      const child = spawn('claude', ['-p', o.taskPrompt, '--dangerously-skip-permissions'], {
        cwd: o.cwd,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      let timedOut = false
      child.stdout?.on('data', (d) => (stdout += String(d)))
      child.stderr?.on('data', (d) => (stderr += String(d)))
      const timer = setTimeout(() => {
        timedOut = true
        if (!child.killed) child.kill('SIGTERM')
      }, o.timeoutMs ?? harnessTimeoutMs)
      ;(timer as { unref?: () => void }).unref?.()
      const onAbort = () => {
        if (!child.killed) child.kill('SIGTERM')
      }
      o.signal?.addEventListener('abort', onAbort, { once: true })
      child.on('error', () => {
        clearTimeout(timer)
        resolve({ exitCode: 1, stdout, stderr: `${stderr}\n[spawn error]`, killedBySignal: null, durationMs: Date.now() - started, timedOut })
      })
      child.on('close', (code, signal) => {
        clearTimeout(timer)
        o.signal?.removeEventListener('abort', onAbort)
        console.error(`  [proposer:claude] exit=${code} wall=${Math.round((Date.now() - started) / 1000)}s out=${stdout.length}b`)
        resolve({ exitCode: code, stdout, stderr, killedBySignal: signal, durationMs: Date.now() - started, timedOut })
      })
    })
  }

  // Domain prompt: name the EDIT BOUNDARY (scaffold logic only) + keep the raw-trace evidence discipline
  // (agenticGenerator discards a raw-trace candidate that doesn't inspect a trace + write the diagnosis).
  const buildPrompt = (args: { report: unknown; findings: Array<{ severity?: string; claim?: string; recommended_action?: string }> }): string => {
    const lines: string[] = [
      'You are improving a SWE-bench coding SCAFFOLD: a harness that drives a FIXED worker model to fix real GitHub bugs via list_files/read_file/edit_file tools. Your job is to rewrite the SCAFFOLD LOGIC so the SAME worker model resolves MORE instances on a held-out split.',
      '',
      'EDIT ONLY the scaffold logic under bench/src:',
      '  - the seed prompt / playbook: SWE_SEED_PROMPT and SWE_SEED_PROMPT_WITH_RUN in bench/src/swe-bench-env.ts',
      '  - the exploration/context handling in bench/src/swe-bench-env.ts: list_files walk depth and 240-entry cap, the read_file 24000-char truncation, edit_file retry messaging, patch synthesis (git diff)',
      '  - the runAgentic strategy/params in bench/src/swe-emit-patch.mts: innerTurns default, budget, how the patch is captured',
      '',
      'DO NOT change (FIXED for this search):',
      '  - the TOOL surface: the list_files/read_file/edit_file/run tool NAMES, JSON signatures, or the path jail. Do not add or remove a tool.',
      '  - the worker MODEL or MAX_TOKENS (passed via env — never hardcode a different model).',
      '  - the swebench Docker JUDGE.',
      '  - the swe-emit-patch.mts I/O contract: it still reads IDS + WORKER_MODEL + router env and prints ONLY the unified diff to stdout (diagnostics to stderr). You may change HOW the patch is produced, never this stdin/stdout contract.',
      '',
      'Make the smallest set of edits that addresses the failure evidence below, then stop. Leave changes in the working tree; do NOT commit.',
      '',
      'Failure evidence from the previous generation (its RAW run traces are on disk):',
    ]
    for (const f of args.findings) {
      lines.push(`- (${f.severity ?? 'info'}) ${f.claim ?? ''}`)
      if (f.recommended_action) lines.push(`    -> ${f.recommended_action}`)
    }
    lines.push(
      '',
      'Raw-trace evidence requirement (enforced — a candidate that skips this is discarded):',
      '  - Inspect at least one raw trace path named above (grep/cat/ls it) BEFORE editing.',
      '  - Write .improve/raw-trace-diagnosis.md in this worktree containing: the exact trace path(s) you inspected, the failure mechanism you found, and the scaffold-logic change you made.',
      '  - A candidate with ONLY that file changed (no real scaffold edit) is discarded.',
    )
    return lines.join('\n')
  }

  const verify = (worktreePath: string): { ok: boolean; feedback?: string } => {
    ensureNodeModules(worktreePath)
    const res = spawnSync(TSX_BIN, [join(worktreePath, 'bench/src/swe-emit-patch.mts')], {
      cwd: join(worktreePath, 'bench'),
      env: { ...process.env, SWE_EMIT_SMOKE: '1' },
      encoding: 'utf-8',
      timeout: 180_000,
    })
    if (res.status === 0) return { ok: true }
    const out = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim()
    return { ok: false, feedback: `edited scaffold failed import smoke (tsx swe-emit-patch SWE_EMIT_SMOKE=1):\n${out.slice(0, 3000)}` }
  }

  const generator = agenticGenerator({
    harness: 'claude',
    verify,
    timeoutMs: harnessTimeoutMs,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    buildPrompt: buildPrompt as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runHarness: runHarness as any,
  })

  const scenarios: Scenario[] = allIds.map((id) => ({ id, kind: 'swe-bench-verified' }))
  const holdoutScenarios: Scenario[] = holdoutIds.map((id) => ({ id, kind: 'swe-bench-verified' }))

  const out = await improve({
    surface: 'code',
    gate: 'holdout',
    code: { repoRoot: REPO_ROOT, baseRef, worktreeDir, generator },
    rawTraceContext: true,
    runDir,
    scenarios,
    judge,
    agent,
    expectUsage: 'warn',
    budget: { generations, populationSize: population, holdoutScenarios, maxConcurrency: 1, reps: 1 },
  })

  console.log('\n=== RESULT ===')
  console.log(`decision=${out.decision} lift=${out.lift}`)
  console.log(`baseline holdout composite = ${out.raw.baseline.compositeMean}`)
  console.log(`winner   holdout composite = ${out.raw.winner.compositeMean}`)
  console.log(`baseline per-scenario: ${JSON.stringify(out.raw.baseline.perScenario)}`)
  console.log(`winner   per-scenario: ${JSON.stringify(out.raw.winner.perScenario)}`)
  if (out.raw.winner.label) console.log(`winner label: ${out.raw.winner.label}`)
  if (out.raw.winner.rationale) console.log(`winner rationale: ${out.raw.winner.rationale}`)
  console.log(`generations explored: ${out.generationsExplored ?? 0}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
