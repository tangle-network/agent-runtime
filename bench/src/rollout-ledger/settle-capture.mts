/**
 * Settle-time rollout capture with LABEL v2 — `tangle.rollout.v1` lines
 * emitted LIVE, right after each campaign cell is judged, while the harness
 * stores still hold the transcripts (the whole reason settle-time capture
 * beats backfill: the opencode sqlite db and claude project transcripts are
 * mutable/garbage-collected).
 *
 * LABEL v2 semantics (reward_source tags distinguish them from the v1
 * backfill's inherited labels — both coexist in one ledger):
 *
 *  - WORKERS get CONTRIBUTION-AWARE reward: reward=1 only when the cell
 *    resolved AND that worker's patch was the delivered one (delivered-patch
 *    identity from the supervisor run dir's per-worker evidence,
 *    workers/<label>.patch); sibling bystanders in a resolved cell get
 *    reward=0 with metrics.bystander=true. In an unresolved cell every worker
 *    gets reward=0. A resolved cell whose delivered patch matches NO worker
 *    patch is a labeled identity gap: reward=null,
 *    metrics.delivered_match='unknown' — never a fabricated credit.
 *  - The SUPERVISOR line keeps the official-judge verdict as its reward
 *    (unchanged semantics; brain transcripts remain honest gap lines until
 *    the loops brain persists message content — journal + stats are joined
 *    into metrics).
 *  - PROPOSERS get BASELINE-RELATIVE reward: candidate_score −
 *    baseline_score (resolved fractions), so an improvement is positive and
 *    a regression negative — emitted once per candidate when the round's
 *    scores are final.
 */

// TODO(UNIFICATION, https://github.com/tangle-network/agent-runtime/issues/593):
// tangle.rollout.v1 is now owned by @tangle-network/agent-eval/rollout (schema,
// ledger, readers, exporters, release). These branch-local imports are the
// pre-unification copies and MUST be swapped for the agent-eval API the moment
// agent-eval 0.124.0 is published (blocked today only by publish timing — do
// not extend the local copies). On swap: emit task.split 'search' (canonical
// trainable split) and set candidate_id; the LABEL v2 reward logic stays here.
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import {
  DEFAULT_OPENCODE_DB,
  findOpencodeSessionsByDirectory,
  openOpencodeDb,
  readOpencodeSessionMessages,
  type OpencodeSessionRow,
} from './opencode-reader.mts'
import { appendRolloutLines } from './ledger.mts'
import { ROLLOUT_LEDGER_SCHEMA, type ChatMessage, type RolloutLine } from './types.ts'

export const OFFICIAL_JUDGE = 'swe-arena-official-judge'
export const WORKER_REWARD_SOURCE_V2 = `${OFFICIAL_JUDGE}/contribution-v2`
export const PROPOSER_REWARD_SOURCE_V2 = `${OFFICIAL_JUDGE}/baseline-relative-v2`

// ---------------------------------------------------------------------------
// Worker evidence — the supervisor run dir's per-worker record.
// ---------------------------------------------------------------------------

export interface WorkerEvidenceRecord {
  label: string
  /** Worker clone cwd from the ndjson `started` event (opencode join key). */
  cwd: string | null
  /** Patch persisted at settle time (workers/<label>.patch); null = none. */
  patch: string | null
}

/** Read workers/<label>.{ndjson,patch} under one supervisor run dir. */
export async function readWorkerEvidence(supRunDir: string): Promise<WorkerEvidenceRecord[]> {
  const workersDir = join(supRunDir, 'workers')
  const names = await readdir(workersDir).catch(() => [])
  const labels = new Set<string>()
  for (const name of names) {
    if (name.endsWith('.ndjson') && !name.endsWith('.inbox.ndjson')) labels.add(name.slice(0, -'.ndjson'.length))
    else if (name.endsWith('.patch')) labels.add(name.slice(0, -'.patch'.length))
  }
  const records: WorkerEvidenceRecord[] = []
  for (const label of [...labels].sort()) {
    let cwd: string | null = null
    const nd = await readFile(join(workersDir, `${label}.ndjson`), 'utf8').catch(() => '')
    for (const line of nd.split('\n')) {
      if (!line.trim()) continue
      try {
        const o = JSON.parse(line) as Record<string, unknown>
        if (o.kind === 'started' && typeof o.cwd === 'string') cwd = o.cwd
      } catch {
        // A corrupt event line cannot invalidate the rest of the evidence.
      }
    }
    const patch = await readFile(join(workersDir, `${label}.patch`), 'utf8').catch(() => null)
    records.push({ label, cwd, patch: patch !== null && patch.trim().length > 0 ? patch : null })
  }
  return records
}

