import type { SpawnModelSubstitution } from '../../runtime'
/**
 * The substitution and the sentence a manager reads beside it. A manager that reports which model
 * did the work must read `modelSubstitution.ran`, never the model it asked for.
 */
export function modelSubstitutionReport(substitution: SpawnModelSubstitution): {
  readonly modelSubstitution: SpawnModelSubstitution
  readonly modelWarning: string
} {
  return {
    modelSubstitution: substitution,
    modelWarning: `spawn authorization ran this worker on ${substitution.ran}, not the ${substitution.requested} you authored; attribute its work to ${substitution.ran}`,
  }
}
