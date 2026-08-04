/**
 * ArmSpec execution — the typed port of the experiment's `solo.sh` and
 * `sup4.sh`, plus the cost-recovery pipeline (`true_sup_spend.py` + the
 * opencode sqlite join that produced worker-tokens.json).
 *
 * Secrets discipline: every model-touching child runs under
 * `dotenvx run -f <env files> --` with cwd = the secrets dir, resolved at CALL
 * time. This module handles env NAMES and file names only — never key values;
 * keys are expanded inside the dotenvx child, not in this process.
 *
 * The supervisor arm WRAPS the real loops driver: the tracked
 * `run-supervisor.mjs` shim registers the loops pi extension's actual tools
 * and invokes `spawn_supervisor` — no supervisor logic is reimplemented here.
 */

import { chmod, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  collectAgentTurn,
  createExecutor,
  streamAgentTurn,
  type CollectedAgentTurn,
} from '@tangle-network/agent-runtime/kernel'
import { run, runOk, type RunResult, shq } from './proc'
import { materializeWorkspace } from './materialize'
import type { ArmSpec, SoloUsage } from './types'

// ---------------------------------------------------------------------------
// Shared pieces: excludes, prompt suffix, patch extraction, dotenvx spawning.
// ---------------------------------------------------------------------------

const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url))
/** The tracked driver shim (was untracked in the experiment scratchpad). */
export const runSupervisorShim = fileURLToPath(new URL('./run-supervisor.mjs', import.meta.url))

/**
 * The exact worker prompt suffix from solo.sh — the SOLO arm gets the same
 * closing instruction the supervisor's workers get, so prompt content is
 * never a confound between arms.
 */
export const WORKER_PROMPT_SUFFIX =
  '\n\nWork only in your current working directory. Implement the change completely and correctly — do not stub, weaken, or special-case anything, and keep the repository\'s existing tests passing. An automated check verifies your work after you finish.'

/** Test-file exclude pathspecs (fixtures/excludes.txt, vendored from hh/excludes.txt). */
export async function loadExcludes(): Promise<string[]> {
  const raw = await readFile(join(fixturesDir, 'excludes.txt'), 'utf8')
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) throw new Error('fixtures/excludes.txt is empty')
  return lines
}

const GIT_COMMAND_TIMEOUT_MS = 2 * 60_000

async function runArenaGitOk(argv: string[], signal?: AbortSignal): Promise<Awaited<ReturnType<typeof runOk>>> {
  signal?.throwIfAborted()
  const result = await runOk('git', argv, { signal, timeoutMs: GIT_COMMAND_TIMEOUT_MS })
  signal?.throwIfAborted()
  return result
}

/**
 * Patch extraction — identical git invocation to solo.sh/sup4.sh: stage
 * everything, diff the index against base_commit, excluding test files and the
 * supervisor's own .loops state.
 */
export async function extractPatch(
  ws: string,
  baseCommit: string,
  excludes: string[],
  signal?: AbortSignal,
): Promise<string> {
  await runArenaGitOk(['-C', ws, 'add', '-A'], signal)
  const res = await runArenaGitOk([
    '-C', ws,
    'diff', '--cached', baseCommit,
    '--', '.',
    ...excludes,
    ':(exclude,glob).loops/**',
    ':(exclude,glob)**/.loops/**',
  ], signal)
  return res.stdout
}

export interface SecretsEnv {
  /** Directory dotenvx runs from (e.g. /home/drew/company/devops/secrets). */
  secretsDir: string
  /** Env file names passed as `-f` flags, resolved relative to secretsDir. */
  envFiles: string[]
}

/** `cd <secretsDir> && dotenvx run -f … -- bash -c <script>` — the arms' env wrapper. */
export function dotenvxBash(
  secrets: SecretsEnv,
  script: string,
  opts: { timeoutMs?: number; killGraceMs?: number; env?: NodeJS.ProcessEnv; signal?: AbortSignal } = {},
): ReturnType<typeof run> {
  const authBootstrap = [
    'if [ -n "${SWE_ARENA_OPENCODE_AUTH_FILE:-}" ] && [ -r "$SWE_ARENA_OPENCODE_AUTH_FILE" ]; then',
    '  export OPENCODE_AUTH_CONTENT="$(cat -- "$SWE_ARENA_OPENCODE_AUTH_FILE")"',
    'fi',
  ].join('\n')
  const argv = [
    'run',
    ...secrets.envFiles.flatMap((f) => ['-f', f]),
    '--',
    'bash',
    '-c',
    `${authBootstrap}\n${script}`,
  ]
  return run('dotenvx', argv, {
    cwd: secrets.secretsDir,
    timeoutMs: opts.timeoutMs,
    killGraceMs: opts.killGraceMs,
    env: opts.env ?? process.env,
    signal: opts.signal,
  })
}

