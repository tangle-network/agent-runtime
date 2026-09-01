import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addHarnessUsage,
  createCodexRolloutStoreReader,
  harnessUsageIsEmpty,
  readCodexRolloutSession,
} from './codex-rollout-store'

/** A `token_count` row carrying codex's cumulative counters. */
const count = (
  cumulative: {
    input: number
    output: number
    cached?: number
    write?: number
    reasoning?: number
  },
  ordinal?: number,
) => ({
  timestamp: '2026-09-01T20:00:00.000Z',
  ...(ordinal === undefined ? {} : { ordinal }),
  type: 'event_msg',
  payload: {
    type: 'token_count',
    info: {
      total_token_usage: {
        input_tokens: cumulative.input,
        cached_input_tokens: cumulative.cached ?? 0,
        cache_write_input_tokens: cumulative.write ?? 0,
        output_tokens: cumulative.output,
        reasoning_output_tokens: cumulative.reasoning ?? 0,
        total_tokens: cumulative.input + cumulative.output,
      },
    },
  },
})

const taskStarted = (turnId: string, startedAt?: number, ordinal?: number) => ({
  timestamp: '2026-09-01T20:00:00.000Z',
  ...(ordinal === undefined ? {} : { ordinal }),
  type: 'event_msg',
  payload: {
    type: 'task_started',
    turn_id: turnId,
    ...(startedAt === undefined ? {} : { started_at: startedAt }),
  },
})

const sessionMeta = (payload: Record<string, unknown>) => ({
  timestamp: '2026-09-01T20:00:00.000Z',
  ordinal: 0,
  type: 'session_meta',
  payload,
})

/** A parent seat rollout: two turns, no fork. */
const seatSessionId = '01a05e99-3b2e-7023-91e4-0b43ce7d5477'
const seatRows = [
  sessionMeta({
    id: seatSessionId,
    timestamp: '2026-09-01T20:00:00.000Z',
    cwd: '/work/run',
    cli_version: '0.152.0',
    originator: 'codex-exec',
  }),
  taskStarted('01a05e99-4000-7000-8000-000000000001', 1_788_000_000),
  count({ input: 40_000, output: 300, cached: 10_000, reasoning: 200 }),
  count({ input: 90_000, output: 900, cached: 50_000, reasoning: 600 }),
  // A repeated identical emission: codex re-sends the same cumulative and it must not be charged.
  count({ input: 90_000, output: 900, cached: 50_000, reasoning: 600 }),
  taskStarted('01a05e99-5000-7000-8000-000000000002', 1_788_000_100),
  count({ input: 200_000, output: 2_000, cached: 120_000, reasoning: 1_200 }),
]

/**
 * A FORKED native child, in the shape the 2026-08-14 build writes: the parent's rows are prepended
 * with rewritten timestamps and uuid4 turn ids, and the child's own turn is a UUIDv7 minted at or
 * after the child thread itself.
 */
const childSessionId = '01a05eac-c4c2-7911-9582-731c6ebfcb69'
const childRows = [
  sessionMeta({
    id: childSessionId,
    parent_thread_id: seatSessionId,
    forked_from_id: seatSessionId,
    thread_source: 'subagent',
    agent_nickname: 'Turing',
    agent_path: '/root/c1_b_grid',
    timestamp: '2026-09-01T20:32:56.000Z',
    cwd: '/work/run',
    cli_version: '0.152.0',
    source: { subagent: { thread_spawn: { parent_thread_id: seatSessionId, depth: 1 } } },
  }),
  // ── inherited block: the parent's whole history, 5,000,000 cumulative input tokens of it ──
  taskStarted('e6b7a614-6156-4d3e-891d-de80de86e1c9', 1_787_000_000),
  count({ input: 2_500_000, output: 20_000, cached: 2_000_000, reasoning: 12_000 }),
  taskStarted('0ec444f9-faa7-43f3-b68c-1b9db3a2b027', 1_787_000_500),
  count({ input: 5_000_000, output: 40_000, cached: 4_400_000, reasoning: 25_000 }),
  // ── the child's own turn ──
  taskStarted('01a05eac-c500-7000-8000-000000000003', 1_788_001_000),
  count({ input: 5_040_000, output: 40_900, cached: 4_430_000, reasoning: 25_600 }),
  count({ input: 5_082_985, output: 41_500, cached: 4_460_000, reasoning: 26_000 }),
]

const jsonl = (rows: readonly unknown[]) => `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`

