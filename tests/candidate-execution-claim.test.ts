import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { AgentCandidateArtifactRef } from '@tangle-network/agent-interface'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  type AgentCandidateExecutionClaim,
  type AgentCandidateExecutionClaimStore,
  type AgentCandidateExecutionFailureClass,
  type AgentCandidateExecutionLease,
  type AgentCandidateExecutionRecoveryEvidence,
  type AgentCandidateExecutionTerminalResult,
  type AgentCandidateExecutionUsage,
  InMemoryAgentCandidateExecutionClaimStore,
} from '../src/candidate-execution/claim'
import { FileAgentCandidateExecutionClaimStore } from '../src/candidate-execution/claim-file-store'
import { candidateExecutionClaim } from '../src/candidate-execution/claim-plan'
import { candidateExecutionOwnerWindowMs } from '../src/candidate-execution/execution-window'
import { prepareAgentCandidateExecution } from '../src/candidate-execution/prepare'
import { verifyAgentCandidateBundle } from '../src/candidate-execution/verify'
import {
  cleanupCandidateFixtures,
  createCandidateExecutionFixture,
} from './helpers/candidate-execution-fixture'

const temporaryDirectories: string[] = []
const FUTURE_EXPIRY_MS = Date.now() + 60 * 60 * 1_000