export interface IsolatedCellEnvironment {
  env: NodeJS.ProcessEnv
  opencodeDb: string
}

/** Give one cell private CLI state, caches, temp files, and Python installs. */
export async function prepareIsolatedCellEnvironment(
  runDir: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): Promise<IsolatedCellEnvironment> {
  const ambientHome = baseEnv.HOME?.trim() || homedir()
  const cellRoot = resolve(runDir)
  const home = join(cellRoot, 'home')
  const xdgRoot = join(cellRoot, 'xdg')
  const configHome = join(xdgRoot, 'config')
  const dataHome = join(xdgRoot, 'data')
  const cacheHome = join(xdgRoot, 'cache')
  const stateHome = join(xdgRoot, 'state')
  const runtimeDir = join(xdgRoot, 'runtime')
  const tmp = join(cellRoot, 'tmp')
  const pythonUserBase = join(cellRoot, 'python-user')
  const opencodeConfigDir = join(configHome, 'opencode')
  const opencodeConfig = join(opencodeConfigDir, 'opencode.json')
  const opencodeDb = join(dataHome, 'opencode', 'opencode.db')
  const managedRoots = [home, xdgRoot, tmp, pythonUserBase]
  await Promise.all(managedRoots.map((dir) => rm(dir, { recursive: true, force: true })))

  const privateDirs = [home, configHome, dataHome, cacheHome, stateHome, runtimeDir, tmp, pythonUserBase, opencodeConfigDir]
  await Promise.all(privateDirs.map((dir) => mkdir(dir, { recursive: true })))
  await Promise.all(privateDirs.map((dir) => chmod(dir, 0o700)))

  const ambientConfigHome = baseEnv.XDG_CONFIG_HOME?.trim() || join(ambientHome, '.config')
  const configCandidates = [
    baseEnv.OPENCODE_CONFIG?.trim(),
    join(ambientConfigHome, 'opencode', 'opencode.json'),
    join(ambientConfigHome, 'opencode', 'opencode.jsonc'),
  ].filter((path): path is string => Boolean(path))
  let configText = baseEnv.OPENCODE_CONFIG_CONTENT
  if (configText === undefined) {
    for (const candidate of configCandidates) {
      configText = await readFile(candidate, 'utf8').catch(() => undefined)
      if (configText !== undefined) break
    }
  }
  await writeFile(opencodeConfig, configText ?? '{}\n', { mode: 0o600 })

  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    HOME: home,
    XDG_CONFIG_HOME: configHome,
    XDG_DATA_HOME: dataHome,
    XDG_CACHE_HOME: cacheHome,
    XDG_STATE_HOME: stateHome,
    XDG_RUNTIME_DIR: runtimeDir,
    TMPDIR: tmp,
    OPENCODE_CONFIG_DIR: opencodeConfigDir,
    OPENCODE_CONFIG: opencodeConfig,
    OPENCODE_DB: opencodeDb,
    SWE_ARENA_OPENCODE_AUTH_FILE:
      baseEnv.SWE_ARENA_OPENCODE_AUTH_FILE?.trim() ||
      join(baseEnv.XDG_DATA_HOME?.trim() || join(ambientHome, '.local', 'share'), 'opencode', 'auth.json'),
    PYTHONUSERBASE: pythonUserBase,
  }
  delete env.OPENCODE_CONFIG_CONTENT
  delete env.OPENCODE_AUTH_CONTENT
  delete env.PYTHONHOME
  delete env.PYTHONPATH
  delete env.PYTHONNOUSERSITE
  return { env, opencodeDb }
}

// ---------------------------------------------------------------------------
// Arm specs. `ArmSpec` (types.ts) is the declarative identity M1 pinned;
// these are the executable forms, convertible back via `toArmIdentity`.
// ---------------------------------------------------------------------------

