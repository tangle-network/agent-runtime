/**
 * Metadata bootstrap — regenerates every per-instance input the experiment
 * used to hand-generate into its scratchpad (`task-meta.json` via
 * `load_meta.py`) straight from the SWE-bench Verified dataset through the
 * bench adapter. The HF dataset cache under ~/.cache survives host reboots;
 * the scratchpad does not — this module removes that scratch dependency
 * permanently (proven necessary: a reboot wiped /tmp and took task-meta.json,
 * the verify scripts, and the round configs with it).
 *
 *   tsx src/swe-arena/bootstrap-meta.mts --task-meta <out.json> [iid...]
 *   tsx src/swe-arena/bootstrap-meta.mts --problems <outDir> [iid...]
 *   tsx src/swe-arena/bootstrap-meta.mts --calibrate <verifyDir> <workDir> [iid...]
 *
 * `iid...` defaults to the round-4 improvement set (defaultRound4Config).
 *
 * HONESTY FIREWALL: `--problems` writes ONLY problem statements — the mode a
 * verify-script author is allowed to read. Gold patches surface ONLY on the
 * `--calibrate` path, where calibrate.ts applies them MECHANICALLY (git apply
 * / patch --fuzz=3) and the official judge grades them; no author-facing
 * output ever contains patch/test_patch/FAIL_TO_PASS content.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createSweBenchAdapter } from '../benchmarks/swe-bench.ts'
import { calibrateInstance, type CalibrationResult } from './calibrate.ts'
import { defaultRound4Config } from './outer-loop.mts'
import { loadInstanceImages } from './run-experiment.mts'
import { createSerializedJudge } from './serialized-judge.ts'
import type { SweInstance } from './types.ts'

/** Validate one adapter task-metadata record into the SweInstance shape the
 *  harness consumes. Throws on any missing/empty load-bearing field — a blank
 *  problem statement or gold patch must never flow silently into a run. */
export function assertSweInstance(id: string, metadata: Record<string, unknown> | undefined): SweInstance {
  if (!metadata) throw new Error(`bootstrap-meta: ${id} has no metadata on its adapter task`)
  const str = (key: keyof SweInstance): string => {
    const v = metadata[key]
    if (typeof v !== 'string' || v.length === 0) {
      throw new Error(`bootstrap-meta: ${id} has a missing/empty ${String(key)}`)
    }
    return v
  }
  const optStr = (key: keyof SweInstance): string | null => {
    const v = metadata[key]
    return typeof v === 'string' && v.length > 0 ? v : null
  }
  const instance: SweInstance = {
    instance_id: str('instance_id'),
    repo: str('repo'),
    base_commit: str('base_commit'),
    problem_statement: str('problem_statement'),
    patch: str('patch'),
    test_patch: str('test_patch'),
    FAIL_TO_PASS: str('FAIL_TO_PASS'),
    PASS_TO_PASS: str('PASS_TO_PASS'),
    version: optStr('version'),
    environment_setup_commit: optStr('environment_setup_commit'),
  }
  if (instance.instance_id !== id) {
    throw new Error(`bootstrap-meta: metadata instance_id ${instance.instance_id} != requested ${id}`)
  }
  return instance
}

/** One dataset load for all ids, via the adapter (single source of truth). */
export async function loadSweInstances(ids: string[]): Promise<Map<string, SweInstance>> {
  if (ids.length === 0) throw new Error('bootstrap-meta: empty instance list')
  const adapter = createSweBenchAdapter()
  const tasks = await adapter.loadTasks({ ids, split: 'test' })
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const out = new Map<string, SweInstance>()
  for (const id of ids) {
    const task = byId.get(id)
    if (!task) throw new Error(`bootstrap-meta: ${id} not found in SWE-bench_Verified`)
    out.set(id, assertSweInstance(id, task.metadata as Record<string, unknown> | undefined))
  }
  return out
}

/** task-meta.json — the experiment's exact shape: `{ [iid]: SweInstance }`. */
export async function writeTaskMeta(ids: string[], outPath: string): Promise<void> {
  const instances = await loadSweInstances(ids)
  await writeFile(outPath, JSON.stringify(Object.fromEntries(instances), null, 1) + '\n')
}

