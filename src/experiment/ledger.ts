/**
 * Append-only campaign ledger: validation, persistence, content-addressed config
 * identity, and the by-construction capture-integrity summary. Presentation-free
 * (report rendering is an injected {@link CampaignReportRenderer}).
 */

import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  armRoles,
  type CampaignArtifact,
  type CampaignReportRenderer,
  type CampaignSummary,
  type CampaignSummaryArm,
  type ExperimentCampaignManifest,
  type ExperimentCellRecord,
  evidenceKinds,
  experimentObjectives,
  policyOrigins,
  type RunAdapterKind,
  runAdapterKinds,
} from './types'

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const nonEmpty = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(`${field} must be a non-empty string`)
  return value
}

const optionalString = (value: unknown, field: string): void => {
  if (value !== undefined && typeof value !== 'string')
    throw new Error(`${field} must be a string when set`)
}

const includes = <T extends readonly string[]>(
  values: T,
  value: unknown,
  field: string,
): T[number] => {
  if (typeof value !== 'string' || !values.includes(value))
    throw new Error(`${field} must be one of ${values.join(', ')}`)
  return value as T[number]
}

const positiveInt = (value: unknown, field: string): number => {
  if (!Number.isInteger(value) || Number(value) <= 0)
    throw new Error(`${field} must be a positive integer`)
  return Number(value)
}

const numberOrNull = (value: unknown, field: string): void => {
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error(`${field} must be a finite number or null`)
  }
}

const nonNegativeNumber = (value: unknown, field: string): void => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a non-negative finite number`)
  }
}

const stringArray = (value: unknown, field: string): readonly string[] => {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  return value.map((item, i) => nonEmpty(item, `${field}[${i}]`))
}

const assertIsoish = (value: unknown, field: string): string => {
  const text = nonEmpty(value, field)
  if (Number.isNaN(Date.parse(text))) throw new Error(`${field} must parse as a date`)
  return text
}

/** Deterministic JSON: object keys sorted, undefined dropped. The basis for a
 *  reproducible content-addressed config hash. */
export function stableJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
}

export function hashJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`
}

/** Content-addressed identity of a campaign config, ignoring the timestamp and
 *  any pre-existing hash so the same design always hashes the same. */
export function campaignConfigHash(manifest: ExperimentCampaignManifest): string {
  const { configHash: _configHash, createdAt: _createdAt, ...hashMaterial } = manifest
  return hashJson(hashMaterial)
}

