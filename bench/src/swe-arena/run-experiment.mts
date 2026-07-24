/**
 * Experiment runner CLI — the typed replacement for the experiment's
 * `orchestrate.sh` + `run-instance.sh`:
 *
 *   tsx src/swe-arena/run-experiment.mts <config.json>
 *   tsx src/swe-arena/run-experiment.mts --dry-run-parity [workDir]
 *
 * Per instance, sequentially: ledger-skip resume → endpoint capacity gates
 * (supervisor arms gate on the ROUTER path too — probing z.ai alone was the
 * proven blind spot) → solo arm → serialized judge → supervisor arm →
 * serialized judge → append one typed LedgerRow (M1 schema) to the ledger.
 *
 * DRY-RUN PARITY (the M2 gate): `--dry-run-parity` executes NO arms and spends
 * NO model tokens. It replays patch extraction + official judging for two
 * committed fixture patches (pallets__flask-5014 SOLO — resolved;
 * pydata__xarray-4687 SUP — unresolved) through materialize → apply →
 * extractPatch → serialized-judge, and checks the verdicts against the pinned
 * M1 fixtures. Docker time only.
 *
 * TODO(operator approval): full 12-instance parity re-run — re-execute both
 * arms on the same 12 instances through this typed path and diff the resulting
 * ledger against fixtures/ledger.jsonl. Costs ~$1 in model spend + ~4h wall;
 * do not launch without an explicit operator go.
 */

import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createSweBenchAdapter } from '../benchmarks/swe-bench.ts'
import { exportBaseTree, judgeCmdEnv } from './factory-judge-child.mts'
import { loadFactoryInstances, type LoadedFactoryInstance } from './fixtures.ts'
import { run, runOk } from './proc.ts'
import {
  extractPatch,
  loadExcludes,
  runSoloArm,
  runSupervisorArm,
  type ExecutableArmSpec,
  type SecretsEnv,
  type SoloArmResult,
  type SoloArmSpec,
  type SupervisorArmResult,
  type SupervisorArmSpec,
} from './arms.ts'
import type { FactoryJudgeResult } from './factory-judge-child.mts'
import { applyPatchWithFallback } from './calibrate.ts'
import { gatesForArmKind, waitForCapacity } from './capacity.ts'
import { materializeWorkspace } from './materialize.ts'
import {
  createSerializedJudge,
  type JudgeVerdict,
  type SerializedJudge,
} from './serialized-judge.ts'
import { reportRound, writeRunReportSafe } from './run-report.mts'
import type { LedgerRow } from './types.ts'

const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url))

// ---------------------------------------------------------------------------
// Instance images (fixtures/instances.json, vendored from the experiment).
// ---------------------------------------------------------------------------

export interface InstanceImageEntry {
  repo: string
  base_commit: string
  image: string
  environment_setup_commit: string | null
}

export async function loadInstanceImages(path?: string): Promise<Record<string, InstanceImageEntry>> {
  const raw = await readFile(path ?? join(fixturesDir, 'instances.json'), 'utf8')
  return JSON.parse(raw) as Record<string, InstanceImageEntry>
}

// ---------------------------------------------------------------------------
// Ledger row assembly + resume.
// ---------------------------------------------------------------------------

/**
 * One paired LedgerRow from the two arm results + judge verdicts — the exact
 * field mapping run-instance.sh wrote. Throws on an inconclusive verdict
 * (resolved: null): an infra failure must abort the pair, never be written
 * into a boolean column.
 */
