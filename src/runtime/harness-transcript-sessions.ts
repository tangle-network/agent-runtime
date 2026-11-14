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
  readBoundHarnessSessions,
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
    // The shared reader walks the exact bound family; each parsed session stands in for its file.
    const { sessions: family } = await readBoundHarnessSessions({
      nativeSessionId: source.nativeSessionId!,
      ...(source.nativeSessionIds ? { nativeSessionIds: source.nativeSessionIds } : {}),
      files: sessions.map((session, index) => ({
        path: `session-${index}`,
        nativeSessionId: session.nativeSessionId,
      })),
      read: async (file) => new TextEncoder().encode(file.path),
      parse: (_text, file) => sessions[Number(file.path.slice('session-'.length))]!,
      signal: options.signal,
    })
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