export function assertCampaignManifest(
  manifest: unknown,
): asserts manifest is ExperimentCampaignManifest {
  if (!isObject(manifest)) throw new Error('manifest must be an object')
  if (manifest.schemaVersion !== 1) throw new Error('manifest.schemaVersion must be 1')
  nonEmpty(manifest.campaignId, 'manifest.campaignId')
  nonEmpty(manifest.title, 'manifest.title')
  nonEmpty(manifest.researchQuestion, 'manifest.researchQuestion')
  includes(experimentObjectives, manifest.objective, 'manifest.objective')
  assertIsoish(manifest.createdAt, 'manifest.createdAt')
  optionalString(manifest.preregistrationHash, 'manifest.preregistrationHash')
  optionalString(manifest.configHash, 'manifest.configHash')
  positiveInt(manifest.reps, 'manifest.reps')
  if (manifest.notes !== undefined) stringArray(manifest.notes, 'manifest.notes')

  if (!Array.isArray(manifest.taskSlices) || manifest.taskSlices.length === 0) {
    throw new Error('manifest.taskSlices must be a non-empty array')
  }
  const taskIds = new Set<string>()
  for (const [i, task] of manifest.taskSlices.entries()) {
    if (!isObject(task)) throw new Error(`manifest.taskSlices[${i}] must be an object`)
    const id = nonEmpty(task.id, `manifest.taskSlices[${i}].id`)
    if (taskIds.has(id)) throw new Error(`duplicate task slice id: ${id}`)
    taskIds.add(id)
    nonEmpty(task.family, `manifest.taskSlices[${i}].family`)
    includes(
      [
        'train',
        'dev',
        'holdout',
        'fresh_holdout',
        'source_adapted',
        'no_match',
        'off_family',
        'smoke',
      ] as const,
      task.split,
      `manifest.taskSlices[${i}].split`,
    )
    nonEmpty(task.taskId, `manifest.taskSlices[${i}].taskId`)
    optionalString(task.source, `manifest.taskSlices[${i}].source`)
    optionalString(task.frozenHash, `manifest.taskSlices[${i}].frozenHash`)
  }

  if (!Array.isArray(manifest.deploymentTargets) || manifest.deploymentTargets.length === 0) {
    throw new Error('manifest.deploymentTargets must be a non-empty array')
  }
  const targetIds = new Set<string>()
  for (const [i, target] of manifest.deploymentTargets.entries()) {
    if (!isObject(target)) throw new Error(`manifest.deploymentTargets[${i}] must be an object`)
    const id = nonEmpty(target.id, `manifest.deploymentTargets[${i}].id`)
    if (targetIds.has(id)) throw new Error(`duplicate deployment target id: ${id}`)
    targetIds.add(id)
    nonEmpty(target.model, `manifest.deploymentTargets[${i}].model`)
    optionalString(target.provider, `manifest.deploymentTargets[${i}].provider`)
    if (target.runtime !== undefined)
      includes(
        ['router', 'sandbox', 'local', 'fixture', 'artifact'] as const,
        target.runtime,
        `manifest.deploymentTargets[${i}].runtime`,
      )
    optionalString(target.tokenizer, `manifest.deploymentTargets[${i}].tokenizer`)
    optionalString(target.quantization, `manifest.deploymentTargets[${i}].quantization`)
    optionalString(target.servingStack, `manifest.deploymentTargets[${i}].servingStack`)
  }

  if (!Array.isArray(manifest.arms) || manifest.arms.length < 2)
    throw new Error('manifest.arms must contain at least 2 arms')
  const armIds = new Set<string>()
  const baselineCount = manifest.arms.filter(
    (arm) => isObject(arm) && arm.role === 'baseline',
  ).length
  if (baselineCount === 0) throw new Error('manifest.arms must include at least one baseline arm')
  for (const [i, arm] of manifest.arms.entries()) {
    if (!isObject(arm)) throw new Error(`manifest.arms[${i}] must be an object`)
    const id = nonEmpty(arm.id, `manifest.arms[${i}].id`)
    if (armIds.has(id)) throw new Error(`duplicate arm id: ${id}`)
    armIds.add(id)
    includes(armRoles, arm.role, `manifest.arms[${i}].role`)
    includes(policyOrigins, arm.origin, `manifest.arms[${i}].origin`)
    nonEmpty(arm.description, `manifest.arms[${i}].description`)
    if (!isObject(arm.policy)) throw new Error(`manifest.arms[${i}].policy must be an object`)
    nonEmpty(arm.policy.carrier, `manifest.arms[${i}].policy.carrier`)
    nonEmpty(arm.policy.promptTransformation, `manifest.arms[${i}].policy.promptTransformation`)
    nonEmpty(
      arm.policy.reasoningRepresentation,
      `manifest.arms[${i}].policy.reasoningRepresentation`,
    )
    if (!isObject(arm.policy.reasoningBudget))
      throw new Error(`manifest.arms[${i}].policy.reasoningBudget must be an object`)
    nonEmpty(arm.policy.reasoningBudget.kind, `manifest.arms[${i}].policy.reasoningBudget.kind`)
    nonEmpty(arm.policy.sampling, `manifest.arms[${i}].policy.sampling`)
    nonEmpty(arm.policy.verification, `manifest.arms[${i}].policy.verification`)
    nonEmpty(arm.policy.stopRule, `manifest.arms[${i}].policy.stopRule`)
    nonEmpty(arm.policy.outputContract, `manifest.arms[${i}].policy.outputContract`)
    if (arm.runtime !== undefined) {
      if (!isObject(arm.runtime)) throw new Error(`manifest.arms[${i}].runtime must be an object`)
      includes(runAdapterKinds, arm.runtime.adapter, `manifest.arms[${i}].runtime.adapter`)
      includes(evidenceKinds, arm.runtime.evidenceKind, `manifest.arms[${i}].runtime.evidenceKind`)
      optionalString(arm.runtime.profileId, `manifest.arms[${i}].runtime.profileId`)
      if (arm.runtime.notes !== undefined)
        stringArray(arm.runtime.notes, `manifest.arms[${i}].runtime.notes`)
    }
  }
}