export interface SoloArmSpec {
  kind: 'solo'
  /** Ledger/run-dir label, e.g. 'SOLO'. */
  name: string
  /** Complete worker identity. Runtime reads harness/provider/model/prompt only from here. */
  profile: AgentProfile
  /** Appended to the problem statement. Default: the shared worker suffix. */
  promptSuffix?: string
  /** Whole-run ceiling. solo.sh used `timeout 1000` (s). */
  timeoutMs?: number
  /** Runtime bridge transport. Defaults to the CLI_BRIDGE environment variables. */
  bridgeUrl?: string
  bridgeBearer?: string
}

export interface SupervisorArmSpec {
  kind: 'supervisor'
  /** Ledger/run-dir label, e.g. 'SUP4'. */
  name: string
  workerModel: string
  driverModel: string
  /** params.json knobs — defaults are sup4.sh's values. */
  budget?: number
  maxSandboxes?: number
  maxUsd?: number
  maxDepth?: number
  /**
   * Env knobs exported inside the dotenvx child. Defaults are sup4.sh's:
   * WORKER_BACKEND=cli, LOOPS_WORKER_HARNESS=opencode, LOOPS_BRAIN_RETRIES=30,
   * DRIVER_DEADLINE_MS=2600000. LOOPS_BRAIN_LOG is always run-dir-derived.
   */
  envKnobs?: Record<string, string>
  /** The loops checkout the driver runs from. */
  loopsRepo?: string
  /** The pi extension entry. Default: <loopsRepo>/extensions/pi/loops.ts. */
  extensionPath?: string
  /** Whole-run ceiling. sup4.sh used `timeout 2800` (s). */
  timeoutMs?: number
}

export type ExecutableArmSpec = SoloArmSpec | SupervisorArmSpec

export const DEFAULT_LOOPS_REPO = '/home/drew/code/loops'

export const SUP_DEFAULT_ENV_KNOBS: Record<string, string> = {
  WORKER_BACKEND: 'cli',
  LOOPS_WORKER_HARNESS: 'opencode',
  LOOPS_BRAIN_RETRIES: '30',
  DRIVER_DEADLINE_MS: '2600000',
}

export const DEFAULT_DRIVER_CANCEL_TIMEOUT_MS = 30_000
export const DRIVER_CANCELLATION_SETTLEMENT_BUFFER_MS = 10_000

/** Leave the driver more time than its own cancellation deadline to settle workers. */
export function supervisorDriverKillGraceMs(envKnobs: Record<string, string>): number {
  const raw = envKnobs.DRIVER_CANCEL_TIMEOUT_MS
  const cancelTimeoutMs = raw === undefined ? DEFAULT_DRIVER_CANCEL_TIMEOUT_MS : Number(raw)
  if (!Number.isFinite(cancelTimeoutMs) || cancelTimeoutMs <= 0) {
    throw new Error('DRIVER_CANCEL_TIMEOUT_MS must be a positive number')
  }
  return cancelTimeoutMs + DRIVER_CANCELLATION_SETTLEMENT_BUFFER_MS
}

export interface ArmProvenance {
  repo: string
  commit: string
  envKnobs: Record<string, string>
}

/** Runtime provenance: which loops commit actually sat in the supervisor seat. */
export async function armProvenance(
  loopsRepo: string,
  envKnobs: Record<string, string>,
  signal?: AbortSignal,
): Promise<ArmProvenance> {
  const head = await runArenaGitOk(['-C', loopsRepo, 'rev-parse', 'HEAD'], signal)
  return { repo: loopsRepo, commit: head.stdout.trim(), envKnobs }
}

/** Collapse an executable spec to the M1 declarative identity for the record. */
export async function toArmIdentity(spec: ExecutableArmSpec): Promise<ArmSpec> {
  if (spec.kind === 'solo') {
    return {
      name: spec.name,
      kind: 'solo',
      env: { model: spec.profile.model?.default ?? 'missing' },
      provenance: { repo: spec.profile.harness ?? 'missing', commit: 'runtime-bridge' },
    }
  }
  const loopsRepo = spec.loopsRepo ?? DEFAULT_LOOPS_REPO
  const envKnobs = { ...SUP_DEFAULT_ENV_KNOBS, ...spec.envKnobs }
  const prov = await armProvenance(loopsRepo, envKnobs)
  return {
    name: spec.name,
    kind: 'supervisor',
    env: envKnobs,
    provenance: { repo: prov.repo, commit: prov.commit },
  }
}

