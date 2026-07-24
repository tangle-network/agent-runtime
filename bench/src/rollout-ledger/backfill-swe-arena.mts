/**
 * swe-arena → rollout backfill — DOMAIN GLUE ONLY. Bench owns the JOIN
 * (manifest + cached cells + judge.json + result.json workerCwds + proposer
 * shot receipts → harness stores); the `tangle.rollout.v1` schema, line
 * validation, serialization, readers, exporters, and release pipeline are
 * owned by `@tangle-network/agent-eval/rollout` — bench never writes a
 * rollout row through anything but that API.
 *
 * Pure READ over one round's outDir
 * (the same artifact tree `swe-arena/manifest.mts` joins) plus the harness
 * stores, emitting `tangle.rollout.v1` lines with capture:"backfill":
 *
 *   - one SUPERVISOR line per campaign cell (instance × rep × candidate):
 *     reward = the official-judge verdict off cached-result.json, verdict =
 *     raw judge.json, cost = the durable episode receipt. The loops brain
 *     persists per-request STATS only (brain.jsonl has no message content),
 *     so supervisor transcripts are honest gap lines until settle-time
 *     capture lands.
 *   - one WORKER line per opencode worker session, joined via result.json
 *     recoveredSpend.workerCwds → opencode sqlite session.directory, with the
 *     FULL transcript inlined and reward inherited from the episode.
 *   - one PROPOSER line per proposer shot receipt, joined to the Claude
 *     project transcript of the shot's worktree cwd by time window.
 *
 * A failed join is a labeled gap line (messages: [], provenance.gap) — never
 * a silent drop: the ledger must account for every invocation it knows of.
 *
 *   tsx src/rollout-ledger/backfill-swe-arena.mts <outDir> <out.jsonl>
 */

import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { DatabaseSync } from 'node:sqlite'
import { loadCampaignCellRecords } from '../swe-arena/cell-evidence.mts'
import { buildRolloutManifest, type RolloutEntry } from '../swe-arena/manifest.mts'
import {
  DEFAULT_CLAUDE_PROJECTS_DIR,
  DEFAULT_OPENCODE_DB,
  findClaudeTranscripts,
  findOpencodeSessionsByDirectory,
  openOpencodeDb,
  readClaudeTranscript,
  readOpencodeSessionMessages,
  ROLLOUT_SCHEMA,
  type OpencodeSessionRow,
  type RolloutLine,
  writeRolloutLedger,
} from '@tangle-network/agent-eval/rollout'
import { candidateId } from './settle-capture.mts'

const OFFICIAL_JUDGE = 'swe-arena-official-judge'

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Full cached-result.json record (superset of the EvidenceCell slice). */
interface CellRecord {
  scenarioId: string
  rep: number
  artifact: Record<string, unknown> | null
  error?: string
  judgeScores?: Record<string, { composite?: number }>
  costUsd?: number
  tokenUsage?: { input?: number; output?: number }
  resolvedModel?: string
  seed?: number
  cached?: boolean
}

/** The same cell caches `loadCampaignCells` reads, kept verbatim: the backfill
 *  needs fields (judgeScores, resolvedModel, seed) the EvidenceCell slice drops.
 *  Traversal and the fail-loud identity check are owned by cell-evidence — one
 *  rule for what counts as a campaign cell. */
async function readCellRecords(campaignDir: string): Promise<CellRecord[]> {
  const records = (await loadCampaignCellRecords(campaignDir)) as unknown as CellRecord[]
  return records.sort((a, b) => a.scenarioId.localeCompare(b.scenarioId) || a.rep - b.rep)
}

