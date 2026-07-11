import { randomUUID } from 'node:crypto'
import { linkSync } from 'node:fs'
import { mkdir, open, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { Sha256Digest } from '@tangle-network/agent-interface'

import {
  type AgentCandidateExecutionAttemptRecord,
  type AgentCandidateExecutionAttemptRef,
  type AgentCandidateExecutionClaim,
  type AgentCandidateExecutionClaimResult,
  type AgentCandidateExecutionClaimStore,
  type AgentCandidateExecutionFinishResult,
  type AgentCandidateExecutionLease,
  type AgentCandidateExecutionPhase,
  type AgentCandidateExecutionPhaseResult,
  type AgentCandidateExecutionRecoveryEvidence,
  type AgentCandidateExecutionStageResult,
  type AgentCandidateExecutionTerminalRecord,
  type AgentCandidateExecutionTerminalResult,
  type AgentCandidateRetryRejection,
  candidateClaimFileInternals,
} from './claim'
import {
  CLAIM_FORMAT_VERSION,
  PENDING_FORMAT_VERSION,
  PHASE_FORMAT_VERSION,
  TERMINAL_FORMAT_VERSION,
} from './claim-file-formats'
import {
  assertRecoveryMatchesStaged,
  assertTerminalAllowedInPhase,
  assertTerminalMatchesClaim,
  assertTerminalMatchesStaged,
  recoveredTerminalRecord,
  rejectedFinish,
  rejectedStage,
  requireStagedTerminal,
  sealTerminalDigest,
  terminalRecord,
} from './claim-terminal'
import { canonicalCandidateBytes } from './digest'

const {
  assertExpiredLease,
  assertLease,
  assertSameSlot,
  assertUnexpiredLease,
  attemptRecord,
  claimSlot,
  leaseDigest,
  newLease,
  readClaim,
  readClaimIfPresent,
  readTerminal,
  readTerminalIfPresent,
  readTransitionIfPresent,
  rejectedExistingClaim,
  rejectedRetry,
  retryRejection,
  sealAttemptRef,
  sealClaim,
  sealLease,
} = candidateClaimFileInternals

export interface FileAgentCandidateExecutionClaimStoreOptions {
  /** Evaluator-owned directory shared by every process allowed to execute candidates. */
  directory: string
  /** Testable evaluator clock; defaults to `Date.now`. */
  now?: () => number
}

/** Cross-process lifecycle implemented as fsynced, create-if-absent records. */
export class FileAgentCandidateExecutionClaimStore implements AgentCandidateExecutionClaimStore {
  private readonly directory: string
  private readonly now: () => number

  constructor(options: FileAgentCandidateExecutionClaimStoreOptions) {
    if (options.directory.length === 0) {
      throw new Error('candidate execution claim directory must not be empty')
    }
    this.directory = options.directory
    this.now = options.now ?? Date.now
  }

  async tryClaim(
    requested: AgentCandidateExecutionClaim,
  ): Promise<AgentCandidateExecutionClaimResult> {
    const claim = sealClaim(requested)
    await mkdir(this.directory, { recursive: true })
    const claimPath = this.claimPath(claim)
    const existing = await readClaimIfPresent(claimPath)
    if (existing) {
      assertSameSlot(existing.claim, claim, claimPath)
      return rejectedExistingClaim(existing.claim, claim)
    }
    assertUnexpiredLease(claim.leaseExpiresAtMs, this.now())
    const retryFailure = await this.retryFailure(claim)
    if (retryFailure) return rejectedRetry(claim, retryFailure)

    const lease = newLease(claim)
    const acquired = await writeRecordIfAbsent(this.directory, claimPath, {
      version: CLAIM_FORMAT_VERSION,
      ...claim,
      phase: 'claimed',
      leaseDigest: leaseDigest(lease),
    })
    if (acquired) return Object.freeze({ acquired: true, claim, lease })

    const winner = await readClaim(claimPath)
    assertSameSlot(winner.claim, claim, claimPath)
    return rejectedExistingClaim(winner.claim, claim)
  }

  async getAttempt(
    requestedAttempt: AgentCandidateExecutionAttemptRef,
  ): Promise<AgentCandidateExecutionAttemptRecord | undefined> {
    return await this.storedAttempt(sealAttemptRef(requestedAttempt))
  }

  async markCandidateMayRun(
    requestedLease: AgentCandidateExecutionLease,
  ): Promise<AgentCandidateExecutionPhaseResult> {
    const lease = sealLease(requestedLease)
    const claimPath = this.claimPath(lease)
    const stored = await readClaim(claimPath)
    assertSameSlot(stored.claim, lease, claimPath)
    assertLease(stored.leaseDigest, stored.claim.leaseExpiresAtMs, lease)
    const state = await this.transitionState(stored.claim)
    if (state.phase === 'candidate-may-run') {
      return Object.freeze({ marked: false, phase: 'candidate-may-run' })
    }
    if (state.staged) {
      throw new Error('candidate execution terminal was staged before candidate-may-run phase')
    }
    assertUnexpiredLease(stored.claim.leaseExpiresAtMs, this.now())
    const marked = await writeRecordIfAbsent(
      this.directory,
      this.transitionPath(stored.claim, 1),
      {
        version: PHASE_FORMAT_VERSION,
        kind: 'candidate-execution-phase',
        executionId: stored.claim.executionId,
        attempt: stored.claim.attempt,
        executionPlanDigest: stored.claim.executionPlanDigest,
        phase: 'candidate-may-run',
      },
      this.ownerPublication(stored.claim),
    )
    if (marked) return Object.freeze({ marked: true, phase: 'candidate-may-run' })
    const winner = await this.transitionState(stored.claim)
    if (winner.phase === 'candidate-may-run') {
      return Object.freeze({ marked: false, phase: 'candidate-may-run' })
    }
    throw new Error('candidate execution terminal was staged before candidate-may-run phase')
  }

  async stageTerminal(
    requestedLease: AgentCandidateExecutionLease,
    result: AgentCandidateExecutionTerminalResult,
  ): Promise<AgentCandidateExecutionStageResult> {
    const lease = sealLease(requestedLease)
    const claimPath = this.claimPath(lease)
    const stored = await readClaim(claimPath)
    assertSameSlot(stored.claim, lease, claimPath)
    assertLease(stored.leaseDigest, stored.claim.leaseExpiresAtMs, lease)
    const terminal = terminalRecord(stored.claim, result)
    const state = await this.transitionState(stored.claim)
    if (state.staged) return rejectedStage(state.staged, terminal)
    assertTerminalAllowedInPhase(state.phase, terminal)
    assertUnexpiredLease(stored.claim.leaseExpiresAtMs, this.now())
    const transition = state.phase === 'claimed' ? 1 : 2
    const staged = await writeRecordIfAbsent(
      this.directory,
      this.transitionPath(stored.claim, transition),
      {
        version: PENDING_FORMAT_VERSION,
        kind: 'candidate-execution-pending-terminal',
        terminal,
      },
      this.ownerPublication(stored.claim),
    )
    if (staged) return Object.freeze({ staged: true, terminal })
    const winner = await this.transitionState(stored.claim)
    if (!winner.staged) {
      throw new Error('candidate execution phase transition won while staging terminal')
    }
    return rejectedStage(winner.staged, terminal)
  }

  async finish(
    requestedLease: AgentCandidateExecutionLease,
    requestedTerminalDigest: Sha256Digest,
  ): Promise<AgentCandidateExecutionFinishResult> {
    const lease = sealLease(requestedLease)
    const terminalDigest = sealTerminalDigest(requestedTerminalDigest)
    const claimPath = this.claimPath(lease)
    const stored = await readClaim(claimPath)
    assertSameSlot(stored.claim, lease, claimPath)
    assertLease(stored.leaseDigest, stored.claim.leaseExpiresAtMs, lease)
    const state = await this.transitionState(stored.claim)
    const staged = requireStagedTerminal(state.staged, terminalDigest)
    const terminalPath = this.terminalPath(lease)
    const existing = await readTerminalIfPresent(terminalPath)
    if (existing) {
      assertTerminalMatchesClaim(existing, stored.claim, terminalPath)
      assertTerminalMatchesStaged(existing, staged, terminalPath)
      return rejectedFinish(existing, terminalDigest)
    }
    assertUnexpiredLease(stored.claim.leaseExpiresAtMs, this.now())
    const finished = await writeRecordIfAbsent(
      this.directory,
      terminalPath,
      {
        version: TERMINAL_FORMAT_VERSION,
        terminal: staged,
      },
      this.ownerPublication(stored.claim),
    )
    if (finished) return Object.freeze({ finished: true, terminal: staged })
    const winner = await readTerminal(terminalPath)
    assertSameSlot(winner, lease, terminalPath)
    assertTerminalMatchesClaim(winner, stored.claim, terminalPath)
    assertTerminalMatchesStaged(winner, staged, terminalPath)
    return rejectedFinish(winner, terminalDigest)
  }

  async recoverExpired(
    requestedAttempt: AgentCandidateExecutionAttemptRef,
    evidence: AgentCandidateExecutionRecoveryEvidence,
  ): Promise<AgentCandidateExecutionFinishResult> {
    const attempt = sealAttemptRef(requestedAttempt)
    const record = await this.storedAttempt(attempt)
    if (!record) throw new Error('candidate execution recovery does not name an acquired attempt')
    const recovered = recoveredTerminalRecord(record.claim, record.phase, evidence)
    if (record.staged) assertRecoveryMatchesStaged(record.staged, recovered)
    const requestedDigest = record.staged?.terminalDigest ?? recovered.terminalDigest
    if (record.terminal) return rejectedFinish(record.terminal, requestedDigest)
    assertExpiredLease(record.claim.leaseExpiresAtMs, this.now())

    let staged = record.staged
    if (!staged) {
      const transition = record.phase === 'claimed' ? 1 : 2
      const didStage = await writeRecordIfAbsent(
        this.directory,
        this.transitionPath(record.claim, transition),
        {
          version: PENDING_FORMAT_VERSION,
          kind: 'candidate-execution-pending-terminal',
          terminal: recovered,
        },
      )
      if (didStage) {
        staged = recovered
      } else {
        const winner = await this.transitionState(record.claim)
        if (!winner.staged) {
          throw new Error(
            'candidate execution recovery lost terminal staging to a phase transition',
          )
        }
        assertRecoveryMatchesStaged(winner.staged, recovered)
        staged = winner.staged
      }
    }

    const terminalPath = this.terminalPath(attempt)
    const didFinish = await writeRecordIfAbsent(this.directory, terminalPath, {
      version: TERMINAL_FORMAT_VERSION,
      terminal: staged,
    })
    if (didFinish) return Object.freeze({ finished: true, terminal: staged })
    const winner = await readTerminal(terminalPath)
    assertSameSlot(winner, attempt, terminalPath)
    assertTerminalMatchesClaim(winner, record.claim, terminalPath)
    assertTerminalMatchesStaged(winner, staged, terminalPath)
    return rejectedFinish(winner, staged.terminalDigest)
  }

  private async storedAttempt(
    claim: Pick<AgentCandidateExecutionClaim, 'executionId' | 'attempt'>,
  ): Promise<AgentCandidateExecutionAttemptRecord | undefined> {
    const claimPath = this.claimPath(claim)
    const stored = await readClaimIfPresent(claimPath)
    if (!stored) return undefined
    assertSameSlot(stored.claim, claim, claimPath)
    const state = await this.transitionState(stored.claim)
    const terminalPath = this.terminalPath(claim)
    const terminal = await readTerminalIfPresent(terminalPath)
    if (terminal) {
      assertTerminalMatchesClaim(terminal, stored.claim, terminalPath)
      if (!state.staged) {
        throw new Error(
          `candidate execution terminal record at ${terminalPath} has no staged outbox`,
        )
      }
      assertTerminalMatchesStaged(terminal, state.staged, terminalPath)
    }
    return attemptRecord(stored.claim, state.phase, state.staged, terminal)
  }

  private async transitionState(claim: AgentCandidateExecutionClaim): Promise<{
    phase: AgentCandidateExecutionPhase
    staged?: AgentCandidateExecutionTerminalRecord
  }> {
    const firstPath = this.transitionPath(claim, 1)
    const first = await readTransitionIfPresent(firstPath, claim)
    if (!first) return { phase: 'claimed' }
    if (first.kind === 'pending') return { phase: 'claimed', staged: first.terminal }
    const secondPath = this.transitionPath(claim, 2)
    const second = await readTransitionIfPresent(secondPath, claim)
    if (!second) return { phase: 'candidate-may-run' }
    if (second.kind !== 'pending') {
      throw new Error(`candidate execution transition at ${secondPath} repeats the phase marker`)
    }
    return { phase: 'candidate-may-run', staged: second.terminal }
  }

  private async retryFailure(
    claim: AgentCandidateExecutionClaim,
  ): Promise<AgentCandidateRetryRejection | undefined> {
    if (claim.attempt === 1) return undefined
    return retryRejection(
      claim,
      await this.storedAttempt({
        executionId: claim.executionId,
        attempt: claim.attempt - 1,
      }),
    )
  }

  private ownerPublication(claim: AgentCandidateExecutionClaim): {
    authorizePublish: () => true
  } {
    return {
      authorizePublish: () => {
        assertUnexpiredLease(claim.leaseExpiresAtMs, this.now())
        return true
      },
    }
  }

  private claimPath(claim: Pick<AgentCandidateExecutionClaim, 'executionId' | 'attempt'>): string {
    return join(this.directory, `${claimSlot(claim)}.claim.json`)
  }

  private terminalPath(
    claim: Pick<AgentCandidateExecutionClaim, 'executionId' | 'attempt'>,
  ): string {
    return join(this.directory, `${claimSlot(claim)}.terminal.json`)
  }

  private transitionPath(
    claim: Pick<AgentCandidateExecutionClaim, 'executionId' | 'attempt'>,
    ordinal: 1 | 2,
  ): string {
    return join(this.directory, `${claimSlot(claim)}.transition-${ordinal}.json`)
  }
}

async function writeRecordIfAbsent(
  directory: string,
  destination: string,
  record: object,
  options: {
    /** Synchronous authorization checked after temp fsync, immediately before atomic publication. */
    authorizePublish?: () => true
  } = {},
): Promise<boolean> {
  const temporaryPath = join(directory, `.candidate-execution-${process.pid}-${randomUUID()}.tmp`)
  const handle = await open(temporaryPath, 'wx', 0o600)
  try {
    await handle.writeFile(
      Buffer.concat([Buffer.from(canonicalCandidateBytes(record)), Buffer.from('\n')]),
    )
    await handle.sync()
  } finally {
    await handle.close()
  }

  let written = false
  try {
    if (options.authorizePublish && options.authorizePublish() !== true) {
      throw new Error('candidate execution record publication was not authorized')
    }
    // Authorization and the atomic filesystem call are one synchronous critical
    // section so the event loop cannot advance an injected lease clock between them.
    linkSync(temporaryPath, destination)
    written = true
    await syncDirectory(directory)
  } catch (error) {
    if (!isNodeError(error, 'EEXIST')) throw error
  } finally {
    await unlink(temporaryPath).catch((error: unknown) => {
      if (!isNodeError(error, 'ENOENT')) throw error
    })
  }
  return written
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  )
}
