import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { FileSpawnJournal } from '../../src/durable/spawn-journal/journal-store'
import {
  type DriverAttemptRecord,
  HarnessTurnFailedError,
} from '../../src/runtime/supervise/driver-attempt-evidence'
import { runDriverWithRetry } from '../../src/runtime/supervise/driver-retry'

const refusal =
  'opencode execution failed: 已达到 5 小时的使用上限。您的限额将在 2026-11-11 21:29:38 重置。 (exit code 1)'

it.each(['legacy', 'typed', 'rate'] as const)(
  'replays the recorded %s refusal through driver retry and a cold journal read',
  async (mode) => {
    const directory = await mkdtemp(join(tmpdir(), 'subscription-window-'))
    const file = join(directory, 'journal.jsonl')
    const journal = new FileSpawnJournal(file)
    const now = Date.parse('2026-11-11T09:55:19.195Z')
    const resetAt = '2026-11-11T13:29:38.000Z'
    const paused = new Error('replay reached its first capacity wait')
    let calls = 0
    const waits: number[] = []
    try {
      await journal.beginTree('root', new Date(now).toISOString())
      await expect(
        runDriverWithRetry({
          now: () => now,
          signal: new AbortController().signal,
          budget: () => ({
            tokensLeft: 100,
            tokensKnown: true,
            cacheBreakdownKnown: true,
            usdLeft: 0,
            usdCapped: false,
            usdKnown: true,
            iterationsLeft: 100,
            deadlineMs: now + 5 * 3_600_000,
            reservedTokens: 0,
          }),
          progress: () => ({ poolTokensSpent: 0, settledCount: 0, submitted: false }),
          async drive() {
            calls++
            throw new HarnessTurnFailedError('opencode', {
              error: mode === 'rate' ? '已达到速率限制，请您控制请求频率' : refusal,
              errorCode: mode === 'typed' ? 'provider_quota_exhausted' : 'rate_limit_error',
              statusCode: 429,
              ...(mode === 'typed'
                ? { failure: { kind: 'capacity' as const, code: 'provider_quota_exhausted', resetAt } }
                : {}),
            })
          },
          async onAttempt(record) {
            await journal.appendEvent('root', {
              kind: 'driver-attempt',
              id: 'root',
              record,
              attemptId: `root:${record.attempt}`,
              seq: record.attempt,
              at: new Date(now).toISOString(),
            })
          },
          async sleep(ms) {
            waits.push(ms)
            throw paused
          },
        }),
      ).rejects.toBe(paused)
      const records: DriverAttemptRecord[] = (
        await new FileSpawnJournal(file).loadTree('root')
      )!.flatMap((event) => (event.kind === 'driver-attempt' ? [event.record] : []))
      expect(calls).toBe(1)
      expect(records).toHaveLength(1)
      expect(waits).toHaveLength(1)
      expect(records[0]).toMatchObject({
        classification: 'unavailable',
        unavailableSignal: mode === 'rate' ? 'rate_limit_error' : 'subscription-usage-limit',
        ...(mode === 'typed' ? { resumeAt: resetAt, retryInMs: Date.parse(resetAt) - now } : {}),
      })
      if (mode !== 'typed') expect(records[0]?.resumeAt).toBeUndefined()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)