// ---------------------------------------------------------------------------
// opencode usage parse (oc_usage.py port).
// ---------------------------------------------------------------------------

/** Sum opencode `--format json` stream token parts into the ledger's SoloUsage. */
export function parseOcUsage(jsonl: string): SoloUsage {
  let steps = 0
  let inp = 0
  let out = 0
  let rea = 0
  let cw = 0
  let cr = 0
  let maxTot = 0
  let cost = 0
  for (const rawLine of jsonl.split('\n')) {
    const line = rawLine.trim()
    if (!line.startsWith('{')) continue
    let o: unknown
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    const part = (o as { part?: unknown }).part
    if (typeof part !== 'object' || part === null) continue
    const tk = (part as { tokens?: unknown }).tokens
    if (typeof tk !== 'object' || tk === null) continue
    const t = tk as Record<string, unknown>
    const num = (v: unknown): number => (typeof v === 'number' ? v : 0)
    steps += 1
    inp += num(t.input)
    out += num(t.output)
    rea += num(t.reasoning)
    const cache = (t.cache ?? {}) as Record<string, unknown>
    cw += num(cache.write)
    cr += num(cache.read)
    maxTot = Math.max(maxTot, num(t.total))
    cost += num((part as Record<string, unknown>).cost)
  }
  return {
    steps,
    in: inp,
    out,
    reasoning: rea,
    cache_w: cw,
    cache_r: cr,
    max_ctx: maxTot,
    oc_cost: Number(cost.toFixed(6)),
    total_io: inp + out + rea,
  }
}

// ---------------------------------------------------------------------------
// Arm execution.
// ---------------------------------------------------------------------------

export interface ArmRunContext {
  instanceId: string
  image: string
  baseCommit: string
  /**
   * Workspace materialization override. Default (undefined) = SWE instance
   * image materialization (docker cp of /testbed). Factory instances inject
   * their archive-export + synthetic-history materialization here so the arm
   * runners themselves stay instance-kind-agnostic. Must leave `dest` a git
   * repo whose HEAD is the diff base for patch extraction (`baseCommit`).
   */
  materialize?: (dest: string) => Promise<void>
  problemStatement: string
  /** Self-repro verify command (bash -c, cwd = ws) — the MEASUREMENT gate. */
  verifyCmd: string
  /** Root for runs/<iid>/<ARM>/ and patches/. */
  outDir: string
  secrets: SecretsEnv
  excludes: string[]
  signal?: AbortSignal
}

export interface SoloArmResult {
  arm: string
  iid: string
  oc_rc: number
  wall_s: number
  patch_lines: number
  verify_rc: number
  verify_pass: boolean
  usage: SoloUsage
  patchPath: string
  ws: string
}

export interface SupervisorArmResult {
  arm: string
  iid: string
  driver_rc: number
  wall_s: number
  patch_lines: number
  verify_rc: number
  verify_pass: boolean
  sup_status: string | null
  sup_verdict: string | null
  delivered: boolean | null
  spentTokens: number | null
  spentUsd: number | null
  spawned: number
  workers: number
  settled: number
  subtasks: string[]
  patchPath: string
  ws: string
  provenance: ArmProvenance
  recoveredSpend: SupSpend | null
}

const patchLineCount = (patch: string): number => (patch.length === 0 ? 0 : patch.split('\n').length - (patch.endsWith('\n') ? 1 : 0))

type ProcessCompletion = Pick<RunResult, 'code' | 'timedOut' | 'aborted'>

/** Reject a solo process outcome before its partial workspace can be scored. */
export function assertSoloProcessCompleted(result: ProcessCompletion, label = 'runSoloArm'): void {
  if (result.timedOut) {
    throw new Error(`${label}: opencode timed out (exit ${result.code})`)
  }
  if (result.aborted) {
    throw new Error(`${label}: opencode was cancelled (exit ${result.code})`)
  }
  if (result.code !== 0) {
    throw new Error(`${label}: opencode exited ${result.code}`)
  }
}

