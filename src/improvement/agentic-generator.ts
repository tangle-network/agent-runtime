/**
 *
 * `agenticGenerator` — the full-agentic `CandidateGenerator`. It runs a real
 * authored profile inside the candidate worktree the driver already created,
 * letting the agent read the codebase + the research proposal findings and
 * make the change in place. The driver then commits the worktree into a
 * `CodeSurface`.
 *
 * Every paid shot enters Runtime through `createExecutor` + `streamAgentTurn`.
 * The caller supplies the exact `AgentProfile` and a worktree-aware executor
 * placement; Runtime validates and records the profile that actually ran. Two
 * built-in placements edit the supplied worktree itself: `{ backend:'cli-in-place',
 * workspacePath: worktreePath }` runs a local coding CLI (claude-code / codex /
 * opencode / pi) in that directory, and `{ backend:'bridge', cwd: worktreePath }`
 * runs a cli-bridge session there. `cli-worktree` is NOT one of them — it cuts a
 * worktree of its own, so every shot would read as an empty tree.
 *
 * `maxShots` is the DEPTH dial — a multi-shot verify-in-session loop, NOT the
 * kernel `runAgentRounds`. Each shot runs one full harness session in the (persistent)
 * worktree; between shots the loop refines based on what the last shot produced:
 *   - empty tree   → "you changed nothing, make the edits" → retry
 *   - dirty + `verify` fails → feed the verifier's failure into the next shot
 *       (the worktree persists, so the harness RESUMES atop its own failing
 *       edits with the error in hand — no session-specific retry path needed)
 *   - dirty + `verify` ok (or no verifier configured) → return the candidate
 *   - dirty + `verify` ok + `keepGoing` → bank the tree and spend the next shot
 * A candidate that never verifies within `maxShots` is discarded (`applied:
 * false`), never shipped — if you configured a verifier, a non-passing tree is
 * not a candidate. With no verifier, the first dirty shot is the candidate.
 *
 * BEST-OF-N is the `keepGoing` path, and the loop owns it end to end. A
 * verifier that passes a tree and asks for another shot has its tree
 * snapshotted as a Git tree object; when the budget ends, the highest-`score`
 * tree is RESTORED into the worktree and returned as the candidate. So the
 * caller ranks and the loop moves the bytes — a caller never has to write a
 * passing tree back itself. The budget ends on the last shot, or earlier on a
 * `keepGoing`-less pass, and a last shot that broke or reverted the change does
 * not cost the candidate the verified tree an earlier shot produced.
 *
 * @stable
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type {
  CostReceipt,
  CostReceiptInput,
  MaximumCharge,
  ProposalFinding,
} from '@tangle-network/agent-eval'
import {
  type AgentProfile,
  agentProfileSchema,
  canonicalAgentProfileDigest,
  type HarnessType,
  type ReasoningEffort,
} from '@tangle-network/agent-interface'
import { runSettledCommand } from '../mcp/worktree-harness'
import {
  type AgentTurnUsage,
  type CollectedAgentTurn,
  collectAgentTurn,
  streamAgentTurn,
} from '../runtime/stream-agent-turn'
import {
  assertExecutableAgentProfile,
  concreteProfileModel,
} from '../runtime/supervise/model-policy'
import { createExecutor, type ExecutorConfig } from '../runtime/supervise/runtime'
import { detachedSnapshot } from '../runtime/supervise/snapshot'
import type { CandidateGenerator } from './improvement-driver'
import { optimizerMethod } from './optimizer-prompt'
import { restoreWorktreeTree, snapshotWorktreeTree } from './worktree-tree'

const RAW_TRACE_ANALYST_ID = 'raw-trace-distiller'
const RAW_TRACE_AREA = 'raw-trace-context'
const RAW_TRACE_DIAGNOSIS_PATH = '.improve/raw-trace-diagnosis.md'

/**
 * Outcome of verifying a candidate worktree.
 *
 * `ok` answers "is this tree shippable". `keepGoing` answers "should the budget
 * stop here", and `score` ranks this tree against the other trees the same
 * candidate produced — three separate questions, so a verifier can pass a tree
 * and still spend the shots it was given.
 *
 * `feedback` (compiler errors, failing test output, or the reason a passing
 * tree is being sent back) is fed into the next shot.
 */
export interface VerifyResult {
  ok: boolean
  feedback?: string
  /**
   * Spend the remaining shots instead of returning this tree now.
   *
   * Read only when `ok` is true: a failed verification already spends the next
   * shot. Omitted means the first passing tree ends the candidate.
   */
  keepGoing?: boolean
  /**
   * How good this tree is, for ranking it against the other passing trees of
   * this candidate. Higher wins; a tie keeps the LATER tree, which is the one
   * already on disk and the one the author refined last.
   *
   * Only a passing tree is ranked — a tree that failed verification is never a
   * candidate, whatever it scored. Score every passing tree or none of them: a
   * scored tree cannot be ranked against an unscored one, and mixing the two
   * fails the run rather than guessing an order.
   */
  score?: number
}