/** Validate and stamp the deterministic config hash; rejects a mismatched
 *  pre-existing hash. */
export function manifestWithHash(manifest: ExperimentCampaignManifest): ExperimentCampaignManifest {
  assertCampaignManifest(manifest)
  const computed = campaignConfigHash(manifest)
  if (manifest.configHash !== undefined && manifest.configHash !== computed) {
    throw new Error(
      `manifest.configHash mismatch: expected ${computed}, got ${manifest.configHash}`,
    )
  }
  return { ...manifest, configHash: computed }
}

export function assertExperimentCellRecord(
  record: unknown,
): asserts record is ExperimentCellRecord {
  if (!isObject(record)) throw new Error('cell record must be an object')
  if (record.schemaVersion !== 1) throw new Error('cell.schemaVersion must be 1')
  nonEmpty(record.campaignId, 'cell.campaignId')
  nonEmpty(record.configHash, 'cell.configHash')
  nonEmpty(record.cellId, 'cell.cellId')
  assertIsoish(record.recordedAt, 'cell.recordedAt')
  includes(runAdapterKinds, record.adapter, 'cell.adapter')
  includes(evidenceKinds, record.evidenceKind, 'cell.evidenceKind')
  if (!isObject(record.task)) throw new Error('cell.task must be an object')
  if (!isObject(record.target)) throw new Error('cell.target must be an object')
  if (!isObject(record.arm)) throw new Error('cell.arm must be an object')
  positiveInt(record.rep, 'cell.rep')
  if (!Number.isInteger(record.seed)) throw new Error('cell.seed must be an integer')
  if (!isObject(record.result)) throw new Error('cell.result must be an object')
  numberOrNull(record.result.score, 'cell.result.score')
  if (record.result.passed !== null && typeof record.result.passed !== 'boolean')
    throw new Error('cell.result.passed must be boolean or null')
  if (!isObject(record.result.usage)) throw new Error('cell.result.usage must be an object')
  nonNegativeNumber(record.result.usage.inputTokens, 'cell.result.usage.inputTokens')
  nonNegativeNumber(record.result.usage.outputTokens, 'cell.result.usage.outputTokens')
  if (record.result.usage.cachedTokens !== undefined)
    nonNegativeNumber(record.result.usage.cachedTokens, 'cell.result.usage.cachedTokens')
  nonNegativeNumber(record.result.usage.costUsd, 'cell.result.usage.costUsd')
  nonNegativeNumber(record.result.usage.latencyMs, 'cell.result.usage.latencyMs')
  if (
    record.result.outputContractValid !== null &&
    typeof record.result.outputContractValid !== 'boolean'
  ) {
    throw new Error('cell.result.outputContractValid must be boolean or null')
  }
  optionalString(record.result.providerError, 'cell.result.providerError')
  optionalString(record.result.failureClass, 'cell.result.failureClass')
}

