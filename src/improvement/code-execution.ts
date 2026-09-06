import { realpath } from 'node:fs/promises'
import { resolve as resolvePath } from 'node:path'
import { makeProposalFinding, type ProposalFinding } from '@tangle-network/agent-eval'
import { assertProposalFindings } from '@tangle-network/agent-eval/analyst'
import {
  gitWorktreeAdapter,
  type Worktree,
  type WorktreeAdapter,
} from '@tangle-network/agent-eval/campaign'
import {
  type CodeSurface,
  type MutableSurface,
  type Scenario,
  type SelfImproveBudget,
  type SelfImproveOptions,
  type SelfImproveProposerResult,
  type SurfaceProposer,
  selfImprove,
} from '@tangle-network/agent-eval/contract'
import { agentProfileSchema } from '@tangle-network/agent-interface'
import { immutableCandidateValue } from '../candidate-execution/digest'
import { assertExecutableAgentProfile } from '../runtime/supervise/model-policy'
import { agenticGenerator } from './agentic-generator'
import { rethrowAfterCleanup } from './cleanup'
import { copyImproveCost } from './improve-result'
import type {
  ImproveCodeOptions,
  ImproveCodeResult,
  ImproveCodeRunOptions,
  ImprovementCodeCandidate,
} from './improve-types'
import { improvementDriver, type ManagedImprovementDriver } from './improvement-driver'
import { assertCandidateSurfaceKind, isCodeSurface } from './profile-surface'
import { rawTraceDistiller } from './raw-trace-distiller'

/** Slice bound for distilled judge notes: wide enough that a real traceback or
 * failing assertion survives intact. */
const distilledNotesMaxChars = 1500

/** Slice bound for a cell's error string. Full text remains on the raw cell. */
const distilledErrorMaxChars = 500

/** Distill failing cells into typed findings for the next proposal round. */
function generationFailureDistiller<TScenario extends Scenario, TArtifact>(
  staticFindings: ReadonlyArray<ProposalFinding>,
): NonNullable<SelfImproveOptions<TScenario, TArtifact>['analyzeGeneration']> {
  const CAP = 12
  return async (input) => {
    const failures: Array<{
      scenario: string
      composite: number
      notes: string
      claim?: string
      error?: string
    }> = []
    for (const candidate of input.candidates) {
      for (const rawCell of candidate.campaign.cells) {
        const cell = rawCell as unknown as Record<string, unknown>
        const scenario = String(cell.scenarioId ?? 'unknown')
        const error = typeof cell.error === 'string' ? cell.error : undefined
        const judgeScores =
          cell.judgeScores && typeof cell.judgeScores === 'object'
            ? Object.values(
                cell.judgeScores as Record<string, { composite?: number; notes?: string }>,
              )
            : []
        const composite =
          judgeScores.length === 0
            ? 0
            : judgeScores.reduce((sum, judge) => sum + (judge.composite ?? 0), 0) /
              judgeScores.length
        if (!error && composite >= 0.999) continue
        const notes = judgeScores
          .map((judge) => judge.notes)
          .filter((note): note is string => typeof note === 'string' && note.length > 0)
          .join('; ')
          .slice(0, distilledNotesMaxChars)
        const claim =
          notes ||
          (error ? `Scenario ${scenario} failed: ${error.slice(0, distilledErrorMaxChars)}` : '')
        failures.push({
          scenario,
          composite: Number(composite.toFixed(3)),
          notes,
          ...(claim ? { claim } : {}),
          ...(error ? { error: error.slice(0, distilledErrorMaxChars) } : {}),
        })
      }
    }
    if (failures.length === 0) return staticFindings
    failures.sort((left, right) => left.composite - right.composite)
    return failures.slice(0, CAP).map((failure) =>
      makeProposalFinding({
        analyst_id: 'generation-failure-distiller',
        proposal_origin: 'search',
        severity: failure.error !== undefined || failure.composite < 0.5 ? 'high' : 'medium',
        area: 'generation-failure',
        confidence: 1,
        subject: failure.scenario,
        claim: `Scenario ${failure.scenario} scored composite ${failure.composite}${
          failure.notes ? `: ${failure.notes}` : ''
        }${failure.error ? ` (error: ${failure.error})` : ''}`,
        evidence_refs: [],
        metadata: {
          scenario: failure.scenario,
          composite: failure.composite,
          ...(failure.notes ? { notes: failure.notes } : {}),
          ...(failure.error !== undefined ? { error: failure.error } : {}),
        },
      }),
    )
  }
}