/** Verifies the edited worktree. Sync or async; throws only on a setup fault
 *  (a candidate that fails verification returns `{ok:false}`, it does not
 *  throw). */
export type Verifier = (
  worktreePath: string,
  signal?: AbortSignal,
) => Promise<VerifyResult> | VerifyResult

export interface AgenticGeneratorShotReceipt {
  readonly generation: number | null
  readonly candidateIndex: number | null
  /** One-based shot number within this candidate. */
  readonly shot: number
  readonly maxShots: number
  /** Exact profile identity admitted before the shot. */
  readonly profileDigest: string
  readonly harness: HarnessType
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: ReasoningEffort | null
  readonly promptSha256: `sha256:${string}`
  readonly startedAt: string
  readonly completedAt: string
  readonly durationMs: number
  readonly status: CollectedAgentTurn['status'] | null
  /** Runtime-normalized usage. Unknown token or dollar totals remain marked unknown. */
  readonly usage: Readonly<AgentTurnUsage> | null
  readonly transportAttempts: number | null
  /** Shared run-ledger call id for this exact shot. */
  readonly costCallId: string | null
  /** Whether dollars came from the provider, the pricing table, or are unknown. */
  readonly costBasis: 'provider-reported' | 'estimated-pricing' | 'unknown'
  readonly costUsd: number | null
  /** True only for a provider-reported amount, never for a pricing estimate. */
  readonly costUsdKnown: boolean
  readonly error: { readonly name: string; readonly message: string } | null
}

/** Runtime's exact terminal turn plus its complete normalized event stream. */
export type AgenticGeneratorShotExecution = Readonly<CollectedAgentTurn>

/** Worktree decision emitted before a completed shot is retried, accepted, or
 *  discarded. The callback runs while `worktreePath` is still available, so
 *  callers can persist the exact diff. */
export type AgenticGeneratorShotDisposition =
  | {
      readonly kind: 'clean'
      readonly worktreePath: string
    }
  | {
      readonly kind: 'rejected'
      readonly worktreePath: string
      readonly stage: 'raw-trace-evidence' | 'verification'
      readonly feedback: string | null
    }
  | {
      /** The tree passed verification and the verifier asked for another shot,
       *  so it was snapshotted and the budget continues. */
      readonly kind: 'kept'
      readonly worktreePath: string
      /** The rank the verifier gave this tree, or null when it scored nothing. */
      readonly score: number | null
      /** Whether this tree is now the best one this candidate has produced. */
      readonly best: boolean
      readonly feedback: string | null
    }
  | {
      readonly kind: 'accepted'
      readonly worktreePath: string
      readonly verified: boolean
      /** One-based shot whose tree was put back into the worktree because it
       *  outranked the tree on disk; null when the tree on disk is the one that
       *  ships. Non-null is the record that best-of-n moved bytes rather than
       *  only ranking them. */
      readonly restoredFromShot: number | null
    }
  | {
      readonly kind: 'setup-error'
      readonly worktreePath: string
      readonly stage: 'worktree-inspection' | 'raw-trace-evidence' | 'verification'
      readonly error: { readonly name: string; readonly message: string }
    }

export type AgenticGeneratorExecutorForWorktree = (worktreePath: string) => ExecutorConfig

export interface AgenticGeneratorOptions {
  /** Complete author identity. Harness, provider, model, prompt, tools, and resources all come from here. */
  profile: AgentProfile
  /** Place the exact profile on compute that can edit this existing worktree.
   * A local coding CLI returns `{ backend:'cli-in-place', workspacePath: worktreePath }`; a Pi
   * author over cli-bridge returns `{ backend:'bridge', cwd: worktreePath, ...transport }`. Both
   * are checked against the supplied path before the first shot spends. */
  executorForWorktree: AgenticGeneratorExecutorForWorktree
  /** Awaited once for every attempted author shot, including execution failures.
   * The second argument is Runtime's exact terminal turn and event stream.
   * Throwing aborts the candidate so evidence persistence fails closed. */
  onShotCompleted?: (
    receipt: AgenticGeneratorShotReceipt,
    execution: AgenticGeneratorShotExecution | null,
  ) => void | Promise<void>
  /** Awaited after worktree inspection and before the shot is accepted,
   *  retried, or discarded. Throwing aborts the candidate. */
  onShotDisposition?: (
    receipt: AgenticGeneratorShotReceipt,
    disposition: AgenticGeneratorShotDisposition,
  ) => void | Promise<void>
  /** Optional hard upper bound passed to the run-wide CostLedger before each author shot. */
  maximumCharge?: MaximumCharge
  /** Per-shot wall-clock timeout. Omit for no Runtime-imposed deadline. */
  timeoutMs?: number
  /** Build the task prompt from proposal findings. Required: Runtime invents no authoring policy. */
  buildPrompt: (args: { findings: ReadonlyArray<ProposalFinding> }) => string
  /** Verify the worktree after each dirtying shot. When set, a candidate that
   *  fails verification is NOT returned — the failure feeds the next shot
   *  (verify-in-session), up to `maxShots`; a candidate that never verifies is
   *  discarded (`applied:false`), never shipped. A verifier that returns
   *  `keepGoing` passes a tree AND spends the remaining shots, and the
   *  best-scoring tree is the one that ships. Omitted means the first dirty
   *  shot is the candidate. See `commandVerifier` and `VerifyResult`. */
  verify?: Verifier
  /** Test seam — inject the worktree-dirty check (defaults to `git status`). */
  isDirty?: (worktreePath: string) => boolean
}

