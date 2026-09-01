/**
 * Codex's OWN rollout store, read as a first-class spend receipt.
 *
 * A codex seat writes every turn it runs into a JSONL rollout under its `CODEX_HOME`, and that
 * file carries the provider's token counters whether or not any of them reach the runtime's event
 * stream. When the harness is driven through a transport that forwards no usage — cli-bridge is
 * the measured case — the runtime meters `{input: 0, output: 0, tokensKnown: false}` for a turn
 * whose counters are already on disk. This module is the reader that closes that gap: the store is
 * evidence, not a side effect.
 *
 * MEASURED MOTIVE (discovery#80, 2026-09-01). One live codex seat reported zero on 9 of 9
 * `metered` events with `tokensKnown: false`, while 27,320,482 codex tokens sat in the same run
 * directory. 1,453,948 of those (5.3%) belonged to three harness-native children the runtime has
 * no journal row for at all. Both numbers come from this file format and neither reached a spend
 * record.
 *
 * ── THE FORK TRAP, and why a file total is never the answer ───────────────────────────────────
 *
 * `spawn_agent` forks a child thread, and a forked child rollout PREPENDS the parent's rows with
 * rewritten timestamps. Measured on a 2026-08-14 depth-1 child: 2,793 lines whose first
 * `token_count` already reads a cumulative 5,080,268,193 and whose last reads 5,396,076,467. The
 * child's own contribution is the DIFFERENCE, 315,808,274 — reading the file's final
 * `total_token_usage` as the child's spend overstates it by 17x here and by 937x on the larger
 * case the research measured.
 *
 * So this reader never reports a file total as a session's spend. It finds the fork boundary — the
 * `task_started` that opens the child's own first turn — and reports the cumulative DELTA from
 * there. A fork whose boundary cannot be isolated reports `boundary: 'unresolved'` and NO usage,
 * because an unattributable number is worse than an absent one.
 *
 * ── Deduplication ─────────────────────────────────────────────────────────────────────────────
 *
 * codex re-emits an identical `token_count` for the same state. Summing the per-turn
 * `last_token_usage` therefore over-counts: measured 25,977,726 against a true cumulative of
 * 25,866,534, a 0.43% overstatement. Every counter here is read from the CUMULATIVE
 * `total_token_usage` and credited as the difference between consecutive DISTINCT cumulative
 * vectors, which is the same dedup-by-cumulative-signature rule `@tangle-network/traces` applies.
 *
 * ── Why this lives in agent-runtime ───────────────────────────────────────────────────────────
 *
 * `@tangle-network/traces` already reads this format, and it DEPENDS on agent-runtime; adopting it
 * here would be a dependency cycle. The wire shape it shares with `harness-usage.ts` — the same
 * five counters, the same two cross-field invariants — is read by `parseCodexUsageRecord`, so the
 * field policy has one home whichever surface the record arrives on.
 */

import type { Dirent } from 'node:fs'
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { ValidationError } from '../errors'
import type { HarnessUsage } from './harness-usage'

/** The cumulative counters codex reports, in the runtime's field names. */
interface CumulativeCounters {
  readonly input: number
  readonly output: number
  readonly cachedInput: number
  readonly cacheWriteInput: number
  readonly reasoningOutput: number
}

const zeroCounters: CumulativeCounters = {
  input: 0,
  output: 0,
  cachedInput: 0,
  cacheWriteInput: 0,
  reasoningOutput: 0,
}