describe('readCodexRolloutSession', () => {
  it('reads an unforked seat rollout as whole-file and dedups a repeated cumulative emission', () => {
    const session = readCodexRolloutSession(seatRows)
    expect(session?.identity.sessionId).toBe(seatSessionId)
    expect(session?.identity.nativeChild).toBe(false)
    expect(session?.boundary).toEqual({ kind: 'whole-file' })
    expect(session?.own).toEqual({
      harness: 'codex',
      input: 200_000,
      output: 2_000,
      cachedInput: 120_000,
      cacheWriteInput: 0,
      reasoningOutput: 1_200,
    })
    expect(session?.turns.map((turn) => turn.usage.input)).toEqual([90_000, 110_000])
  })

  it('scopes a forked child to its own turn instead of the file total', () => {
    const session = readCodexRolloutSession(childRows)
    expect(session?.identity.nativeChild).toBe(true)
    expect(session?.identity.agentPath).toBe('/root/c1_b_grid')
    expect(session?.identity.depth).toBe(1)
    expect(session?.boundary).toEqual({
      kind: 'resolved',
      rule: 'turn-uuid-v7',
      turnId: '01a05eac-c500-7000-8000-000000000003',
      inheritedTurns: 2,
    })
    // The child's own contribution, NOT the 5,082,985 the file's final cumulative reads.
    expect(session?.own).toEqual({
      harness: 'codex',
      input: 82_985,
      output: 1_500,
      cachedInput: 60_000,
      cacheWriteInput: 0,
      reasoningOutput: 1_000,
    })
    expect(session?.fileCumulativeInput).toBe(5_082_985)
    // The fork trap, stated as a number: the file total is 61x the child's real spend.
    expect(Math.round(session!.fileCumulativeInput / session!.own!.input)).toBe(61)
  })

  it('resolves a v2 fork by the history-start ordinal the build states outright', () => {
    const rows = [
      sessionMeta({
        id: childSessionId,
        parent_thread_id: seatSessionId,
        thread_source: 'subagent',
        timestamp: '2026-09-01T20:32:56.000Z',
        subagent_history_start_ordinal: 3,
      }),
      taskStarted('aaaaaaaa-0000-4000-8000-000000000001', 1_787_000_000, 1),
      count({ input: 900_000, output: 5_000 }, 2),
      taskStarted('bbbbbbbb-0000-4000-8000-000000000002', 1_787_000_100, 3),
      count({ input: 950_000, output: 5_400 }, 4),
    ]
    const session = readCodexRolloutSession(rows)
    expect(session?.boundary).toEqual({
      kind: 'resolved',
      rule: 'history-start-ordinal',
      turnId: 'bbbbbbbb-0000-4000-8000-000000000002',
      inheritedTurns: 1,
    })
    expect(session?.own?.input).toBe(50_000)
  })

  it('resolves an older uuid4-turn fork by the child session start time', () => {
    const rows = [
      sessionMeta({
        id: 'legacy-child-0001',
        parent_thread_id: 'legacy-parent-0001',
        forked_from_id: 'legacy-parent-0001',
        thread_source: 'subagent',
        timestamp: '2026-09-01T20:00:00.000Z',
      }),
      taskStarted('aaaaaaaa-0000-4000-8000-000000000001', 1_787_000_000),
      count({ input: 700_000, output: 4_000 }),
      // `2026-09-01T20:00:00.000Z` is epoch second 1_788_292_800.
      taskStarted('bbbbbbbb-0000-4000-8000-000000000002', 1_788_292_800),
      count({ input: 730_000, output: 4_500 }),
    ]
    const session = readCodexRolloutSession(rows)
    expect(session?.boundary).toMatchObject({ kind: 'resolved', rule: 'turn-start-time' })
    expect(session?.own?.input).toBe(30_000)
  })

  it('refuses to charge a fork whose own turn cannot be isolated', () => {
    const rows = [
      sessionMeta({
        id: 'opaque-child-0001',
        forked_from_id: 'opaque-parent-0001',
        thread_source: 'subagent',
        timestamp: '2026-09-01T20:00:00.000Z',
      }),
      taskStarted('aaaaaaaa-0000-4000-8000-000000000001', 1_700_000_000),
      count({ input: 5_000_000_000, output: 9_000_000 }),
    ]
    const session = readCodexRolloutSession(rows)
    expect(session?.boundary.kind).toBe('unresolved')
    // The 937x number is never reported. Absent, not zero, and not the file total.
    expect(session?.own).toBeUndefined()
    expect(session?.fileCumulativeInput).toBe(5_000_000_000)
  })

  it('reports nothing for rows carrying no session_meta', () => {
    expect(readCodexRolloutSession([count({ input: 10, output: 1 })])).toBeUndefined()
  })
})