/** Full-agentic `CandidateGenerator`: run an exact profiled author inside the existing candidate worktree. */
export function agenticGenerator(opts: AgenticGeneratorOptions): CandidateGenerator {
  const profile = detachedSnapshot(
    agentProfileSchema.parse(opts.profile) as AgentProfile,
    'agenticGenerator profile',
  )
  assertExecutableAgentProfile(profile, 'agenticGenerator')
  const harness = profile.harness!
  const provider = profile.model!.provider!.trim()
  const model = concreteProfileModel(profile)!
  const profileDigest = canonicalAgentProfileDigest(profile)
  const dirty = opts.isDirty ?? worktreeDirty
  const verify = opts.verify

  return {
    kind: `agentic:${harness}`,
    // The seed repo + (in rawTraceContext mode) the raw-trace filesystem context
    // are the change signal — an agentic coder proposes from them even when the
    // distiller yielded zero findings. Without this, the code candidate driver's
    // empty-findings guard short-circuits and generates ZERO candidates on the
    // first (and, for a single-generation run, only) proposal round.
    proposesWithoutFindings: true,
    async generate({
      worktreePath,
      findings,
      maxShots,
      signal,
      generation,
      candidateIndex,
      costLedger,
      costPhase,
    }) {
      signal.throwIfAborted()
      if (opts.maximumCharge && !costLedger) {
        throw new Error(
          'agenticGenerator: maximumCharge requires the run-wide CostLedger supplied by agent-eval',
        )
      }
      const basePrompt = opts.buildPrompt({ findings })
      if (typeof basePrompt !== 'string' || basePrompt.trim().length === 0) {
        throw new Error('agenticGenerator: buildPrompt must return a non-empty string')
      }
      const executorConfig = opts.executorForWorktree(worktreePath)
      if (executorConfig.backend === 'bridge' && !samePath(executorConfig.cwd, worktreePath)) {
        throw new Error(
          'agenticGenerator: bridge executor cwd must equal the candidate worktree path',
        )
      }
      if (
        executorConfig.backend === 'cli-in-place' &&
        !samePath(executorConfig.workspacePath, worktreePath)
      ) {
        throw new Error(
          'agenticGenerator: cli-in-place executor workspacePath must equal the candidate worktree path',
        )
      }
      const factory = createExecutor(executorConfig)
      const needsRawTraceEvidence = requiresRawTraceEvidence(findings)
      const shots = Math.max(1, maxShots)
      // Feedback appended to the base prompt for the NEXT shot — empty on shot 0.
      let attemptNote = ''
      // The best tree this candidate has produced, and where it lives. Only a
      // verifier that returns `keepGoing` can put more than one tree here: a
      // passing tree that ends the budget is banked and shipped in one step.
      let best: BankedTree | null = null
      // Whether the verifier scores its trees. Set by the first passing tree;
      // a later tree that disagrees cannot be ranked and fails the run.
      let scored: boolean | null = null
      let lastReceipt: AgenticGeneratorShotReceipt | null = null

      /** Ship the best tree this candidate produced, restoring it when a later
       *  shot wrote over it. */
      const shipBankedTree = async (
        receipt: AgenticGeneratorShotReceipt,
        banked: BankedTree,
      ): Promise<ReturnType<typeof acceptedCandidate>> => {
        const restoredFromShot = banked.onDisk ? null : banked.shot
        if (!banked.onDisk) {
          if (banked.tree === null) {
            throw new Error(
              `agenticGenerator: shot ${banked.shot} produced the best tree but it was never snapshotted`,
            )
          }
          restoreWorktreeTree(worktreePath, banked.tree)
          banked.onDisk = true
        }
        signal.throwIfAborted()
        await emitShotDisposition(opts.onShotDisposition, receipt, {
          kind: 'accepted',
          worktreePath,
          verified: true,
          restoredFromShot,
        })
        signal.throwIfAborted()
        return acceptedCandidate(findings)
      }

      for (let shot = 0; shot < shots; shot++) {
        signal.throwIfAborted()
        // This shot may write over whatever the worktree held.
        if (best) best.onDisk = false
        const taskPrompt = attemptNote ? `${basePrompt}\n\n${attemptNote}` : basePrompt
        const startedAt = new Date()
        let turn: CollectedAgentTurn | null = null
        let costReceipt: CostReceipt | null = null
        let costCallId: string | null = null
        let shotError: Error | null = null
        try {
          const execute = async (
            executionSignal: AbortSignal,
            callId?: string,
          ): Promise<CollectedAgentTurn> => {
            turn = await collectAgentTurn(
              streamAgentTurn(
                { kind: 'executor', profile, factory },
                { prompt: taskPrompt },
                {
                  signal: executionSignal,
                  ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
                  ...(callId ? { callId } : {}),
                },
              ),
            )
            const failure = shotFailure(turn)
            if (failure) throw failure
            return turn
          }

          if (costLedger) {
            const paid = await costLedger.runPaidCall({
              channel: 'driver',
              phase: costPhase ?? 'search.proposal',
              actor: `agentic-generator:${harness}`,
              model,
              tags: {
                generation: String(generation ?? -1),
                candidateIndex: String(candidateIndex ?? -1),
                shot: String(shot + 1),
              },
              signal,
              ...(opts.maximumCharge ? { maximumCharge: opts.maximumCharge } : {}),
              execute: (executionSignal, callId) => execute(executionSignal, callId),
              receipt: (result) => costReceiptFromTurn(result, model),
              receiptFromError: () => (turn ? costReceiptFromTurn(turn, model) : undefined),
            })
            costCallId = paid.callId ?? null
            costReceipt = paid.receipt ?? null
            if (!paid.succeeded) throw paid.error
            turn = paid.value
          } else {
            turn = await execute(signal)
          }
        } catch (cause) {
          shotError = cause instanceof Error ? cause : new Error(String(cause))
        }
        const execution = turn ? detachedSnapshot(turn, 'agenticGenerator shot execution') : null
        const receipt = shotReceipt({
          generation,
          candidateIndex,
          shot,
          maxShots: shots,
          harness,
          provider,
          model,
          profile,
          profileDigest,
          prompt: taskPrompt,
          startedAt,
          completedAt: new Date(),
          result: execution,
          costCallId,
          costReceipt,
          error: shotError,
        })
        lastReceipt = receipt
        await emitShotReceipt(opts.onShotCompleted, receipt, execution, shotError)
        signal.throwIfAborted()

        if (!execution) {
          throw new Error('agenticGenerator: author shot completed without a Runtime turn')
        }

        let worktreeChanged: boolean
        try {
          worktreeChanged = dirty(worktreePath)
        } catch (cause) {
          signal.throwIfAborted()
          return rethrowShotSetupError(
            opts.onShotDisposition,
            receipt,
            worktreePath,
            'worktree-inspection',
            cause,
          )
        }

        // The worktree IS the signal: no edits ⇒ tell the next shot to act.
        if (!worktreeChanged) {
          signal.throwIfAborted()
          await emitShotDisposition(opts.onShotDisposition, receipt, {
            kind: 'clean',
            worktreePath,
          })
          signal.throwIfAborted()
          attemptNote = EMPTY_TREE_NOTE
          continue
        }

        if (needsRawTraceEvidence) {
          let problem: string | null
          try {
            problem = rawTraceEvidenceProblem(worktreePath, findings)
          } catch (cause) {
            signal.throwIfAborted()
            return rethrowShotSetupError(
              opts.onShotDisposition,
              receipt,
              worktreePath,
              'raw-trace-evidence',
              cause,
            )
          }
          if (problem) {
            signal.throwIfAborted()
            await emitShotDisposition(opts.onShotDisposition, receipt, {
              kind: 'rejected',
              worktreePath,
              stage: 'raw-trace-evidence',
              feedback: problem,
            })
            signal.throwIfAborted()
            attemptNote = problem
            continue
          }
        }

        // Dirty: with no verifier the diff IS the candidate (we trust the diff,
        // not the model's response text). With a verifier the candidate must pass it.
        if (!verify) {
          signal.throwIfAborted()
          await emitShotDisposition(opts.onShotDisposition, receipt, {
            kind: 'accepted',
            worktreePath,
            verified: false,
            restoredFromShot: null,
          })
          signal.throwIfAborted()
          return acceptedCandidate(findings)
        }
        let result: VerifyResult
        try {
          signal.throwIfAborted()
          result = await verify(worktreePath, signal)
          signal.throwIfAborted()
        } catch (cause) {
          signal.throwIfAborted()
          return rethrowShotSetupError(
            opts.onShotDisposition,
            receipt,
            worktreePath,
            'verification',
            cause,
          )
        }
        if (result.ok) {
          const score = admittedScore(result, scored, shot)
          scored = score !== null
          const previousBest = best
          let banked: BankedTree
          // A tie keeps the LATER tree: it is already on disk, and it is the
          // author's own refinement of the tree it tied with. `admittedScore`
          // refuses a mix of scored and unscored trees, so an unscored set is a
          // flat 0 and this rule reduces to "the later tree wins".
          if (previousBest === null || (score ?? 0) >= (previousBest.score ?? 0)) {
            banked = { shot: shot + 1, score, tree: null, onDisk: true }
          } else {
            banked = previousBest
          }
          const becomesBest = banked !== previousBest
          best = banked
          if (result.keepGoing !== true) {
            signal.throwIfAborted()
            return await shipBankedTree(receipt, banked)
          }
          // Shots remain, so a later one can write over this tree. Bank the
          // bytes now, while they are still on disk.
          if (becomesBest && shot < shots - 1) banked.tree = snapshotWorktreeTree(worktreePath)
          signal.throwIfAborted()
          await emitShotDisposition(opts.onShotDisposition, receipt, {
            kind: 'kept',
            worktreePath,
            score,
            best: becomesBest,
            feedback: result.feedback ?? null,
          })
          signal.throwIfAborted()
          attemptNote = keptNote(result.feedback)
          continue
        }
        signal.throwIfAborted()
        await emitShotDisposition(opts.onShotDisposition, receipt, {
          kind: 'rejected',
          worktreePath,
          stage: 'verification',
          feedback: result.feedback ?? null,
        })
        signal.throwIfAborted()
        // Dirty but failing — resume next shot atop these edits with the error.
        attemptNote = failureNote(result.feedback)
      }

      // Shots exhausted. A banked tree passed verification, so it ships even
      // though the last shot did not end the budget on it — discarding paid,
      // verified work because a later shot broke or reverted it is the loss
      // best-of-n exists to prevent.
      if (best !== null) {
        if (!lastReceipt) {
          throw new Error('agenticGenerator: a tree was banked without a shot receipt')
        }
        return await shipBankedTree(lastReceipt, best)
      }
      // No verified candidate (or, sans verifier, no edits).
      return { applied: false, summary: '' }
    },
  }
}

