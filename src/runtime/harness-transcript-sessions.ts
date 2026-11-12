import {
  type AgentExactRunControlRef,
  sameAgentRunControlRef,
} from '@tangle-network/agent-interface'
import { z } from 'zod'
import { recordValue } from '../record-value'
import {
  type BoundHarnessSession,
  type HarnessTranscriptArtifact,
  type HarnessTranscriptMetadata,
  type HarnessTranscriptReadOptions,
  harnessTranscriptArtifact,
} from './harness-transcript'
import type { ExecutorNodeContext, ResultBlobStore } from './supervise/types'

const completeEvidence = z.object({
  status: z.literal('available'),
  transcriptRef: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
  harness: z.string().min(1),
  fileCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  totalBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  skippedCount: z.literal(0),
  coverageComplete: z.literal(true),
  missing: z.array(z.string()).max(0).optional(),
})

/**
 * Verify complete native evidence and its exact execution before ending source custody. Original
 * retained archive bytes are checked even when binary or bounded files have no text projection.
 * Parsed conversation completeness is a separate check owned by `readHarnessTranscriptSessions`.
 */
export async function readVerifiedHarnessTranscript(
  receipt: unknown,
  blobs: Pick<ResultBlobStore, 'get'>,
  options: Omit<HarnessTranscriptReadOptions, 'content'> & {
    readonly node: Pick<ExecutorNodeContext, 'rootId' | 'nodeId' | 'attemptId'>
    readonly controlRef?: AgentExactRunControlRef
    readonly profileDigest?: string
    /** Runtime invocation identity on a retained provider source. */
    readonly executionId?: string
  },
): Promise<
  | {
      readonly succeeded: true
      readonly value: {
        readonly metadata: HarnessTranscriptMetadata
        readonly artifact: HarnessTranscriptArtifact
      }
    }
  | { readonly succeeded: false; readonly error: string }
> {
  try {
    const parsed = completeEvidence.safeParse(receipt)
    if (!parsed.success)
      throw new Error(
        `Native transcript coverage is incomplete: ${recordValue(receipt)?.reason ?? 'complete receipt required'}`,
      )
    const { node, controlRef, profileDigest, executionId, ...readOptions } = options
    const metadata = await harnessTranscriptArtifact(parsed.data, blobs, {
      ...readOptions,
      content: false,
    })
    if (
      !metadata ||
      metadata.harness !== parsed.data.harness ||
      metadata.skipped.length ||
      metadata.missing?.length ||
      (metadata.source && !metadata.source.coverageComplete) ||
      metadata.files.length !== parsed.data.fileCount ||
      metadata.files.reduce((total, file) => total + file.bytes, 0) !== parsed.data.totalBytes
    )
      throw new Error('Native transcript bytes or inventory do not match the complete receipt')
    if (metadata.binding && metadata.source)
      throw new Error('Native transcript has conflicting source bindings')
    const source = metadata.binding ?? metadata.source
    if (!source?.nativeSessionId) throw new Error('Native transcript has no bound native session')
    const ids = source.nativeSessionIds ?? [source.nativeSessionId]
    if (
      !ids.length ||
      ids.length > 1_000 ||
      ids.some((id) => !id) ||
      new Set(ids).size !== ids.length ||
      !ids.includes(source.nativeSessionId)
    )
      throw new Error('Native transcript has ambiguous bound session identities')
    for (const key of ['rootId', 'nodeId', 'attemptId'] as const) {
      if (!node[key] || source.node?.[key] !== node[key])
        throw new Error(`Native transcript ${key} does not match the requested execution`)
    }
    if (
      controlRef &&
      (!source.controlRef || !sameAgentRunControlRef(source.controlRef, controlRef))
    )
      throw new Error('Native transcript control reference does not match the requested execution')
    if (profileDigest !== undefined && source.profileDigest !== profileDigest)
      throw new Error('Native transcript profile does not match the requested execution')
    if (executionId !== undefined && metadata.source?.executionId !== executionId)
      throw new Error('Native transcript invocation does not match the requested execution')
    const artifact = await harnessTranscriptArtifact(parsed.data, blobs, readOptions)
    if (!artifact) throw new Error('Native transcript bytes could not be resolved')
    return { succeeded: true, value: { metadata, artifact } }
  } catch (error) {
    return {
      succeeded: false,
      error: error instanceof Error ? error.message : 'Native transcript could not be verified',
    }
  }
}

