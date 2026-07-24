import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  findOpencodeSessionsByDirectory,
  openOpencodeDb,
  readOpencodeSessionMessages,
} from './opencode-reader.mts'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'opencode-reader-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Miniature opencode.db with the observed session/message/part schema. */
async function buildFixtureDb(path: string): Promise<void> {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(path)
  db.exec(`
    CREATE TABLE session (
      id text PRIMARY KEY, project_id text NOT NULL, workspace_id text, parent_id text,
      slug text NOT NULL, directory text NOT NULL, path text, title text NOT NULL,
      version text NOT NULL, share_url text, summary_additions integer, summary_deletions integer,
      summary_files integer, summary_diffs text, metadata text,
      cost real DEFAULT 0 NOT NULL,
      tokens_input integer DEFAULT 0 NOT NULL, tokens_output integer DEFAULT 0 NOT NULL,
      tokens_reasoning integer DEFAULT 0 NOT NULL,
      tokens_cache_read integer DEFAULT 0 NOT NULL, tokens_cache_write integer DEFAULT 0 NOT NULL,
      revert text, permission text, agent text, model text,
      time_created integer NOT NULL, time_updated integer NOT NULL,
      time_compacting integer, time_archived integer
    );
    CREATE TABLE message (
      id text PRIMARY KEY, session_id text NOT NULL,
      time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL
    );
    CREATE TABLE part (
      id text PRIMARY KEY, message_id text NOT NULL, session_id text NOT NULL,
      time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL
    );
  `)
  db.prepare(
    `INSERT INTO session (id, project_id, slug, directory, title, version, parent_id, agent, model,
       cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
       time_created, time_updated)
     VALUES ('ses_1', 'prj', 'w-0', '/tmp/loops-w-0-fixture', 'worker', '1', 'ses_root', 'build',
       '{"id":"glm-5.2","providerID":"tangle-router","variant":"default"}',
       0.01, 100, 50, 5, 30, 10, 1000, 61000)`,
  ).run()
  const insertMessage = db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)')
  const insertPart = db.prepare('INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)')
  insertMessage.run('msg_1', 'ses_1', 1000, 1000, JSON.stringify({ role: 'user', time: { created: 1000 } }))
  insertPart.run('prt_a', 'msg_1', 'ses_1', 1000, 1000, JSON.stringify({ type: 'text', text: 'Survey the workspace.' }))
  insertMessage.run(
    'msg_2',
    'ses_1',
    2000,
    2000,
    JSON.stringify({ role: 'assistant', modelID: 'glm-5.2', providerID: 'tangle-router', tokens: { input: 100, output: 50 } }),
  )
  insertPart.run('prt_b1', 'msg_2', 'ses_1', 2000, 2000, JSON.stringify({ type: 'step-start', snapshot: 'abc' }))
  insertPart.run('prt_b2', 'msg_2', 'ses_1', 2000, 2000, JSON.stringify({ type: 'reasoning', text: 'List files first.' }))
  insertPart.run('prt_b3', 'msg_2', 'ses_1', 2000, 2000, JSON.stringify({ type: 'text', text: 'Surveying now.' }))
  insertPart.run(
    'prt_b4',
    'msg_2',
    'ses_1',
    2000,
    2000,
    JSON.stringify({
      type: 'tool',
      tool: 'read',
      callID: 'call_1',
      state: { status: 'completed', input: { filePath: '/tmp/x' }, output: 'dir listing' },
    }),
  )
  insertPart.run('prt_b5', 'msg_2', 'ses_1', 2000, 2000, JSON.stringify({ type: 'step-finish', reason: 'tool-calls' }))
  insertPart.run('prt_b6', 'msg_2', 'ses_1', 2001, 2001, JSON.stringify({ type: 'step-start', snapshot: 'abc' }))
  insertPart.run('prt_b7', 'msg_2', 'ses_1', 2001, 2001, JSON.stringify({ type: 'text', text: 'Done: 3 entries.' }))
  db.close()
}

describe('openOpencodeDb', () => {
  it('returns null for a missing or corrupt store instead of throwing', async () => {
    expect(await openOpencodeDb(join(dir, 'absent.db'))).toBeNull()
    const corrupt = join(dir, 'corrupt.db')
    await writeFile(corrupt, 'not a sqlite file at all')
    expect(await openOpencodeDb(corrupt)).toBeNull()
  })
})

describe('opencode session reading', () => {
  it('finds sessions by worker cwd and converts message/part rows to canonical messages', async () => {
    const path = join(dir, 'opencode.db')
    await buildFixtureDb(path)
    const db = await openOpencodeDb(path)
    expect(db).not.toBeNull()
    if (db === null) return
    try {
      const sessions = findOpencodeSessionsByDirectory(db, '/tmp/loops-w-0-fixture')
      expect(sessions).toHaveLength(1)
      const session = sessions[0]
      expect(session.id).toBe('ses_1')
      expect(session.parentId).toBe('ses_root')
      expect(session.model).toEqual({ id: 'glm-5.2', providerID: 'tangle-router', variant: 'default' })
      expect(session.tokensInput).toBe(100)
      expect(session.tokensOutput).toBe(50)
      expect(session.costUsd).toBeCloseTo(0.01)

      const messages = readOpencodeSessionMessages(db, 'ses_1')
      expect(messages).toEqual([
        { role: 'user', content: 'Survey the workspace.' },
        {
          role: 'assistant',
          content: 'Surveying now.',
          reasoning_content: 'List files first.',
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'read', arguments: '{"filePath":"/tmp/x"}' } },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', name: 'read', content: 'dir listing' },
        { role: 'assistant', content: 'Done: 3 entries.' },
      ])
      expect(findOpencodeSessionsByDirectory(db, '/tmp/loops-w-9-missing')).toEqual([])
    } finally {
      db.close()
    }
  })
})