afterEach(async () => {
  vi.restoreAllMocks()
  cleanupCandidateFixtures()
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('candidate execution claim lifecycle', () => {
  it('leases only the frozen execution and cleanup owner window', async () => {
    const fixture = createCandidateExecutionFixture()
    const cleanupTimeoutMs = 25
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
      { cleanupTimeoutMs },
    )
    const claimedAtMs = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(claimedAtMs)

    const requested = candidateExecutionClaim(prepared)
    const ownerWindowMs = candidateExecutionOwnerWindowMs(
      fixture.task.limits.timeoutMs,
      cleanupTimeoutMs,
      fixture.task.limits.timeoutMs,
      fixture.task.limits.timeoutMs,
    )

    expect(requested.leaseExpiresAtMs).toBe(claimedAtMs + ownerWindowMs)
    expect(requested.cleanup.cleanupTimeoutMs).toBe(cleanupTimeoutMs)
    expect(requested.resultTimeoutMs).toBe(fixture.task.limits.timeoutMs)
    expect(ownerWindowMs).toBeLessThan(15 * 60_000)
  })

  it('rejects a preparation too near reservation expiry for the owner window', async () => {
    const fixture = createCandidateExecutionFixture()
    const cleanupTimeoutMs = 25
    let reservationExpiresAtMs = 0
    const reserveGrant = fixture.ports.models.reserveGrant
    fixture.ports.models.reserveGrant = async (input) => {
      reservationExpiresAtMs = input.expiresAtMs
      return await reserveGrant(input)
    }
    const prepared = await prepareAgentCandidateExecution(
      await verifyAgentCandidateBundle(fixture.bundle, fixture.ports),
      fixture.task,
      fixture.ports,
      { cleanupTimeoutMs },
    )
    const ownerWindowMs = candidateExecutionOwnerWindowMs(
      fixture.task.limits.timeoutMs,
      cleanupTimeoutMs,
      fixture.task.limits.timeoutMs,
      fixture.task.limits.timeoutMs,
    )
    vi.spyOn(Date, 'now').mockReturnValue(reservationExpiresAtMs - ownerWindowMs + 1)

    expect(() => candidateExecutionClaim(prepared)).toThrow(
      /full execution and cleanup owner window/,
    )
  })

  it('lets exactly one in-process caller acquire an attempt', async () => {
    const store = new InMemoryAgentCandidateExecutionClaimStore()
    const results = await Promise.all(Array.from({ length: 32 }, () => store.tryClaim(claim())))

    expect(results.filter((result) => result.acquired)).toHaveLength(1)
    expect(results.filter((result) => !result.acquired)).toHaveLength(31)
    expect(
      results
        .filter((result) => !result.acquired && result.reason === 'already-claimed')
        .every((result) => result.exactReplay),
    ).toBe(true)
  })

  it('does not call a different preparation an exact replay', async () => {
    const store = new InMemoryAgentCandidateExecutionClaimStore()
    await acquire(store, claim())

    expect(
      await store.tryClaim(
        claim({ cleanup: { ...cleanupHandles(), preparationId: preparationId('q') } }),
      ),
    ).toMatchObject({ acquired: false, reason: 'already-claimed', exactReplay: false })
  })

  it('requires stage before finish and the exact staged terminal digest', async () => {
    const store = new InMemoryAgentCandidateExecutionClaimStore()
    const acquired = await acquire(store, claim())
    const result = failed()

    await expect(store.finish(acquired.lease, sha256('f'))).rejects.toThrow('has not been staged')
    const staged = await store.stageTerminal(acquired.lease, result)
    if (!staged.staged) throw new Error('test setup did not stage')
    await expect(store.finish(acquired.lease, sha256('f'))).rejects.toThrow(
      'does not match staged outbox',
    )
    const finished = await store.finish(acquired.lease, staged.terminal.terminalDigest)

    expect(finished).toEqual({ finished: true, terminal: staged.terminal })
    expect(finished.terminal).toEqual(staged.terminal)
  })

  it('requires the winning lease for phase, stage, and finish', async () => {
    const store = new InMemoryAgentCandidateExecutionClaimStore()
    const acquired = await acquire(store, claim())
    const invalid = { ...acquired.lease, token: leaseToken('x') }

    await expect(store.markCandidateMayRun(invalid)).rejects.toThrow('lease is invalid')
    await expect(store.stageTerminal(invalid, failed())).rejects.toThrow('lease is invalid')
    const staged = await store.stageTerminal(acquired.lease, failed())
    await expect(store.finish(invalid, staged.terminal.terminalDigest)).rejects.toThrow(
      'lease is invalid',
    )
  })

  it('stages exactly once with exact-replay and mismatch evidence', async () => {
    const store = new InMemoryAgentCandidateExecutionClaimStore()
    const acquired = await acquire(store, claim())
    const first = await store.stageTerminal(acquired.lease, failed())
    const replay = await store.stageTerminal(acquired.lease, failed())
    const mismatch = await store.stageTerminal(
      acquired.lease,
      failed(0, 'unknown', { failureEvidence: artifact('9') }),
    )

    expect(first).toMatchObject({ staged: true })
    expect(replay).toMatchObject({ staged: false, exactReplay: true })
    expect(mismatch).toMatchObject({ staged: false, exactReplay: false })
  })

  it('persists every fixed usage field and durable success artifact reference', async () => {
    const store = new InMemoryAgentCandidateExecutionClaimStore()
    const acquired = await acquire(store, claim())
    await store.markCandidateMayRun(acquired.lease)
    const result = succeeded()
    const terminal = await complete(store, acquired.lease, result)
    const observed = await store.getAttempt({ executionId: 'execution-1', attempt: 1 })

    expect(terminal.usage).toEqual(result.usage)
    expect(terminal).toMatchObject({
      schemaVersion: 1,
      modelSettlement: result.modelSettlement,
      taskOutcome: result.taskOutcome,
      benchmarkResult: result.benchmarkResult,
      runReceipt: result.runReceipt,
      terminalDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    })
    expect(observed).toMatchObject({
      phase: 'candidate-may-run',
      staged: terminal,
      terminal,
    })
  })

  it('persists the candidate-may-run phase monotonically before execution terminals', async () => {
    const store = new InMemoryAgentCandidateExecutionClaimStore()
    const acquired = await acquire(store, claim())

    expect(await store.getAttempt({ executionId: 'execution-1', attempt: 1 })).toMatchObject({
      phase: 'claimed',
    })
    expect(await store.markCandidateMayRun(acquired.lease)).toEqual({
      marked: true,
      phase: 'candidate-may-run',
    })
    expect(await store.markCandidateMayRun(acquired.lease)).toEqual({
      marked: false,
      phase: 'candidate-may-run',
    })
    await expect(store.stageTerminal(acquired.lease, failed())).rejects.toThrow(
      'crossed candidate-may-run',
    )
    await complete(store, acquired.lease, failed(0, 'execution'))
    expect(await store.getAttempt({ executionId: 'execution-1', attempt: 1 })).toMatchObject({
      phase: 'candidate-may-run',
    })
  })

  it('refuses success unless candidate-may-run was persisted first', async () => {
    const store = new InMemoryAgentCandidateExecutionClaimStore()
    const acquired = await acquire(store, claim())

    await expect(store.stageTerminal(acquired.lease, succeeded())).rejects.toThrow(
      'requires candidate-may-run phase',
    )
  })

  it('keeps exact stage and finish replay idempotent after lease expiry', async () => {
    let now = 1_000
    const store = new InMemoryAgentCandidateExecutionClaimStore({ now: () => now })
    const acquired = await acquire(store, claim({ leaseExpiresAtMs: 1_100 }))
    const staged = await store.stageTerminal(acquired.lease, failed())
    const finished = await store.finish(acquired.lease, staged.terminal.terminalDigest)
    expect(finished.finished).toBe(true)
    now = 1_100

    expect(await store.stageTerminal(acquired.lease, failed())).toMatchObject({
      staged: false,
      exactReplay: true,
    })
    expect(await store.finish(acquired.lease, staged.terminal.terminalDigest)).toMatchObject({
      finished: false,
      exactReplay: true,
    })
  })

  it('rejects new phase, stage, and finish writes after lease expiry', async () => {
    let now = 2_000
    const phaseStore = new InMemoryAgentCandidateExecutionClaimStore({ now: () => now })
    const phaseLease = await acquire(phaseStore, claim({ leaseExpiresAtMs: 2_100 }))
    const finishStore = new InMemoryAgentCandidateExecutionClaimStore({ now: () => now })
    const finishLease = await acquire(finishStore, claim({ leaseExpiresAtMs: 2_100 }))
    const staged = await finishStore.stageTerminal(finishLease.lease, failed())
    now = 2_100

    await expect(phaseStore.markCandidateMayRun(phaseLease.lease)).rejects.toThrow(
      'lease has expired',
    )
    await expect(phaseStore.stageTerminal(phaseLease.lease, failed())).rejects.toThrow(
      'lease has expired',
    )
    await expect(
      finishStore.finish(finishLease.lease, staged.terminal.terminalDigest),
    ).rejects.toThrow('lease has expired')
  })

  it.each([
    'phase',
    'stage',
  ] as const)('refuses file-backed %s publication when the lease expires during durable write preparation and lets recovery win', async (operation) => {
    const directory = await tempDirectory()
    const expiresAtMs = 2_600
    let now = 2_500
    let expireAfterNextRead = false
    const store = new FileAgentCandidateExecutionClaimStore({
      directory,
      now: () => {
        const observed = now
        if (expireAfterNextRead) {
          expireAfterNextRead = false
          now = expiresAtMs
        }
        return observed
      },
    })
    const requested = retryClaim({ leaseExpiresAtMs: expiresAtMs })
    const acquired = await acquire(store, requested)
    now = expiresAtMs - 1
    expireAfterNextRead = true

    await expect(
      operation === 'phase'
        ? store.markCandidateMayRun(acquired.lease)
        : store.stageTerminal(acquired.lease, failed()),
    ).rejects.toThrow('lease has expired')
    const beforeRecovery = await store.getAttempt({
      executionId: requested.executionId,
      attempt: requested.attempt,
    })
    expect(beforeRecovery?.phase).toBe('claimed')
    expect(beforeRecovery?.staged).toBeUndefined()
    expect(beforeRecovery?.terminal).toBeUndefined()

    const recovered = await store.recoverExpired(
      { executionId: requested.executionId, attempt: requested.attempt },
      recoveryEvidence(requested),
    )
    expect(recovered).toMatchObject({
      finished: true,
      terminal: { status: 'failed', failureClass: 'pre-model-infrastructure' },
    })
  })

  it('refuses file-backed finish publication when the lease expires during durable write preparation and lets recovery win', async () => {
    const directory = await tempDirectory()
    const expiresAtMs = 2_900
    let now = 2_800
    let expireAfterNextRead = false
    const store = new FileAgentCandidateExecutionClaimStore({
      directory,
      now: () => {
        const observed = now
        if (expireAfterNextRead) {
          expireAfterNextRead = false
          now = expiresAtMs
        }
        return observed
      },
    })
    const requested = retryClaim({ leaseExpiresAtMs: expiresAtMs })
    const acquired = await acquire(store, requested)
    const staged = await store.stageTerminal(acquired.lease, failed())
    now = expiresAtMs - 1
    expireAfterNextRead = true

    await expect(store.finish(acquired.lease, staged.terminal.terminalDigest)).rejects.toThrow(
      'lease has expired',
    )
    const beforeRecovery = await store.getAttempt({
      executionId: requested.executionId,
      attempt: requested.attempt,
    })
    expect(beforeRecovery?.staged).toEqual(staged.terminal)
    expect(beforeRecovery?.terminal).toBeUndefined()

    const recovered = await store.recoverExpired(
      { executionId: requested.executionId, attempt: requested.attempt },
      recoveryEvidence(requested),
    )
    expect(recovered).toEqual({ finished: true, terminal: staged.terminal })
  })

  it('recovers zero-call pre-model work only when candidate-may-run was never crossed', async () => {
    let now = 3_000
    const store = new InMemoryAgentCandidateExecutionClaimStore({ now: () => now })
    const requested = retryClaim({ leaseExpiresAtMs: 3_100, cleanup: cleanupHandles(true) })
    await acquire(store, requested)
    now = 3_100

    const recovered = await store.recoverExpired(
      { executionId: requested.executionId, attempt: 1 },
      recoveryEvidence(requested),
    )

    expect(recovered).toMatchObject({
      finished: true,
      terminal: {
        status: 'failed',
        failureClass: 'pre-model-infrastructure',
        usage: { modelCalls: 0 },
      },
    })
    expect((await store.tryClaim(retryClaim({ attempt: 2 }))).acquired).toBe(true)
  })

  it('normalizes recovered pre-model evidence to unknown after candidate-may-run', async () => {
    let now = 3_500
    const store = new InMemoryAgentCandidateExecutionClaimStore({ now: () => now })
    const requested = retryClaim({ leaseExpiresAtMs: 3_600 })
    const acquired = await acquire(store, requested)
    await store.markCandidateMayRun(acquired.lease)
    now = 3_600

    const recovered = await store.recoverExpired(
      { executionId: requested.executionId, attempt: 1 },
      recoveryEvidence(requested),
    )

    expect(recovered).toMatchObject({
      terminal: { failureClass: 'unknown', usage: { modelCalls: 0 } },
    })
    expect(await store.tryClaim(retryClaim({ attempt: 2 }))).toMatchObject({
      acquired: false,
      detail: 'prior-attempt-not-pre-model-infrastructure',
    })
  })

  it('promotes an exact staged terminal after a crash instead of replacing it', async () => {
    let now = 4_000
    const directory = await tempDirectory()
    const requested = claim({ leaseExpiresAtMs: 4_100 })
    const owner = new FileAgentCandidateExecutionClaimStore({ directory, now: () => now })
    const acquired = await acquire(owner, requested)
    await owner.markCandidateMayRun(acquired.lease)
    const staged = await owner.stageTerminal(acquired.lease, succeeded())
    expect(
      (await owner.getAttempt({ executionId: 'execution-1', attempt: 1 }))?.terminal,
    ).toBeUndefined()
    now = 4_100

    const recovery = new FileAgentCandidateExecutionClaimStore({ directory, now: () => now })
    const recovered = await recovery.recoverExpired(
      { executionId: requested.executionId, attempt: 1 },
      recoveryEvidence(requested, {
        failureClass: 'execution',
        usage: staged.terminal.usage,
      }),
    )

    expect(recovered).toEqual({ finished: true, terminal: staged.terminal })
    expect(
      await recovery.recoverExpired(
        { executionId: requested.executionId, attempt: 1 },
        recoveryEvidence(requested, {
          failureClass: 'execution',
          usage: staged.terminal.usage,
        }),
      ),
    ).toMatchObject({ finished: false, exactReplay: true })
  })

  it('refuses recovery whose model evidence differs from the staged outbox', async () => {
    let now = 4_500
    const store = new InMemoryAgentCandidateExecutionClaimStore({ now: () => now })
    const requested = claim({ leaseExpiresAtMs: 4_600 })
    const acquired = await acquire(store, requested)
    await store.stageTerminal(acquired.lease, failed())
    now = 4_600

    await expect(
      store.recoverExpired(
        { executionId: requested.executionId, attempt: 1 },
        recoveryEvidence(requested, { modelSettlement: artifact('8') }),
      ),
    ).rejects.toThrow('does not match staged model evidence')
  })

  it('requires exact process, model, and memory closure before recovery', async () => {
    let now = 5_000
    const store = new InMemoryAgentCandidateExecutionClaimStore({ now: () => now })
    const requested = claim({ leaseExpiresAtMs: 5_100, cleanup: cleanupHandles(true) })
    await acquire(store, requested)
    const evidence = recoveryEvidence(requested)
    await expect(
      store.recoverExpired({ executionId: requested.executionId, attempt: 1 }, evidence),
    ).rejects.toThrow('lease has not expired')
    now = 5_100
    const { memory: _memory, ...withoutMemory } = evidence

    await expect(
      store.recoverExpired(
        { executionId: requested.executionId, attempt: 1 },
        { ...evidence, process: { ...evidence.process, stopped: false as true } },
      ),
    ).rejects.toThrow('does not prove the claimed process stopped')
    await expect(
      store.recoverExpired(
        { executionId: requested.executionId, attempt: 1 },
        { ...evidence, model: { ...evidence.model, grantDigest: sha256('f') } },
      ),
    ).rejects.toThrow('does not prove the claimed model grant closed')
    await expect(
      store.recoverExpired({ executionId: requested.executionId, attempt: 1 }, withoutMemory),
    ).rejects.toThrow('missing memory closure evidence')
  })

  it('unlocks retry only after a zero-call pre-model infrastructure terminal', async () => {
    const store = new InMemoryAgentCandidateExecutionClaimStore()
    const first = await acquire(store, retryClaim())
    expect(await store.tryClaim(retryClaim({ attempt: 2 }))).toMatchObject({
      acquired: false,
      detail: 'prior-attempt-running',
    })
    await complete(store, first.lease, failed())
    expect((await store.tryClaim(retryClaim({ attempt: 2 }))).acquired).toBe(true)
  })

  it.each([
    'execution',
    'post-model-infrastructure',
    'unknown',
  ] as const)('rejects a zero-call %s terminal as non-retryable', async (failureClass) => {
    const store = new InMemoryAgentCandidateExecutionClaimStore()
    const first = await acquire(store, retryClaim())
    if (failureClass !== 'unknown') await store.markCandidateMayRun(first.lease)
    await complete(store, first.lease, failed(0, failureClass))

    expect(await store.tryClaim(retryClaim({ attempt: 2 }))).toMatchObject({
      acquired: false,
      detail: 'prior-attempt-not-pre-model-infrastructure',
    })
  })

  it('rejects a pre-model terminal with paid calls', async () => {
    const store = new InMemoryAgentCandidateExecutionClaimStore()
    const acquired = await acquire(store, retryClaim())

    await expect(store.stageTerminal(acquired.lease, failed(1))).rejects.toThrow(
      'pre-model infrastructure failure cannot contain model calls',
    )
  })

  it('rejects changed retry lineage and a missing prior attempt', async () => {
    const missing = new InMemoryAgentCandidateExecutionClaimStore()
    expect(await missing.tryClaim(retryClaim({ attempt: 2 }))).toMatchObject({
      acquired: false,
      detail: 'prior-attempt-missing',
    })
    const changed = new InMemoryAgentCandidateExecutionClaimStore()
    const first = await acquire(changed, retryClaim())
    await complete(changed, first.lease, failed())

    expect(
      await changed.tryClaim(retryClaim({ attempt: 2, retryLineageDigest: sha256('f') })),
    ).toMatchObject({ acquired: false, detail: 'retry-lineage-mismatch' })
  })

  it('persists claim7, pending1, terminal3, phase, staged, and full usage across stores', async () => {
    const directory = await tempDirectory()
    const store = new FileAgentCandidateExecutionClaimStore({ directory })
    const acquired = await acquire(store, claim())
    await store.markCandidateMayRun(acquired.lease)
    const terminal = await complete(store, acquired.lease, failed(2, 'execution'))
    const reopened = new FileAgentCandidateExecutionClaimStore({ directory })
    const observed = await reopened.getAttempt({ executionId: 'execution-1', attempt: 1 })
    const files = await Promise.all(
      (await readdir(directory)).map(async (name) => ({
        name,
        text: await readFile(resolve(directory, name), 'utf8'),
      })),
    )

    expect(observed).toMatchObject({
      phase: 'candidate-may-run',
      staged: terminal,
      terminal,
    })
    expect(files.find(({ name }) => name.endsWith('.claim.json'))?.text).toContain('"version":7')
    expect(files.find(({ name }) => name.includes('transition-2'))?.text).toContain('"version":1')
    expect(files.find(({ name }) => name.endsWith('.terminal.json'))?.text).toContain('"version":3')
    expect(files.map(({ text }) => text).join('\n')).not.toContain(acquired.lease.token)
  })

  it('finishes a staged file outbox after reopening without recomputing content', async () => {
    const directory = await tempDirectory()
    const owner = new FileAgentCandidateExecutionClaimStore({ directory })
    const acquired = await acquire(owner, claim())
    const staged = await owner.stageTerminal(acquired.lease, failed())
    const reopened = new FileAgentCandidateExecutionClaimStore({ directory })

    const observed = await reopened.getAttempt({ executionId: 'execution-1', attempt: 1 })
    expect(observed).toMatchObject({
      staged: staged.terminal,
    })
    expect(observed?.terminal).toBeUndefined()
    expect(await reopened.finish(acquired.lease, staged.terminal.terminalDigest)).toEqual({
      finished: true,
      terminal: staged.terminal,
    })
  })

  it('lets exactly one independent process acquire the same attempt', async () => {
    const directory = await tempDirectory()
    const results = await Promise.all(
      Array.from({ length: 8 }, () => claimFromChildProcess(directory, claim())),
    )

    expect(results.filter((result) => result === 'acquired')).toHaveLength(1)
    expect(results.filter((result) => result === 'already-claimed')).toHaveLength(7)
  })

  it('linearizes candidate-may-run across independent processes', async () => {
    const directory = await tempDirectory()
    const store = new FileAgentCandidateExecutionClaimStore({ directory })
    const acquired = await acquire(store, claim())
    const results = await Promise.all(
      Array.from({ length: 8 }, () => markFromChildProcess(directory, acquired.lease)),
    )

    expect(results.filter((result) => result === 'marked')).toHaveLength(1)
    expect(results.filter((result) => result === 'already-marked')).toHaveLength(7)
  })

  it('linearizes staging and finishing across independent processes', async () => {
    const directory = await tempDirectory()
    const store = new FileAgentCandidateExecutionClaimStore({ directory })
    const acquired = await acquire(store, retryClaim())
    const stageResults = await Promise.all(
      Array.from({ length: 8 }, () => stageFromChildProcess(directory, acquired.lease, failed())),
    )
    const record = await store.getAttempt({ executionId: 'execution-1', attempt: 1 })
    if (!record?.staged) throw new Error('cross-process stage is missing')
    const finishResults = await Promise.all(
      Array.from({ length: 8 }, () =>
        finishFromChildProcess(
          directory,
          acquired.lease,
          record.staged?.terminalDigest ?? sha256('f'),
        ),
      ),
    )

    expect(stageResults.filter((result) => result === 'staged')).toHaveLength(1)
    expect(stageResults.filter((result) => result === 'already-staged:exact')).toHaveLength(7)
    expect(finishResults.filter((result) => result === 'finished')).toHaveLength(1)
    expect(finishResults.filter((result) => result === 'already-finished:exact')).toHaveLength(7)
  })

  it('linearizes expired recovery across independent processes', async () => {
    const directory = await tempDirectory()
    const requested = retryClaim({ leaseExpiresAtMs: 6_000 })
    const store = new FileAgentCandidateExecutionClaimStore({ directory, now: () => 5_900 })
    await acquire(store, requested)
    const evidence = recoveryEvidence(requested)
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        recoverFromChildProcess(
          directory,
          { executionId: requested.executionId, attempt: 1 },
          evidence,
          6_000,
        ),
      ),
    )

    expect(results.filter((result) => result === 'recovered')).toHaveLength(1)
    expect(results.filter((result) => result === 'already-recovered:exact')).toHaveLength(7)
  })
})