/** Default code-run analysis: raw trace paths for durable runs, otherwise a
 * bounded digest of failed cells. */
function defaultDistillerFor<TScenario extends Scenario, TArtifact>(
  opts: ImproveCodeRunOptions<TScenario, TArtifact>,
  findings: ReadonlyArray<ProposalFinding>,
): NonNullable<SelfImproveOptions<TScenario, TArtifact>['analyzeGeneration']> {
  const durableRun = opts.runDir !== undefined && !opts.runDir.startsWith('mem://')
  const useRawTraces = opts.rawTraceContext ?? durableRun
  if (useRawTraces) return rawTraceDistiller<TScenario, TArtifact>({ fallbackFindings: findings })
  return generationFailureDistiller<TScenario, TArtifact>(findings)
}

interface PreparedCodeRun {
  baseline: CodeSurface
  proposer: SurfaceProposer<ProposalFinding>
  cleanup(retainedWinner?: MutableSurface): Promise<void>
}

async function discardPreparedBaseline(
  worktree: WorktreeAdapter,
  baselineWorktree: Worktree,
  cause: unknown,
): Promise<never> {
  return rethrowAfterCleanup(
    cause,
    () => worktree.discard(baselineWorktree),
    'improve(): code preparation failed',
  )
}

/**
 * The real path of a repository root, for the one comparison that needs it.
 *
 * Git prints a RESOLVED worktree path, and the Eval worktree adapter compares what git
 * printed against the root it was handed. A root whose PREFIX is a symlink therefore never
 * matches: on macOS the OS hands out temp roots under /var, a symlink to /private/var, so the
 * adapter refuses to finalize or discard a worktree it created seconds earlier. Resolve once
 * here, where the caller's root meets git, instead of at every caller.
 *
 * A directory that does not exist yet — `worktreeDir` is created on demand — keeps its
 * lexical form; the adapter creates it under a root that is already resolved.
 */
async function realRoot(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    return resolvePath(path)
  }
}

/** Create a clean incumbent checkout and the candidate producer for a code run. */
async function prepareCodeRun(code: ImproveCodeOptions): Promise<PreparedCodeRun> {
  const authorProfile = agentProfileSchema.parse(code.profile)
  assertExecutableAgentProfile(authorProfile, 'improve(code) author')
  const baseRef = code.baseRef ?? 'main'
  const worktree =
    code.worktree ??
    gitWorktreeAdapter({
      repoRoot: await realRoot(code.repoRoot),
      ...(code.worktreeDir ? { worktreeDir: await realRoot(code.worktreeDir) } : {}),
    })
  const baselineWorktree = await worktree.create({ baseRef, label: 'incumbent-baseline' })
  try {
    const baseline = await worktree.finalize(baselineWorktree, 'Incumbent code checkout')
    let baselineDiscarded = false
    const generator = code.generator
      ? code.generator
      : agenticGenerator({
          profile: authorProfile,
          executorForWorktree: code.executorForWorktree,
          buildPrompt: code.buildPrompt,
          ...(code.verify ? { verify: code.verify } : {}),
          ...(code.timeoutMs !== undefined ? { timeoutMs: code.timeoutMs } : {}),
          ...(code.maximumCharge ? { maximumCharge: code.maximumCharge } : {}),
        })
    const managed: ManagedImprovementDriver = improvementDriver({ worktree, generator, baseRef })

    return {
      baseline,
      proposer: managed,
      async cleanup(retainedWinner) {
        const errors: unknown[] = []
        const retainedWorktreeRef = isCodeSurface(retainedWinner)
          ? retainedWinner.worktreeRef
          : undefined
        try {
          await managed?.cleanup(retainedWorktreeRef ? [retainedWorktreeRef] : [])
        } catch (cause) {
          errors.push(cause)
        }
        if (!baselineDiscarded && retainedWorktreeRef !== baseline.worktreeRef) {
          try {
            await worktree.discard(baselineWorktree)
            baselineDiscarded = true
          } catch (cause) {
            errors.push(cause)
          }
        }
        if (errors.length > 0) {
          throw new AggregateError(errors, 'improve(): failed to clean code improvement worktrees')
        }
      },
    }
  } catch (cause) {
    return discardPreparedBaseline(worktree, baselineWorktree, cause)
  }
}