export function buildLedgerRow(
  solo: SoloArmResult,
  soloVerdict: JudgeVerdict,
  sup: SupervisorArmResult,
  supVerdict: JudgeVerdict,
): LedgerRow {
  if (solo.iid !== sup.iid) throw new Error(`ledger row: arm iid mismatch ${solo.iid} vs ${sup.iid}`)
  if (soloVerdict.resolved === null || supVerdict.resolved === null) {
    throw new Error(
      `ledger row ${solo.iid}: inconclusive judge verdict (solo=${soloVerdict.resolved}, sup=${supVerdict.resolved}) — not writing a fabricated boolean`,
    )
  }
  const SUP_STATUSES = ['completed', 'running', 'failed', 'cancelled', null] as const
  const SUP_VERDICTS = ['delivered', 'no-winner', 'best-effort', null] as const
  if (!SUP_STATUSES.includes(sup.sup_status as (typeof SUP_STATUSES)[number])) {
    throw new Error(`ledger row ${solo.iid}: unknown sup_status ${JSON.stringify(sup.sup_status)} — loops contract changed?`)
  }
  if (!SUP_VERDICTS.includes(sup.sup_verdict as (typeof SUP_VERDICTS)[number])) {
    throw new Error(`ledger row ${solo.iid}: unknown sup_verdict ${JSON.stringify(sup.sup_verdict)} — loops contract changed?`)
  }
  return {
    iid: solo.iid,
    solo_resolved: soloVerdict.resolved,
    sup_resolved: supVerdict.resolved,
    solo_verify_pass: solo.verify_pass,
    sup_verify_pass: sup.verify_pass,
    solo_patch_lines: solo.patch_lines,
    sup_patch_lines: sup.patch_lines,
    solo_wall_s: solo.wall_s,
    sup_wall_s: sup.wall_s,
    solo_tokens: solo.usage.total_io,
    solo_usage: solo.usage,
    sup_spentTokens: sup.spentTokens,
    sup_spentUsd: sup.spentUsd,
    sup_spawned: sup.spawned,
    sup_workers: sup.workers,
    sup_settled: sup.settled,
    sup_subtasks: sup.subtasks,
    sup_delivered: sup.delivered,
    sup_status: sup.sup_status as LedgerRow['sup_status'],
    sup_verdict: sup.sup_verdict as LedgerRow['sup_verdict'],
    solo_oc_rc: solo.oc_rc,
    sup_driver_rc: sup.driver_rc,
    solo_patch: solo.patchPath,
    sup_patch: sup.patchPath,
  }
}

/** iids already present in the ledger (resume-skip, orchestrate.sh semantics). */
export async function ledgerIids(ledgerPath: string): Promise<Set<string>> {
  const raw = await readFile(ledgerPath, 'utf8').catch(() => '')
  const iids = new Set<string>()
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line) as { iid?: string }
      if (typeof row.iid === 'string') iids.add(row.iid)
    } catch {
      throw new Error(`corrupt ledger line in ${ledgerPath}: ${line.slice(0, 120)}`)
    }
  }
  return iids
}

// ---------------------------------------------------------------------------
// Experiment config + loop.
// ---------------------------------------------------------------------------

export interface ExperimentConfig {
  instances: string[]
  /** Exactly one solo and one supervisor arm (the paired-ledger contract). */
  arms: ExecutableArmSpec[]
  ledgerPath: string
  outDir: string
  secretsDir: string
  envFiles: string[]
  /** Per-instance self-repro verify scripts: <verifyDir>/<iid>.sh. */
  verifyDir: string
  /** Override fixtures/instances.json (image map). */
  instanceImagesPath?: string
  judgeTimeoutMs?: number
  gateWaitCeilingMs?: number
  /** Probe model id. Defaults per-endpoint in capacity.ts. */
  capacityModel?: string
  /** Pause between instances (orchestrate.sh: 15s, gentle on the shared key). */
  cooldownMs?: number
  /**
   * Run log the per-cell run-report headline is appended to. Defaults to
   * `<outDir>/run.log`; the headline is always echoed to stdout as well, so a
   * shell-redirected log gets it either way.
   */
  runLogPath?: string
}

