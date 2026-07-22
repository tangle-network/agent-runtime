/**
 * 2-rep holdout certification — the operator-approved run that decides whether
 * a would-be-KEEP winner ships. Encodes the gen-2 postmortem: the winner
 * failed certification 3/6 vs 4/6 on a ONE-REP holdout with exactly one
 * discordant cell — a known single-rep noise class — so the protocol now
 * pins:
 *
 *   - `holdoutRepsPerInstance` (default 2) replicate cells per instance,
 *   - resolved = ALL reps resolved (fail-closed, identical to the improvement
 *     set's AND-rule in cell-evidence.mts),
 *   - the certification bar compares against a SAME-PROTOCOL parent
 *     measurement: `config.holdoutBaseline` is either an explicit
 *     `{iid -> bool}` verdict map measured under this exact protocol, or
 *     'measure' — the incumbent runs the same 2-rep holdout FIRST in this run.
 *
 * Certification rule (pre-registered, gen-2 bar unchanged in kind):
 * non-regression — the candidate's AND-resolved count must be >= the parent's,
 * with complete conclusive coverage on the candidate side. The improvement-set
 * gate already demanded a strict gain; the holdout certifies that the gain did
 * not cost held-out performance.
 *
 * The operator-release valve is unchanged: the outer loop always runs with
 * `holdout: 'deferred'` and only reports a would-be-KEEP brief; THIS module is
 * the separate, operator-fired run:
 *
 *   tsx src/swe-arena/holdout-certify.mts <config.json> --candidate <loops-commit> [--out <dir>]
 */

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import process from 'node:process'
import { createSweBenchAdapter } from '../benchmarks/swe-bench.ts'
import { loadExcludes, runSupervisorArm, type SecretsEnv, type SupervisorArmSpec } from './arms.ts'
import { gatesForArmKind, waitForCapacity } from './capacity.ts'
import {
  replicateCoverageComplete,
  resolvedInstanceCount,
  type ReplicateRun,
} from './cell-evidence.mts'
import {
  acquireInstanceLock,
  addEvalWorktree,
  assertFrozenArm,
  assertLaunchEnv,
  removeEvalWorktree,
  runWithPostGateClock,
  type OuterLoopConfig,
} from './outer-loop.mts'
import { runOk } from './proc.ts'
import { loadInstanceImages } from './run-experiment.mts'
import { createSerializedJudge, type SerializedJudge } from './serialized-judge.ts'

// ---------------------------------------------------------------------------
// Pure protocol pieces — unit-tested against synthetic replicate runs.
// ---------------------------------------------------------------------------

export const DEFAULT_HOLDOUT_REPS = 2

export function holdoutReps(config: Pick<OuterLoopConfig, 'holdoutRepsPerInstance'>): number {
  const reps = config.holdoutRepsPerInstance ?? DEFAULT_HOLDOUT_REPS
  if (!Number.isInteger(reps) || reps < 1) {
    throw new Error(`holdout-certify: holdoutRepsPerInstance must be a positive integer, got ${JSON.stringify(reps)}`)
  }
  return reps
}

/** Validate an explicit same-protocol parent verdict map: every holdout
 *  instance must carry a boolean (a partial map cannot anchor the bar). */
export function assertHoldoutBaselineMap(
  baseline: Record<string, boolean>,
  holdoutInstances: string[],
): void {
  const missing = holdoutInstances.filter((iid) => typeof baseline[iid] !== 'boolean')
  if (missing.length > 0) {
    throw new Error(
      `holdout-certify: holdoutBaseline map is missing same-protocol verdicts for: ${missing.join(', ')} — ` +
        "provide all instances or use holdoutBaseline: 'measure'",
    )
  }
  const extras = Object.keys(baseline).filter((iid) => !holdoutInstances.includes(iid))
  if (extras.length > 0) {
    throw new Error(`holdout-certify: holdoutBaseline names non-holdout instances: ${extras.join(', ')}`)
  }
}

