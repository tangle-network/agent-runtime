import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claudeProjectSlug, findClaudeTranscripts, readClaudeTranscript } from './claude-reader.mts'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'claude-reader-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const jsonl = (rows: unknown[]): string => rows.map((r) => JSON.stringify(r)).join('\n') + '\n'

describe('claudeProjectSlug', () => {
  it('matches Claude Code project-directory naming', () => {
    expect(claudeProjectSlug('/tmp/claude-1000/-home-drew/x.y_z')).toBe('-tmp-claude-1000--home-drew-x-y-z')
  })
})

describe('findClaudeTranscripts', () => {
  it('lists jsonl session files for a cwd, empty when the project dir is absent', async () => {
    const cwd = '/tmp/some/worktree'
    const project = join(dir, claudeProjectSlug(cwd))
    await mkdir(project, { recursive: true })
    await writeFile(join(project, 'abc.jsonl'), '')
    await writeFile(join(project, 'notes.txt'), '')
    const refs = await findClaudeTranscripts(cwd, dir)
    expect(refs).toEqual([{ sessionId: 'abc', path: join(project, 'abc.jsonl') }])
    expect(await findClaudeTranscripts('/tmp/other', dir)).toEqual([])
  })
})

describe('readClaudeTranscript', () => {
  it('converts user/assistant/tool lines, merges per-block assistant lines, counts usage once', async () => {
    const usage = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 7 }
    const path = join(dir, 'session.jsonl')
    await writeFile(
      path,
      jsonl([
        { type: 'queue-operation', operation: 'enqueue' },
        { type: 'user', timestamp: '2026-07-22T19:00:00.000Z', message: { role: 'user', content: 'Fix the bug.' } },
        {
          type: 'assistant',
          timestamp: '2026-07-22T19:00:01.000Z',
          message: {
            id: 'msg_1',
            model: 'claude-fable-5',
            role: 'assistant',
            content: [{ type: 'thinking', thinking: 'Look at the file first.' }],
            usage,
          },
        },
        {
          type: 'assistant',
          timestamp: '2026-07-22T19:00:02.000Z',
          message: {
            id: 'msg_1',
            model: 'claude-fable-5',
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/a.py' } }],
            usage,
          },
        },
        {
          type: 'user',
          timestamp: '2026-07-22T19:00:03.000Z',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'print(1)' }] }],
          },
        },
        {
          type: 'assistant',
          timestamp: '2026-07-22T19:00:04.000Z',
          message: {
            id: 'msg_2',
            model: 'claude-fable-5',
            role: 'assistant',
            content: [{ type: 'text', text: 'Fixed.' }],
            usage,
          },
        },
        {
          type: 'assistant',
          isSidechain: true,
          timestamp: '2026-07-22T19:00:05.000Z',
          message: { id: 'msg_side', role: 'assistant', content: [{ type: 'text', text: 'subagent noise' }], usage },
        },
      ]),
    )
    const t = await readClaudeTranscript(path)
    expect(t.messages).toEqual([
      { role: 'user', content: 'Fix the bug.' },
      {
        role: 'assistant',
        content: null,
        reasoning_content: 'Look at the file first.',
        tool_calls: [
          { id: 'toolu_1', type: 'function', function: { name: 'Read', arguments: '{"file_path":"/a.py"}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'toolu_1', content: 'print(1)' },
      { role: 'assistant', content: 'Fixed.' },
    ])
    // msg_1 usage counted once despite two jsonl lines; sidechain excluded.
    expect(t.usage).toEqual({ tokensIn: 20, tokensOut: 40, cacheRead: 10, cacheWrite: 14 })
    expect(t.startedAt).toBe('2026-07-22T19:00:00.000Z')
    expect(t.endedAt).toBe('2026-07-22T19:00:04.000Z')
    expect(t.model).toBe('claude-fable-5')
  })
})