/** Reject a driver or unfinished supervisor state before its partial workspace can be scored. */
export function assertSupervisorProcessCompleted(
  driver: ProcessCompletion,
  status: string | null,
  label = 'runSupervisorArm',
): void {
  const state = status ?? 'missing'
  if (driver.timedOut) {
    throw new Error(`${label}: driver timed out (exit ${driver.code}, supervisor state ${state})`)
  }
  if (driver.aborted) {
    throw new Error(`${label}: driver was cancelled (exit ${driver.code}, supervisor state ${state})`)
  }
  if (driver.code !== 0) {
    throw new Error(`${label}: driver exited ${driver.code} (supervisor state ${state})`)
  }
  if (status !== 'completed') {
    throw new Error(`${label}: supervisor state ${state}; expected completed`)
  }
}

async function verifyWorkspace(
  verifyCmd: string,
  ws: string,
  logPath: string,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<number> {
  const res = await run('bash', ['-c', verifyCmd], { cwd: ws, timeoutMs: 600_000, env, signal })
  await writeFile(logPath, res.stdout + res.stderr)
  return res.code
}

function runtimeSoloUsage(turn: CollectedAgentTurn): SoloUsage {
  const calls = turn.events.filter((event) => event.type === 'llm_call')
  const maxCtx = calls.reduce(
    (max, event) => Math.max(max, (event.tokensIn ?? 0) + (event.tokensOut ?? 0)),
    0,
  )
  const cacheRead = Number(turn.usage.promptCache?.readTokens ?? 0)
  const cacheWrite = Number(turn.usage.promptCache?.writeTokens ?? 0)
  const reasoning = turn.usage.reasoningTokens ?? 0
  return {
    steps: calls.length,
    in: turn.usage.input,
    out: turn.usage.output,
    reasoning,
    cache_w: Number.isFinite(cacheWrite) ? cacheWrite : 0,
    cache_r: Number.isFinite(cacheRead) ? cacheRead : 0,
    max_ctx: maxCtx,
    oc_cost: turn.usage.costUsd ?? turn.usage.estimatedCostUsd ?? 0,
    total_io: turn.usage.input + turn.usage.output + reasoning,
  }
}

/** Solo arm: materialize → exact Runtime profile turn → patch extract → verify. */
export async function runSoloArm(spec: SoloArmSpec, ctx: ArmRunContext): Promise<SoloArmResult> {
  const runDir = join(ctx.outDir, 'runs', ctx.instanceId, spec.name)
  const ws = join(runDir, 'ws')
  await mkdir(runDir, { recursive: true })
  const cell = await prepareIsolatedCellEnvironment(runDir)
  // A caller-supplied materializer (synthetic-history factory cells) replaces the
  // SWE-bench image checkout, but still runs inside the isolated cell above.
  if (ctx.materialize) await ctx.materialize(ws)
  else
    await materializeWorkspace({
      instanceId: ctx.instanceId,
      image: ctx.image,
      baseCommit: ctx.baseCommit,
      dest: ws,
      signal: ctx.signal,
    })

  const promptFile = join(runDir, 'prompt.txt')
  const prompt = ctx.problemStatement + (spec.promptSuffix ?? WORKER_PROMPT_SUFFIX)
  await writeFile(promptFile, prompt)

  const bridgeUrl = spec.bridgeUrl ?? process.env.CLI_BRIDGE_URL ?? process.env.BRIDGE_URL
  const bridgeBearer =
    spec.bridgeBearer ?? process.env.CLI_BRIDGE_BEARER ?? process.env.BRIDGE_BEARER
  if (!bridgeUrl || !bridgeBearer) {
    throw new Error(
      'runSoloArm requires CLI_BRIDGE_URL/BRIDGE_URL and CLI_BRIDGE_BEARER/BRIDGE_BEARER',
    )
  }

  const t0 = Date.now()
  const timeoutMs = spec.timeoutMs ?? 1_000_000
  const factory = createExecutor({
    backend: 'bridge',
    bridgeUrl,
    bridgeBearer,
    cwd: ws,
    timeoutMs,
  })
  const turn = await collectAgentTurn(
    streamAgentTurn(
      { kind: 'executor', factory, profile: spec.profile },
      prompt,
      { timeoutMs, ...(ctx.signal ? { signal: ctx.signal } : {}) },
    ),
  )
  const wall_s = Math.round((Date.now() - t0) / 1000)
  await writeFile(
    join(runDir, 'runtime-events.jsonl'),
    turn.events.map((event) => JSON.stringify(event)).join('\n') + '\n',
  )
  if (turn.status !== 'completed') {
    throw new Error(
      `runSoloArm ${ctx.instanceId}/${spec.name}: ${turn.error?.message ?? turn.status}`,
    )
  }
  if (ctx.signal?.aborted) throw ctx.signal.reason

  const patch = await extractPatch(ws, ctx.baseCommit, ctx.excludes, ctx.signal)
  const patchPath = join(ctx.outDir, 'patches', `${ctx.instanceId}.${spec.name.toLowerCase()}.patch`)
  await mkdir(join(ctx.outDir, 'patches'), { recursive: true })
  await writeFile(patchPath, patch)

  const verify_rc = await verifyWorkspace(ctx.verifyCmd, ws, join(runDir, 'verify.log'), cell.env, ctx.signal)
  return {
    arm: spec.name,
    iid: ctx.instanceId,
    oc_rc: 0,
    wall_s,
    patch_lines: patchLineCount(patch),
    verify_rc,
    verify_pass: verify_rc === 0,
    usage: runtimeSoloUsage(turn),
    patchPath,
    ws,
  }
}

interface SupervisorRunArtifacts {
  status: string | null
  verdict: string | null
  delivered: boolean | null
  spentTokens: number | null
  spentUsd: number | null
  spawned: number
  workers: number
  settled: number
  subtasks: string[]
  supRunDir: string | null
}

/** Locate the (single) supervisor run dir under <ws>/.loops/supervisor. */
export async function findSupervisorRunDir(ws: string): Promise<string | null> {
  const root = join(ws, '.loops', 'supervisor')
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => join(root, e.name))
  return dirs[0] ?? null
}

