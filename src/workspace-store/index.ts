/**
 * One versioned workspace store per tenant, shared by every executor: path
 * documents with compare-and-set revisions and erasure tombstones, memory and
 * file tools bound to a trusted turn, a default authority policy, the pinned
 * memory block, and the contract suite every adapter runs. Worker-safe.
 */
export type { ContentCodecOptions, WorkspaceCodecContext, WorkspaceContentCodec } from './codec'
export {
  type MakeWorkspaceStore,
  runWorkspaceStoreContract,
  type WorkspaceStoreContractCase,
  type WorkspaceStoreContractOptions,
  type WorkspaceStoreContractResult,
  workspaceStoreContractCases,
} from './contract'
export type { HarnessIngestResult, HarnessProvenance, MemoryDivergence } from './harness'
export {
  assertWorkspacePath,
  checkWorkspacePut,
  createInMemoryWorkspaceStore,
  type WorkspaceBytesRef,
  WorkspaceConflictError,
  type WorkspaceDeleteInput,
  type WorkspaceEntry,
  type WorkspaceEntryKind,
  type WorkspaceEntryScope,
  type WorkspacePutInput,
  type WorkspaceStore,
  type WorkspaceTombstone,
} from './store'
export {
  createFileTools,
  createMemoryTools,
  defaultMemoryPolicy,
  type MemoryPolicy,
  readTurnMemories,
  renderPinnedMemory,
  type WorkspaceAccess,
  type WorkspacePolicyDecision,
  type WorkspaceRole,
  type WorkspaceToolContext,
  type WorkspaceToolDefinition,
  type WorkspaceTurn,
} from './tools'