function armPair(arms: ExecutableArmSpec[]): { solo: SoloArmSpec; sup: SupervisorArmSpec } {
  const solo = arms.filter((a): a is SoloArmSpec => a.kind === 'solo')
  const sup = arms.filter((a): a is SupervisorArmSpec => a.kind === 'supervisor')
  if (solo.length !== 1 || sup.length !== 1) {
    throw new Error(`expected exactly one solo + one supervisor arm, got ${arms.map((a) => a.kind).join(', ')}`)
  }
  return { solo: solo[0], sup: sup[0] }
}

export async function runExperiment(config: ExperimentConfig): Promise<void> {
  const { solo, sup } = armPair(config.arms)
  const secrets: SecretsEnv = { secretsDir: config.secretsDir, envFiles: config.envFiles }
  const excludes = await loadExcludes()
  const images = await loadInstanceImages(config.instanceImagesPath)
  const judge = createSerializedJudge({
    ...(config.judgeTimeoutMs !== undefined ? { timeoutMs: config.judgeTimeoutMs } : {}),
  })
  const adapter = createSweBenchAdapter()
  const log = (msg: string): void => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`)

  const done = await ledgerIids(config.ledgerPath)
  const pending = config.instances.filter((iid) => !done.has(iid))
  for (const iid of config.instances.filter((i) => done.has(i))) log(`SKIP ${iid} (already in ledger)`)
  if (pending.length === 0) {
    log('nothing to do — all instances already in ledger')
    return
  }

  // One dataset load for all pending instances (problem statements + metadata).
  const tasks = await adapter.loadTasks({ ids: pending, split: 'test' })
  const taskById = new Map(tasks.map((t) => [t.id, t]))

  for (const iid of pending) {
    const task = taskById.get(iid)
    if (!task) throw new Error(`instance ${iid} not found in SWE-bench_Verified`)
    const entry = images[iid]
    if (!entry) throw new Error(`instance ${iid} has no image mapping (instances.json)`)
    const problemStatement = String(task.metadata?.problem_statement ?? '')
    if (!problemStatement) throw new Error(`instance ${iid}: empty problem_statement`)

    // Capacity gates: worker path always; router path because a supervisor arm runs.
    const gateOpts = {
      ...(config.gateWaitCeilingMs !== undefined ? { waitCeilingMs: config.gateWaitCeilingMs } : {}),
      ...(config.capacityModel !== undefined ? { model: config.capacityModel } : {}),
      onStatus: log,
    }
    for (const gate of gatesForArmKind('supervisor', secrets, gateOpts)) {
      if (!(await waitForCapacity(gate))) {
        log(`NO CAPACITY on ${gate.name} within ceiling — stopping before ${iid} (resume later)`)
        return
      }
    }

    const ctx = {
      instanceId: iid,
      image: entry.image,
      baseCommit: entry.base_commit,
      problemStatement,
      verifyCmd: `bash ${join(config.verifyDir, `${iid}.sh`)}`,
      outDir: config.outDir,
      secrets,
      excludes,
    }

    log(`>>> ${iid} SOLO arm`)
    const soloResult = await runSoloArm(solo, ctx)
    const soloVerdict = await judge.judge(iid, soloResult.patchPath, 'solo')
    log(`${iid} SOLO judged: ${JSON.stringify(soloVerdict)}`)

    log(`>>> ${iid} SUP arm`)
    const supResult = await runSupervisorArm(sup, ctx)
    const supVerdict = await judge.judge(iid, supResult.patchPath, 'sup')
    log(`${iid} SUP judged: ${JSON.stringify(supVerdict)}`)

    const row = buildLedgerRow(soloResult, soloVerdict, supResult, supVerdict)
    await appendFile(config.ledgerPath, JSON.stringify(row) + '\n')
    log(`LEDGER_ROW ${iid} solo=${row.solo_resolved} sup=${row.sup_resolved}`)

    // Deterministic run observability: never hand-grep a journal for steers/waves/
    // idle/cost again. Best-effort — a reporting failure can't lose a finished cell.
    await writeRunReportSafe(join(config.outDir, 'runs', iid, sup.name), {
      appendHeadlineTo: config.runLogPath ?? join(config.outDir, 'run.log'),
      ledgerPath: config.ledgerPath,
    })

    await new Promise((r) => setTimeout(r, config.cooldownMs ?? 15_000))
  }

  await reportRound(config.outDir, {
    appendHeadlineTo: config.runLogPath ?? join(config.outDir, 'run.log'),
    ledgerPath: config.ledgerPath,
    title: 'Round rollup — paired solo/supervisor experiment',
    echo: true,
  })
}

// ---------------------------------------------------------------------------
// Dry-run parity — the M2 gate. No arms, no tokens; docker only.
// ---------------------------------------------------------------------------

export interface ParityCaseSpec {
  iid: string
  arm: 'solo' | 'sup'
  /** Committed patch fixture, relative to fixtures/ (e.g. patches/x.solo.patch). */
  patchFixture: string
}

export interface ParityCaseResult {
  iid: string
  arm: 'solo' | 'sup'
  applyRc: number
  fixtureFiles: string[]
  extractedFiles: string[]
  extractedPatchLines: number
  verdict: JudgeVerdict
}

/** The two pinned parity cases: one resolved SOLO patch, one unresolved SUP patch. */
export const PARITY_CASES: ParityCaseSpec[] = [
  { iid: 'pallets__flask-5014', arm: 'solo', patchFixture: 'patches/pallets__flask-5014.solo.patch' },
  { iid: 'pydata__xarray-4687', arm: 'sup', patchFixture: 'patches/pydata__xarray-4687.sup.patch' },
]

/** Changed paths of a unified diff (b/ side), for extraction-parity checks. */
export function diffChangedFiles(patch: string): string[] {
  const files = new Set<string>()
  for (const m of patch.matchAll(/^diff --git a\/.+ b\/(.+)$/gm)) files.add(m[1])
  return [...files].sort()
}

/**
 * Replay extraction + judging for committed patches WITHOUT running any arm:
 * materialize the instance workspace from its image, apply the committed
 * patch, re-extract it via the arms.ts extraction path, then grade the
 * re-extracted patch with the serialized judge. Byte-identical output is not
 * required (git normalizes); the changed-file set and the official verdict are.
 */
export async function replayPatchParity(
  cases: ParityCaseSpec[],
  opts: { workDir: string; judge?: SerializedJudge; keepWorkspaces?: boolean },
): Promise<ParityCaseResult[]> {
  const judge = opts.judge ?? createSerializedJudge()
  const excludes = await loadExcludes()
  const images = await loadInstanceImages()
  const results: ParityCaseResult[] = []
  for (const c of cases) {
    const entry = images[c.iid]
    if (!entry) throw new Error(`parity: no image mapping for ${c.iid}`)
    const fixturePatchPath = join(fixturesDir, c.patchFixture)
    const fixturePatch = await readFile(fixturePatchPath, 'utf8')
    const ws = join(opts.workDir, `parity-${c.iid}-${c.arm}`)
    try {
      await materializeWorkspace({
        instanceId: c.iid,
        image: entry.image,
        baseCommit: entry.base_commit,
        dest: ws,
      })
      const applyRc = await applyPatchWithFallback(ws, fixturePatchPath)
      if (applyRc !== 0) throw new Error(`parity ${c.iid}: committed patch failed to apply (rc=${applyRc})`)
      const extracted = await extractPatch(ws, entry.base_commit, excludes)
      const extractedPath = join(opts.workDir, `parity-${c.iid}.${c.arm}.extracted.patch`)
      await writeFile(extractedPath, extracted)
      const verdict = await judge.judge(c.iid, extractedPath, `parity-${c.arm}`)
      results.push({
        iid: c.iid,
        arm: c.arm,
        applyRc,
        fixtureFiles: diffChangedFiles(fixturePatch),
        extractedFiles: diffChangedFiles(extracted),
        extractedPatchLines: extracted.length === 0 ? 0 : extracted.split('\n').length - 1,
        verdict,
      })
    } finally {
      if (!opts.keepWorkspaces) await rm(ws, { recursive: true, force: true })
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// Factory-bench: worker workspace + experiment loop.
//
// The worker cell for a factory instance is the `git archive` export of the
// base commit re-initialized as a FRESH git repo with one synthetic commit —
// worker tooling that expects git works, but `git log`/refs cannot leak the
// real repo's future history (the PR's impl and tests live only on the
// judge-side mirror). SPEC.md (the rewritten PM-ticket spec) is part of that
// initial commit. Everything downstream — arm runners, budgets, serialized
// judge queue/ceiling, ledger resume — is the same machinery as swe-arena.
// ---------------------------------------------------------------------------

/** Ref name the synthetic initial commit is pinned to; the arm's diff base. */
export const FACTORY_BASE_REF = 'factory-base'

export interface FactoryWorkspace {
  /** Sha of the synthetic initial commit (== FACTORY_BASE_REF). */
  syntheticBase: string
}

/**
 * Materialize a worker workspace for a factory instance: archive-export the
 * base tree, add SPEC.md, re-init as a synthetic-history repo (single commit,
 * no remotes), then pre-run `setup_cmds` so the worker starts on installed
 * deps. The real repo's refs/objects are unreachable by construction — the
 * leak test greps the workspace for them after setup.
 */
export async function materializeFactoryWorkspace(
  inst: LoadedFactoryInstance,
  dest: string,
  opts: { setup?: boolean } = {},
): Promise<FactoryWorkspace> {
  await rm(dest, { recursive: true, force: true })
  await mkdir(dirname(dest), { recursive: true })
  await exportBaseTree(inst.repo_local_mirror, inst.base_commit, dest)
  await writeFile(join(dest, 'SPEC.md'), inst.spec)

  await runOk('git', ['-C', dest, 'init', '-q', '-b', 'work'])
  await runOk('git', ['-C', dest, 'config', 'user.email', 'factory-bench@local'])
  await runOk('git', ['-C', dest, 'config', 'user.name', 'factory-bench'])
  await runOk('git', ['-C', dest, 'add', '-A'])
  await runOk('git', ['-C', dest, 'commit', '-q', '-m', 'baseline workspace'])
  await runOk('git', ['-C', dest, 'branch', '-f', FACTORY_BASE_REF, 'HEAD'])
  const syntheticBase = (await runOk('git', ['-C', dest, 'rev-parse', 'HEAD'])).stdout.trim()
  if (syntheticBase === inst.base_commit) {
    throw new Error(`factory workspace ${inst.id}: synthetic base equals the real base commit — history leaked`)
  }

  if (opts.setup !== false) {
    const env = judgeCmdEnv()
    for (const cmd of inst.setup_cmds) {
      const res = await run('bash', ['-c', cmd], { cwd: dest, timeoutMs: inst.timeout_s * 1000, env })
      if (res.code !== 0) {
        throw new Error(
          `factory workspace ${inst.id}: setup_cmd failed (rc=${res.code}): ${cmd}\n${(res.stderr || res.stdout).slice(-2000)}`,
        )
      }
    }
  }
  return { syntheticBase }
}

/** One appended line of the factory ledger (JSONL, resume key = iid + rep). */
export interface FactoryLedgerRow {
  at: string
  iid: string
  rep: number
  arm: string
  resolved: boolean
  /** passed / calibrated total — the dense partial-credit signal. */
  score: number
  passed: number | null
  total: number | null
  verify_pass: boolean
  patch_lines: number
  wall_s: number
  judge_secs: number | null
  judge_attempts: number | null
  driver_rc: number
  sup_status: string | null
  sup_verdict: string | null
  delivered: boolean | null
  spentTokens: number | null
  spentUsd: number | null
  spawned: number
  workers: number
  settled: number
  patchPath: string
  runDir: string
}

/** `iid#r<rep>` keys already in a factory ledger (resume-skip). */
export async function factoryLedgerKeys(ledgerPath: string): Promise<Set<string>> {
  const raw = await readFile(ledgerPath, 'utf8').catch(() => '')
  const keys = new Set<string>()
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let row: { iid?: string; rep?: number }
    try {
      row = JSON.parse(line) as { iid?: string; rep?: number }
    } catch {
      throw new Error(`corrupt factory ledger line in ${ledgerPath}: ${line.slice(0, 120)}`)
    }
    if (typeof row.iid === 'string' && typeof row.rep === 'number') keys.add(`${row.iid}#r${row.rep}`)
  }
  return keys
}