/** A tree that passed verification, and whether the worktree still holds it. */
interface BankedTree {
  /** One-based shot that produced it. */
  readonly shot: number
  /** Its rank, or null when the verifier scores nothing. */
  readonly score: number | null
  /** Its Git tree id, written only while a later shot can still overwrite it. */
  tree: string | null
  onDisk: boolean
}

/** The rank a passing tree carries, refusing a set of trees that cannot be ordered. */
function admittedScore(result: VerifyResult, scored: boolean | null, shot: number): number | null {
  const has = result.score !== undefined
  if (scored !== null && has !== scored) {
    throw new Error(
      `agenticGenerator: verify ${has ? 'scored' : 'did not score'} the tree from shot ${shot + 1} and ${
        scored ? 'scored' : 'did not score'
      } an earlier passing tree; a scored tree cannot be ranked against an unscored one`,
    )
  }
  if (!has) return null
  if (typeof result.score !== 'number' || !Number.isFinite(result.score)) {
    throw new Error(
      `agenticGenerator: verify returned a non-finite score (${String(result.score)}) for shot ${shot + 1}`,
    )
  }
  return result.score
}

async function emitShotReceipt(
  callback: AgenticGeneratorOptions['onShotCompleted'],
  receipt: AgenticGeneratorShotReceipt,
  execution: AgenticGeneratorShotExecution | null,
  primaryError: Error | null,
): Promise<void> {
  try {
    await callback?.(receipt, execution)
  } catch (callbackError) {
    if (primaryError !== null) {
      throw new AggregateError(
        [primaryError, callbackError],
        'agenticGenerator: author shot failed and its receipt could not be persisted',
      )
    }
    throw callbackError
  }
  if (primaryError !== null) throw primaryError
}