/** Labels whose persisted patch IS the delivered patch (trimmed equality —
 *  the supervisor delivers a settled worker's patch verbatim). */
export function deliveredWorkerLabels(deliveredPatch: string, workers: readonly WorkerEvidenceRecord[]): string[] {
  const delivered = deliveredPatch.trim()
  if (delivered.length === 0) return []
  return workers.filter((w) => w.patch !== null && w.patch.trim() === delivered).map((w) => w.label)
}

export interface WorkerRewardV2 {
  reward: number | null
  bystander: boolean
  /** 'delivered' | 'bystander' | 'unresolved' | 'unknown' (identity gap). */
  deliveredMatch: 'delivered' | 'bystander' | 'unresolved' | 'unknown'
}

/** The v2 contribution rule for one worker in one cell. */
export function workerRewardV2(input: {
  /** Official judge verdict for the cell; null = inconclusive. */
  resolved: boolean | null
  /** This worker's label is among the delivered-patch matches. */
  isDelivered: boolean
  /** At least one worker matched the delivered patch (identity known). */
  identityKnown: boolean
}): WorkerRewardV2 {
  if (input.resolved !== true) {
    return { reward: input.resolved === false ? 0 : null, bystander: false, deliveredMatch: 'unresolved' }
  }
  if (!input.identityKnown) {
    return { reward: null, bystander: false, deliveredMatch: 'unknown' }
  }
  if (input.isDelivered) return { reward: 1, bystander: false, deliveredMatch: 'delivered' }
  return { reward: 0, bystander: true, deliveredMatch: 'bystander' }
}

/** Baseline-relative proposer reward (resolved fractions; improvement > 0). */
export function proposerRewardV2(candResolved: number, baselineResolved: number, instanceCount: number): number {
  if (!(instanceCount > 0)) throw new Error('proposerRewardV2: instanceCount must be > 0')
  return (candResolved - baselineResolved) / instanceCount
}

// ---------------------------------------------------------------------------
// The live capture handle.
// ---------------------------------------------------------------------------

export interface SettleCaptureOptions {
  /** Ledger JSONL destination (appended live, one flush per cell). */
  ledgerPath: string
  runId: string
  instanceCount: number
  opencodeDb?: string
  /** Injected clock for deterministic tests. */
  now?: () => Date
  log?: (msg: string) => void
}

export interface CellCaptureArgs {
  generation: number
  candidateIndex: number
  iid: string
  rep: number
  seed: number | null
  /** Our public/private sub-split of the train instances (metrics label). */
  splitVisibility: 'public' | 'private' | null
  commit: string | null
  /** Official judge verdict (null = inconclusive). */
  resolved: boolean | null
  /** Raw judge verdict record, verbatim. */
  judgeVerdict: unknown
  runDir: string | null
  patchPath: string | null
  /** Supervisor run dir (<ws>/.loops/supervisor/<id>); null = unlocatable. */
  supRunDir: string | null
  /** The delivered patch text (empty = no delivery). */
  deliveredPatch: string
  workerModel: string | null
  metrics: Record<string, unknown>
  cost: { usd: number | null; wallS: number | null; spentTokens: number | null }
}

export interface ProposerCaptureArgs {
  generation: number
  candidateIndex: number
  proposer: string
  harness: string | null
  commit: string | null
  candResolved: number
  baselineResolved: number
  shotReceiptPaths: string[]
  diffPath: string | null
}

export interface SettleCapture {
  readonly path: string
  captureCell(args: CellCaptureArgs): Promise<{ lines: number }>
  captureProposer(args: ProposerCaptureArgs): Promise<{ lines: number }>
}

