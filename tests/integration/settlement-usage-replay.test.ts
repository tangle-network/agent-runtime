import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { expect, it } from 'vitest'
import { readSettleRecord, writeSettleRecord } from '../../src/durable/settle-record'
import { FileSpawnJournal } from '../../src/durable/spawn-journal/journal-store'
import { sumSpendFromEvents } from '../../src/runtime/supervise/recover-executors'
import { terminalAccounting } from '../../src/runtime/supervise/supervisor-accounting'

// Preserved accounting records only: prompts, transcripts and outputs are excluded.
const fixtures = join(import.meta.dirname, '../fixtures/durable/settlement-usage')
it.each(['incomplete', 'partial', 'complete', 'undispatched'])(
  'settles preserved %s usage without changing its evidence or guessing missing receipts',
  async (name) => {
    const saved = JSON.parse(await readFile(join(fixtures, `${name}.json`), 'utf8'))
    const bytes = gunzipSync(await readFile(join(fixtures, `${name}.jsonl.gz`)))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(saved.projectionSha256)
    const dir = await mkdtemp(join(tmpdir(), 'settlement-replay-'))
    try {
      const path = join(dir, 'spawn-journal.jsonl')
      await writeFile(path, bytes)
      const journal = new FileSpawnJournal(path)
      const profile: AgentProfile = {
        name: 'requested-seat',
        harness: 'opencode',
        model: { default: 'requested-model', provider: 'requested-provider' },
      }
      const result = await terminalAccounting(journal, saved.runId, saved.spentTotal.ms, profile)
      if (name === 'incomplete') {
        expect(result.spentTotal.tokens.input).toBe(616_624_623)
        expect(result.spentTotal.iterations).toBe(0)
        // Admission must still charge the unfinished reservations conservatively.
        expect(
          sumSpendFromEvents((await journal.loadTree(saved.runId))!).childWork.tokens.input,
        ).toBeGreaterThan(result.spentTotal.tokens.input)
      } else expect(result.spentTotal).toEqual(saved.spentTotal)
      expect(result.providerModel).toMatchObject(saved.providerModel)
      expect(result.spentTotal.tokensKnown).toBe(saved.spentTotal.tokensKnown)
      expect(result.usage.tokens).toEqual({
        status: name === 'complete' ? 'known' : name === 'undispatched' ? 'unknown' : 'lower-bound',
        input: name === 'undispatched' ? null : result.spentTotal.tokens.input,
        output: name === 'undispatched' ? null : result.spentTotal.tokens.output,
        unknownAttempts:
          name === 'complete' ? 0 : name === 'partial' ? 1 : name === 'undispatched' ? 61 : null,
      })
      expect(result.usage.requestedModel).toEqual({
        id: 'requested-model',
        harness: 'opencode',
        provider: 'requested-provider',
      })
      expect(result.usage.observedModels).toEqual(saved.providerModel.models)
      if (name !== 'complete')
        expect(result.gaps.some((gap) => gap.channels.includes('tokens'))).toBe(true)
      await writeSettleRecord(dir, {
        kind: 'no-winner',
        tree: { root: saved.runId, nodes: [] },
        ...result,
        usage: undefined,
      })
      expect((await readSettleRecord(dir))?.spentTotal).toEqual(result.spentTotal)
      expect(
        (await readSettleRecord(dir, { usage: true, requestedProfile: profile }))?.usage,
      ).toEqual(result.usage)
      expect((await readSettleRecord(dir))?.usage).toBeUndefined()
      await expect(writeSettleRecord(dir, result)).rejects.toThrow('already exists')
      expect(await readFile(path)).toEqual(bytes)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
)

it('refuses a malformed receipt on the real journal-to-settlement path', async () => {
  const saved = JSON.parse(await readFile(join(fixtures, 'complete.json'), 'utf8'))
  const bytes = gunzipSync(await readFile(join(fixtures, 'complete.jsonl.gz')))
  const records = bytes
    .toString('utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  const meter = records.find(
    (record) => record.event?.kind === 'metered' && record.event.spend.tokens.input > 0,
  )
  const dir = await mkdtemp(join(tmpdir(), 'settlement-invalid-'))
  try {
    const valid = { ...meter.event.spend.tokens }
    for (const tokens of [
      { ...valid, input: -1 },
      { ...valid, input: Number.MAX_SAFE_INTEGER + 1 },
      { ...valid, input: 0 },
      { ...valid, input: undefined },
      { ...valid, output: undefined },
      {},
      { ...valid, input: 1.5 },
      { input: 1, output: 1, cacheRead: 2 },
    ]) {
      meter.event.spend.tokens = tokens
      await writeFile(
        join(dir, 'spawn-journal.jsonl'),
        `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
      )
      await expect(
        terminalAccounting(new FileSpawnJournal(join(dir, 'spawn-journal.jsonl')), saved.runId, 0),
      ).rejects.toThrow(/tokens/)
    }
    meter.event.spend.tokens = { ...valid, tokensKnown: false }
    await writeFile(
      join(dir, 'spawn-journal.jsonl'),
      `${records.map((record) => JSON.stringify(record)).join('\n')}\n`,
    )
    const unknown = await terminalAccounting(
      new FileSpawnJournal(join(dir, 'spawn-journal.jsonl')),
      saved.runId,
      0,
    )
    expect(unknown.spentTotal.tokensKnown).toBe(false)
    expect(unknown.gaps.some((gap) => gap.channels.includes('tokens'))).toBe(true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
