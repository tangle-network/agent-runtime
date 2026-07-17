export type ExperimentArm = 'independent-2' | 'persistent-refine-2'

export interface ExperimentArmPreset {
  arm: ExperimentArm
  k: 1 | 2
  repairs: 0 | 1
  alwaysRunContinuation: boolean
  persistent: boolean
  workerSessions: 2
}

export interface WorkerSessionReceipt {
  calls: number
  completions: number
  attemptError: string | null
}

const PRESETS: Record<ExperimentArm, ExperimentArmPreset> = {
  'independent-2': {
    arm: 'independent-2',
    k: 2,
    repairs: 0,
    alwaysRunContinuation: false,
    persistent: false,
    workerSessions: 2,
  },
  'persistent-refine-2': {
    arm: 'persistent-refine-2',
    k: 1,
    repairs: 1,
    alwaysRunContinuation: true,
    persistent: true,
    workerSessions: 2,
  },
}

export function resolveExperimentArm(value: string): ExperimentArmPreset {
  const preset = PRESETS[value as ExperimentArm]
  if (!preset) {
    throw new Error(
      `EXPERIMENT_ARM must be independent-2|persistent-refine-2, got "${value}"`,
    )
  }
  return preset
}

/** Both arms use one selection rule: lower visible severity wins and a tie prefers session two. */
export function preferLaterCandidate(currentSeverity: number, laterSeverity: number): boolean {
  return laterSeverity <= currentSeverity
}

/** The persistent arm always starts its one continuation, including after a visible pass. */
export function shouldRunContinuation(input: {
  round: number
  preset: ExperimentArmPreset
}): boolean {
  return input.preset.alwaysRunContinuation && input.preset.repairs === 1 && input.round === 1
}

/** A continuation replaces its parent under the same later-on-tie rule as independent selection. */
export function shouldAcceptContinuation(currentSeverity: number, continuationSeverity: number): boolean {
  return preferLaterCandidate(currentSeverity, continuationSeverity)
}

export function continuationDisposition(accepted: boolean, changedFromParent: boolean): {
  finalFrom: 'session:2-refinement' | 'session:2-identical' | 'session:1-visible-better'
  stop: 'continuation-accepted-changed' | 'continuation-accepted-identical' | 'continuation-rejected-visible-regression'
} {
  if (!accepted) {
    return { finalFrom: 'session:1-visible-better', stop: 'continuation-rejected-visible-regression' }
  }
  return changedFromParent
    ? { finalFrom: 'session:2-refinement', stop: 'continuation-accepted-changed' }
    : { finalFrom: 'session:2-identical', stop: 'continuation-accepted-identical' }
}

/** Describe inherited workspace state without echoing model-authored patch bytes back through the
 * outbound prompt. The checkout already contains the parent state; repeating its diff can collide
 * with hidden-patch leak marks when session one independently finds the correct line. */
export function continuationStateNotice(parentDiff: string): string {
  return parentDiff.trim()
    ? '--- PREVIOUS FIX STATE ---\nSession one changes are already applied to this checkout. Inspect the current files directly.\n\n'
    : '--- NO FIX APPLIED YET (session one produced no change) ---\n\n'
}

/** Admit only two genuinely completed model-backed sessions, never two attempted dispatches. */
export function assertExactCompletedWorkerSessions(input: {
  started: number
  completed: number
  sessions: readonly WorkerSessionReceipt[]
  context: string
}): void {
  if (input.started !== 2 || input.completed !== 2 || input.sessions.length !== 2) {
    throw new Error(
      `${input.context}: expected exactly 2 started and completed worker sessions ` +
        `(started=${input.started}, completed=${input.completed}, receipts=${input.sessions.length})`,
    )
  }
  input.sessions.forEach((session, index) => {
    if (
      session.attemptError !== null ||
      !Number.isInteger(session.calls) ||
      session.calls < 1 ||
      !Number.isInteger(session.completions) ||
      session.completions < 1
    ) {
      throw new Error(
        `${input.context}: session ${index + 1} did not complete successfully ` +
          `(error=${session.attemptError ?? 'none'}, calls=${session.calls}, completions=${session.completions})`,
      )
    }
  })
}