function claim(
  overrides: Partial<AgentCandidateExecutionClaim> = {},
): AgentCandidateExecutionClaim {
  return {
    executionId: 'execution-1',
    attempt: 1,
    maxAttempts: 1,
    retryPolicy: 'none',
    bundleDigest: sha256('a'),
    executionPlanDigest: sha256('b'),
    retryLineageDigest: sha256('c'),
    leaseExpiresAtMs: FUTURE_EXPIRY_MS,
    resultTimeoutMs: 60_000,
    cleanup: cleanupHandles(),
    ...overrides,
  }
}

function retryClaim(
  overrides: Partial<AgentCandidateExecutionClaim> = {},
): AgentCandidateExecutionClaim {
  return claim({ maxAttempts: 3, retryPolicy: 'pre-model-infrastructure-only', ...overrides })
}

function usage(
  modelCalls = 0,
  overrides: Partial<AgentCandidateExecutionUsage> = {},
): AgentCandidateExecutionUsage {
  return {
    costUsdNanos: modelCalls * 123_456,
    inputTokens: modelCalls * 101,
    outputTokens: modelCalls * 29,
    cachedInputTokens: modelCalls * 17,
    reasoningTokens: modelCalls * 11,
    modelCalls,
    ...overrides,
  }
}

function failed(
  modelCalls = 0,
  failureClass: AgentCandidateExecutionFailureClass = 'pre-model-infrastructure',
  overrides: Partial<Extract<AgentCandidateExecutionTerminalResult, { status: 'failed' }>> = {},
): Extract<AgentCandidateExecutionTerminalResult, { status: 'failed' }> {
  return {
    schemaVersion: 1,
    status: 'failed',
    failureClass,
    usage: usage(modelCalls),
    modelSettlement: artifact('1'),
    ...overrides,
  }
}

