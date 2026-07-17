import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'

import { readMaterializedWorkspaceFiles } from './artifacts'
import type {
  AgentCandidateExecutionPorts,
  PreparedAgentCandidateKnowledge,
  VerifiedAgentCandidate,
} from './types'
import { verifiedArtifactBytes } from './verify'

/** Environment variable containing the materialized candidate knowledge root. */
export const CANDIDATE_KNOWLEDGE_ROOT_ENV = 'TANGLE_CANDIDATE_KNOWLEDGE_ROOT'
/** Environment variable containing the materialized retrieval configuration path. */
export const CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG_ENV =
  'TANGLE_CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG'

/** Deterministic, signed locations used by every candidate executor. */
export function candidateKnowledgeExecutionPaths(
  taskRoot: string,
  hasRetrievalConfig: boolean,
): { root: string; retrievalConfig?: string } {
  if (!posix.isAbsolute(taskRoot) || posix.normalize(taskRoot) !== taskRoot) {
    throw new Error('candidate knowledge requires a normalized absolute task root')
  }
  const parent = posix.join(taskRoot, '.tangle')
  return {
    root: posix.join(parent, 'knowledge'),
    ...(hasRetrievalConfig
      ? { retrievalConfig: posix.join(parent, 'knowledge-retrieval-config.json') }
      : {}),
  }
}

/** Verify and detach the exact file-backed knowledge admitted by the bundle. */
export async function prepareAgentCandidateKnowledge(
  candidate: VerifiedAgentCandidate,
  ports: AgentCandidateExecutionPorts,
): Promise<PreparedAgentCandidateKnowledge | undefined> {
  const knowledge = candidate.bundle.knowledge
  if (!knowledge) return undefined

  const archive = await verifiedArtifactBytes(candidate, knowledge.snapshot.archive)
  const retrievalConfig = knowledge.retrievalConfig
    ? await verifiedArtifactBytes(candidate, knowledge.retrievalConfig)
    : undefined
  const root = await mkdtemp(join(tmpdir(), 'agent-candidate-knowledge-'))
  try {
    await ports.workspaces.materialize({
      role: 'knowledge',
      snapshot: knowledge.snapshot,
      archive,
      destination: root,
    })
    const files = await readMaterializedWorkspaceFiles(root, knowledge.snapshot.material)
    return Object.freeze({
      candidate: knowledge.candidate,
      snapshot: knowledge.snapshot,
      files: Object.freeze(
        files.map((file) =>
          Object.freeze({ path: file.path, mode: file.mode, bytes: Uint8Array.from(file.bytes) }),
        ),
      ),
      ...(retrievalConfig ? { retrievalConfig: Uint8Array.from(retrievalConfig) } : {}),
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