/** Who wrote one rollout, exactly as its own `session_meta` states it. Nothing here is inferred. */
export interface CodexRolloutIdentity {
  /** The rollout's own thread id (`session_meta.payload.id`). */
  readonly sessionId: string
  /** The thread this one was spawned or forked from, when it was. */
  readonly parentThreadId?: string
  /** The thread whose rows are prepended into this file, when this file is a fork. */
  readonly forkedFromId?: string
  /** True when `thread_source` reads `subagent`: a harness-native child, invisible to the journal. */
  readonly nativeChild: boolean
  /** The child's own path in the harness's agent tree (`/root/c1_b_grid`), when it has one. */
  readonly agentPath?: string
  /** The harness's own nickname for the child ("Turing"), when it has one. */
  readonly agentNickname?: string
  /** Spawn depth the harness recorded. `1` is a direct child of the seat. */
  readonly depth?: number
  /** The working directory the session ran in, used to attribute a store to a workspace. */
  readonly cwd?: string
  /** The codex build that wrote it. */
  readonly cliVersion?: string
  /** When the session itself started, from its own `session_meta` timestamp. */
  readonly startedAtMs?: number
}

/** How this reader isolated the session's own rows from the parent rows prepended to its file. */
export type CodexForkBoundary =
  /** Not a fork: every row in the file belongs to this session. */
  | { readonly kind: 'whole-file' }
  /** A fork whose own first turn was isolated, and by which rule. */
  | {
      readonly kind: 'resolved'
      readonly rule:
        | 'history-start-ordinal'
        | 'turn-is-session'
        | 'turn-uuid-v7'
        | 'turn-start-time'
      /** The `turn_id` of the session's own first turn. */
      readonly turnId?: string
      /** Rows credited to the parent and excluded from `own`. */
      readonly inheritedTurns: number
    }
  /** A fork this reader could not isolate. `own` is absent; nothing may be charged. */
  | { readonly kind: 'unresolved'; readonly reason: string }

/** One turn of one session, with the counters it added to the session's cumulative total. */
export interface CodexRolloutTurn {
  readonly turnId?: string
  readonly startedAtMs?: number
  readonly usage: HarnessUsage
}

/** One rollout file, read. */
export interface CodexRolloutSession {
  readonly identity: CodexRolloutIdentity
  readonly boundary: CodexForkBoundary
  /**
   * The session's OWN spend — the cumulative delta from its fork boundary to its last report.
   * ABSENT when the boundary is unresolved: an unattributable number must not be charged.
   */
  readonly own?: HarnessUsage
  /** The session's own turns, newest last. Empty when the file reported no usage. */
  readonly turns: readonly CodexRolloutTurn[]
  /**
   * The file's final cumulative `total_token_usage`, kept ONLY as the diagnostic that shows how
   * far a naive file total is from the truth. Never charge this.
   */
  readonly fileCumulativeInput: number
  readonly fileCumulativeOutput: number
}

/** What one incremental read of a store observed. */
export interface CodexStoreDelta {
  /** Spend by sessions that are NOT native children — the seat's own turns. */
  readonly seat: HarnessUsage
  /** Spend by `thread_source: subagent` sessions — the harness-native children. */
  readonly native: HarnessUsage
  /** Sessions whose fork boundary could not be isolated, so their spend is absent, not zero. */
  readonly unresolved: ReadonlyArray<{ readonly sessionId: string; readonly reason: string }>
  /**
   * Every session this read touched, for evidence. Each one states its WHOLE own spend and turn
   * list, which is not the same number as `seat` / `native`: those two carry only what this read
   * newly observed.
   */
  readonly sessions: readonly CodexRolloutSession[]
}

/** A store reader that credits each turn once: it tails only the bytes appended since the last read. */
export interface CodexRolloutStoreReader {
  /**
   * Read everything appended since the previous call and attribute it.
   *
   * The FIRST call establishes the baseline. Call it before the first turn so pre-existing rows are
   * consumed and credited to nothing; every later call returns exactly that turn's spend.
   */
  read(): Promise<CodexStoreDelta>
}