function succeeded(): Extract<AgentCandidateExecutionTerminalResult, { status: 'succeeded' }> {
  return {
    schemaVersion: 1,
    status: 'succeeded',
    usage: usage(2),
    modelSettlement: artifact('1'),
    taskOutcome: artifact('2'),
    benchmarkResult: artifact('3'),
    runReceipt: artifact('4'),
  }
}

function artifact(character: string): AgentCandidateArtifactRef {
  return {
    locator: { kind: 's3', bucket: 'candidate-evidence', key: `${character}/artifact.json` },
    sha256: sha256(character),
    byteLength: character.charCodeAt(0),
  }
}

function cleanupHandles(memory = false): AgentCandidateExecutionClaim['cleanup'] {
  return {
    preparationId: preparationId('p'),
    modelGrantDigest: sha256('d'),
    resolvedModel: {
      requested: 'provider/model',
      provider: 'provider',
      model: 'model-snapshot',
      snapshot: 'model-snapshot-2026-07-01',
      reasoningEffort: 'high',
    },
    traceRunId: 'execution-1:attempt-1:trace',
    cleanupTimeoutMs: 30_000,
    ...(memory
      ? {
          memory: {
            accessDigest: sha256('e'),
            effectiveNamespace: 'candidate/bundle/execution/task/preparation',
          },
        }
      : {}),
  }
}