/** <outDir>/<iid>.problem.md — problem statements ONLY (author-safe). */
export async function writeProblemStatements(ids: string[], outDir: string): Promise<string[]> {
  const instances = await loadSweInstances(ids)
  await mkdir(outDir, { recursive: true })
  const written: string[] = []
  for (const [id, inst] of instances) {
    const path = join(outDir, `${id}.problem.md`)
    await writeFile(path, inst.problem_statement)
    written.push(path)
  }
  return written
}

/** Dual-calibrate each instance through the M2 path: repro base-fail/gold-pass
 *  plus the official-judge gold gate. Gold patches come from the adapter and
 *  are only ever applied mechanically. */
export async function calibrateIds(
  ids: string[],
  opts: { verifyDir: string; workDir: string; instanceImagesPath?: string; keepWorkspaces?: boolean },
): Promise<CalibrationResult[]> {
  const instances = await loadSweInstances(ids)
  const images = await loadInstanceImages(opts.instanceImagesPath)
  const judge = createSerializedJudge()
  await mkdir(opts.workDir, { recursive: true })
  const results: CalibrationResult[] = []
  for (const id of ids) {
    const inst = instances.get(id)!
    const entry = images[id]
    if (!entry) throw new Error(`bootstrap-meta: ${id} has no image mapping (fixtures/instances.json)`)
    // verifyCmd runs with cwd = the materialized WORKSPACE (and, downstream,
    // worker clones) — the script path must be absolute or bash exits 127.
    const result = await calibrateInstance({
      instanceId: id,
      image: entry.image,
      baseCommit: entry.base_commit,
      goldPatch: inst.patch,
      verifyCmd: `bash ${resolve(opts.verifyDir, `${id}.sh`)}`,
      workDir: opts.workDir,
      judge,
      ...(opts.keepWorkspaces !== undefined ? { keepWorkspaces: opts.keepWorkspaces } : {}),
    })
    results.push(result)
    console.log(
      `CALIBRATION ${id}: baseRc=${result.baseRc} goldApplyRc=${result.goldApplyRc} goldRc=${result.goldRc} ` +
        `verifyCalibrated=${result.verifyCalibrated} goldOfficialResolved=${result.goldOfficialResolved} ` +
        `experimentValid=${result.experimentValid}`,
    )
  }
  return results
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const [mode, ...rest] = process.argv.slice(2)
  const defaultIds = defaultRound4Config().instances
  if (mode === '--task-meta') {
    const [outPath, ...ids] = rest
    if (!outPath) {
      console.error('usage: bootstrap-meta.mts --task-meta <out.json> [iid...]')
      process.exit(2)
    }
    await writeTaskMeta(ids.length > 0 ? ids : defaultIds, outPath)
    console.log(`task-meta → ${outPath}`)
  } else if (mode === '--problems') {
    const [outDir, ...ids] = rest
    if (!outDir) {
      console.error('usage: bootstrap-meta.mts --problems <outDir> [iid...]')
      process.exit(2)
    }
    for (const p of await writeProblemStatements(ids.length > 0 ? ids : defaultIds, outDir)) {
      console.log(`problem statement → ${p}`)
    }
  } else if (mode === '--calibrate') {
    const [verifyDir, workDir, ...ids] = rest
    if (!verifyDir || !workDir) {
      console.error('usage: bootstrap-meta.mts --calibrate <verifyDir> <workDir> [iid...]')
      process.exit(2)
    }
    const results = await calibrateIds(ids.length > 0 ? ids : defaultIds, { verifyDir, workDir })
    const summaryPath = join(workDir, 'calibration.json')
    await writeFile(summaryPath, JSON.stringify(results, null, 2) + '\n')
    console.log(`calibration summary → ${summaryPath}`)
    const invalid = results.filter((r) => !r.experimentValid)
    if (invalid.length > 0) {
      console.error(`NOT experiment-valid: ${invalid.map((r) => r.iid).join(', ')}`)
      process.exit(1)
    }
  } else {
    console.error(
      'usage: tsx src/swe-arena/bootstrap-meta.mts --task-meta <out.json> [iid...]\n' +
        '       tsx src/swe-arena/bootstrap-meta.mts --problems <outDir> [iid...]\n' +
        '       tsx src/swe-arena/bootstrap-meta.mts --calibrate <verifyDir> <workDir> [iid...]',
    )
    process.exit(2)
  }
}