export interface HoldoutCertification {
  candResolved: number
  parentResolved: number
  coverageComplete: boolean
  certified: boolean
  reasons: string[]
  perInstance: Array<{ iid: string; candidate: boolean | null; parent: boolean | null; discordant: boolean }>
}

/** The certification decision over fail-closed AND-verdicts. Pure. */
export function decideHoldoutCertification(input: {
  candidateRuns: ReplicateRun[]
  /** Parent AND-verdict per instance, measured under the SAME protocol
   *  (reps, fail-closed rule). */
  parentVerdicts: Record<string, boolean>
  iids: string[]
  reps: number
}): HoldoutCertification {
  const { candidateRuns, parentVerdicts, iids, reps } = input
  assertHoldoutBaselineMap(parentVerdicts, iids)
  const candResolved = resolvedInstanceCount(candidateRuns, iids, reps)
  const parentResolved = iids.filter((iid) => parentVerdicts[iid] === true).length
  const coverageComplete = replicateCoverageComplete(candidateRuns, iids, reps)
  const perInstance = iids.map((iid) => {
    const mine = candidateRuns.filter((r) => r.iid === iid)
    const candidate =
      mine.length === reps && mine.every((r) => r.resolved !== null)
        ? mine.every((r) => r.resolved === true)
        : null
    const parent = parentVerdicts[iid] ?? null
    return { iid, candidate, parent, discordant: candidate !== null && parent !== null && candidate !== parent }
  })
  const reasons: string[] = []
  if (!coverageComplete) reasons.push(`candidate coverage incomplete: not every instance has ${reps} conclusive reps`)
  if (candResolved < parentResolved) {
    reasons.push(`regression: candidate ${candResolved} < parent ${parentResolved} (same-protocol AND-verdicts)`)
  }
  const certified = coverageComplete && candResolved >= parentResolved
  if (certified) reasons.push(`non-regression met: candidate ${candResolved} >= parent ${parentResolved} at ${reps} reps, fail-closed`)
  return { candResolved, parentResolved, coverageComplete, certified, reasons, perInstance }
}

// ---------------------------------------------------------------------------
// The runner — real arms + the official judge, resumable per (commit,iid,rep).
// ---------------------------------------------------------------------------

export interface HoldoutCellRow {
  schema: 'swe-arena.holdout-cell.v1'
  at: string
  commit: string
  side: 'candidate' | 'parent'
  iid: string
  rep: number
  resolved: boolean | null
  verifyPass: boolean | null
  wallS: number | null
  runDir: string
  error?: string
}

/** Read prior cells (resume): conclusive rows are reused, inconclusive re-run. */
export async function loadHoldoutCells(cellsPath: string): Promise<HoldoutCellRow[]> {
  if (!existsSync(cellsPath)) return []
  const raw = await readFile(cellsPath, 'utf8')
  return raw
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as HoldoutCellRow)
    .filter((r) => r.schema === 'swe-arena.holdout-cell.v1')
}