/** Where a harness keeps its own session store, and which workspace may be credited from it. */
export interface CodexRolloutStoreRef {
  /**
   * Absolute path to the harness home the CLI writes into — `CODEX_HOME`, or `$HOME/.codex`.
   * This MUST be the run's own isolated store. Pointing it at an ambient host store credits one
   * run with another run's files, which is the exact defect this reader exists to end.
   */
  readonly root: string
  /**
   * Credit only sessions whose recorded `cwd` is this path or below it. Absent credits every
   * session under `root`, which is correct only for a store no other run writes to.
   */
  readonly workspaceRoot?: string
}

const ROLLOUT_SUFFIX = '.jsonl'
/** Rows this reader needs. Every other line is skipped without being parsed. */
const INTERESTING = ['"session_meta"', '"token_count"', '"task_started"'] as const

/**
 * Read one rollout's rows into a session record.
 *
 * `rows` is the file's JSON values in file order. Pass the whole file to read a completed session;
 * the store reader passes appended slices and carries the identity forward itself.
 */
export function readCodexRolloutSession(rows: Iterable<unknown>): CodexRolloutSession | undefined {
  const state = createSessionState()
  for (const row of rows) consumeRow(state, row)
  return finishSession(state)?.session
}

/**
 * Open an incremental reader over a codex store.
 *
 * Nothing is read until `read()` is called, and every read is bounded by the bytes appended since
 * the previous one, so a 695MB rollout is scanned once rather than once per turn.
 */
export function createCodexRolloutStoreReader(ref: CodexRolloutStoreRef): CodexRolloutStoreReader {
  if (!isAbsolute(ref.root)) {
    throw new ValidationError(
      `createCodexRolloutStoreReader: root must be an absolute path, received ${JSON.stringify(ref.root)}`,
    )
  }
  const root = resolve(ref.root)
  const workspaceRoot = ref.workspaceRoot === undefined ? undefined : resolve(ref.workspaceRoot)
  const files = new Map<string, FileCursor>()
  return {
    async read(): Promise<CodexStoreDelta> {
      const sessions: Array<{ session: CodexRolloutSession; incremental?: HarnessUsage }> = []
      for (const path of await listRollouts(root)) {
        const cursor = files.get(path) ?? newCursor()
        files.set(path, cursor)
        const size = await fileSize(path)
        if (size === undefined) continue
        // A file that shrank was replaced, not appended to. Re-read it from the top rather than
        // slicing at a byte offset that now falls inside a different session's rows.
        if (size < cursor.offset) {
          const fresh = newCursor()
          files.set(path, fresh)
          cursor.offset = fresh.offset
          cursor.state = fresh.state
          cursor.pending = fresh.pending
        }
        if (size === cursor.offset) continue
        await consumeAppendedBytes(path, cursor, size)
        const read = finishSession(cursor.state)
        if (read === undefined || !includesWorkspace(read.session, workspaceRoot)) continue
        // Charge from the LATER of the fork boundary and what this cursor already reported. The
        // boundary is what excludes the parent's prepended rows; the credited mark is what stops a
        // turn already charged on an earlier read from being charged again.
        const from =
          read.ownFrom === undefined ? undefined : laterCounters(read.ownFrom, cursor.credited)
        const incremental =
          from === undefined ? undefined : counterDelta(from, cursor.state.cumulative)
        cursor.credited = cursor.state.cumulative
        sessions.push({
          session: read.session,
          ...(incremental === undefined ? {} : { incremental }),
        })
      }
      return reduceDelta(sessions)
    },
  }
}

/** Sum two usage reports on every counter both of them state. */
export function addHarnessUsage(left: HarnessUsage, right: HarnessUsage): HarnessUsage {
  return {
    harness: left.harness,
    input: left.input + right.input,
    output: left.output + right.output,
    ...sumOptional('cachedInput', left, right),
    ...sumOptional('cacheWriteInput', left, right),
    ...sumOptional('reasoningOutput', left, right),
  }
}

/** True when a report states any spend at all. */
export function harnessUsageIsEmpty(usage: HarnessUsage): boolean {
  return usage.input === 0 && usage.output === 0
}