async function emitShotDisposition(
  callback: AgenticGeneratorOptions['onShotDisposition'],
  receipt: AgenticGeneratorShotReceipt,
  disposition: AgenticGeneratorShotDisposition,
): Promise<void> {
  await callback?.(receipt, disposition)
}

async function rethrowShotSetupError(
  callback: AgenticGeneratorOptions['onShotDisposition'],
  receipt: AgenticGeneratorShotReceipt,
  worktreePath: string,
  stage: Extract<AgenticGeneratorShotDisposition, { kind: 'setup-error' }>['stage'],
  cause: unknown,
): Promise<never> {
  const error = cause instanceof Error ? cause : new Error(String(cause))
  try {
    await emitShotDisposition(callback, receipt, {
      kind: 'setup-error',
      worktreePath,
      stage,
      error: { name: error.name, message: error.message },
    })
  } catch (callbackError) {
    throw new AggregateError(
      [cause, callbackError],
      'agenticGenerator: shot processing failed and its worktree disposition could not be persisted',
    )
  }
  throw cause
}

function shotReceipt(input: {
  readonly generation: number | undefined
  readonly candidateIndex: number | undefined
  readonly shot: number
  readonly maxShots: number
  readonly harness: HarnessType
  readonly provider: string
  readonly model: string
  readonly profile: AgentProfile
  readonly profileDigest: string
  readonly prompt: string
  readonly startedAt: Date
  readonly completedAt: Date
  readonly result: AgenticGeneratorShotExecution | null
  readonly costCallId: string | null
  readonly costReceipt: CostReceipt | null
  readonly error: unknown
}): AgenticGeneratorShotReceipt {
  const error = input.error
    ? {
        name: input.error instanceof Error ? input.error.name : 'Error',
        message: input.error instanceof Error ? input.error.message : String(input.error),
      }
    : null
  const result = input.result
  const costBasis = costBasisFor(input.costReceipt, result)
  const costUsd =
    input.costReceipt?.costUsd ?? result?.usage.costUsd ?? result?.usage.estimatedCostUsd ?? null
  return {
    generation: input.generation ?? null,
    candidateIndex: input.candidateIndex ?? null,
    shot: input.shot + 1,
    maxShots: input.maxShots,
    profileDigest: input.profileDigest,
    harness: input.harness,
    provider: input.provider,
    model: input.model,
    reasoningEffort: input.profile.model?.reasoningEffort ?? null,
    promptSha256: sha256(input.prompt),
    startedAt: input.startedAt.toISOString(),
    completedAt: input.completedAt.toISOString(),
    durationMs: input.completedAt.getTime() - input.startedAt.getTime(),
    status: result?.status ?? null,
    usage: result ? { ...result.usage } : null,
    transportAttempts: result?.transportAttempts ?? null,
    costCallId: input.costCallId,
    costBasis,
    costUsd: costBasis === 'unknown' ? null : costUsd,
    costUsdKnown: costBasis === 'provider-reported',
    error,
  }
}