const log = (msg: string): void => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`)

export async function runHoldoutCertification(
  config: OuterLoopConfig,
  opts: { candidateCommit: string; outDir?: string },
): Promise<HoldoutCertification> {
  assertFrozenArm(config.arm)
  const reps = holdoutReps(config)
  const iids = config.holdoutInstances
  if (iids.length === 0) throw new Error('holdout-certify: empty holdout set')
  const outDir = opts.outDir ?? join(config.outDir, 'holdout-certification')
  await mkdir(outDir, { recursive: true })
  const cellsPath = join(outDir, 'cells.jsonl')

  const secrets: SecretsEnv = { secretsDir: config.secretsDir, envFiles: config.envFiles }
  const excludes = await loadExcludes()
  const images = await loadInstanceImages(config.instanceImagesPath)
  const adapter = createSweBenchAdapter()
  const tasks = await adapter.loadTasks({ ids: iids, split: 'test' })
  const problemById = new Map<string, string>()
  for (const iid of iids) {
    const task = tasks.find((t) => t.id === iid)
    if (!task) throw new Error(`holdout-certify: ${iid} not found in SWE-bench_Verified`)
    const problem = String(task.metadata?.problem_statement ?? '')
    if (!problem) throw new Error(`holdout-certify: ${iid} has an empty problem_statement`)
    if (!images[iid]) throw new Error(`holdout-certify: ${iid} has no image mapping`)
    if (!existsSync(join(config.verifyDir, `${iid}.sh`))) {
      throw new Error(`holdout-certify: missing verify script ${join(config.verifyDir, `${iid}.sh`)}`)
    }
    problemById.set(iid, problem)
  }

  const judge: SerializedJudge = createSerializedJudge(
    config.judgeTimeoutMs !== undefined ? { timeoutMs: config.judgeTimeoutMs } : {},
  )
  const prior = await loadHoldoutCells(cellsPath)

  const awaitGates = async (): Promise<void> => {
    for (const gate of gatesForArmKind('supervisor', secrets, {
      ...(config.gateWaitCeilingMs !== undefined ? { waitCeilingMs: config.gateWaitCeilingMs } : {}),
      ...(config.capacityModel !== undefined ? { model: config.capacityModel } : {}),
      onStatus: log,
    })) {
      if (!(await waitForCapacity(gate))) throw new Error(`no capacity on ${gate.name} within ceiling`)
    }
  }

  const runSide = async (side: 'candidate' | 'parent', commit: string): Promise<ReplicateRun[]> => {
    const runs: ReplicateRun[] = []
    for (const iid of iids) {
      for (let rep = 0; rep < reps; rep++) {
        const cached = prior.find(
          (r) => r.side === side && r.commit === commit && r.iid === iid && r.rep === rep && r.resolved !== null,
        )
        if (cached) {
          log(`holdout ${side} ${iid} rep=${rep}: cached resolved=${cached.resolved}`)
          runs.push({ iid, resolved: cached.resolved })
          continue
        }
        const tag = `${side}-${commit.slice(0, 10)}`
        const evalWt = join(outDir, 'eval-wt', `${tag}-${iid}-r${rep}`)
        const armOutDir = join(outDir, 'arm-runs', tag, iid, `rep-${rep}`)
        let row: HoldoutCellRow
        try {
          await addEvalWorktree(config.loopsRepo, commit, evalWt)
          try {
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
              loopsRepo: evalWt,
              extensionPath: join(evalWt, 'extensions', 'pi', 'loops.ts'),
              timeoutMs: config.arm.timeoutMs,
            }
            log(`>>> holdout ${side} ${iid} rep=${rep} @ ${commit.slice(0, 10)}`)
            const entry = images[iid]!
            const armRes = await runWithPostGateClock({
              awaitGates,
              work: (signal) =>
                runSupervisorArm(spec, {
                  instanceId: iid,
                  image: entry.image,
                  baseCommit: entry.base_commit,
                  problemStatement: problemById.get(iid)!,
                  verifyCmd: `bash ${join(config.verifyDir, `${iid}.sh`)}`,
                  outDir: armOutDir,
                  secrets,
                  excludes,
                  signal,
                }),
              timeoutMs: config.dispatchTimeoutMs,
              label: `holdout ${side} ${iid} r${rep}`,
            })
            const verdict = await judge.judge(iid, armRes.patchPath, `holdout-${tag}`)
            row = {
              schema: 'swe-arena.holdout-cell.v1',
              at: new Date().toISOString(),
              commit,
              side,
              iid,
              rep,
              resolved: verdict.resolved,
              verifyPass: armRes.verify_pass,
              wallS: armRes.wall_s,
              runDir: join(armOutDir, 'runs', iid, config.armName),
              ...(verdict.resolved === null ? { error: verdict.error ?? 'inconclusive judge verdict' } : {}),
            }
          } finally {
            await removeEvalWorktree(config.loopsRepo, evalWt)
          }
        } catch (cause) {
          // An errored cell is an INCONCLUSIVE replicate (resolved: null) —
          // fail-closed downstream, never a fabricated boolean.
          row = {
            schema: 'swe-arena.holdout-cell.v1',
            at: new Date().toISOString(),
            commit,
            side,
            iid,
            rep,
            resolved: null,
            verifyPass: null,
            wallS: null,
            runDir: armOutDir,
            error: (cause as Error).message,
          }
        }
        await appendFile(cellsPath, JSON.stringify(row) + '\n')
        log(`holdout ${side} ${iid} rep=${rep}: resolved=${row.resolved}${row.error ? ` (${row.error})` : ''}`)
        runs.push({ iid, resolved: row.resolved })
      }
    }
    return runs
  }

  // SAME-PROTOCOL parent verdicts: an explicit operator-provided map, or the
  // incumbent measured FIRST under the identical 2-rep fail-closed protocol.
  let parentVerdicts: Record<string, boolean>
  let parentSource: 'provided' | 'measured'
  let parentCommit: string | null = null
  const baseline = config.holdoutBaseline ?? 'measure'
  if (baseline !== 'measure') {
    assertHoldoutBaselineMap(baseline, iids)
    parentVerdicts = baseline
    parentSource = 'provided'
  } else {
    parentCommit = (
      await runOk('git', ['-C', config.loopsRepo, 'rev-parse', config.loopsBaseRef])
    ).stdout.trim()
    log(`holdout parent: measuring incumbent ${parentCommit.slice(0, 10)} under the same ${reps}-rep protocol`)
    const parentRuns = await runSide('parent', parentCommit)
    parentVerdicts = {}
    for (const iid of iids) {
      const mine = parentRuns.filter((r) => r.iid === iid)
      // Fail-closed: an inconclusive/missing parent replicate reads as NOT
      // resolved for the parent — it can only make the bar EASIER, never
      // stricter, so a broken parent measurement cannot fail a good candidate.
      parentVerdicts[iid] = mine.length === reps && mine.every((r) => r.resolved === true)
    }
    parentSource = 'measured'
  }

  const candidateRuns = await runSide('candidate', opts.candidateCommit)
  const decision = decideHoldoutCertification({ candidateRuns, parentVerdicts, iids, reps })

  const record = {
    schema: 'swe-arena.holdout-certification.v1',
    at: new Date().toISOString(),
    round: config.round,
    reps,
    instances: iids,
    candidateCommit: opts.candidateCommit,
    parent: { source: parentSource, commit: parentCommit, verdicts: parentVerdicts },
    ...decision,
  }
  const recordPath = join(outDir, `certification-${opts.candidateCommit.slice(0, 10)}.json`)
  await writeFile(recordPath, JSON.stringify(record, null, 2))
  log(
    `holdout certification: candidate ${decision.candResolved}/${iids.length} vs parent ` +
      `${decision.parentResolved}/${iids.length} at ${reps} reps — ${decision.certified ? 'CERTIFIED' : 'NOT CERTIFIED'}`,
  )
  for (const r of decision.reasons) log(`  - ${r}`)
  log(`certification record → ${recordPath}`)
  return decision
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const argv = process.argv.slice(2)
  const configPath = argv[0]
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name)
    return i !== -1 ? argv[i + 1] : undefined
  }
  const candidate = flag('--candidate')
  if (!configPath || configPath.startsWith('--') || !candidate) {
    console.error(
      'usage: tsx src/swe-arena/holdout-certify.mts <config.json> --candidate <loops-commit> [--out <dir>]  # SPENDS: arms + judges',
    )
    process.exit(2)
  }
  const config = JSON.parse(await readFile(configPath, 'utf8')) as OuterLoopConfig
  assertLaunchEnv()
  const out = flag('--out')
  const lockDir = out ?? join(config.outDir, 'holdout-certification')
  await mkdir(lockDir, { recursive: true })
  const lock = await acquireInstanceLock(lockDir)
  try {
    const decision = await runHoldoutCertification(config, {
      candidateCommit: candidate,
      ...(out ? { outDir: out } : {}),
    })
    process.exitCode = decision.certified ? 0 : 1
  } finally {
    await lock.release()
  }
}