function idempotentDispose(dispose: () => Promise<void>): () => Promise<void> {
  let disposed = false
  let inFlight: Promise<void> | undefined
  return async () => {
    if (disposed) return
    if (inFlight) return inFlight
    inFlight = (async () => {
      await dispose()
      disposed = true
    })()
    try {
      await inFlight
    } finally {
      inFlight = undefined
    }
  }
}

export async function runCodeImprovement<TScenario extends Scenario, TArtifact>(
  opts: ImproveCodeRunOptions<TScenario, TArtifact>,
): Promise<ImproveCodeResult<TScenario, TArtifact>> {
  const {
    gate = 'holdout',
    findings: inputFindings = [],
    rawTraceContext: _rawTraceContext,
    code,
    promotionGate,
    analyzeGeneration,
    surface: _surface,
    ...sharedOptions
  } = opts
  const findings = immutableCandidateValue([
    ...assertProposalFindings(inputFindings, 'improve() code findings'),
  ])
  const preparedCode = await prepareCodeRun(code)

  const budget: SelfImproveBudget =
    gate === 'none' ? { ...sharedOptions.budget, generations: 0 } : { ...sharedOptions.budget }

  let raw: SelfImproveProposerResult<TScenario, TArtifact>
  try {
    raw = await selfImprove<TScenario, TArtifact>({
      ...sharedOptions,
      baselineSurface: preparedCode.baseline,
      proposer: preparedCode.proposer,
      budget,
      findings,
      ...(promotionGate !== undefined ? { gate: promotionGate } : {}),
      ...(analyzeGeneration === null
        ? {}
        : {
            analyzeGeneration:
              analyzeGeneration ?? defaultDistillerFor<TScenario, TArtifact>(opts, findings),
          }),
    })
  } catch (cause) {
    return rethrowAfterCleanup(
      cause,
      () => preparedCode.cleanup(),
      'improve(): code improvement failed',
    )
  }

  const winnerSurface = raw.winner.surface
  assertCandidateSurfaceKind('code', preparedCode.baseline, winnerSurface)
  try {
    await preparedCode.cleanup(winnerSurface)
  } catch (cleanupCause) {
    try {
      await preparedCode.cleanup()
    } catch (finalCleanupCause) {
      throw new AggregateError(
        [cleanupCause, finalCleanupCause],
        'improve(): code result cleanup failed, including the final all-worktree retry',
      )
    }
    throw new AggregateError(
      [cleanupCause],
      'improve(): code result cleanup failed; the final all-worktree retry succeeded',
    )
  }
  const dispose = idempotentDispose(async () => preparedCode.cleanup())
  const candidate = immutableCandidateValue<ImprovementCodeCandidate>({
    surface: 'code',
    value: winnerSurface,
  })

  return {
    mode: 'code',
    candidate,
    decision: raw.gateDecision,
    ...(raw.lift !== undefined ? { lift: raw.lift } : {}),
    cost: copyImproveCost(raw.cost),
    durationMs: raw.durationMs,
    lineage: Object.freeze({
      invocationId: raw.provenance.runId,
      runId: raw.provenance.runId,
      developmentSplitDigest: raw.provenance.evidence.search.splitDigest,
    }),
    generationsExplored: raw.generationsExplored,
    raw,
    dispose,
  }
}