function preparationId(character: string): string {
  return `candidate-preparation-v1.${character.repeat(43)}`
}

function recoveryEvidence(
  requested: AgentCandidateExecutionClaim,
  overrides: {
    failureClass?: AgentCandidateExecutionFailureClass
    usage?: AgentCandidateExecutionUsage
    modelSettlement?: AgentCandidateArtifactRef
  } = {},
): AgentCandidateExecutionRecoveryEvidence {
  return {
    failureClass: overrides.failureClass ?? 'pre-model-infrastructure',
    usage: overrides.usage ?? usage(),
    modelSettlement: overrides.modelSettlement ?? artifact('1'),
    process: { stopped: true, executionPlanDigest: requested.executionPlanDigest },
    model: {
      closed: true,
      preparationId: requested.cleanup.preparationId,
      grantDigest: requested.cleanup.modelGrantDigest,
    },
    ...(requested.cleanup.memory
      ? {
          memory: {
            closed: true as const,
            preparationId: requested.cleanup.preparationId,
            accessDigest: requested.cleanup.memory.accessDigest,
            effectiveNamespace: requested.cleanup.memory.effectiveNamespace,
          },
        }
      : {}),
  }
}

function sha256(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`
}

function leaseToken(character: string): string {
  return `candidate-execution-lease-v1.${character.repeat(43)}`
}

async function acquire(
  store: Pick<AgentCandidateExecutionClaimStore, 'tryClaim'>,
  requested: AgentCandidateExecutionClaim,
) {
  const result = await store.tryClaim(requested)
  if (!result.acquired) throw new Error(`test setup failed to acquire: ${result.reason}`)
  return result
}

async function complete(
  store: Pick<AgentCandidateExecutionClaimStore, 'stageTerminal' | 'finish'>,
  lease: AgentCandidateExecutionLease,
  result: AgentCandidateExecutionTerminalResult,
) {
  const staged = await store.stageTerminal(lease, result)
  return (await store.finish(lease, staged.terminal.terminalDigest)).terminal
}

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'candidate-execution-claim-'))
  temporaryDirectories.push(directory)
  return directory
}

async function claimFromChildProcess(
  directory: string,
  requested: AgentCandidateExecutionClaim,
): Promise<string> {
  return runChild([
    storeSource(directory),
    `const result = await store.tryClaim(${JSON.stringify(requested)})`,
    "process.stdout.write(result.acquired ? 'acquired' : result.reason)",
  ])
}

async function markFromChildProcess(
  directory: string,
  lease: AgentCandidateExecutionLease,
): Promise<string> {
  return runChild([
    storeSource(directory),
    `const result = await store.markCandidateMayRun(${JSON.stringify(lease)})`,
    "process.stdout.write(result.marked ? 'marked' : 'already-marked')",
  ])
}

async function stageFromChildProcess(
  directory: string,
  lease: AgentCandidateExecutionLease,
  result: AgentCandidateExecutionTerminalResult,
): Promise<string> {
  return runChild([
    storeSource(directory),
    `const result = await store.stageTerminal(${JSON.stringify(lease)}, ${JSON.stringify(result)})`,
    "process.stdout.write(result.staged ? 'staged' : 'already-staged:' + (result.exactReplay ? 'exact' : 'mismatch'))",
  ])
}

async function finishFromChildProcess(
  directory: string,
  lease: AgentCandidateExecutionLease,
  terminalDigest: string,
): Promise<string> {
  return runChild([
    storeSource(directory),
    `const result = await store.finish(${JSON.stringify(lease)}, ${JSON.stringify(terminalDigest)})`,
    "process.stdout.write(result.finished ? 'finished' : 'already-finished:' + (result.exactReplay ? 'exact' : 'mismatch'))",
  ])
}

async function recoverFromChildProcess(
  directory: string,
  attempt: { executionId: string; attempt: number },
  evidence: AgentCandidateExecutionRecoveryEvidence,
  nowMs: number,
): Promise<string> {
  return runChild([
    storeSource(directory, nowMs),
    `const result = await store.recoverExpired(${JSON.stringify(attempt)}, ${JSON.stringify(evidence)})`,
    "process.stdout.write(result.finished ? 'recovered' : 'already-recovered:' + (result.exactReplay ? 'exact' : 'mismatch'))",
  ])
}

function storeSource(directory: string, nowMs?: number): string {
  return `const store = new FileAgentCandidateExecutionClaimStore({ directory: ${JSON.stringify(directory)}${nowMs === undefined ? '' : `, now: () => ${nowMs}`} })`
}

async function runChild(lines: readonly string[]): Promise<string> {
  const moduleUrl = new URL('../src/candidate-execution/claim-file-store.ts', import.meta.url).href
  const source = [
    `import { FileAgentCandidateExecutionClaimStore } from ${JSON.stringify(moduleUrl)}`,
    ...lines,
  ].join('\n')

  return await new Promise<string>((resolveChild, rejectChild) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '--eval', source],
      { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', rejectChild)
    child.once('close', (code) => {
      if (code !== 0) {
        rejectChild(new Error(`claim child exited ${code}: ${stderr}`))
        return
      }
      resolveChild(stdout)
    })
  })
}