describe('createCodexRolloutStoreReader', () => {
  let root = ''
  let sessionsDir = ''

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'codex-store-'))
    sessionsDir = join(root, 'sessions', '2026', '09', '01')
    await mkdir(sessionsDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('baselines existing rows, then credits only what each later turn appended', async () => {
    const seatFile = join(sessionsDir, `rollout-${seatSessionId}.jsonl`)
    await writeFile(seatFile, jsonl(seatRows.slice(0, 3)))
    const reader = createCodexRolloutStoreReader({ root })

    const baseline = await reader.read()
    // Everything present when the reader opened is consumed here and charged to nothing after it.
    expect(baseline.seat.input).toBe(40_000)

    await appendFile(seatFile, jsonl(seatRows.slice(3)))
    const afterTurn = await reader.read()
    // The DELTA since the baseline, not the file's own running total of 200,000.
    expect(afterTurn.seat).toEqual({
      harness: 'codex',
      input: 160_000,
      output: 1_700,
      cachedInput: 110_000,
      cacheWriteInput: 0,
      reasoningOutput: 1_000,
    })
    expect(afterTurn.sessions[0]?.own?.input).toBe(200_000)
    expect(harnessUsageIsEmpty(afterTurn.native)).toBe(true)

    // Nothing appended since: a re-read charges nothing, so no turn is billed twice.
    const idle = await reader.read()
    expect(harnessUsageIsEmpty(idle.seat)).toBe(true)
  })

  it('separates a harness-native child from the seat and never sums the fork prefix', async () => {
    await writeFile(join(sessionsDir, `rollout-${seatSessionId}.jsonl`), jsonl(seatRows))
    const reader = createCodexRolloutStoreReader({ root })
    await reader.read()

    // The lead spawns a native child mid-turn; the child writes its own forked rollout.
    await writeFile(join(sessionsDir, `rollout-${childSessionId}.jsonl`), jsonl(childRows))
    const delta = await reader.read()

    expect(harnessUsageIsEmpty(delta.seat)).toBe(true)
    expect(delta.native.input).toBe(82_985)
    expect(delta.native.output).toBe(1_500)
    expect(delta.sessions.map((session) => session.identity.sessionId)).toContain(childSessionId)
    expect(addHarnessUsage(delta.seat, delta.native).input).toBe(82_985)
  })

  it('names an unattributable fork instead of charging its file total', async () => {
    await writeFile(
      join(sessionsDir, 'rollout-opaque.jsonl'),
      jsonl([
        sessionMeta({
          id: 'opaque-child-0002',
          forked_from_id: 'opaque-parent-0002',
          thread_source: 'subagent',
          timestamp: '2026-09-01T20:00:00.000Z',
        }),
        taskStarted('aaaaaaaa-0000-4000-8000-000000000001', 1_700_000_000),
        count({ input: 5_000_000_000, output: 9_000_000 }),
      ]),
    )
    const delta = await createCodexRolloutStoreReader({ root }).read()
    expect(harnessUsageIsEmpty(delta.seat)).toBe(true)
    expect(harnessUsageIsEmpty(delta.native)).toBe(true)
    expect(delta.unresolved).toEqual([
      { sessionId: 'opaque-child-0002', reason: expect.any(String) },
    ])
  })

  it('credits only sessions recorded under the run workspace', async () => {
    await writeFile(join(sessionsDir, `rollout-${seatSessionId}.jsonl`), jsonl(seatRows))
    await writeFile(
      join(sessionsDir, 'rollout-foreign.jsonl'),
      jsonl([
        sessionMeta({
          id: 'foreign-0001',
          timestamp: '2026-09-01T20:00:00.000Z',
          cwd: '/somewhere/else',
        }),
        taskStarted('01a05e99-9000-7000-8000-00000000000f', 1_788_000_000),
        count({ input: 8_000_000, output: 70_000 }),
      ]),
    )
    const delta = await createCodexRolloutStoreReader({
      root,
      workspaceRoot: '/work/run',
    }).read()
    expect(delta.seat.input).toBe(200_000)
    expect(delta.sessions.map((session) => session.identity.sessionId)).toEqual([seatSessionId])
  })

  it('reads a partially written line only once it is terminated', async () => {
    const path = join(sessionsDir, `rollout-${seatSessionId}.jsonl`)
    await writeFile(path, jsonl(seatRows.slice(0, 2)))
    const reader = createCodexRolloutStoreReader({ root })
    await reader.read()

    const complete = JSON.stringify(count({ input: 300_000, output: 3_000 }))
    await appendFile(path, complete.slice(0, 40))
    expect(harnessUsageIsEmpty((await reader.read()).seat)).toBe(true)

    await appendFile(path, `${complete.slice(40)}\n`)
    expect((await reader.read()).seat.input).toBe(300_000)
  })

  it('returns an empty delta for a store the harness has not written yet', async () => {
    const delta = await createCodexRolloutStoreReader({ root: join(root, 'absent') }).read()
    expect(harnessUsageIsEmpty(delta.seat)).toBe(true)
    expect(delta.sessions).toEqual([])
  })

  it('refuses a relative store root', () => {
    expect(() => createCodexRolloutStoreReader({ root: 'sessions' })).toThrow(/absolute path/)
  })
})
