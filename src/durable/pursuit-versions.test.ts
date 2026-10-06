import { describe, expect, it } from 'vitest'
import {
  assertPursuitVersions,
  identicalFailureStreak,
  type JudgedPursuitVersion,
  versionFailure,
} from './pursuit-versions'

const MATERIALIZE =
  'AgentProfile workspace materialization failed: Refusing to replace existing workspace file: CLAUDE.md'

/** A judged version as the chain reads it; only the fields the failure rule reads are real. */
function version(
  n: number,
  outcome: { error: string; name?: string } | 'winner' | 'budget-exhausted' | 'unscored',
): JudgedPursuitVersion {
  const result =
    outcome === 'winner'
      ? { kind: 'winner' }
      : outcome === 'budget-exhausted' || outcome === 'unscored'
        ? { kind: 'no-winner', reason: 'budget-exhausted' }
        : {
            kind: 'no-winner',
            reason: 'driver-failed',
            error: { name: outcome.name ?? 'Error', message: outcome.error },
          }
  return {
    version: n,
    nodeId: `node_${n}`,
    runId: `run.v${n}`,
    runDir: `/runs/run.v${n}`,
    result,
    verdict: {
      score: outcome === 'unscored' ? null : outcome === 'winner' ? 1 : 0,
      judgeDigest: `sha256:${'0'.repeat(64)}`,
    },
  } as unknown as JudgedPursuitVersion
}

describe('the identical-failure stop of a version chain', () => {
  it('names a driver failure with run-specific parts normalized', () => {
    expect(
      versionFailure(
        version(4, {
          error: 'spawn failed for run 9f3a2b1c4d5e6f70 at /mnt/traces/runs/x.v4/work after 12 ms',
        }),
      ),
    ).toBe('driver-failed: Error: spawn failed for run <hex> at <path> after <n> ms')
    expect(versionFailure(version(5, 'unscored'))).toBe('unscored by the judge')
    expect(versionFailure(version(6, 'budget-exhausted'))).toBeNull()
    expect(versionFailure(version(7, 'winner'))).toBeNull()
  })

  it('stops after the configured number of versions failed identically', () => {
    const chain = [
      version(1, 'winner'),
      version(2, 'budget-exhausted'),
      version(3, { error: MATERIALIZE }),
      version(4, { error: MATERIALIZE }),
    ]
    expect(identicalFailureStreak(chain, 3)).toBeNull()
    expect(identicalFailureStreak([...chain, version(5, { error: MATERIALIZE })], 3)).toBe(
      `driver-failed: Error: ${MATERIALIZE}`,
    )
  })

  it('does not count different failures, or a version that ran, as a streak', () => {
    const different = [
      version(1, { error: MATERIALIZE }),
      version(2, { error: 'credential rejected' }),
      version(3, { error: MATERIALIZE }),
    ]
    expect(identicalFailureStreak(different, 3)).toBeNull()
    const interrupted = [
      version(1, { error: MATERIALIZE }),
      version(2, 'budget-exhausted'),
      version(3, { error: MATERIALIZE }),
      version(4, { error: MATERIALIZE }),
    ]
    expect(identicalFailureStreak(interrupted, 3)).toBeNull()
    expect(identicalFailureStreak(interrupted, 2)).toBe(`driver-failed: Error: ${MATERIALIZE}`)
    expect(
      identicalFailureStreak(
        [
          version(1, { error: MATERIALIZE, name: 'Error' }),
          version(2, { error: MATERIALIZE, name: 'ConfigError' }),
        ],
        2,
      ),
    ).toBeNull()
  })

  it('validates the stop field', () => {
    const versions = (stop: Record<string, unknown>) => ({
      judge: { digest: `sha256:${'a'.repeat(64)}`, judge: async () => ({}) },
      next: 'review-of-best',
      stop: { patience: 3, maxVersions: 10, maxUsd: 5, deadlineMs: 60_000, ...stop },
    })
    expect(() => assertPursuitVersions(versions({}))).not.toThrow()
    expect(() => assertPursuitVersions(versions({ identicalFailures: 2 }))).not.toThrow()
    expect(() => assertPursuitVersions(versions({ identicalFailures: 0 }))).toThrow(
      'stop.identicalFailures must be an integer of at least 1',
    )
  })
})