// ── session parsing ───────────────────────────────────────────────────────────

interface TurnMark {
  readonly turnId?: string
  readonly startedAtSeconds?: number
  /** Cumulative counters at the moment this turn opened. */
  readonly at: CumulativeCounters
  /** File-order index of the row that opened the turn, used only for ordinal boundary rules. */
  readonly ordinal?: number
}

interface SessionState {
  identity?: CodexRolloutIdentity
  historyStartOrdinal?: number
  /** Cumulative counters from the newest DISTINCT `token_count` seen so far. */
  cumulative: CumulativeCounters
  /** Every `task_started` in file order, with the cumulative state at that point. */
  marks: TurnMark[]
  /** Cumulative counters at the end of each mark's turn, aligned with `marks` by index. */
  markEnds: CumulativeCounters[]
  /** Cumulative counters before any `task_started` was seen. */
  beforeFirstMark: CumulativeCounters
  sawAnyCount: boolean
}

function createSessionState(): SessionState {
  return {
    cumulative: zeroCounters,
    marks: [],
    markEnds: [],
    beforeFirstMark: zeroCounters,
    sawAnyCount: false,
  }
}

function consumeRow(state: SessionState, row: unknown): void {
  const record = plainRecord(row)
  if (record === undefined) return
  if (record.type === 'session_meta') {
    readIdentity(state, record)
    return
  }
  if (record.type !== 'event_msg') return
  const payload = plainRecord(record.payload)
  if (payload === undefined) return
  if (payload.type === 'task_started') {
    const at = state.cumulative
    state.marks.push({
      ...(typeof payload.turn_id === 'string' ? { turnId: payload.turn_id } : {}),
      ...(typeof payload.started_at === 'number' ? { startedAtSeconds: payload.started_at } : {}),
      at,
      ...(typeof record.ordinal === 'number' ? { ordinal: record.ordinal } : {}),
    })
    state.markEnds.push(at)
    return
  }
  if (payload.type !== 'token_count') return
  const info = plainRecord(payload.info)
  const total = readCumulative(info?.total_token_usage)
  if (total === undefined) return
  // Dedup by cumulative signature: codex re-emits an identical `token_count`, and crediting the
  // repeat would charge the same tokens twice.
  if (sameCounters(total, state.cumulative)) return
  state.cumulative = total
  state.sawAnyCount = true
  if (state.marks.length === 0) state.beforeFirstMark = total
  else state.markEnds[state.marks.length - 1] = total
}

function readIdentity(state: SessionState, record: Record<string, unknown>): void {
  const payload = plainRecord(record.payload)
  if (payload === undefined) return
  const sessionId = typeof payload.id === 'string' ? payload.id : undefined
  if (sessionId === undefined) return
  const spawn = plainRecord(plainRecord(plainRecord(payload.source)?.subagent)?.thread_spawn)
  const startedAtMs = Date.parse(
    typeof payload.timestamp === 'string' ? payload.timestamp : String(record.timestamp ?? ''),
  )
  state.identity = {
    sessionId,
    ...(typeof payload.parent_thread_id === 'string'
      ? { parentThreadId: payload.parent_thread_id }
      : {}),
    ...(typeof payload.forked_from_id === 'string' ? { forkedFromId: payload.forked_from_id } : {}),
    nativeChild: payload.thread_source === 'subagent',
    ...(typeof payload.agent_path === 'string' ? { agentPath: payload.agent_path } : {}),
    ...(typeof payload.agent_nickname === 'string'
      ? { agentNickname: payload.agent_nickname }
      : {}),
    ...(typeof spawn?.depth === 'number' ? { depth: spawn.depth } : {}),
    ...(typeof payload.cwd === 'string' ? { cwd: payload.cwd } : {}),
    ...(typeof payload.cli_version === 'string' ? { cliVersion: payload.cli_version } : {}),
    ...(Number.isFinite(startedAtMs) ? { startedAtMs } : {}),
  }
  if (typeof payload.subagent_history_start_ordinal === 'number') {
    state.historyStartOrdinal = payload.subagent_history_start_ordinal
  }
}