/** sup4.sh's state.json + journal.jsonl summary (spawned/settled/workers/goals). */
export async function parseSupervisorArtifacts(ws: string): Promise<SupervisorRunArtifacts> {
  const supRunDir = await findSupervisorRunDir(ws)
  let status: string | null = null
  let verdict: string | null = null
  let delivered: boolean | null = null
  let spentTokens: number | null = null
  let spentUsd: number | null = null
  let spawned = 0
  let workers = 0
  let settled = 0
  const subtasks: string[] = []
  if (supRunDir) {
    let state: Record<string, unknown> = {}
    try {
      state = JSON.parse(await readFile(join(supRunDir, 'state.json'), 'utf8')) as Record<string, unknown>
    } catch {
      // Absent/corrupt state.json (driver killed mid-write) = all-null summary.
    }
    status = typeof state.status === 'string' ? state.status : null
    verdict = typeof state.verdict === 'string' ? state.verdict : null
    const result = (state.result ?? {}) as Record<string, unknown>
    delivered = typeof result.delivered === 'boolean' ? result.delivered : null
    spentTokens = typeof result.spentTokens === 'number' ? result.spentTokens : null
    spentUsd = typeof result.spentUsd === 'number' ? result.spentUsd : null
    const journal = await readFile(join(supRunDir, 'journal.jsonl'), 'utf8').catch(() => '')
    for (const line of journal.split('\n')) {
      if (!line.trim()) continue
      let o: Record<string, unknown>
      try {
        o = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue
      }
      const kind = o.kind
      const label = typeof o.label === 'string' ? o.label : ''
      if (kind === 'spawned') {
        spawned += 1
        if (label && label !== 'root') {
          workers += 1
          subtasks.push(label.slice(0, 100))
        }
      } else if (kind === 'settled') {
        settled += 1
      }
    }
  }
  return { status, verdict, delivered, spentTokens, spentUsd, spawned, workers, settled, subtasks, supRunDir }
}

/**
 * sup4.sh port: materialize → params.json → loops driver via the tracked shim
 * (env knobs incl. LOOPS_BRAIN_RETRIES / DRIVER_DEADLINE_MS) → patch extract →
 * verify → cost recovery. The driver runs with cwd = the loops repo, exactly
 * like the bash (`cd /home/drew/code/loops && node --import tsx …`).
 */