function costBasisFor(
  receipt: CostReceipt | null,
  turn: AgenticGeneratorShotExecution | null,
): AgenticGeneratorShotReceipt['costBasis'] {
  if (receipt) {
    if (receipt.costUnknown) return 'unknown'
    return receipt.actualCostUsd === undefined ? 'estimated-pricing' : 'provider-reported'
  }
  if (turn?.usage.usdKnown !== false && turn?.usage.costUsd !== undefined) {
    return 'provider-reported'
  }
  return turn?.usage.estimatedCostUsd !== undefined ? 'estimated-pricing' : 'unknown'
}

function shotFailure(result: CollectedAgentTurn): Error | null {
  if (result.status === 'completed') return null
  if (result.status === 'aborted') {
    return new Error('agenticGenerator: author shot was cancelled by the caller')
  }
  return new Error(
    `agenticGenerator: author shot failed${result.error?.message ? `: ${result.error.message}` : ''}`,
  )
}

function costReceiptFromTurn(result: CollectedAgentTurn, model: string): CostReceiptInput {
  const tokensKnown = result.usage.tokensKnown !== false
  const actualCostUsd = result.usage.usdKnown === false ? undefined : result.usage.costUsd
  const cachedTokens = promptCacheReadTokens(result.usage)
  return {
    model,
    inputTokens: tokensKnown ? Math.max(0, result.usage.input - (cachedTokens ?? 0)) : 0,
    outputTokens: tokensKnown ? result.usage.output : 0,
    ...(tokensKnown ? {} : { usageUnknown: true }),
    ...(cachedTokens !== undefined ? { cachedTokens } : {}),
    ...(result.usage.reasoningTokens !== undefined
      ? { reasoningTokens: result.usage.reasoningTokens }
      : {}),
    ...(actualCostUsd !== undefined
      ? { actualCostUsd }
      : result.usage.estimatedCostUsd !== undefined
        ? { estimatedCostUsd: result.usage.estimatedCostUsd }
        : { costUnknown: true }),
  }
}

function promptCacheReadTokens(usage: AgentTurnUsage): number | undefined {
  const cache = usage.promptCache
  if (!cache) return undefined
  for (const field of ['readTokens', 'cachedInputTokens', 'cacheReadInputTokens']) {
    const value = cache[field]
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  }
  return undefined
}

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

/** Turn proposal findings into a concrete coder task —
 *  the senior scientific-method framing shared with the tool/MCP build prompts. */
export function defaultBuildPrompt(args: { findings: ReadonlyArray<ProposalFinding> }): string {
  const lines: string[] = [
    'You are improving this codebase based on an evaluation analysis: real runs failed, an',
    'analyst distilled the findings below, and your change will be measured on held-out tasks',
    'against the unchanged baseline — only a real lift promotes it.',
    '',
    optimizerMethod,
    '',
    'THE SURFACE — what a deliverable change looks like here:',
    '- edit this codebase in place: the smallest coherent change set that fully tests your',
    '  hypothesis about the dominant failure mode (see the method above — no unrelated edits,',
    '  they confound the measurement),',
    '- keep the diff reviewable: a reviewer should be able to trace every hunk back to a finding,',
    '- do not commit — leave changes in the working tree.',
    '',
    'FINDINGS — ranked evidence from real failed runs:',
  ]
  for (const f of args.findings) {
    const where = f.subject ? ` [${f.subject}]` : ''
    lines.push(`- (${f.severity})${where} ${f.claim}`)
    if (f.recommended_action) lines.push(`    → ${f.recommended_action}`)
  }
  if (requiresRawTraceEvidence(args.findings)) {
    lines.push(
      '',
      'Raw trace evidence requirement:',
      `- Inspect at least one raw trace path named above before editing.`,
      `- Write ${RAW_TRACE_DIAGNOSIS_PATH} in this worktree.`,
      '- Include the exact trace path(s) inspected, the failure mechanism, and the code change made.',
      '- A candidate without this file, or with only this file changed, is discarded.',
    )
  }
  return lines.join('\n')
}

