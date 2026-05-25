/**
 * `@tangle-network/agent-runtime` improvement drivers — implementations of
 * agent-eval's `ImprovementDriver` contract.
 *
 * ONE driver (`improvementDriver`) owns the candidate lifecycle; pluggable
 * `CandidateGenerator`s set the cost/capability dial:
 *   - `reflectiveGenerator` — cheap, no sandbox, applies pre-drafted patches
 *   - `agenticGenerator`     — full sandbox runLoop (forthcoming)
 */

export {
  type CandidateGenerator,
  type ImprovementDriverOptions,
  improvementDriver,
} from './improvement-driver'
export { type ReflectiveGeneratorOptions, reflectiveGenerator } from './reflective-generator'