export async function runSupervisorArm(spec: SupervisorArmSpec, ctx: ArmRunContext): Promise<SupervisorArmResult> {
  const loopsRepo = spec.loopsRepo ?? DEFAULT_LOOPS_REPO
  const extensionPath = spec.extensionPath ?? join(loopsRepo, 'extensions', 'pi', 'loops.ts')
  const envKnobs = { ...SUP_DEFAULT_ENV_KNOBS, ...spec.envKnobs }
  const provenance = await armProvenance(loopsRepo, envKnobs, ctx.signal)

  const runDir = join(ctx.outDir, 'runs', ctx.instanceId, spec.name)
  const ws = join(runDir, 'ws')
  await mkdir(runDir, { recursive: true })
  const cell = await prepareIsolatedCellEnvironment(runDir)
  // A caller-supplied materializer (synthetic-history factory cells) replaces the
  // SWE-bench image checkout, but still runs inside the isolated cell above.
  if (ctx.materialize) await ctx.materialize(ws)
  else
    await materializeWorkspace({
      instanceId: ctx.instanceId,
      image: ctx.image,
      baseCommit: ctx.baseCommit,
      dest: ws,
      signal: ctx.signal,
    })

  const paramsFile = join(runDir, 'params.json')
  await writeFile(
    paramsFile,
    JSON.stringify(
      {
        task: ctx.problemStatement,
        workspaceDir: ws,
        budget: spec.budget ?? 40,
        verifyCmd: ctx.verifyCmd,
        workerModel: spec.workerModel,
        driverModel: spec.driverModel,
        maxSandboxes: spec.maxSandboxes ?? 4,
        maxUsd: spec.maxUsd ?? 8,
        maxDepth: spec.maxDepth ?? 3,
      },
      null,
      1,
    ),
  )
  await rm(join(ws, '.loops'), { recursive: true, force: true })

  const knobExports = Object.entries({ ...envKnobs, LOOPS_BRAIN_LOG: join(runDir, 'brain.jsonl') })
    .map(([k, v]) => {
      if (!/^[A-Z_][A-Z0-9_]*$/.test(k)) throw new Error(`invalid env knob name: ${k}`)
      return `export ${k}=${shq(v)}`
    })
    .join('\n')
  const script = [
    knobExports,
    `cd ${shq(loopsRepo)}`,
    `node --import tsx ${shq(runSupervisorShim)} ${shq(extensionPath)} ${shq(ws)} ${shq(paramsFile)}`,
  ].join('\n')

  const t0 = Date.now()
  const driver = await dotenvxBash(ctx.secrets, script, {
    timeoutMs: spec.timeoutMs ?? 2_800_000,
    killGraceMs: supervisorDriverKillGraceMs(envKnobs),
    env: cell.env,
    signal: ctx.signal,
  })
  const wall_s = Math.round((Date.now() - t0) / 1000)
  await writeFile(join(runDir, 'driver.log'), driver.stdout + driver.stderr)

  const artifacts = await parseSupervisorArtifacts(ws)
  assertSupervisorProcessCompleted(
    driver,
    artifacts.status,
    `runSupervisorArm ${ctx.instanceId}/${spec.name}`,
  )
  if (ctx.signal?.aborted) throw ctx.signal.reason

  const patch = await extractPatch(ws, ctx.baseCommit, ctx.excludes, ctx.signal)
  const patchPath = join(ctx.outDir, 'patches', `${ctx.instanceId}.${spec.name.toLowerCase()}.patch`)
  await mkdir(join(ctx.outDir, 'patches'), { recursive: true })
  await writeFile(patchPath, patch)

  const verify_rc = await verifyWorkspace(ctx.verifyCmd, ws, join(runDir, 'verify.log'), cell.env, ctx.signal)

  const recoveredSpend = artifacts.supRunDir
    ? await recoverSupSpend(artifacts.supRunDir, { opencodeDb: cell.opencodeDb }).catch(() => null)
    : null

  return {
    arm: spec.name,
    iid: ctx.instanceId,
    driver_rc: driver.code,
    wall_s,
    patch_lines: patchLineCount(patch),
    verify_rc,
    verify_pass: verify_rc === 0,
    sup_status: artifacts.status,
    sup_verdict: artifacts.verdict,
    delivered: artifacts.delivered,
    spentTokens: artifacts.spentTokens,
    spentUsd: artifacts.spentUsd,
    spawned: artifacts.spawned,
    workers: artifacts.workers,
    settled: artifacts.settled,
    subtasks: artifacts.subtasks,
    patchPath,
    ws,
    provenance,
    recoveredSpend,
  }
}

// ---------------------------------------------------------------------------
// Cost recovery — true_sup_spend.py port + the opencode sqlite worker join.
// ---------------------------------------------------------------------------

