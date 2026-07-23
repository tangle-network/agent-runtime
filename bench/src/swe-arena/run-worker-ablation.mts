/**
 * Worker-model ablation runner — the pre-registered question: is the
 * supervisor's 1/6 reps-confirmed baseline a supervisor-design limit or a
 * worker-model capability limit?
 *
 * Protocol: supervisor FROZEN at the gen-3/4 baseline loops commit; ONLY the
 * worker model/harness is swapped (workerModel + LOOPS_WORKER_HARNESS env knob
 * + a PATH shim translating loops' opencode-shaped worker argv to the claude
 * CLI — no loops code change). Same 6 instances x 2 reps, same budgets as the
 * premeasured baseline campaign (budget 40, maxSandboxes 4, maxUsd 8,
 * maxDepth 3, timeoutMs 2_800_000), cells run serially like the baseline
 * (maxConcurrency 1).
 *
 * Two phases so the official docker judge (shared flock with any concurrent
 * campaign) is only touched AFTER all model-side sessions finish:
 *   phase "cells": run every supervisor arm cell, persist result.json + patch.
 *   phase "judge": serialized official judge over all collected patches.
 *
 *   tsx src/swe-arena/run-worker-ablation.mts <config.json> [--judge-only]
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { createSweBenchAdapter } from '../benchmarks/swe-bench.ts'
import {
  loadExcludes,
  runSupervisorArm,
  type SecretsEnv,
  type SupervisorArmResult,
  type SupervisorArmSpec,
} from './arms.ts'
import { loadInstanceImages } from './run-experiment.mts'
import { createSerializedJudge, type JudgeVerdict } from './serialized-judge.ts'

interface AblationConfig {
  instances: string[]
  repsPerInstance: number
  armName: string
  arm: {
    workerModel: string
    driverModel: string
    budget: number
    maxSandboxes: number
    maxUsd: number
    maxDepth: number
    timeoutMs: number
    envKnobs?: Record<string, string>
  }
  loopsRepo: string
  verifyDir: string
  outDir: string
  secretsDir: string
  envFiles: string[]
}

const [, , configPath, flag] = process.argv
if (!configPath) {
  console.error('usage: tsx run-worker-ablation.mts <config.json> [--judge-only]')
  process.exit(2)
}
const config = JSON.parse(await readFile(configPath, 'utf8')) as AblationConfig
const judgeOnly = flag === '--judge-only'

const log = (msg: string): void => console.log(`[${new Date().toISOString()}] ${msg}`)

const secrets: SecretsEnv = { secretsDir: config.secretsDir, envFiles: config.envFiles }
const excludes = await loadExcludes()
const images = await loadInstanceImages()
const adapter = createSweBenchAdapter()
const tasks = await adapter.loadTasks({ ids: config.instances, split: 'test' })
const taskById = new Map(tasks.map((t) => [t.id, t]))

const cellDir = (iid: string, rep: number): string => join(config.outDir, 'cells', iid, `rep${rep}`)

// ── phase: cells (no docker, no judge) ─────────────────────────────────────
if (!judgeOnly) {
  for (const iid of config.instances) {
    const task = taskById.get(iid)
    if (!task) throw new Error(`instance ${iid} not found in SWE-bench_Verified`)
    const entry = images[iid]
    if (!entry) throw new Error(`instance ${iid} has no image mapping`)
    const problemStatement = String(task.metadata?.problem_statement ?? '')
    if (!problemStatement) throw new Error(`${iid}: empty problem_statement`)

    for (let rep = 0; rep < config.repsPerInstance; rep += 1) {
      const dir = cellDir(iid, rep)
      const resultPath = join(dir, 'result.json')
      if (existsSync(resultPath)) {
        log(`SKIP cell ${iid} rep${rep} (result.json exists)`)
        continue
      }
      await mkdir(dir, { recursive: true })
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
        extensionPath: join(config.loopsRepo, 'extensions', 'pi', 'loops.ts'),
        timeoutMs: config.arm.timeoutMs,
      }
      log(`>>> cell ${iid} rep${rep} (worker=${config.arm.workerModel})`)
      const t0 = Date.now()
      const ctx = {
        instanceId: iid,
        image: entry.image,
        baseCommit: entry.base_commit,
        problemStatement,
        verifyCmd: `bash ${join(config.verifyDir, `${iid}.sh`)}`,
        outDir: dir,
        secrets,
        excludes,
      }
      // Retry once: a concurrent campaign's judge pre-clean (docker rm -f by
      // instance short-name) can kill this cell's ext-* materialize container
      // mid-cp — a transient infra failure, not a model outcome. A second
      // failure is recorded as a failed-cell marker and the campaign continues.
      let res: SupervisorArmResult | undefined
      let lastErr: unknown
      for (let attempt = 0; attempt < 2 && !res; attempt += 1) {
        try {
          res = await runSupervisorArm(spec, ctx)
        } catch (err) {
          lastErr = err
          log(`cell ${iid} rep${rep} attempt ${attempt + 1} FAILED: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      if (!res) {
        await writeFile(join(dir, 'failed.json'), JSON.stringify({ iid, rep, error: String(lastErr) }, null, 2))
        continue
      }
      await writeFile(resultPath, JSON.stringify({ ...res, rep, startedAt: t0, endedAt: Date.now() }, null, 2))
      log(
        `<<< cell ${iid} rep${rep}: verify_pass=${res.verify_pass} patch_lines=${res.patch_lines} ` +
          `wall_s=${res.wall_s} workers=${res.workers} verdict=${res.sup_verdict} usd=${res.spentUsd} tok=${res.spentTokens}`,
      )
    }
  }
  log('all cells complete')
}

// ── phase: judge (serialized, shared cross-process lock, 1800s ceiling) ────
const judge = createSerializedJudge()
const summary: Array<Record<string, unknown>> = []
for (const iid of config.instances) {
  for (let rep = 0; rep < config.repsPerInstance; rep += 1) {
    const dir = cellDir(iid, rep)
    const resultPath = join(dir, 'result.json')
    if (!existsSync(resultPath)) {
      // A twice-failed cell (failed.json) is an infra hole, reported as such —
      // never a fabricated verdict.
      summary.push({ iid, rep, resolved: null, note: existsSync(join(dir, 'failed.json')) ? 'cell-failed' : 'cell-missing' })
      log(`NO RESULT for ${iid} rep${rep} — recorded as inconclusive infra hole`)
      continue
    }
    const res = JSON.parse(await readFile(resultPath, 'utf8')) as SupervisorArmResult & { rep: number }
    const verdictPath = join(dir, 'verdict.json')
    let verdict: JudgeVerdict
    if (existsSync(verdictPath)) {
      verdict = JSON.parse(await readFile(verdictPath, 'utf8')) as JudgeVerdict
      log(`SKIP judge ${iid} rep${rep} (verdict.json exists: resolved=${verdict.resolved})`)
    } else {
      log(`JUDGE ${iid} rep${rep} patch=${res.patchPath}`)
      verdict = await judge.judge(iid, res.patchPath, `wabl-rep${rep}`)
      await writeFile(verdictPath, JSON.stringify(verdict, null, 2))
      log(`JUDGED ${iid} rep${rep}: resolved=${verdict.resolved} secs=${verdict.secs} attempts=${verdict.attempts}`)
    }
    summary.push({
      iid,
      rep,
      resolved: verdict.resolved,
      verify_pass: res.verify_pass,
      patch_lines: res.patch_lines,
      wall_s: res.wall_s,
      workers: res.workers,
      settled: res.settled,
      sup_status: res.sup_status,
      sup_verdict: res.sup_verdict,
      spentUsd: res.spentUsd,
      spentTokens: res.spentTokens,
    })
  }
}
await writeFile(join(config.outDir, 'summary.json'), JSON.stringify(summary, null, 2))
log(`summary written: ${join(config.outDir, 'summary.json')}`)
for (const row of summary) console.log(JSON.stringify(row))
