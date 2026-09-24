/**
 * The kill-and-resume conformance conversation: two participants, six turns (three rounds,
 * round-robin), every turn committing a keyed side effect through its own deterministic turn id —
 * the product's own idempotency key (`turnId(runId, index, speaker)` is stable across retries and
 * resumes by design, which is exactly the property under test).
 *
 * `FileConversationJournal` and `SqlConversationJournal` are the two shipped durable backends for
 * this layer. The journal subsystem owns turn-granularity durability: a process that dies between
 * turns resumes from the last committed turn; a turn that died mid-flight re-runs under the SAME
 * turn id, so a keyed side effect commits exactly once.
 *
 * A `runGraph` run cannot take these backends at all (its durable layer is the SpawnJournal
 * family; `ConversationJournal` is a different interface on a different subsystem) — that
 * mismatch is itself a conformance finding, recorded in the suite's capability-gap case.
 */

import { DatabaseSync } from 'node:sqlite'
import { createIterableBackend } from '../../../src/backends'
import { FileConversationJournal } from '../../../src/conversation/journal'
import { type SqlAdapter, SqlConversationJournal } from '../../../src/conversation/journal-sql'
import { runConversation } from '../../../src/conversation/run-conversation'
import { turnId as deriveTurnId } from '../../../src/conversation/turn-id'
import type {
  Conversation,
  ConversationResult,
  ConversationStreamEvent,
} from '../../../src/conversation/types'
import type { AgentExecutionBackend } from '../../../src/types'
import { armKillSwitch, type KillSwitch } from './kill-switch'
import { openSideEffectSite, type SideEffectSite } from './side-effect'

export const CONV_RUN_ID = 'conformance-conv'
export const CONV_TURNS = 6
const SPEAKERS = ['alpha', 'beta'] as const
const ROUNDS = CONV_TURNS / SPEAKERS.length

/** Deterministic reply per (speaker, turnIndex) — the same text for a turn in ANY process. */
export function replyFor(speaker: string, turnIndex: number): string {
  return `${speaker}-says-${turnIndex}`
}

export function expectedTurnIds(): string[] {
  return Array.from({ length: CONV_TURNS }, (_, i) =>
    deriveTurnId(CONV_RUN_ID, i, SPEAKERS[i % SPEAKERS.length] as string),
  )
}

export type BackendKind = 'file' | 'sqlite'

export function openJournal(
  dir: string,
  kind: BackendKind,
): {
  loadRun: (
    runId: string,
  ) => Promise<{ turns: Array<{ index: number; text: string; turnId: string }> } | undefined>
  close: () => void
  readonly kind: BackendKind
} {
  if (kind === 'file') {
    const journal = new FileConversationJournal(`${dir}/conversation.jsonl`)
    return {
      kind,
      loadRun: async (runId) => {
        const entry = await journal.loadRun(runId)
        return entry === undefined
          ? undefined
          : {
              turns: entry.turns.map((t) => ({
                index: t.index,
                text: t.text,
                turnId: t.turnId,
              })),
            }
      },
      close: () => {},
    }
  }
  const db = new DatabaseSync(`${dir}/conversation.sqlite`)
  const journal = new SqlConversationJournal(nodeSqliteAdapter(db), 'durability')
  return {
    kind,
    loadRun: async (runId) => {
      await journal.migrate()
      const entry = await journal.loadRun(runId)
      return entry === undefined
        ? undefined
        : {
            turns: entry.turns.map((t) => ({
              index: t.index,
              text: t.text,
              turnId: t.turnId,
            })),
          }
    },
    close: () => db.close(),
  }
}

function nodeSqliteAdapter(db: DatabaseSync): SqlAdapter {
  return {
    async exec(sql, params = []) {
      const res = db.prepare(sql).run(...params)
      return { rowsAffected: Number(res?.changes ?? 0) }
    },
    async query<TRow>(sql: string, params: readonly unknown[] = []): Promise<TRow[]> {
      return db.prepare(sql).all(...params) as TRow[]
    },
  }
}

/** The scripted participant backend: keyed side effect + fixed reply, kill points inside the turn. */
function scriptedBackend(
  speaker: string,
  site: SideEffectSite,
  kill: KillSwitch,
): AgentExecutionBackend {
  return createIterableBackend({
    kind: `conformance-${speaker}`,
    async *stream(_input, context) {
      const turnIndex = Number(context.task.metadata?.turnIndex ?? -1)
      const id = context.task.id
      kill(`turn:${turnIndex}:before`)
      // The turn's side effect, keyed by the product's own deterministic turn id: a re-run after
      // a mid-turn kill re-commits under the SAME key and dedupes at the effect site.
      site.commit(id, { speaker, turnIndex })
      const text = replyFor(speaker, turnIndex)
      yield {
        type: 'text_delta' as const,
        task: context.task,
        session: context.session,
        text,
        timestamp: new Date().toISOString(),
      }
      yield {
        type: 'llm_call' as const,
        task: context.task,
        session: context.session,
        model: `conformance-${speaker}`,
        tokensIn: 10,
        tokensOut: 5,
        costUsd: 0.01,
        latencyMs: 1,
        timestamp: new Date().toISOString(),
      }
      kill(`turn:${turnIndex}:after-backend`)
    },
  })
}

export interface ConversationChildReport {
  readonly phase: string
  readonly backend: BackendKind
  readonly haltedKind: string
  readonly turns: number
  readonly texts: string[]
  readonly committedEffects: string[]
  readonly effectInvocationKeys: string[]
}

/** One phase of the conformance conversation run, in THIS process. */
export async function runConversationPhase(
  dir: string,
  phase: string,
  backend: BackendKind,
  killAt?: string,
): Promise<ConversationChildReport> {
  const kill = armKillSwitch({
    ...(killAt === undefined ? {} : { killAt }),
    labelsFile: `${dir}/labels-phase-${phase}.log`,
    killedFile: `${dir}/killed.log`,
  })
  const site = openSideEffectSite(dir)
  let journal: FileConversationJournal | SqlConversationJournal
  if (backend === 'file') {
    journal = new FileConversationJournal(`${dir}/conversation.jsonl`)
  } else {
    const sql = new SqlConversationJournal(
      nodeSqliteAdapter(new DatabaseSync(`${dir}/conversation.sqlite`)),
      'durability',
    )
    await sql.migrate()
    journal = sql
  }
  const conversation: Conversation = {
    participants: SPEAKERS.map((speaker) => ({
      name: speaker,
      backend: scriptedBackend(speaker, site, kill),
    })),
    policy: { maxTurns: CONV_TURNS, turnOrder: 'round-robin' },
  }
  const onEvent = async (event: ConversationStreamEvent): Promise<void> => {
    if (event.type === 'turn_end') kill(`turn:${event.turn.index}:committed`)
  }
  const result: ConversationResult = await runConversation(conversation, {
    runId: CONV_RUN_ID,
    seed: 'conformance-seed',
    journal,
    onEvent,
  })
  return {
    phase,
    backend,
    haltedKind: result.halted?.kind ?? 'none',
    turns: result.turns,
    texts: result.transcript.map((t) => t.text),
    committedEffects: site.committedKeys(),
    effectInvocationKeys: site.invocations().map((i) => i.key),
  }
}