/** A session plus the cumulative point its OWN spend is measured from. */
interface ReadSession {
  readonly session: CodexRolloutSession
  /** Cumulative counters at the fork boundary. `undefined` when nothing may be charged. */
  readonly ownFrom?: CumulativeCounters
}

function finishSession(state: SessionState): ReadSession | undefined {
  const identity = state.identity
  if (identity === undefined) return undefined
  const boundary = resolveBoundary(state, identity)
  const base = {
    identity,
    boundary,
    fileCumulativeInput: state.cumulative.input,
    fileCumulativeOutput: state.cumulative.output,
  }
  if (boundary.kind === 'unresolved') return { session: { ...base, turns: [] } }
  const firstOwn = boundary.kind === 'whole-file' ? 0 : boundary.inheritedTurns
  const turns: CodexRolloutTurn[] = []
  for (let index = firstOwn; index < state.marks.length; index += 1) {
    const mark = state.marks[index]
    const end = state.markEnds[index]
    if (mark === undefined || end === undefined) continue
    const usage = counterDelta(mark.at, end)
    if (usage === undefined) continue
    turns.push({
      ...(mark.turnId === undefined ? {} : { turnId: mark.turnId }),
      ...(mark.startedAtSeconds === undefined
        ? {}
        : { startedAtMs: mark.startedAtSeconds * 1_000 }),
      usage,
    })
  }
  const from =
    firstOwn === 0
      ? // A session with no `task_started` at all still reported counters; they are all its own.
        state.marks.length === 0
        ? zeroCounters
        : state.beforeFirstMark
      : (state.marks[firstOwn]?.at ?? state.cumulative)
  const own = counterDelta(from, state.cumulative) ?? emptyUsage()
  return { session: { ...base, own, turns }, ownFrom: from }
}

/**
 * Find the row where this session's OWN history begins.
 *
 * Four rules, most authoritative first. A build that states the boundary is believed over one that
 * must be inferred, and inference is refused rather than guessed when nothing distinguishes the
 * child's turns from the parent's.
 */
function resolveBoundary(state: SessionState, identity: CodexRolloutIdentity): CodexForkBoundary {
  const forked = identity.forkedFromId !== undefined || identity.nativeChild
  if (!forked) return { kind: 'whole-file' }

  // 1. multi-agent v2 states the boundary outright.
  if (state.historyStartOrdinal !== undefined) {
    const at = state.marks.findIndex(
      (mark) => mark.ordinal !== undefined && mark.ordinal >= (state.historyStartOrdinal ?? 0),
    )
    if (at >= 0) {
      return {
        kind: 'resolved',
        rule: 'history-start-ordinal',
        ...(state.marks[at]?.turnId === undefined ? {} : { turnId: state.marks[at]?.turnId }),
        inheritedTurns: at,
      }
    }
  }
  // 2. The child's own turn sometimes carries the child's session id.
  const exact = state.marks.findIndex((mark) => mark.turnId === identity.sessionId)
  if (exact >= 0) {
    return {
      kind: 'resolved',
      rule: 'turn-is-session',
      turnId: identity.sessionId,
      inheritedTurns: exact,
    }
  }
  // 3. Both ids are UUIDv7 on current builds, so the child's own turns are the ones minted at or
  //    after the child thread itself. Inherited turns were minted before it existed.
  const sessionMintedAtMs = uuidV7TimestampMs(identity.sessionId)
  if (sessionMintedAtMs !== undefined) {
    const at = state.marks.findIndex((mark) => {
      const minted = uuidV7TimestampMs(mark.turnId)
      return minted !== undefined && minted >= sessionMintedAtMs
    })
    if (at >= 0) {
      return {
        kind: 'resolved',
        rule: 'turn-uuid-v7',
        ...(state.marks[at]?.turnId === undefined ? {} : { turnId: state.marks[at]?.turnId }),
        inheritedTurns: at,
      }
    }
  }
  // 4. Older builds mint uuid4 turn ids. The child's own turn is the one that started when the
  //    child session's metadata says the child started.
  if (identity.startedAtMs !== undefined) {
    const startedAtSeconds = Math.floor(identity.startedAtMs / 1_000)
    const matches = state.marks
      .map((mark, index) => ({ mark, index }))
      .filter(
        ({ mark }) =>
          mark.startedAtSeconds !== undefined &&
          Math.abs(mark.startedAtSeconds - startedAtSeconds) <= 2,
      )
    if (matches.length === 1) {
      const only = matches[0]
      if (only !== undefined) {
        return {
          kind: 'resolved',
          rule: 'turn-start-time',
          ...(only.mark.turnId === undefined ? {} : { turnId: only.mark.turnId }),
          inheritedTurns: only.index,
        }
      }
    }
    if (matches.length > 1) {
      return {
        kind: 'unresolved',
        reason: `${matches.length} task_started rows start within 2s of the child session; its own turn cannot be isolated`,
      }
    }
  }
  return {
    kind: 'unresolved',
    reason:
      'forked rollout carries no history-start ordinal, no turn matching the session id, no UUIDv7 turn at or after it, and no task_started at the session start time',
  }
}