export interface FactoryArmConfig {
  workerModel: string
  driverModel: string
  budget?: number
  maxSandboxes?: number
  maxUsd?: number
  maxDepth?: number
  timeoutMs?: number
  envKnobs?: Record<string, string>
}

export interface FactoryExperimentConfig {
  /** Instance-dir root; relative paths resolve against the config file. */
  instancesDir: string
  /** Manifest ids to run (subset of instancesDir). */
  instances: string[]
  repsPerInstance: number
  armName: string
  arm: FactoryArmConfig
  /** The loops checkout in the supervisor seat (baseline = loops main). */
  loopsRepo: string
  ledgerPath: string
  outDir: string
  secretsDir: string
  envFiles: string[]
  /**
   * Worker-side self-check per instance (the supervisor's internal verify
   * gate). NEVER the judge tests — those stay hidden. Default `true` (no gate).
   */
  verifyCmds?: Record<string, string>
  judgeTimeoutMs?: number
  cooldownMs?: number
  gateWaitCeilingMs?: number
  capacityModel?: string
  /** Run log the per-cell run-report headline is appended to (default `<outDir>/run.log`). */
  runLogPath?: string
}

const factoryJudgeChildPath = fileURLToPath(new URL('./factory-judge-child.mts', import.meta.url))
const benchRootDir = fileURLToPath(new URL('../..', import.meta.url))