export function readCampaignLedger(path: string): ExperimentCellRecord[] {
  const text = readFileSync(path, 'utf8').trim()
  if (!text) return []
  return text.split('\n').map((line, index) => {
    const parsed = JSON.parse(line) as unknown
    try {
      assertExperimentCellRecord(parsed)
    } catch (error) {
      throw new Error(
        `${path}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    return parsed
  })
}

export function appendCampaignCell(path: string, record: ExperimentCellRecord): void {
  assertExperimentCellRecord(record)
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(record)}\n`)
}

/** Write the manifest, cells, summary, and full artifact to `outDir`. If a
 *  `renderReport` callback is given, also writes REPORT.md; the ledger itself
 *  carries no formatting. */
export function writeCampaignArtifact(
  outDir: string,
  manifest: ExperimentCampaignManifest,
  cells: readonly ExperimentCellRecord[],
  renderReport?: CampaignReportRenderer,
): CampaignArtifact {
  const finalManifest = manifestWithHash(manifest)
  const summary = summarizeCampaign(finalManifest, cells)
  const artifact: CampaignArtifact = {
    schemaVersion: 1,
    manifest: finalManifest,
    summary,
    cells,
  }
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(finalManifest, null, 2)}\n`)
  writeFileSync(
    join(outDir, 'cells.jsonl'),
    cells.map((cell) => JSON.stringify(cell)).join('\n') + (cells.length ? '\n' : ''),
  )
  writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  writeFileSync(join(outDir, 'artifact.json'), `${JSON.stringify(artifact, null, 2)}\n`)
  if (renderReport) writeFileSync(join(outDir, 'REPORT.md'), renderReport(artifact))
  return artifact
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid] ?? null
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index] ?? null
}

function countBy(
  cells: readonly ExperimentCellRecord[],
  key: (cell: ExperimentCellRecord) => string,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const cell of cells) out[key(cell)] = (out[key(cell)] ?? 0) + 1
  return out
}

function summarizeArm(armId: string, cells: readonly ExperimentCellRecord[]): CampaignSummaryArm {
  const first = cells[0]
  if (!first) throw new Error(`cannot summarize empty arm ${armId}`)
  const scores = cells
    .map((cell) => cell.result.score)
    .filter((score): score is number => typeof score === 'number')
  const passKnown = cells.filter((cell) => typeof cell.result.passed === 'boolean')
  const latencies = cells
    .map((cell) => cell.result.usage.latencyMs)
    .filter((value) => Number.isFinite(value))
  return {
    armId,
    role: first.arm.role,
    origin: first.arm.origin,
    cells: cells.length,
    scoredCells: scores.length,
    meanScore: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
    passRate: passKnown.length
      ? passKnown.filter((cell) => cell.result.passed === true).length / passKnown.length
      : null,
    totalCostUsd: cells.reduce((sum, cell) => sum + cell.result.usage.costUsd, 0),
    totalInputTokens: cells.reduce((sum, cell) => sum + cell.result.usage.inputTokens, 0),
    totalOutputTokens: cells.reduce((sum, cell) => sum + cell.result.usage.outputTokens, 0),
    latencyMs: {
      min: latencies.length ? Math.min(...latencies) : null,
      median: median(latencies),
      p90: percentile(latencies, 90),
      max: latencies.length ? Math.max(...latencies) : null,
    },
  }
}

/** Summarize a campaign per arm and compute the by-construction integrity block.
 *  `zeroUsageRealCells` flags live (non-replay) cells that scored while spending
 *  no tokens and no dollars: the canonical fake-backend signal. */
export function summarizeCampaign(
  manifest: ExperimentCampaignManifest,
  cells: readonly ExperimentCellRecord[],
): CampaignSummary {
  const finalManifest = manifestWithHash(manifest)
  const byArm = new Map<string, ExperimentCellRecord[]>()
  for (const cell of cells) {
    assertExperimentCellRecord(cell)
    if (cell.configHash !== finalManifest.configHash) {
      throw new Error(
        `cell ${cell.cellId} configHash ${cell.configHash} does not match campaign ${finalManifest.configHash}`,
      )
    }
    byArm.set(cell.arm.id, [...(byArm.get(cell.arm.id) ?? []), cell])
  }
  const syntheticAdapters = new Set<RunAdapterKind>(['fixture', 'artifact-replay'])
  return {
    campaignId: finalManifest.campaignId,
    configHash: finalManifest.configHash ?? campaignConfigHash(finalManifest),
    cells: cells.length,
    arms: [...byArm.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([armId, armCells]) => summarizeArm(armId, armCells)),
    byEvidenceKind: countBy(cells, (cell) => cell.evidenceKind),
    byAdapter: countBy(cells, (cell) => cell.adapter),
    integrity: {
      zeroUsageRealCells: cells.filter(
        (cell) =>
          !syntheticAdapters.has(cell.adapter) &&
          cell.result.metrics?.meteringUnavailable !== 1 &&
          cell.result.providerError === undefined &&
          cell.result.usage.inputTokens === 0 &&
          cell.result.usage.outputTokens === 0 &&
          cell.result.usage.costUsd === 0,
      ).length,
      meteringUnavailableCells: cells.filter(
        (cell) => cell.result.metrics?.meteringUnavailable === 1,
      ).length,
      erroredCells: cells.filter((cell) => cell.result.providerError !== undefined).length,
      unscoredCells: cells.filter((cell) => cell.result.score === null).length,
    },
  }
}