// ── store walking ─────────────────────────────────────────────────────────────

interface FileCursor {
  offset: number
  pending: string
  state: SessionState
  /** Cumulative counters this cursor has already reported. A later read credits only what is
   *  beyond this point, so one turn is never charged twice. */
  credited: CumulativeCounters
}

function newCursor(): FileCursor {
  return { offset: 0, pending: '', state: createSessionState(), credited: zeroCounters }
}

async function listRollouts(root: string): Promise<string[]> {
  const found: string[] = []
  const walk = async (dir: string): Promise<void> => {
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      // A store directory that does not exist yet is not an error: the harness has not run.
      return
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile() && entry.name.endsWith(ROLLOUT_SUFFIX)) found.push(path)
    }
  }
  await walk(join(root, 'sessions'))
  return found.sort()
}

async function fileSize(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).size
  } catch {
    return undefined
  }
}

/** Read `[cursor.offset, size)` and fold every complete line into the cursor's session state. */
async function consumeAppendedBytes(path: string, cursor: FileCursor, size: number): Promise<void> {
  const stream = createReadStream(path, {
    encoding: 'utf8',
    start: cursor.offset,
    end: size - 1,
  })
  try {
    for await (const chunk of stream) {
      cursor.pending += chunk
      let start = 0
      for (
        let at = cursor.pending.indexOf('\n');
        at !== -1;
        at = cursor.pending.indexOf('\n', start)
      ) {
        consumeLine(cursor.state, cursor.pending.slice(start, at))
        start = at + 1
      }
      // Only the unterminated tail is retained, so memory is bounded by the longest single line
      // rather than by the file, and a row split across two reads is not lost.
      cursor.pending = cursor.pending.slice(start)
    }
  } finally {
    stream.destroy()
  }
  cursor.offset = size
}

function consumeLine(state: SessionState, line: string): void {
  if (!INTERESTING.some((marker) => line.includes(marker))) return
  try {
    consumeRow(state, JSON.parse(line))
  } catch {
    // A truncated or corrupt row is skipped. It cannot be credited, and refusing the whole store
    // over one bad line would lose every turn the file did record.
  }
}