/**
 * Serialized judge whose child is factory-judge-child.mts — same JUDGE_RESULT
 * line protocol, queue, retry, and SIGKILL ceiling as the swebench judge. The
 * 1800s ceiling floor is kept as the backstop; the child self-enforces the
 * manifest's (much smaller) per-command timeout_s inside it.
 */
export function createFactoryJudge(
  instances: LoadedFactoryInstance[],
  opts: { timeoutMs?: number } = {},
): SerializedJudge {
  const dirById = new Map(instances.map((i) => [i.id, i.dir]))
  return createSerializedJudge({
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    lockFile: join(tmpdir(), 'factory-arena-judge.lock'),
    command: (iid, patchPath) => {
      const dir = dirById.get(iid)
      if (!dir) throw new Error(`factory judge: unknown instance id ${iid}`)
      return { bin: 'node', argv: ['--import', 'tsx', factoryJudgeChildPath, dir, patchPath], cwd: benchRootDir }
    },
  })
}

/**
 * Factory gen0 loop: per (instance × rep), sequentially — ledger resume →
 * capacity gates → supervisor arm on a factory workspace → factory judge →
 * one FactoryLedgerRow appended. Structure mirrors runExperiment.
 */
export async function runFactoryExperiment(
  config: FactoryExperimentConfig,
  opts: { configDir?: string; only?: string[]; repsOverride?: number } = {},
): Promise<void> {
  const log = (msg: string): void => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`)
  const baseDir = opts.configDir ?? process.cwd()
  const instancesDir = isAbsolute(config.instancesDir) ? config.instancesDir : resolve(baseDir, config.instancesDir)
  const all = loadFactoryInstances(instancesDir)
  const byId = new Map(all.map((i) => [i.id, i]))
  const wanted = (opts.only ?? config.instances).map((id) => {
    const inst = byId.get(id)
    if (!inst) throw new Error(`factory config: instance ${id} not found under ${instancesDir}`)
    return inst
  })
  const reps = opts.repsOverride ?? config.repsPerInstance
  if (!Number.isInteger(reps) || reps < 1) throw new Error(`repsPerInstance must be an integer ≥ 1, got ${reps}`)

  const secrets: SecretsEnv = { secretsDir: config.secretsDir, envFiles: config.envFiles }
  const judge = createFactoryJudge(all, {
    ...(config.judgeTimeoutMs !== undefined ? { timeoutMs: config.judgeTimeoutMs } : {}),
  })
  await mkdir(config.outDir, { recursive: true })
  await mkdir(dirname(config.ledgerPath), { recursive: true })
  const done = await factoryLedgerKeys(config.ledgerPath)

  for (const inst of wanted) {
    for (let rep = 0; rep < reps; rep += 1) {
      const key = `${inst.id}#r${rep}`
      if (done.has(key)) {
        log(`SKIP ${key} (already in ledger)`)
        continue
      }

      const gateOpts = {
        ...(config.gateWaitCeilingMs !== undefined ? { waitCeilingMs: config.gateWaitCeilingMs } : {}),
        ...(config.capacityModel !== undefined ? { model: config.capacityModel } : {}),
        onStatus: log,
      }
      for (const gate of gatesForArmKind('supervisor', secrets, gateOpts)) {
        if (!(await waitForCapacity(gate))) {
          log(`NO CAPACITY on ${gate.name} within ceiling — stopping before ${key} (resume later)`)
          return
        }
      }

      const spec: SupervisorArmSpec = {
        kind: 'supervisor',
        name: config.armName,
        workerModel: config.arm.workerModel,
        driverModel: config.arm.driverModel,
        budget: config.arm.budget,
        maxSandboxes: config.arm.maxSandboxes,
        maxUsd: config.arm.maxUsd,
        maxDepth: config.arm.maxDepth,
        ...(config.arm.envKnobs ? { envKnobs: config.arm.envKnobs } : {}),
        loopsRepo: config.loopsRepo,
        timeoutMs: config.arm.timeoutMs,
      }
      const armOutDir = join(config.outDir, `rep-${rep}`)
      log(`>>> ${config.armName} ${inst.id} rep=${rep}`)
      const armRes = await runSupervisorArm(spec, {
        instanceId: inst.id,
        image: `factory-archive:${inst.id}`,
        // The synthetic-history ref, NOT the real base sha: patch extraction
        // diffs against the workspace's own single commit.
        baseCommit: FACTORY_BASE_REF,
        materialize: async (dest) => {
          await materializeFactoryWorkspace(inst, dest)
        },
        problemStatement: inst.spec,
        verifyCmd: config.verifyCmds?.[inst.id] ?? 'true',
        outDir: armOutDir,
        secrets,
        // SPEC.md is workspace furniture, not worker product.
        excludes: [':(exclude)SPEC.md'],
      })

      const factoryRunDir = join(armOutDir, 'runs', inst.id, config.armName)
      const { ws: _ws, ...armSummary } = armRes
      await writeFile(join(factoryRunDir, 'result.json'), JSON.stringify(armSummary, null, 1)).catch(() => {})

      const verdict = await judge.judge(inst.id, armRes.patchPath, `${config.armName}-r${rep}`)
      log(`${inst.id} r${rep} judged: ${JSON.stringify(verdict)}`)
      await writeFile(join(factoryRunDir, 'judge.json'), JSON.stringify(verdict, null, 1)).catch(() => {})
      if (verdict.resolved === null) {
        throw new Error(`inconclusive factory judge verdict for ${key} (${verdict.error ?? 'unknown'}) — not writing a fabricated boolean`)
      }
      const fv = verdict as JudgeVerdict & Partial<FactoryJudgeResult>
      const row: FactoryLedgerRow = {
        at: new Date().toISOString(),
        iid: inst.id,
        rep,
        arm: config.armName,
        resolved: verdict.resolved,
        score: typeof fv.score === 'number' ? fv.score : 0,
        passed: typeof fv.passed === 'number' ? fv.passed : null,
        total: typeof fv.total === 'number' ? fv.total : null,
        verify_pass: armRes.verify_pass,
        patch_lines: armRes.patch_lines,
        wall_s: armRes.wall_s,
        judge_secs: fv.secs ?? null,
        judge_attempts: fv.attempts ?? null,
        driver_rc: armRes.driver_rc,
        sup_status: armRes.sup_status,
        sup_verdict: armRes.sup_verdict,
        delivered: armRes.delivered,
        spentTokens: armRes.spentTokens,
        spentUsd: armRes.spentUsd,
        spawned: armRes.spawned,
        workers: armRes.workers,
        settled: armRes.settled,
        patchPath: armRes.patchPath,
        runDir: factoryRunDir,
      }
      await appendFile(config.ledgerPath, JSON.stringify(row) + '\n')
      log(`LEDGER_ROW ${key} resolved=${row.resolved} score=${row.score} (${row.passed}/${row.total})`)

      await writeRunReportSafe(row.runDir, {
        appendHeadlineTo: config.runLogPath ?? join(config.outDir, 'run.log'),
        ledgerPath: config.ledgerPath,
        patchPath: armRes.patchPath,
      })

      await new Promise((r) => setTimeout(r, config.cooldownMs ?? 15_000))
    }
  }

  await reportRound(config.outDir, {
    appendHeadlineTo: config.runLogPath ?? join(config.outDir, 'run.log'),
    ledgerPath: config.ledgerPath,
    title: `Round rollup — factory ${config.armName}`,
    echo: true,
  })
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const [arg, extra] = process.argv.slice(2)
  if (arg === '--dry-run-parity') {
    const workDir = extra ?? join(process.env.TMPDIR ?? '/tmp', 'swe-arena-parity')
    await mkdir(workDir, { recursive: true })
    const results = await replayPatchParity(PARITY_CASES, { workDir })
    for (const r of results) {
      console.log(
        `PARITY ${r.iid} [${r.arm}] resolved=${r.verdict.resolved} score=${r.verdict.score} ` +
          `files(fixture=${r.fixtureFiles.join(',')} extracted=${r.extractedFiles.join(',')})`,
      )
    }
  } else if (arg === '--factory') {
    if (!extra) {
      console.error('usage: tsx src/swe-arena/run-experiment.mts --factory <config.json> [--only <iid> ...] [--reps <n>]')
      process.exit(2)
    }
    const rest = process.argv.slice(4)
    const only: string[] = []
    let repsOverride: number | undefined
    for (let i = 0; i < rest.length; i += 1) {
      if (rest[i] === '--only' && rest[i + 1]) only.push(rest[(i += 1)]!)
      else if (rest[i] === '--reps' && rest[i + 1]) repsOverride = Number(rest[(i += 1)])
      else throw new Error(`unknown --factory flag: ${rest[i]}`)
    }
    const configPath = resolve(extra)
    const config = JSON.parse(await readFile(configPath, 'utf8')) as FactoryExperimentConfig
    await runFactoryExperiment(config, {
      configDir: dirname(configPath),
      ...(only.length > 0 ? { only } : {}),
      ...(repsOverride !== undefined ? { repsOverride } : {}),
    })
  } else if (arg && !arg.startsWith('--')) {
    const config = JSON.parse(await readFile(arg, 'utf8')) as ExperimentConfig
    await runExperiment(config)
  } else {
    console.error(
      'usage: tsx src/swe-arena/run-experiment.mts <config.json>\n' +
        '       tsx src/swe-arena/run-experiment.mts --factory <config.json> [--only <iid> ...] [--reps <n>]\n' +
        '       tsx src/swe-arena/run-experiment.mts --dry-run-parity [workDir]',
    )
    process.exit(2)
  }
}
