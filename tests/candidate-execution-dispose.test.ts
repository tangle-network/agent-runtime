import { afterEach, describe, expect, it } from 'vitest'
import { InMemoryAgentCandidateExecutionClaimStore } from '../src/candidate-execution/claim'
import { disposePreparedAgentCandidateExecution } from '../src/candidate-execution/dispose'
import { executePreparedAgentCandidate } from '../src/candidate-execution/execute'
import { prepareAgentCandidateExecution } from '../src/candidate-execution/prepare'
import { verifyAgentCandidateBundle } from '../src/candidate-execution/verify'
import {
  candidateSha,
  cleanupCandidateFixtures,
  createCandidateExecutionFixture,
  createCandidateOutputFixture,
} from './helpers/candidate-execution-fixture'

afterEach(cleanupCandidateFixtures)

describe('prepared candidate disposal', () => {
  it('settles an unexecuted reservation exactly once and consumes the preparation', async () => {
    const fixture = createCandidateExecutionFixture()
    const reasons: string[] = []
    fixture.ports.models.settleGrant = async ({ preparationId, reason }) => {
      reasons.push(`${preparationId}:${reason}`)
      return {
        preparationId,
        grantDigest: candidateSha('c'),
        closed: true,
        calls: [],
      }
    }
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    )

    await expect(disposePreparedAgentCandidateExecution(prepared)).resolves.toEqual({
      disposed: true,
    })
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toMatch(/candidate-preparation\..+:abandoned/)
    await expect(
      executePreparedAgentCandidate(prepared, {
        traceStore: {} as never,
        claimStore: new InMemoryAgentCandidateExecutionClaimStore(),
        executor: {} as never,
        ...createCandidateOutputFixture(),
      }),
    ).resolves.toMatchObject({
      succeeded: false,
      reason: expect.stringMatching(/already disposed/),
    })
  })

  it('retries exact idempotent cleanup when disposal transiently fails', async () => {
    const fixture = createCandidateExecutionFixture()
    let settlements = 0
    fixture.ports.models.settleGrant = async ({ preparationId }) => {
      settlements++
      if (settlements === 1) throw new Error('gateway unavailable')
      return {
        preparationId,
        grantDigest: candidateSha('c'),
        closed: true,
        calls: [],
      }
    }
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    )

    await expect(
      disposePreparedAgentCandidateExecution(prepared, { cleanupTimeoutMs: 25 }),
    ).rejects.toThrow(/disposal failed/)
    await expect(disposePreparedAgentCandidateExecution(prepared)).resolves.toEqual({
      disposed: true,
    })
    expect(settlements).toBe(2)
  })

  it('allows only one concurrent disposal attempt', async () => {
    const fixture = createCandidateExecutionFixture()
    let release!: () => void
    const wait = new Promise<void>((resolve) => {
      release = resolve
    })
    fixture.ports.models.settleGrant = async ({ preparationId }) => {
      await wait
      return {
        preparationId,
        grantDigest: candidateSha('c'),
        closed: true,
        calls: [],
      }
    }
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
    )
    const first = disposePreparedAgentCandidateExecution(prepared)
    await expect(disposePreparedAgentCandidateExecution(prepared)).rejects.toThrow(
      /already disposing/,
    )
    release()
    await expect(first).resolves.toEqual({ disposed: true })
  })
})
