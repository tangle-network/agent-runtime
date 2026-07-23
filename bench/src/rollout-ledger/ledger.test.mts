import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fixtureRolloutLine } from './fixtures.mts'
import { appendRolloutLines, readRolloutLedger, writeRolloutLedger } from './ledger.mts'
import { validateRolloutLine, type RolloutLine } from './types.ts'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rollout-ledger-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('validateRolloutLine', () => {
  it('accepts the fixture line', () => {
    expect(validateRolloutLine(fixtureRolloutLine())).toEqual([])
  })

  it('rejects a wrong schema tag, bad role, and bad split with dotted paths', () => {
    const bad = fixtureRolloutLine() as unknown as Record<string, unknown>
    bad.schema = 'tangle.rollout.v0'
    bad.role = 'manager'
    ;(bad.task as Record<string, unknown>).split = 'test'
    const errors = validateRolloutLine(bad)
    expect(errors).toContain('schema: expected "tangle.rollout.v1"')
    expect(errors.some((e) => e.startsWith('role:'))).toBe(true)
    expect(errors.some((e) => e.startsWith('task.split:'))).toBe(true)
  })

  it('requires a gap note on empty-messages lines', () => {
    const gapless = fixtureRolloutLine({ messages: [] })
    expect(validateRolloutLine(gapless)).toContain('provenance.gap: required when messages is empty')
    const labeled = fixtureRolloutLine({
      messages: [],
      provenance: { captured_at: '2026-07-23T00:00:00.000Z', capture: 'backfill', gap: 'store unavailable' },
    })
    expect(validateRolloutLine(labeled)).toEqual([])
  })

  it('requires tool_call_id on role:"tool" messages and rejects malformed tool_calls', () => {
    const line = fixtureRolloutLine() as unknown as { messages: Array<Record<string, unknown>> }
    delete line.messages[3].tool_call_id
    line.messages[2].tool_calls = [{ id: 'x' }]
    const errors = validateRolloutLine(line)
    expect(errors.some((e) => e.includes('messages[3].tool_call_id'))).toBe(true)
    expect(errors.some((e) => e.includes('messages[2].tool_calls[0]'))).toBe(true)
  })
})

describe('ledger write/append/read', () => {
  it('round-trips lines through write + read', async () => {
    const path = join(dir, 'ledger.jsonl')
    const lines = [fixtureRolloutLine(), fixtureRolloutLine({ rollout_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' })]
    await writeRolloutLedger(path, lines)
    expect(await readRolloutLedger(path)).toEqual(lines)
  })

  it('append adds JSONL lines without rewriting existing ones', async () => {
    const path = join(dir, 'ledger.jsonl')
    await writeRolloutLedger(path, [fixtureRolloutLine()])
    await appendRolloutLines(path, [fixtureRolloutLine({ rollout_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' })])
    const raw = await readFile(path, 'utf8')
    expect(raw.trim().split('\n')).toHaveLength(2)
    const read = await readRolloutLedger(path)
    expect(read.map((l) => l.rollout_id)).toEqual([
      '11111111-2222-4333-8444-555555555555',
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    ])
  })

  it('refuses to write an invalid line (nothing lands on disk)', async () => {
    const path = join(dir, 'ledger.jsonl')
    const bad = fixtureRolloutLine({ role: 'manager' as unknown as RolloutLine['role'] })
    await expect(writeRolloutLedger(path, [bad])).rejects.toThrow(/role: invalid role/)
    await expect(readFile(path, 'utf8')).rejects.toThrow()
  })

  it('read fails loud with the line number on a corrupt line', async () => {
    const path = join(dir, 'ledger.jsonl')
    await writeRolloutLedger(path, [fixtureRolloutLine()])
    const raw = await readFile(path, 'utf8')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(path, raw + '{"schema":"tangle.rollout.v1"}\n')
    await expect(readRolloutLedger(path)).rejects.toThrow(/:2/)
  })
})
