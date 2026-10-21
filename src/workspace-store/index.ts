/**
 * One versioned workspace store per tenant, shared by every executor: path
 * documents with compare-and-set revisions and erasure tombstones, memory and
 * file tools bound to a trusted turn, a default authority policy, the pinned
 * memory block, and the contract suite every adapter runs. Worker-safe.
 */
export {
  aesGcmContentCodecFromEnv,
  createAesGcmContentCodec,
  openWorkspaceBytes,
  SEALED_CONTENT_PREFIX,
  sealWorkspaceBytes,
  WorkspaceCodecError,
  withContentCodec,
} from './codec'
export { runWorkspaceStoreContract, workspaceStoreContractCases } from './contract'
export {
  captureHarnessMemory,
  HARNESS_MEMORY_BEGIN,
  type HarnessNativeFiles,
  ingestHarnessMemories,
  memoryDivergence,
  parseHarnessActor,
  projectHarnessMemory,
  renderHarnessMemory,
} from './harness'
export {
  assertWorkspacePath,
  checkWorkspacePut,
  createInMemoryWorkspaceStore,
  type WorkspaceBytesRef,
  WorkspaceConflictError,
  type WorkspaceDeleteInput,
  type WorkspaceEntry,
  type WorkspaceEntryKind,
  type WorkspacePutInput,
  type WorkspaceStore,
  type WorkspaceTombstone,
} from './store'
export {
  createFileTools,
  createMemoryTools,
  defaultMemoryPolicy,
  readTurnMemories,
  renderPinnedMemory,
  type WorkspaceAccess,
  type WorkspaceRole,
} from './tools'