const EMPTY_TREE_NOTE =
  'NOTE: your previous attempt left the working tree unchanged. Make the concrete file edits now.'

/** Next-shot feedback when the worktree is dirty but failed verification. The
 *  edits persist on disk, so the harness resumes atop them — tell it to fix in
 *  place, not start over. Verifier detail is truncated to keep the prompt bounded. */
function failureNote(feedback?: string): string {
  const detail = feedback?.trim()
  return [
    'NOTE: your edits are in the working tree but verification FAILED.',
    'Fix the problem in place — build on your existing edits, do not revert them.',
    detail ? `Verifier output:\n${truncate(detail, 4000)}` : 'No verifier detail was captured.',
  ].join('\n')
}

/** Next-shot feedback when the worktree PASSED and the verifier asked for
 *  another shot. The passing tree is banked, so the author is told to improve
 *  it rather than protect it — a worse tree cannot cost it the candidate. */
function keptNote(feedback?: string): string {
  const detail = feedback?.trim()
  return [
    'NOTE: your edits are in the working tree and verification PASSED.',
    'Shots remain in this budget — keep improving the change in place, do not revert it.',
    'The best version you produce is the one that ships.',
    detail ? `Verifier output:\n${truncate(detail, 4000)}` : 'No verifier detail was captured.',
  ].join('\n')
}

function rawTraceEvidenceProblem(
  worktreePath: string,
  findings: ReadonlyArray<ProposalFinding>,
): string | null {
  const changedPaths = worktreeChangedPaths(worktreePath)
  const substantive = changedPaths.filter((path) => path !== RAW_TRACE_DIAGNOSIS_PATH)
  if (substantive.length === 0) {
    return [
      `NOTE: raw-trace mode requires a real code/config edit in addition to ${RAW_TRACE_DIAGNOSIS_PATH}.`,
      'Your previous attempt only changed the diagnosis artifact. Inspect the cited traces and make the causal code change.',
    ].join('\n')
  }

  const diagnosisPath = join(worktreePath, RAW_TRACE_DIAGNOSIS_PATH)
  if (!existsSync(diagnosisPath)) {
    return [
      `NOTE: raw-trace mode requires ${RAW_TRACE_DIAGNOSIS_PATH}.`,
      'Before retrying, inspect at least one cited spans.jsonl/cached-result.json/artifact path, then write the diagnosis file with the exact path, failure mechanism, and code change.',
    ].join('\n')
  }

  const body = readFileSync(diagnosisPath, 'utf8')
  const evidencePaths = traceEvidencePaths(findings)
  if (evidencePaths.length > 0 && !evidencePaths.some((path) => body.includes(path))) {
    return [
      `${RAW_TRACE_DIAGNOSIS_PATH} exists, but it does not cite any exact raw trace path from the findings.`,
      `Cite at least one of these inspected paths exactly: ${evidencePaths.slice(0, 5).join(', ')}`,
    ].join('\n')
  }

  return null
}

function requiresRawTraceEvidence(findings: ReadonlyArray<ProposalFinding>): boolean {
  return findings.some((finding) => {
    const f = finding as unknown as Record<string, unknown>
    return f.analyst_id === RAW_TRACE_ANALYST_ID || f.area === RAW_TRACE_AREA
  })
}

function traceEvidencePaths(findings: ReadonlyArray<ProposalFinding>): string[] {
  const out: string[] = []
  for (const finding of findings) {
    const refs = (finding as unknown as { evidence_refs?: unknown }).evidence_refs
    if (!Array.isArray(refs)) continue
    for (const ref of refs) {
      if (!ref || typeof ref !== 'object') continue
      const uri = (ref as { uri?: unknown }).uri
      if (typeof uri === 'string' && uri.length > 0) out.push(uri)
    }
  }
  return [...new Set(out)]
}

/** A `Verifier` that runs a command in the worktree: exit 0 ⇒ ok, any other
 *  exit ⇒ failed with stdout+stderr as feedback. The common case — verify by
 *  `tsc --noEmit`, `pnpm build`, or a test command. A timeout is treated as a
 *  FAILED candidate (a change that hangs the build is a bad change); a missing
 *  binary or spawn fault throws (a setup bug, not a failed candidate — no
 *  silent fallback). */
