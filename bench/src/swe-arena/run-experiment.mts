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
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { createSweBenchAdapter } from '../benchmarks/swe-bench.ts'
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
import { applyPatchWithFallback } from './calibrate.ts'
import { gatesForArmKind, waitForCapacity } from './capacity.ts'
import { materializeWorkspace } from './materialize.ts'
import {
  createSerializedJudge,
  type JudgeVerdict,
  type SerializedJudge,
} from './serialized-judge.ts'
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
    await new Promise((r) => setTimeout(r, config.cooldownMs ?? 15_000))
  }
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
  } else if (arg && !arg.startsWith('--')) {
    const config = JSON.parse(await readFile(arg, 'utf8')) as ExperimentConfig
    await runExperiment(config)
  } else {
    console.error(
      'usage: tsx src/swe-arena/run-experiment.mts <config.json>\n' +
        '       tsx src/swe-arena/run-experiment.mts --dry-run-parity [workDir]',
    )
    process.exit(2)
  }
}
