/**
 * `@tangle-network/agent-bench` — the unified benchmark suite for agent-runtime agents.
 *
 * Any consumer (a product, a supervisor harness, a profile/skill/prompt change) imports the registry
 * and scores its agent's artifact against a real, deterministic judge — without owning the benchmark:
 *
 *   import { resolveAdapter } from '@tangle-network/agent-bench'
 *   const verdict = await resolveAdapter('commit0').judge(task, myAgentsDiff)
 *
 * Each adapter fails loud in `preflight()` when its harness/deps (Docker, a venv, a dataset) are
 * absent, so importing the registry is cheap; running a specific benchmark pulls only its deps.
 */
export { ADAPTERS, resolveAdapter } from './adapters'
export { createCragAdapter } from './benchmarks/crag'
export { createNoMiraclAdapter } from './benchmarks/nomiracl'
export { createOpenRagBenchAdapter } from './benchmarks/open-rag-bench'
export { createRagBenchAdapter } from './benchmarks/ragbench'
export {
  FINAL_ANSWER_SENTINEL,
  answerScoreToBenchScore,
  contextBlock,
  contextsFrom,
  normalizeAnswer,
  parseCitations,
  parseFinalAnswer,
  ragAnswerOutput,
  scoreAnswerArtifact,
  tokenF1,
  type RagAnswerScore,
  type RagContext,
} from './benchmarks/rag-shared'
export { createT2RagBenchAdapter } from './benchmarks/t2-ragbench'
export type {
  BenchmarkAdapter,
  BenchScore,
  BenchTask,
  LoadOptions,
} from './benchmarks/types'

/**
 * The unifier: run a subset of the registry over a matrix of agent cells (harness × model ×
 * persona), each scored by the benchmark's own judge, and rank them.
 *
 *   import { runBenchmarks, printBenchmarksReport } from '@tangle-network/agent-bench'
 */
export {
  runBenchmarks,
  printBenchmarksReport,
  type BenchCell,
  type BenchShot,
  type BenchCellTaskResult,
  type BenchLeaderboardRow,
  type RunBenchmarksOptions,
  type RunBenchmarksReport,
} from './run-benchmarks'
export {
  createPierCandidateRecoveryExecutor,
  executePreparedPierCandidate,
  type ExecutePreparedPierCandidateOptions,
  type PierCandidateGraderPort,
  type PierCandidateOfficialResult,
  type PierCandidateTerminationAcknowledgement,
  type PierCandidateTrialController,
  type PierCandidateTrialHandle,
  type PierCandidateTrialIdentity,
  type PierCandidateTrialResult,
  type StagedPierCandidateExecution,
} from './pier-agent'
export {
  FilePierCandidateTrialController,
  type FilePierCandidateTrialControllerOptions,
  type PierCandidateProcessSpec,
} from './pier-trial-controller'
export { createPierResultGrader } from './pier-result-grader'
export {
  createPierWorkspaceArchive,
  materializePierWorkspaceArchive,
  type PierWorkspaceArchiveFile,
  type PierWorkspaceArchiveV1,
  type PierWorkspaceFile,
} from './pier-workspace-archive'