export function commandVerifier(
  command: string,
  args: string[] = [],
  timeoutMs = 300_000,
): Verifier {
  return async (worktreePath: string, signal?: AbortSignal): Promise<VerifyResult> => {
    let result: Awaited<ReturnType<typeof runSettledCommand>>
    try {
      result = await runSettledCommand({
        command,
        args,
        cwd: worktreePath,
        timeoutMs,
        ...(signal ? { signal } : {}),
      })
    } catch (err) {
      signal?.throwIfAborted()
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        throw new Error(
          `commandVerifier: '${command}' not found in PATH (setup bug, not a failed candidate)`,
        )
      }
      const reason = err instanceof Error ? err.message : String(err)
      throw new Error(`commandVerifier: '${command}' failed to spawn: ${reason}`)
    }
    if (result.timedOut || result.killedBySignal) {
      return {
        ok: false,
        feedback: `verifier '${command}' ${result.killedBySignal ? `killed by ${result.killedBySignal}` : 'timed out'} after ${timeoutMs}ms`,
      }
    }
    if (result.exitCode === 0) return { ok: true }
    const out = `${result.stdout}${result.stderr}`.trim()
    return { ok: false, feedback: out.length > 0 ? out : `exit ${result.exitCode}` }
  }
}

/** A one-line summary for the commit message, derived from the findings. */
function summarizeFindings(findings: ReadonlyArray<ProposalFinding>): string {
  if (findings.length === 0) return 'agentic improvement'
  if (findings.length === 1) return `agentic: ${truncate(findings[0]!.claim, 64)}`
  return `agentic: ${findings.length} findings addressed`
}

/**
 * The accepted-shot result: summary (commit message) + the attribution pair
 * the driver wraps into a `ProposedCandidate`, so the candidate stays
 * attributable through `GenerationRecord` and the emitted provenance instead
 * of landing as an anonymous surface.
 */
function acceptedCandidate(findings: ReadonlyArray<ProposalFinding>): {
  applied: true
  summary: string
  label: string
  rationale: string
} {
  const summary = summarizeFindings(findings)
  return {
    applied: true,
    summary,
    label: slugify(summary.split('\n', 1)[0] ?? summary),
    rationale: boundedRationale(summary, findings),
  }
}

/** Short slug from the summary's first line — the candidate's human label. */
function slugify(line: string): string {
  const slug = line
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return truncate(slug || 'agentic-improvement', 48)
}

/** Bounded "because Z" for the candidate: the findings it addressed, or the
 *  summary itself when the change was proposed from raw repo/trace context. */
function boundedRationale(summary: string, findings: ReadonlyArray<ProposalFinding>): string {
  if (findings.length === 0) return summary
  return truncate(
    findings.map((finding) => `(${finding.severity}) ${finding.claim}`).join('; '),
    400,
  )
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`
}

/** Non-empty `git status --porcelain` ⇒ the harness changed the worktree.
 *  Fails loud: the worktree is a fresh checkout, so a git error here means
 *  something is genuinely broken (git missing, corrupt index, killed mid-run).
 *  Folding that into `false` would silently discard a candidate and mask the
 *  real failure — forbidden by the no-silent-fallbacks doctrine. */
/** Do two names address the same directory? An in-place placement is only in-place if it names the
 *  worktree the driver created, and a byte comparison answers that wrongly on a platform whose
 *  temporary directory is a symlink: macOS reports `/var/folders/...` where the resolved path is
 *  `/private/var/folders/...`, and both are the same directory. */
function samePath(candidate: string | undefined, worktreePath: string): boolean {
  if (typeof candidate !== 'string' || candidate.length === 0) return false
  if (candidate === worktreePath) return true
  return canonicalPath(candidate) === canonicalPath(worktreePath)
}

/** The resolved path, or the lexically absolute one when the name does not exist — a name that
 *  cannot be resolved is a mismatch the caller is told about, not an error to swallow. */
function canonicalPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

function worktreeDirty(worktreePath: string): boolean {
  return worktreeChangedPaths(worktreePath).length > 0
}

function worktreeChangedPaths(worktreePath: string): string[] {
  const result = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    cwd: worktreePath,
    encoding: 'utf-8',
  })
  if (result.error) {
    throw new Error(
      `agenticGenerator: git status failed to spawn in ${worktreePath}: ${result.error.message}`,
    )
  }
  if (result.status !== 0) {
    throw new Error(
      `agenticGenerator: git status exited ${result.status} in ${worktreePath}: ${result.stderr.trim()}`,
    )
  }
  const records = result.stdout.split('\0')
  const paths: string[] = []
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i]
    if (!record) continue
    paths.push(record.slice(3))
    // Rename and copy entries have a second NUL-delimited path without a status prefix.
    if (record[0] === 'R' || record[1] === 'R' || record[0] === 'C' || record[1] === 'C') {
      const source = records[++i]
      if (!source) {
        throw new Error(
          `agenticGenerator: git status omitted a rename/copy path in ${worktreePath}`,
        )
      }
      paths.push(source)
    }
  }
  return paths
}