async function readJson(path: string): Promise<unknown | null> {
  const raw = await readFile(path, 'utf8').catch(() => null)
  if (raw === null) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function splitModelRef(ref: string | undefined): { provider: string | null; model: string | null } {
  if (typeof ref !== 'string' || ref.length === 0) return { provider: null, model: null }
  const slash = ref.indexOf('/')
  if (slash === -1) return { provider: null, model: ref }
  return { provider: ref.slice(0, slash), model: ref.slice(slash + 1) }
}

export interface BackfillStats {
  lines: number
  byRole: Record<string, number>
  fullTranscripts: number
  gapLines: number
  rewardLabeled: number
  workerSessionsJoined: number
  /** Worker cwds with no opencode session row — a join failure. */
  workerCwdsMissed: number
  /** Sessions found but carrying no readable message parts — a store failure. */
  workerSessionsEmpty: number
  proposerShotsJoined: number
  proposerShotsMissed: number
  opencodeDbAvailable: boolean
}

export interface BackfillResult {
  lines: RolloutLine[]
  stats: BackfillStats
}

export interface BackfillOptions {
  opencodeDb?: string
  claudeProjectsDir?: string
  /** Injected clock for deterministic tests. */
  now?: () => Date
}

interface Ctx {
  outDir: string
  runId: string
  instanceCount: number
  db: DatabaseSync | null
  claudeProjectsDir: string
  capturedAt: string
  stats: BackfillStats
}

function baseLine(ctx: Ctx): Pick<RolloutLine, 'schema' | 'run_id' | 'provenance'> {
  return {
    schema: ROLLOUT_SCHEMA,
    run_id: ctx.runId,
    provenance: { captured_at: ctx.capturedAt, capture: 'backfill' },
  }
}

function push(ctx: Ctx, lines: RolloutLine[], line: RolloutLine): void {
  lines.push(line)
  ctx.stats.lines += 1
  ctx.stats.byRole[line.role] = (ctx.stats.byRole[line.role] ?? 0) + 1
  if (line.messages.length > 0) ctx.stats.fullTranscripts += 1
  else ctx.stats.gapLines += 1
  if (line.outcome.reward !== null) ctx.stats.rewardLabeled += 1
}

// ---------------------------------------------------------------------------
// Supervisor episode + worker sessions for one campaign cell.
// ---------------------------------------------------------------------------

async function emitCellLines(
  ctx: Ctx,
  lines: RolloutLine[],
  entry: RolloutEntry,
  cell: CellRecord,
): Promise<void> {
  const artifact = cell.artifact
  const runDir = artifact !== null && typeof artifact.runDir === 'string' ? artifact.runDir : null
  const judgeVerdict = runDir !== null ? await readJson(join(runDir, 'judge.json')) : null
  const resultJson = runDir !== null ? await readJson(join(runDir, 'result.json')) : null
  const result = isRecord(resultJson) ? resultJson : null

  const composite = cell.judgeScores?.[OFFICIAL_JUDGE]?.composite
  const reward =
    typeof composite === 'number'
      ? composite
      : artifact !== null && typeof artifact.resolved === 'boolean'
        ? (artifact.resolved ? 1 : 0)
        : null

  const { provider, model } = splitModelRef(cell.resolvedModel)
  const supStatus = result !== null && typeof result.sup_status === 'string' ? result.sup_status : null
  const supervisorId = randomUUID()

  push(ctx, lines, {
    ...baseLine(ctx),
    rollout_id: supervisorId,
    parent_rollout_id: null,
    candidate_id: candidateId(entry.state.generation, entry.state.candidateIndex),
    generation: entry.state.generation,
    candidate_index: entry.state.candidateIndex,
    role: 'supervisor',
    task: {
      suite: 'swe-bench-verified',
      instance_id: cell.scenarioId,
      split: 'search',
      seed: typeof cell.seed === 'number' ? cell.seed : null,
      rep: cell.rep,
    },
    policy: {
      harness: 'pi-loops',
      harness_version: null,
      model,
      provider,
      profile_commit:
        artifact !== null && typeof artifact.commit === 'string' ? artifact.commit : entry.state.commit,
      sampling: null,
    },
    messages: [],
    tool_defs: [],
    outcome: {
      reward,
      reward_source: reward === null ? null : OFFICIAL_JUDGE,
      verdict: judgeVerdict,
      metrics: {
        resolved: artifact?.resolved ?? null,
        verify_pass: artifact?.verifyPass ?? null,
        patch_lines: artifact?.patchLines ?? null,
        judge_attempts: artifact?.judgeAttempts ?? null,
        judge_wall_s: artifact?.judgeWallS ?? null,
        // Supervisor-tree spend (state.json spend tree); the durable episode
        // receipt usd is on cost.usd. Worker-session tokens live on the
        // worker lines — recovered_tokens here is the EPISODE total, so do
        // not sum tokens across roles without dedup.
        spent_tokens: artifact?.spentTokens ?? null,
        spent_usd: artifact?.spentUsd ?? null,
        recovered_tokens: artifact?.recoveredTokens ?? null,
        sup_status: supStatus,
        sup_verdict: result !== null && typeof result.sup_verdict === 'string' ? result.sup_verdict : null,
        spawned: result !== null && typeof result.spawned === 'number' ? result.spawned : null,
        workers: result !== null && typeof result.workers === 'number' ? result.workers : null,
        settled: result !== null && typeof result.settled === 'number' ? result.settled : null,
        subtasks: result !== null && Array.isArray(result.subtasks) ? result.subtasks : null,
        cached: cell.cached ?? null,
      },
      is_completed: artifact !== null && cell.error === undefined,
      is_truncated: supStatus === 'running',
      error: cell.error ?? null,
    },
    cost: {
      // The campaign CostLedger receipt for the whole episode.
      usd: typeof cell.costUsd === 'number' ? cell.costUsd : null,
      // Brain-side token split is not recorded (brain.jsonl is stats-only);
      // totals live in metrics.spent_tokens / recovered_tokens.
      tokens_in: null,
      tokens_out: null,
      tokens_reasoning: null,
      cache_read: null,
      cache_write: null,
      wall_s: artifact !== null && typeof artifact.wallS === 'number' ? artifact.wallS : null,
    },
    artifacts: {
      patch_path: artifact !== null && typeof artifact.patchPath === 'string' ? artifact.patchPath : null,
      run_dir: runDir,
      transcript_ref: runDir !== null ? join(runDir, 'brain.jsonl') : null,
    },
    provenance: {
      captured_at: ctx.capturedAt,
      capture: 'backfill',
      gap: 'supervisor brain transcript not persisted (brain.jsonl carries per-request stats only)',
    },
  })

  // Worker sessions: result.json recoveredSpend.workerCwds → opencode store.
  const recovered = result !== null && isRecord(result.recoveredSpend) ? result.recoveredSpend : null
  // A respawned worker reuses its clone cwd, so the recovered list can name the
  // same directory twice. Joining it twice would mint two rollout ids over one
  // opencode session — duplicate training signal, inflated worker counts.
  const workerCwds =
    recovered !== null && Array.isArray(recovered.workerCwds)
      ? [...new Set(recovered.workerCwds.filter((c): c is string => typeof c === 'string'))]
      : []
  for (const cwd of workerCwds) {
    const sessions = ctx.db === null ? [] : findOpencodeSessionsByDirectory(ctx.db, cwd)
    if (sessions.length === 0) {
      ctx.stats.workerCwdsMissed += 1
      push(ctx, lines, workerLine(ctx, entry, cell, supervisorId, reward, cwd, null, []))
      continue
    }
    for (const session of sessions) {
      const messages = ctx.db === null ? [] : readOpencodeSessionMessages(ctx.db, session.id)
      // Two distinct failures: no session row for the cwd (join failure) versus
      // a session row whose parts are unreadable (store integrity). One counter
      // for both would hide store corruption behind a cwd-join metric.
      if (messages.length > 0) ctx.stats.workerSessionsJoined += 1
      else ctx.stats.workerSessionsEmpty += 1
      push(ctx, lines, workerLine(ctx, entry, cell, supervisorId, reward, cwd, session, messages))
    }
  }
}

function workerLine(
  ctx: Ctx,
  entry: RolloutEntry,
  cell: CellRecord,
  supervisorId: string,
  reward: number | null,
  cwd: string,
  session: OpencodeSessionRow | null,
  messages: RolloutLine['messages'],
): RolloutLine {
  const artifact = cell.artifact
  return {
    ...baseLine(ctx),
    rollout_id: randomUUID(),
    parent_rollout_id: supervisorId,
    candidate_id: candidateId(entry.state.generation, entry.state.candidateIndex),
    generation: entry.state.generation,
    candidate_index: entry.state.candidateIndex,
    role: 'worker',
    task: {
      suite: 'swe-bench-verified',
      instance_id: cell.scenarioId,
      split: 'search',
      seed: typeof cell.seed === 'number' ? cell.seed : null,
      rep: cell.rep,
    },
    policy: {
      harness: 'opencode',
      harness_version: null,
      model: session?.model?.id ?? null,
      provider: session?.model?.providerID ?? null,
      profile_commit:
        artifact !== null && typeof artifact.commit === 'string' ? artifact.commit : entry.state.commit,
      sampling: null,
    },
    messages,
    tool_defs: [],
    outcome: {
      // Episode-level credit: the worker has no verdict of its own.
      reward,
      reward_source: reward === null ? null : `${OFFICIAL_JUDGE}/inherited`,
      verdict: null,
      metrics: {
        worker_cwd: cwd,
        session_agent: session?.agent ?? null,
        session_parent_id: session?.parentId ?? null,
        has_session: session !== null,
      },
      // A session row with no readable parts is a gap line, not a completed
      // invocation — training filters that key on is_completed alone would
      // otherwise pull empty transcripts.
      is_completed: session !== null && messages.length > 0,
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
      run_dir: artifact !== null && typeof artifact.runDir === 'string' ? artifact.runDir : null,
      transcript_ref: session !== null ? `opencode:${session.id}` : null,
    },
    provenance: {
      captured_at: ctx.capturedAt,
      capture: 'backfill',
      ...(messages.length === 0
        ? {
            gap:
              session === null
                ? ctx.db === null
                  ? `opencode store unavailable; worker cwd ${cwd} unrecoverable`
                  : `no opencode session found for worker cwd ${cwd}`
                : `opencode session ${session.id} has no readable message parts`,
          }
        : {}),
    },
  }
}

// ---------------------------------------------------------------------------
// Proposer shots — receipts under proposer-shots/ (flat or per-author dirs),
// joined to Claude transcripts of the shot worktree by time window.
// ---------------------------------------------------------------------------

interface ShotReceiptFile {
  path: string
  author: string | null
  generation: number
  candidateIndex: number
  shot: number
}

async function listShotReceipts(outDir: string): Promise<ShotReceiptFile[]> {
  const shotDir = join(outDir, 'proposer-shots')
  const found: ShotReceiptFile[] = []
  const parse = (name: string, author: string | null, path: string): void => {
    const match = /^gen(\d+)-cand(\d+)-shot(\d+)\.json$/.exec(name)
    if (match === null) return
    found.push({
      path,
      author,
      generation: Number(match[1]),
      candidateIndex: Number(match[2]),
      shot: Number(match[3]),
    })
  }
  for (const entry of await readdir(shotDir, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory()) {
      const authorDir = join(shotDir, entry.name)
      for (const name of await readdir(authorDir).catch(() => [])) {
        parse(name, entry.name, join(authorDir, name))
      }
    } else {
      parse(entry.name, null, join(shotDir, entry.name))
    }
  }
  return found.sort((a, b) => a.path.localeCompare(b.path))
}

async function emitProposerLines(ctx: Ctx, lines: RolloutLine[], entries: RolloutEntry[]): Promise<void> {
  const receipts = await listShotReceipts(ctx.outDir)
  const entryFor = new Map<string, RolloutEntry>()
  for (const entry of entries) {
    entryFor.set(`${entry.state.generation}:${entry.state.candidateIndex}`, entry)
  }

  for (const shot of receipts) {
    const parsed = await readJson(shot.path)
    const receipt = isRecord(parsed) && isRecord(parsed.receipt) ? parsed.receipt : null
    const entry = entryFor.get(`${shot.generation}:${shot.candidateIndex}`) ?? null

    // The proposer worktree the arena dispatched this shot into.
    const worktreeCwd =
      shot.author !== null
        ? join(ctx.outDir, 'proposer-wt', `gen${shot.generation}-cand${shot.candidateIndex}-${shot.author}`)
        : join(ctx.outDir, 'proposer-wt', `gen${shot.generation}-cand${shot.candidateIndex}`)

    const startedAt = receipt !== null && typeof receipt.startedAt === 'string' ? Date.parse(receipt.startedAt) : NaN
    const completedAt =
      receipt !== null && typeof receipt.completedAt === 'string' ? Date.parse(receipt.completedAt) : NaN

    let transcript: Awaited<ReturnType<typeof readClaudeTranscript>> | null = null
    let transcriptRef: string | null = null
    const candidates = await findClaudeTranscripts(worktreeCwd, ctx.claudeProjectsDir)
    const windowed: Array<{ path: string; startMs: number }> = []
    for (const ref of candidates) {
      const t = await readClaudeTranscript(ref.path)
      if (t.startedAt === null) continue
      const startMs = Date.parse(t.startedAt)
      const inWindow =
        Number.isNaN(startedAt) || Number.isNaN(completedAt)
          ? candidates.length === 1
          : startMs >= startedAt - 120_000 && startMs <= completedAt + 120_000
      if (inWindow) windowed.push({ path: ref.path, startMs })
    }
    if (windowed.length > 0) {
      windowed.sort(
        (a, b) => Math.abs(a.startMs - (startedAt || a.startMs)) - Math.abs(b.startMs - (startedAt || b.startMs)),
      )
      transcriptRef = windowed[0].path
      transcript = await readClaudeTranscript(transcriptRef)
      ctx.stats.proposerShotsJoined += 1
    } else {
      ctx.stats.proposerShotsMissed += 1
    }

    // The proposer's reward is its candidate's official resolved fraction —
    // fail-closed null when the candidate has no scored entry.
    const reward =
      entry !== null && ctx.instanceCount > 0 ? entry.outcome.resolvedCount / ctx.instanceCount : null

    push(ctx, lines, {
      ...baseLine(ctx),
      rollout_id: randomUUID(),
      parent_rollout_id: null,
      candidate_id: candidateId(shot.generation, shot.candidateIndex),
      generation: shot.generation,
      candidate_index: shot.candidateIndex,
      role: 'proposer',
      task: {
        suite: 'swe-arena-proposer',
        instance_id:
          shot.author !== null
            ? `gen${shot.generation}-cand${shot.candidateIndex}-${shot.author}`
            : `gen${shot.generation}-cand${shot.candidateIndex}`,
        split: 'search',
        seed: null,
        rep: shot.shot,
      },
      policy: {
        harness: receipt !== null && typeof receipt.harness === 'string' ? receipt.harness : null,
        harness_version: null,
        model:
          transcript?.model ?? (receipt !== null && typeof receipt.model === 'string' ? receipt.model : null),
        provider: null,
        profile_commit: entry?.state.commit ?? null,
        sampling: null,
      },
      messages: transcript?.messages ?? [],
      tool_defs: [],
      outcome: {
        reward,
        reward_source: reward === null ? null : `${OFFICIAL_JUDGE}/candidate-resolved-fraction`,
        verdict: null,
        metrics: {
          resolved_count: entry?.outcome.resolvedCount ?? null,
          instance_count: ctx.instanceCount,
          exit_code: receipt !== null && typeof receipt.exitCode === 'number' ? receipt.exitCode : null,
          timed_out: receipt !== null && typeof receipt.timedOut === 'boolean' ? receipt.timedOut : null,
          author: shot.author,
          max_shots: receipt !== null && typeof receipt.maxShots === 'number' ? receipt.maxShots : null,
          prompt_sha256: receipt !== null && typeof receipt.promptSha256 === 'string' ? receipt.promptSha256 : null,
        },
        is_completed: receipt !== null && receipt.exitCode === 0,
        is_truncated: receipt !== null && receipt.timedOut === true,
        error: receipt !== null && typeof receipt.error === 'string' ? receipt.error : null,
      },
      cost: {
        usd: receipt !== null && typeof receipt.costUsd === 'number' ? receipt.costUsd : null,
        tokens_in: transcript !== null ? transcript.usage.tokensIn : null,
        tokens_out: transcript !== null ? transcript.usage.tokensOut : null,
        tokens_reasoning: null,
        cache_read: transcript !== null ? transcript.usage.cacheRead : null,
        cache_write: transcript !== null ? transcript.usage.cacheWrite : null,
        wall_s:
          receipt !== null && typeof receipt.durationMs === 'number' ? Math.round(receipt.durationMs / 1000) : null,
      },
      artifacts: {
        patch_path: entry?.action.diffPath ?? null,
        run_dir: worktreeCwd,
        transcript_ref: transcriptRef ?? shot.path,
      },
      provenance: {
        captured_at: ctx.capturedAt,
        capture: 'backfill',
        ...(transcript === null
          ? { gap: `no claude transcript matched worktree ${worktreeCwd} in the shot's time window` }
          : {}),
      },
    })
  }
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------

export async function backfillSweArena(outDir: string, opts: BackfillOptions = {}): Promise<BackfillResult> {
  const manifest = await buildRolloutManifest(outDir)
  const provenance = isRecord(manifest.provenance) ? manifest.provenance : null
  const runId = provenance !== null && typeof provenance.runId === 'string' ? provenance.runId : outDir

  const db = await openOpencodeDb(opts.opencodeDb ?? DEFAULT_OPENCODE_DB)
  const ctx: Ctx = {
    outDir,
    runId,
    instanceCount: manifest.instances.length,
    db,
    claudeProjectsDir: opts.claudeProjectsDir ?? DEFAULT_CLAUDE_PROJECTS_DIR,
    capturedAt: (opts.now?.() ?? new Date()).toISOString(),
    stats: {
      lines: 0,
      byRole: {},
      fullTranscripts: 0,
      gapLines: 0,
      rewardLabeled: 0,
      workerSessionsJoined: 0,
      workerCwdsMissed: 0,
      workerSessionsEmpty: 0,
      proposerShotsJoined: 0,
      proposerShotsMissed: 0,
      opencodeDbAvailable: db !== null,
    },
  }

  const lines: RolloutLine[] = []
  const entries: RolloutEntry[] = manifest.generations.flatMap((g) => g.rollouts)
  try {
    for (const entry of entries) {
      for (const cell of await readCellRecords(entry.state.campaignDir)) {
        await emitCellLines(ctx, lines, entry, cell)
      }
    }
    await emitProposerLines(ctx, lines, entries)
  } finally {
    db?.close()
  }

  return { lines, stats: ctx.stats }
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const [outDir, ledgerPath] = process.argv.slice(2)
  if (!outDir || !ledgerPath) {
    console.error('usage: tsx src/rollout-ledger/backfill-swe-arena.mts <outDir> <out.jsonl>')
    process.exit(2)
  }
  const { lines, stats } = await backfillSweArena(outDir)
  await writeRolloutLedger(ledgerPath, lines)
  console.log(JSON.stringify(stats, null, 2))
  console.log(`rollout ledger → ${ledgerPath} (${lines.length} lines)`)
}
