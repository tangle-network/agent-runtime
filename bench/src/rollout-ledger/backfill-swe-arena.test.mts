import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertRolloutLine, claudeProjectSlug, toSftRows } from '@tangle-network/agent-eval/rollout'
import { backfillSweArena } from './backfill-swe-arena.mts'

let dir: string
let outDir: string
let dbPath: string
let projectsDir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'backfill-swe-'))
  outDir = join(dir, 'out')
  dbPath = join(dir, 'opencode.db')
  projectsDir = join(dir, 'claude-projects')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const COMMIT = '1deb554c45d31dd0d4a851efe90da875cd9b50c8'
const WORKER_CWD = '/tmp/loops-w-0-backfill-fixture'
const MISSING_CWD = '/tmp/loops-w-1-backfill-missing'

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, JSON.stringify(value, null, 1))
}

function cachedResult(iid: string, resolved: boolean, runDir: string): unknown {
  return {
    manifestHash: 'x',
    cellId: `${iid}:0`,
    scenarioId: iid,
    rep: 0,
    artifact: {
      kind: 'swe-arm',
      iid,
      commit: COMMIT,
      resolved,
      verifyPass: true,
      patchLines: 12,
      wallS: 549,
      spentTokens: 70222,
      spentUsd: 0.05,
      recoveredTokens: 169560,
      workerTokIn: 100,
      workerTokOut: 50,
      judgeAttempts: 1,
      judgeWallS: 62,
      runDir,
      patchPath: join(runDir, 'patch.diff'),
    },
    judgeScores: {
      'swe-arena-official-judge': { composite: resolved ? 1 : 0, dimensions: { resolved: resolved ? 1 : 0 } },
    },
    costUsd: 0.05,
    costEstimated: false,
    costCallIds: ['call-a'],
    tokenUsage: { input: 100, output: 50 },
    resolvedModel: 'zai-coding-plan/glm-5.2',
    durationMs: 639038,
    seed: 42,
    cached: false,
  }
}

async function writeArmRun(runDir: string, iid: string, resolved: boolean, workerCwds: string[]): Promise<void> {
  await mkdir(runDir, { recursive: true })
  await writeJson(join(runDir, 'judge.json'), { iid, resolved, score: resolved ? 1 : 0, secs: 59, attempts: 1 })
  await writeJson(join(runDir, 'result.json'), {
    arm: 'R4',
    iid,
    driver_rc: 0,
    wall_s: 549,
    sup_status: 'completed',
    sup_verdict: 'delivered',
    spawned: 2,
    workers: workerCwds.length,
    settled: workerCwds.length,
    subtasks: ['fix-it'],
    recoveredSpend: {
      workerTokJournal: 0,
      workerCwds,
      workerSessions: workerCwds.length,
      workerTokSqlite: 150,
      workerTokIn: 100,
      workerTokOut: 50,
    },
  })
  await writeFile(join(runDir, 'patch.diff'), 'diff --git a/x b/x\n')
}