/**
 * Resolve complete native sessions for one exact Runtime execution. The existing capture reader
 * verifies retained bytes; the caller supplies its native parser. Missing coverage, a different
 * attempt, and incomplete native families return explicit failures rather than training examples.
 */
export async function readHarnessTranscriptSessions<S extends BoundHarnessSession>(
  receipt: unknown,
  blobs: Pick<ResultBlobStore, 'get'>,
  options: Parameters<typeof readVerifiedHarnessTranscript>[2] & {
    readonly readSessions: (
      artifact: HarnessTranscriptArtifact,
      signal?: AbortSignal,
    ) => Promise<readonly S[]>
  },
): Promise<
  | { readonly succeeded: true; readonly value: { readonly sessions: readonly S[] } }
  | { readonly succeeded: false; readonly error: string }
> {
  const { readSessions, ...readOptions } = options
  const verified = await readVerifiedHarnessTranscript(receipt, blobs, readOptions)
  if (!verified.succeeded) return verified
  try {
    const { artifact, metadata } = verified.value
    const source = (metadata.binding ?? metadata.source)!
    if (!artifact.files.length)
      throw new Error('Native transcript projection has no readable session bytes')
    // Source custody can include non-session binary/config bytes. The native parser must resolve
    // every exact bound family from the available text projection before it qualifies for learning.
    options.signal?.throwIfAborted()
    const sessions = await readSessions(artifact, options.signal)
    const byId = new Map<string, S>()
    for (const session of sessions) {
      if (
        !session.nativeSessionId ||
        byId.has(session.nativeSessionId) ||
        session.integrity.truncated !== false ||
        session.integrity.unparsedRecords !== 0 ||
        session.integrity.gaps.length
      )
        throw new Error('Native session identity or integrity is incomplete')
      byId.set(session.nativeSessionId, session)
    }
    const family: S[] = []
    const roots = source.nativeSessionIds ?? [source.nativeSessionId!]
    if (
      !roots.length ||
      roots.length > 1_000 ||
      roots.some((id) => !id) ||
      new Set(roots).size !== roots.length ||
      !roots.includes(source.nativeSessionId!)
    )
      throw new Error('Native transcript has ambiguous bound session identities')
    const pending = [...roots]
    const visited = new Set<string>()
    const parents = new Map<string, string>()
    while (pending.length) {
      const id = pending.shift()!
      if (visited.has(id)) continue
      visited.add(id)
      const session = byId.get(id)
      if (!session) throw new Error('The exact native session or a recorded child was not retained')
      family.push(session)
      for (const child of session.children) {
        if (parents.has(child.nativeSessionId) && parents.get(child.nativeSessionId) !== id)
          throw new Error('Native child has cyclic or ambiguous recorded parents')
        let ancestor: string | undefined = id
        while (ancestor !== undefined) {
          if (ancestor === child.nativeSessionId)
            throw new Error('Native child has cyclic or ambiguous recorded parents')
          ancestor = parents.get(ancestor)
        }
        const found = byId.get(child.nativeSessionId)
        if (found?.parentNativeSessionId && found.parentNativeSessionId !== id)
          throw new Error('Native child has a different recorded parent')
        parents.set(child.nativeSessionId, id)
        pending.push(child.nativeSessionId)
      }
    }
    if (family.length !== sessions.length)
      throw new Error('Native transcript includes a session outside the bound family')
    return { succeeded: true, value: { sessions: family } }
  } catch (error) {
    return {
      succeeded: false,
      error: error instanceof Error ? error.message : 'Native transcript could not be verified',
    }
  }
}