export interface SupSpend {
  /** Worker tokens the journal itself captured (`settled` spend) — often 0. */
  workerTokJournal: number
  /** Worker clone cwds found in workers/*.ndjson `started` events. */
  workerCwds: string[]
  /**
   * Worker-session spend recovered from the opencode sqlite store by joining
   * ndjson cwd → session.directory (the provenance of worker-tokens.json).
   * `null` = the store was unavailable — a telemetry gap, never a zero.
   * `workerTokIn`/`workerTokOut` split the same sessions so the campaign
   * CostLedger receipt carries a real input/output usage, not a lump.
   */
  workerSessions: number | null
  workerTokSqlite: number | null
  workerTokIn: number | null
  workerTokOut: number | null
}

export const DEFAULT_OPENCODE_DB = join(homedir(), '.local', 'share', 'opencode', 'opencode.db')

/**
 * Recover the WORKER-side SUP-arm spend from a supervisor run dir
 * (<ws>/.loops/supervisor/<id>): ndjson settled spend where captured, plus the
 * opencode sqlite session totals for each worker clone cwd. CLI-backend worker
 * sessions never meter into the journal, so the sqlite join is genuinely
 * custom recovery. Brain/driver spend is NO LONGER re-parsed from journal
 * `metered` events: the supervise runtime's spend tree now reaches state.json
 * on BOTH result arms (loops extensions/pi/loops.ts writes
 * `result.spentTokens`/`spentUsd` from `SupervisedResult.spentTotal`, winner
 * AND no-winner), so `parseSupervisorArtifacts` already carries it — the old
 * no-winner zeroing this parsing compensated for is fixed upstream.
 */
export async function recoverSupSpend(
  supRunDir: string,
  opts: { opencodeDb?: string } = {},
): Promise<SupSpend> {
  let workerTokJournal = 0
  const workerCwds: string[] = []
  const workersDir = join(supRunDir, 'workers')
  const workerFiles = (await readdir(workersDir).catch(() => [])).filter((f) => f.endsWith('.ndjson'))
  for (const f of workerFiles) {
    const nd = await readFile(join(workersDir, f), 'utf8').catch(() => '')
    for (const line of nd.split('\n')) {
      if (!line.trim()) continue
      let o: Record<string, unknown>
      try {
        o = JSON.parse(line) as Record<string, unknown>
      } catch {
        continue
      }
      if (o.kind === 'settled') {
        const tokens = ((o.spend ?? {}) as Record<string, unknown>).tokens as Record<string, unknown> | undefined
        workerTokJournal +=
          (typeof tokens?.input === 'number' ? tokens.input : 0) +
          (typeof tokens?.output === 'number' ? tokens.output : 0)
      } else if (o.kind === 'started' && typeof o.cwd === 'string') {
        workerCwds.push(o.cwd)
      }
    }
  }

  let workerSessions: number | null = null
  let workerTokSqlite: number | null = null
  let workerTokIn: number | null = null
  let workerTokOut: number | null = null
  if (workerCwds.length > 0) {
    try {
      // Deferred import: node:sqlite is only needed on the cost-recovery path.
      const { DatabaseSync } = await import('node:sqlite')
      const db = new DatabaseSync(opts.opencodeDb ?? DEFAULT_OPENCODE_DB, { readOnly: true })
      try {
        const placeholders = workerCwds.map(() => '?').join(',')
        const row = db
          .prepare(
            `SELECT COUNT(*) AS n,
                    COALESCE(SUM(tokens_input), 0) AS tin,
                    COALESCE(SUM(tokens_output + tokens_reasoning), 0) AS tout
             FROM session WHERE directory IN (${placeholders})`,
          )
          .get(...workerCwds) as { n: number | bigint; tin: number | bigint; tout: number | bigint }
        workerSessions = Number(row.n)
        workerTokIn = Number(row.tin)
        workerTokOut = Number(row.tout)
        workerTokSqlite = workerTokIn + workerTokOut
      } finally {
        db.close()
      }
    } catch {
      // Store unavailable/corrupt → telemetry gap (null), never a silent 0.
      workerSessions = null
      workerTokSqlite = null
      workerTokIn = null
      workerTokOut = null
    }
  } else {
    workerSessions = 0
    workerTokSqlite = 0
    workerTokIn = 0
    workerTokOut = 0
  }

  return {
    workerTokJournal,
    workerCwds,
    workerSessions,
    workerTokSqlite,
    workerTokIn,
    workerTokOut,
  }
}