async function buildFixtureDb(): Promise<void> {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE session (
      id text PRIMARY KEY, project_id text NOT NULL, parent_id text, slug text, directory text NOT NULL,
      title text, version text, agent text, model text, cost real DEFAULT 0 NOT NULL,
      tokens_input integer DEFAULT 0 NOT NULL, tokens_output integer DEFAULT 0 NOT NULL,
      tokens_reasoning integer DEFAULT 0 NOT NULL, tokens_cache_read integer DEFAULT 0 NOT NULL,
      tokens_cache_write integer DEFAULT 0 NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL
    );
    CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL);
    CREATE TABLE part (id text PRIMARY KEY, message_id text NOT NULL, session_id text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL);
  `)
  db.prepare(
    `INSERT INTO session (id, project_id, parent_id, directory, agent, model, cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, time_created, time_updated)
     VALUES ('ses_w0', 'prj', 'ses_root', ?, 'build', '{"id":"glm-5.2","providerID":"tangle-router"}', 0, 100, 50, 5, 30, 10, 1000, 61000)`,
  ).run(WORKER_CWD)
  db.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('msg_u', 'ses_w0', 1000, 1000, ?)").run(
    JSON.stringify({ role: 'user' }),
  )
  db.prepare("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ('prt_u', 'msg_u', 'ses_w0', 1000, 1000, ?)").run(
    JSON.stringify({ type: 'text', text: 'Fix the failing test.' }),
  )
  db.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES ('msg_a', 'ses_w0', 2000, 2000, ?)").run(
    JSON.stringify({ role: 'assistant', modelID: 'glm-5.2', providerID: 'tangle-router' }),
  )
  db.prepare("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ('prt_a1', 'msg_a', 'ses_w0', 2000, 2000, ?)").run(
    JSON.stringify({ type: 'step-start' }),
  )
  db.prepare("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES ('prt_a2', 'msg_a', 'ses_w0', 2000, 2000, ?)").run(
    JSON.stringify({ type: 'text', text: 'Patched.' }),
  )
  db.close()
}

async function buildFixtureTree(): Promise<void> {
  // Baseline (resolved=false) + gen-0 candidate-0 (resolved=true), same
  // instance — resolvedInstanceCount scores candidates against the baseline's
  // instance set, exactly like a real round.
  const baselineRun = join(outDir, 'arm-runs', 'baseline', 'rep-0', 'runs', 'astropy__astropy-13033', 'R4')
  const candidateRun = join(outDir, 'arm-runs', 'cand-0', 'rep-0', 'runs', 'astropy__astropy-13033', 'R4')
  await writeArmRun(baselineRun, 'astropy__astropy-13033', false, [WORKER_CWD, MISSING_CWD])
  await writeArmRun(candidateRun, 'astropy__astropy-13033', true, [WORKER_CWD])
  await writeJson(
    join(outDir, 'improve-run', 'baseline', 'astropy__astropy-13033_0', 'cached-result.json'),
    cachedResult('astropy__astropy-13033', false, baselineRun),
  )
  await writeJson(
    join(outDir, 'improve-run', 'gen-0', 'candidate-0', 'astropy__astropy-13033_0', 'cached-result.json'),
    cachedResult('astropy__astropy-13033', true, candidateRun),
  )
  await writeJson(join(outDir, 'improve-run', 'loop-provenance.json'), {
    schema: 'tangle.loop-provenance',
    runId: `${outDir}/improve-run#42`,
  })
  await mkdir(join(outDir, 'candidates'), { recursive: true })
  await writeFile(join(outDir, 'candidates', `${COMMIT.slice(0, 10)}.patch`), 'diff --git a/y b/y\n')

  // Proposer shot receipt + matching claude transcript.
  await writeJson(join(outDir, 'proposer-shots', 'default-author', 'gen0-cand0-shot1.json'), {
    receipt: {
      generation: 0,
      candidateIndex: 0,
      shot: 1,
      maxShots: 3,
      harness: 'claude',
      model: null,
      promptSha256: 'sha256:abc',
      startedAt: '2026-07-22T19:27:18.350Z',
      completedAt: '2026-07-22T19:34:55.925Z',
      durationMs: 457571,
      exitCode: 0,
      timedOut: false,
      costUsd: null,
    },
    stdoutTail: 'Done.',
  })
  const proposerCwd = join(outDir, 'proposer-wt', 'gen0-cand0-default-author')
  const projectDir = join(projectsDir, claudeProjectSlug(proposerCwd))
  await mkdir(projectDir, { recursive: true })
  await writeFile(
    join(projectDir, 'sess-1.jsonl'),
    [
      JSON.stringify({
        type: 'user',
        timestamp: '2026-07-22T19:27:19.104Z',
        message: { role: 'user', content: 'Improve the supervisor.' },
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-07-22T19:27:21.583Z',
        message: {
          id: 'msg_p1',
          model: 'claude-fable-5',
          role: 'assistant',
          content: [{ type: 'text', text: 'Diagnosed and patched the prompts.' }],
          usage: { input_tokens: 2, output_tokens: 462, cache_read_input_tokens: 15109, cache_creation_input_tokens: 33218 },
        },
      }),
    ].join('\n') + '\n',
  )
}

