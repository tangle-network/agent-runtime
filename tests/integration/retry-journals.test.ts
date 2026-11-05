import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { FileSpawnJournal } from '../../src/durable/spawn-journal/journal-store'
import { DriverAttemptsExhaustedError } from '../../src/runtime/supervise/driver-attempt-evidence'
import { runDriverWithRetry } from '../../src/runtime/supervise/driver-retry'
import { RetainedExecutionPendingError } from '../../src/runtime/supervise/retained-executor'

// JSONL keeps one projected source/episode per committed journal row.
const captured = (
  await readFile(new URL('./fixtures/retry-journals.jsonl', import.meta.url), 'utf8')
)
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line)) as Array<{
  kind: string
  runId: string
  node: string
  count: number
  error: string
}>
const runs = captured
  .filter((row) => row.kind === 'source')
  .map((row) => ({
    runId: row.runId,
    episodes: captured.filter(
      (episode) => episode.kind === 'episode' && episode.runId === row.runId,
    ),
  }))

for (const run of runs) {
  it(`settles every captured unchanged episode from ${run.runId} within three attempts`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'retry-journal-golden-'))
    try {
      for (const [index, episode] of run.episodes.entries()) {
        const file = join(directory, `${index}.jsonl`)
        const journal = new FileSpawnJournal(file)
        await journal.beginTree(episode.node, new Date().toISOString())
        let seq = 0
        let caught: unknown
        const controller = new AbortController()
        try {
          await runDriverWithRetry({
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(1500)]),
            budget: () => ({
              tokensLeft: 100,
              tokensKnown: true,
              cacheBreakdownKnown: true,
              usdLeft: 0,
              usdCapped: false,
              usdKnown: true,
              iterationsLeft: 100,
              deadlineMs: Date.now() + 10000,
              reservedTokens: 0,
            }),
            progress: () => ({ poolTokensSpent: 0, settledCount: 0, submitted: false }),
            nested: episode.node !== run.runId,
            stopPause: episode.node === run.runId ? { steered: async () => {} } : undefined,
            policy: { initialBackoffMs: 1, maxBackoffMs: 2 },
            async drive() {
              // The legacy journal preserved flattened text, not SDK error instances or typed codes.
              throw new RetainedExecutionPendingError(new Error(episode.error), 'unobservable')
            },
            async onAttempt(record) {
              await journal.appendEvent(episode.node, {
                kind: 'driver-attempt',
                id: episode.node,
                record,
                attemptId: `${episode.node}:replay:${++seq}`,
                seq,
                at: new Date().toISOString(),
              })
              if (record.attempt >= 4)
                controller.abort(new Error('four replayed failures observed'))
            },
          })
        } catch (error) {
          caught = error
        }
        expect(caught, episode.node).toBeInstanceOf(DriverAttemptsExhaustedError)
        const rows = (await new FileSpawnJournal(file).loadTree(episode.node))!.flatMap((event) =>
          event.kind === 'driver-attempt' ? [event.record] : [],
        )
        expect(
          Math.max(...rows.map((row) => row.attempt)),
          `${episode.node}: historical ${episode.count}`,
        ).toBeLessThanOrEqual(3)
        expect(rows.at(-1)?.stop, episode.node).toBe('pending-unresolved')
        expect(rows.at(-1)?.pendingCause).toBe('unobservable')
        expect(rows.at(-1)?.error).toContain(episode.error)
        expect(rows.slice(0, -1).every((row) => (row.retryInMs ?? 0) > 0)).toBe(true)
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }, 15000)
}