function includesWorkspace(
  session: CodexRolloutSession,
  workspaceRoot: string | undefined,
): boolean {
  if (workspaceRoot === undefined) return true
  const cwd = session.identity.cwd
  if (cwd === undefined) return false
  const rel = relative(workspaceRoot, resolve(cwd))
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function reduceDelta(
  read: ReadonlyArray<{ session: CodexRolloutSession; incremental?: HarnessUsage }>,
): CodexStoreDelta {
  let seat = emptyUsage()
  let native = emptyUsage()
  const unresolved: Array<{ sessionId: string; reason: string }> = []
  for (const { session, incremental } of read) {
    if (session.boundary.kind === 'unresolved') {
      unresolved.push({
        sessionId: session.identity.sessionId,
        reason: session.boundary.reason,
      })
      continue
    }
    if (incremental === undefined) continue
    if (session.identity.nativeChild) native = addHarnessUsage(native, incremental)
    else seat = addHarnessUsage(seat, incremental)
  }
  return { seat, native, unresolved, sessions: read.map((entry) => entry.session) }
}

/** The later of two cumulative marks. Every counter is monotonic within one session. */
function laterCounters(left: CumulativeCounters, right: CumulativeCounters): CumulativeCounters {
  return left.input + left.output >= right.input + right.output ? left : right
}

// ── counters ──────────────────────────────────────────────────────────────────

function emptyUsage(): HarnessUsage {
  return { harness: 'codex', input: 0, output: 0 }
}

function counterDelta(from: CumulativeCounters, to: CumulativeCounters): HarnessUsage | undefined {
  const input = to.input - from.input
  const output = to.output - from.output
  if (input < 0 || output < 0) return undefined
  const cachedInput = Math.max(0, to.cachedInput - from.cachedInput)
  const cacheWriteInput = Math.max(0, to.cacheWriteInput - from.cacheWriteInput)
  const reasoningOutput = Math.max(0, to.reasoningOutput - from.reasoningOutput)
  if (input === 0 && output === 0) return undefined
  return {
    harness: 'codex',
    input,
    output,
    // The two cross-field invariants `parseCodexUsageRecord` holds also hold on a delta: a
    // classification of a total can never exceed the total it classifies.
    cachedInput: Math.min(cachedInput, input),
    cacheWriteInput: Math.min(cacheWriteInput, Math.max(0, input - Math.min(cachedInput, input))),
    reasoningOutput: Math.min(reasoningOutput, output),
  }
}

function readCumulative(value: unknown): CumulativeCounters | undefined {
  const record = plainRecord(value)
  if (record === undefined) return undefined
  const input = naturalNumber(record.input_tokens)
  const output = naturalNumber(record.output_tokens)
  if (input === undefined || output === undefined) return undefined
  return {
    input,
    output,
    cachedInput: naturalNumber(record.cached_input_tokens) ?? 0,
    cacheWriteInput: naturalNumber(record.cache_write_input_tokens) ?? 0,
    reasoningOutput: naturalNumber(record.reasoning_output_tokens) ?? 0,
  }
}

function sameCounters(left: CumulativeCounters, right: CumulativeCounters): boolean {
  return (
    left.input === right.input &&
    left.output === right.output &&
    left.cachedInput === right.cachedInput &&
    left.cacheWriteInput === right.cacheWriteInput &&
    left.reasoningOutput === right.reasoningOutput
  )
}

function sumOptional(
  field: 'cachedInput' | 'cacheWriteInput' | 'reasoningOutput',
  left: HarnessUsage,
  right: HarnessUsage,
): Record<string, number> {
  const a = left[field]
  const b = right[field]
  if (a === undefined && b === undefined) return {}
  return { [field]: (a ?? 0) + (b ?? 0) }
}

const UUID_V7 = /^([0-9a-f]{8})-([0-9a-f]{4})-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function uuidV7TimestampMs(value: string | undefined): number | undefined {
  const match = value?.match(UUID_V7)
  if (!match) return undefined
  const ms = Number.parseInt(`${match[1]}${match[2]}`, 16)
  return Number.isSafeInteger(ms) ? ms : undefined
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function naturalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}