export function createSettleCapture(opts: SettleCaptureOptions): SettleCapture {
  const now = opts.now ?? (() => new Date())
  const log = opts.log ?? (() => {})
  const dbPath = opts.opencodeDb ?? DEFAULT_OPENCODE_DB

  const base = (capturedAt: string): Pick<RolloutLine, 'schema' | 'run_id'> & { provenance: RolloutLine['provenance'] } => ({
    schema: ROLLOUT_LEDGER_SCHEMA,
    run_id: opts.runId,
    provenance: { captured_at: capturedAt, capture: 'settle-time' },
  })

  return {
    path: opts.ledgerPath,

    async captureCell(args: CellCaptureArgs): Promise<{ lines: number }> {
      const capturedAt = now().toISOString()
      const supervisorId = randomUUID()
      const reward = args.resolved === null ? null : args.resolved ? 1 : 0
      const lines: RolloutLine[] = []

      lines.push({
        ...base(capturedAt),
        rollout_id: supervisorId,
        parent_rollout_id: null,
        generation: args.generation,
        candidate_index: args.candidateIndex,
        role: 'supervisor',
        task: { suite: 'swe-bench-verified', instance_id: args.iid, split: 'train', seed: args.seed, rep: args.rep },
        policy: {
          harness: 'pi-loops',
          harness_version: null,
          model: args.workerModel,
          provider: null,
          profile_commit: args.commit,
          sampling: null,
        },
        messages: [],
        tool_defs: [],
        outcome: {
          reward,
          reward_source: reward === null ? null : OFFICIAL_JUDGE,
          verdict: args.judgeVerdict,
          metrics: {
            ...args.metrics,
            ...(args.splitVisibility !== null ? { split_visibility: args.splitVisibility } : {}),
          },
          is_completed: args.resolved !== null,
          is_truncated: false,
          error: null,
        },
        cost: {
          usd: args.cost.usd,
          tokens_in: null,
          tokens_out: null,
          tokens_reasoning: null,
          cache_read: null,
          cache_write: null,
          wall_s: args.cost.wallS,
        },
        artifacts: {
          patch_path: args.patchPath,
          run_dir: args.runDir,
          transcript_ref: args.runDir !== null ? join(args.runDir, 'brain.jsonl') : null,
        },
        provenance: {
          captured_at: capturedAt,
          capture: 'settle-time',
          gap: 'supervisor brain transcript not persisted (brain.jsonl carries per-request stats only)',
        },
      })

      // Worker lines with v2 contribution labels.
      const workers = args.supRunDir !== null ? await readWorkerEvidence(args.supRunDir) : []
      if (workers.length > 0) {
        const delivered = new Set(deliveredWorkerLabels(args.deliveredPatch, workers))
        const identityKnown = delivered.size > 0
        let db: DatabaseSync | null = null
        try {
          db = await openOpencodeDb(dbPath)
          for (const worker of workers) {
            const v2 = workerRewardV2({
              resolved: args.resolved,
              isDelivered: delivered.has(worker.label),
              identityKnown,
            })
            let session: OpencodeSessionRow | null = null
            let messages: ChatMessage[] = []
            if (db !== null && worker.cwd !== null) {
              const sessions = findOpencodeSessionsByDirectory(db, worker.cwd)
              session = sessions[0] ?? null
              if (session !== null) messages = readOpencodeSessionMessages(db, session.id)
            }
            lines.push({
              ...base(capturedAt),
              rollout_id: randomUUID(),
              parent_rollout_id: supervisorId,
              generation: args.generation,
              candidate_index: args.candidateIndex,
              role: 'worker',
              task: {
                suite: 'swe-bench-verified',
                instance_id: args.iid,
                split: 'train',
                seed: args.seed,
                rep: args.rep,
              },
              policy: {
                harness: 'opencode',
                harness_version: null,
                model: session?.model?.id ?? null,
                provider: session?.model?.providerID ?? null,
                profile_commit: args.commit,
                sampling: null,
              },
              messages,
              tool_defs: [],
              outcome: {
                reward: v2.reward,
                reward_source: v2.reward === null && v2.deliveredMatch !== 'unknown' ? null : WORKER_REWARD_SOURCE_V2,
                verdict: null,
                metrics: {
                  worker_label: worker.label,
                  worker_cwd: worker.cwd,
                  bystander: v2.bystander,
                  delivered_match: v2.deliveredMatch,
                  has_patch: worker.patch !== null,
                  ...(args.splitVisibility !== null ? { split_visibility: args.splitVisibility } : {}),
                },
                is_completed: session !== null,
                is_truncated: false,
                error: null,
              },
              cost: {
                usd: session?.costUsd ?? null,
                tokens_in: session?.tokensInput ?? null,
                tokens_out: session?.tokensOutput ?? null,
                tokens_reasoning: session?.tokensReasoning ?? null,
                cache_read: session?.tokensCacheRead ?? null,
                cache_write: session?.tokensCacheWrite ?? null,
                wall_s: session !== null ? Math.round((session.timeUpdated - session.timeCreated) / 1000) : null,
              },
              artifacts: {
                patch_path: null,
                run_dir: args.runDir,
                transcript_ref: session !== null ? `opencode:${session.id}` : null,
              },
              provenance: {
                captured_at: capturedAt,
                capture: 'settle-time',
                ...(messages.length === 0
                  ? {
                      gap:
                        worker.cwd === null
                          ? `worker ${worker.label} recorded no clone cwd in its ndjson`
                          : session === null
                            ? db === null
                              ? `opencode store unavailable; worker cwd ${worker.cwd} unrecoverable`
                              : `no opencode session found for worker cwd ${worker.cwd}`
                            : `opencode session ${session.id} has no readable message parts`,
                    }
                  : {}),
              },
            })
          }
        } finally {
          db?.close()
        }
      }

      await appendRolloutLines(opts.ledgerPath, lines)
      log(`rollout-ledger: +${lines.length} line(s) (cell ${args.iid} r${args.rep}) → ${opts.ledgerPath}`)
      return { lines: lines.length }
    },

    async captureProposer(args: ProposerCaptureArgs): Promise<{ lines: number }> {
      const capturedAt = now().toISOString()
      const reward = proposerRewardV2(args.candResolved, args.baselineResolved, opts.instanceCount)
      const line: RolloutLine = {
        ...base(capturedAt),
        rollout_id: randomUUID(),
        parent_rollout_id: null,
        generation: args.generation,
        candidate_index: args.candidateIndex,
        role: 'proposer',
        task: {
          suite: 'swe-arena-proposer',
          instance_id: `gen${args.generation}-cand${args.candidateIndex}-${args.proposer}`,
          split: 'train',
          seed: null,
          rep: 0,
        },
        policy: {
          harness: args.harness,
          harness_version: null,
          model: null,
          provider: null,
          profile_commit: args.commit,
          sampling: null,
        },
        messages: [],
        tool_defs: [],
        outcome: {
          reward,
          reward_source: PROPOSER_REWARD_SOURCE_V2,
          verdict: null,
          metrics: {
            resolved_count: args.candResolved,
            baseline_resolved_count: args.baselineResolved,
            instance_count: opts.instanceCount,
            proposer: args.proposer,
            shot_receipts: args.shotReceiptPaths,
          },
          is_completed: true,
          is_truncated: false,
          error: null,
        },
        cost: { usd: null, tokens_in: null, tokens_out: null, tokens_reasoning: null, cache_read: null, cache_write: null, wall_s: null },
        artifacts: {
          patch_path: args.diffPath !== null && existsSync(args.diffPath) ? args.diffPath : null,
          run_dir: null,
          transcript_ref: args.shotReceiptPaths[0] ?? null,
        },
        provenance: {
          captured_at: capturedAt,
          capture: 'settle-time',
          gap: 'proposer transcript joined at backfill time (settle-time line carries the v2 reward label)',
        },
      }
      await appendRolloutLines(opts.ledgerPath, [line])
      log(`rollout-ledger: +1 proposer line (${args.proposer}, reward ${reward.toFixed(3)}) → ${opts.ledgerPath}`)
      return { lines: 1 }
    },
  }
}

/** Parse (generation, candidateIndex) off a campaign cell artifact path — the
 *  campaign DIRECTORY is the blessed attribution source (never dispatch
 *  order): `<improveRunDir>/gen-<g>/candidate-<k>/<cell>/…` for candidates,
 *  `<improveRunDir>/baseline/<cell>/…` (→ −1/−1) for the baseline. */
export function campaignCoordsFromCellPath(path: string): { generation: number; candidateIndex: number } | null {
  const cand = /\/gen-(\d+)\/candidate-(\d+)\//.exec(path)
  if (cand !== null) return { generation: Number(cand[1]), candidateIndex: Number(cand[2]) }
  if (/\/baseline\//.test(path)) return { generation: -1, candidateIndex: -1 }
  return null
}