describe('backfillSweArena', () => {
  it('joins cells, worker sessions, and proposer shots into labeled ledger lines', async () => {
    await buildFixtureTree()
    await buildFixtureDb()
    const { lines, stats } = await backfillSweArena(outDir, {
      opencodeDb: dbPath,
      claudeProjectsDir: projectsDir,
      now: () => new Date('2026-07-23T00:00:00.000Z'),
    })
    for (const line of lines) assertRolloutLine(line)

    // 2 supervisors + 3 worker cwd joins (2 found, 1 missing) + 1 proposer.
    expect(stats.lines).toBe(6)
    expect(stats.byRole).toEqual({ supervisor: 2, worker: 3, proposer: 1 })
    expect(stats.fullTranscripts).toBe(3)
    expect(stats.gapLines).toBe(3)
    expect(stats.workerSessionsJoined).toBe(2)
    expect(stats.workerCwdsMissed).toBe(1)
    expect(stats.proposerShotsJoined).toBe(1)
    expect(stats.rewardLabeled).toBe(6)

    const runId = `${outDir}/improve-run#42`
    expect(new Set(lines.map((l) => l.run_id))).toEqual(new Set([runId]))

    const baselineSup = lines.find((l) => l.role === 'supervisor' && l.candidate_index === -1)
    expect(baselineSup).toBeDefined()
    expect(baselineSup?.candidate_id).toBe('baseline')
    expect(baselineSup?.outcome.reward).toBe(0)
    expect(baselineSup?.outcome.reward_source).toBe('swe-arena-official-judge')
    expect(baselineSup?.outcome.verdict).toMatchObject({ iid: 'astropy__astropy-13033', resolved: false })
    expect(baselineSup?.policy).toMatchObject({ harness: 'pi-loops', model: 'glm-5.2', provider: 'zai-coding-plan' })
    expect(baselineSup?.task).toMatchObject({ split: 'search', seed: 42, rep: 0 })
    expect(baselineSup?.provenance.gap).toMatch(/brain transcript/)

    const candidateSup = lines.find((l) => l.role === 'supervisor' && l.candidate_index === 0)
    expect(candidateSup?.outcome.reward).toBe(1)
    expect(candidateSup?.generation).toBe(0)
    expect(candidateSup?.candidate_id).toBe('gen0-cand0')

    const workers = lines.filter((l) => l.role === 'worker')
    const joined = workers.filter((l) => l.messages.length > 0)
    expect(joined).toHaveLength(2)
    for (const worker of joined) {
      expect(worker.parent_rollout_id).toBe(
        lines.find((l) => l.role === 'supervisor' && l.candidate_index === worker.candidate_index)?.rollout_id,
      )
      expect(worker.outcome.reward_source).toBe('swe-arena-official-judge/inherited')
      expect(worker.policy).toMatchObject({ harness: 'opencode', model: 'glm-5.2', provider: 'tangle-router' })
      expect(worker.cost).toMatchObject({ tokens_in: 100, tokens_out: 50, tokens_reasoning: 5 })
      expect(worker.artifacts.transcript_ref).toBe('opencode:ses_w0')
      expect(worker.messages[0]).toEqual({ role: 'user', content: 'Fix the failing test.' })
    }
    const missed = workers.find((l) => l.messages.length === 0)
    expect(missed?.provenance.gap).toMatch(/no opencode session/)
    expect(missed?.outcome.reward).toBe(0)

    const proposer = lines.find((l) => l.role === 'proposer')
    expect(proposer?.messages).toHaveLength(2)
    expect(proposer?.outcome.reward).toBe(1)
    expect(proposer?.outcome.reward_source).toBe('swe-arena-official-judge/candidate-resolved-fraction')
    expect(proposer?.policy).toMatchObject({ harness: 'claude', model: 'claude-fable-5' })
    expect(proposer?.cost.tokens_out).toBe(462)
    expect(proposer?.task).toMatchObject({ suite: 'swe-arena-proposer', rep: 1 })

    // The dataset is immediately trainable: reward==1 trainable-split lines
    // with transcripts → SFT rows (candidate worker + proposer here).
    expect(toSftRows(lines)).toHaveLength(2)
  })

  it('records worker gap lines when the opencode store is unavailable', async () => {
    await buildFixtureTree()
    const { lines, stats } = await backfillSweArena(outDir, {
      opencodeDb: join(dir, 'absent.db'),
      claudeProjectsDir: projectsDir,
    })
    expect(stats.opencodeDbAvailable).toBe(false)
    const workers = lines.filter((l) => l.role === 'worker')
    expect(workers).toHaveLength(3)
    for (const worker of workers) {
      expect(worker.messages).toHaveLength(0)
      expect(worker.provenance.gap).toMatch(/opencode store unavailable/)
    }
  })
})
