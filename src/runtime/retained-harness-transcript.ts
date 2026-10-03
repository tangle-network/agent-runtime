import { createHash } from 'node:crypto'
import {
  type AgentCandidateArtifactRef,
  type AgentExactRunControlRef,
  AgentExactRunControlRefSchema,
  agentCandidateArtifactRefSchema,
  agentCandidateWorkspaceManifestMaterialSchema,
} from '@tangle-network/agent-interface'
import { z } from 'zod'
import { verifiedArtifactChunks } from '../candidate-execution/artifact-streams'
import { deepFreezeCandidate } from '../candidate-execution/digest'
import type { AgentCandidateArtifactPort } from '../candidate-execution/types'
import type { AgentCandidateWorkspaceArchiveLimits } from '../candidate-execution/workspace-archive'
import { readAgentCandidateWorkspaceArtifactFiles } from '../candidate-execution/workspace-streams'
import { ValidationError } from '../errors'
import type {
  HarnessTranscriptArtifact,
  HarnessTranscriptCapture,
  HarnessTranscriptFile,
  HarnessTranscriptUnavailable,
} from './harness-transcript'
import type { ProviderWorkspaceCaptureReceipt } from './provider-workspace-retention'
import type { ExecutorNodeContext } from './supervise/types'

const digest = z.custom<`sha256:${string}`>(
  (value) => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value),
)
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const text = z.string().min(1)
const node = z.custom<ExecutorNodeContext>((value) => {
  if (value === null || typeof value !== 'object') return false
  return ['rootId', 'parentId', 'nodeId', 'attemptId'].every(
    (key) => typeof Reflect.get(value, key) === 'string',
  )
})
const sourceSchema = z.object({
  executionId: text,
  controlRef: AgentExactRunControlRefSchema.optional(),
  node: node.optional(),
  environmentId: text,
  profileDigest: digest,
  providerSessionId: text.nullable(),
  nativeSessionId: text.nullable(),
  coverageComplete: z.boolean(),
  incompleteReason: z.string().optional(),
})
const attributionSchema = z.object({
  providerSessionId: text,
  sourceId: text.optional(),
  rootScope: z.enum(['session-home', 'workspace-session']),
  nativePath: text,
})
const fileSchema = z.object({
  path: text,
  bytes: count,
  sha256: digest,
  attribution: attributionSchema,
})
const skippedSchema = z.object({ path: text, reason: text })
const retainedSchema = z.object({
  kind: z.literal('retained-harness-transcript'),
  schemaVersion: z.literal(1),
  harness: text,
  source: sourceSchema,
  provider: z.string().optional(),
  capturedAt: z.string().optional(),
  snapshot: z.object({
    kind: z.literal('agent-candidate-workspace-snapshot'),
    digest,
    manifest: agentCandidateArtifactRefSchema,
    archive: agentCandidateArtifactRefSchema,
  }),
  files: z.array(fileSchema),
  skipped: z.array(skippedSchema),
  missing: z.array(z.string()),
})

/** Inventory and source identity only; native bytes remain in the original workspace archive. */
export interface RetainedHarnessTranscriptDescriptor {
  readonly kind: 'retained-harness-transcript'
  readonly schemaVersion: 1
  readonly harness: string
  readonly source: {
    readonly executionId: string
    readonly controlRef?: AgentExactRunControlRef
    readonly node?: ExecutorNodeContext
    readonly environmentId: string
    readonly profileDigest: `sha256:${string}`
    readonly providerSessionId: string | null
    readonly nativeSessionId: string | null
    readonly coverageComplete: boolean
    readonly incompleteReason?: string
  }
  readonly provider?: string
  readonly capturedAt?: string
  readonly snapshot: {
    readonly kind: 'agent-candidate-workspace-snapshot'
    readonly digest: `sha256:${string}`
    readonly manifest: AgentCandidateArtifactRef
    readonly archive: AgentCandidateArtifactRef
  }
  readonly files: readonly {
    readonly path: string
    readonly bytes: number
    readonly sha256: `sha256:${string}`
    readonly attribution: {
      readonly providerSessionId: string
      readonly sourceId?: string
      readonly rootScope: 'session-home' | 'workspace-session'
      readonly nativePath: string
    }
  }[]
  readonly skipped: readonly { readonly path: string; readonly reason: string }[]
  readonly missing: readonly string[]
}
export interface RetainedHarnessTranscriptCapture {
  readonly status: 'retained'
  readonly descriptor: RetainedHarnessTranscriptDescriptor
  readonly fileCount: number
  readonly totalBytes: number
  readonly skippedCount: number
}

export interface HarnessTranscriptMetadata {
  readonly schemaVersion: 1
  readonly harness: string
  readonly files: readonly {
    readonly path: string
    readonly bytes: number
    readonly sha256: string
    readonly attribution?: RetainedHarnessTranscriptDescriptor['files'][number]['attribution']
  }[]
  readonly skipped: readonly { readonly path: string; readonly reason: string }[]
  readonly source?: RetainedHarnessTranscriptDescriptor['source']
  readonly missing?: readonly string[]
  readonly provider?: string
  readonly capturedAt?: string
}

/** Projection limits do not change what the original archive retained. */
export interface HarnessTranscriptReadLimits {
  readonly maxFileBytes: number
  readonly maxTotalBytes: number
  readonly maxFiles: number
  readonly maxManifestBytes: number
}
export interface HarnessTranscriptReadOptions {
  readonly content?: boolean
  readonly artifacts?: AgentCandidateArtifactPort
  readonly limits?: Partial<HarnessTranscriptReadLimits>
  readonly workspaceLimits?: Partial<AgentCandidateWorkspaceArchiveLimits>
  readonly signal?: AbortSignal
}
const defaults: HarnessTranscriptReadLimits = {
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
  maxFiles: 1_000,
  maxManifestBytes: 16 * 1024 * 1024,
}

/** Validate persisted descriptors before trusting their identity, locators, or inventory. */
export function parseRetainedHarnessTranscript(
  value: unknown,
): RetainedHarnessTranscriptDescriptor {
  const parsed = retainedSchema.safeParse(value)
  if (!parsed.success)
    throw new ValidationError(`Invalid retained harness transcript: ${parsed.error.message}`)
  const paths = new Set<string>()
  for (const file of parsed.data.files) {
    if (paths.has(file.path))
      throw new ValidationError(`Retained transcript repeats native identity: ${file.path}`)
    paths.add(file.path)
    if (file.path !== nativeIdentity(file.attribution))
      throw new ValidationError(
        `Retained transcript native identity does not match its attribution: ${file.path}`,
      )
  }
  return deepFreezeCandidate(parsed.data)
}

function nativeIdentity(attribution: z.infer<typeof attributionSchema>): string {
  return (
    [attribution.providerSessionId, attribution.sourceId ?? '', attribution.rootScope]
      .map(encodeURIComponent)
      .join('/') +
    '/' +
    attribution.nativePath
  )
}

/** Describe already-verified retention, without reading the environment or copying archive bytes. */
export function retainHarnessTranscript(
  receipt: ProviderWorkspaceCaptureReceipt,
  harness: string,
): RetainedHarnessTranscriptCapture | HarnessTranscriptUnavailable {
  try {
    return retainedCapture(receipt, harness)
  } catch (error) {
    if (error instanceof ValidationError) throw error
    throw new ValidationError(
      `Invalid retained transcript receipt: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function retainedCapture(
  receipt: ProviderWorkspaceCaptureReceipt,
  harness: string,
): RetainedHarnessTranscriptCapture | HarnessTranscriptUnavailable {
  const { snapshot, provenance, ...source } = receipt
  const files: Array<RetainedHarnessTranscriptDescriptor['files'][number]> = []
  const skipped: Array<RetainedHarnessTranscriptDescriptor['skipped'][number]> = []
  const missing = [...provenance.missing]
  for (const session of provenance.sessions ?? []) {
    if (session.executionId !== receipt.executionId || session.backendType !== harness)
      throw new ValidationError('Retained transcript session has a different execution or harness')
    if (!session.nativeStore) {
      missing.push(`Session ${session.id} native inventory unavailable`)
      continue
    }
    if (!session.nativeStore.complete)
      missing.push(`Session ${session.id} native inventory incomplete`)
    for (const entry of session.nativeStore.entries) {
      if (entry.kind !== 'file') continue
      const attribution = {
        providerSessionId: session.id,
        ...(entry.sourceId === undefined ? {} : { sourceId: entry.sourceId }),
        rootScope: entry.rootScope,
        nativePath: entry.path,
      }
      const parsed = fileSchema.safeParse({
        path: nativeIdentity(attribution),
        bytes: entry.sizeBytes,
        sha256: entry.sha256,
        attribution,
      })
      if (parsed.success) files.push(parsed.data)
      else {
        const reason = `Native inventory cannot identify verified bytes: ${parsed.error.message}`
        skipped.push({ path: nativeIdentity(attribution), reason })
        missing.push(`${nativeIdentity(attribution)}: ${reason}`)
      }
    }
    for (const entry of session.nativeStore.excludedPaths) {
      skipped.push({
        path: nativeIdentity({
          providerSessionId: session.id,
          ...(entry.sourceId === undefined ? {} : { sourceId: entry.sourceId }),
          rootScope: entry.rootScope,
          nativePath: entry.path,
        }),
        reason: entry.reason,
      })
    }
  }
  if (files.length === 0) missing.push('No native files declared by provider capture')
  const descriptor = parseRetainedHarnessTranscript({
    kind: 'retained-harness-transcript',
    schemaVersion: 1,
    harness,
    source,
    ...(provenance.provider === undefined ? {} : { provider: provenance.provider }),
    ...(provenance.capturedAt === undefined ? {} : { capturedAt: provenance.capturedAt }),
    snapshot: {
      kind: snapshot.kind,
      digest: snapshot.digest,
      manifest: snapshot.manifest,
      archive: snapshot.archive,
    },
    files,
    skipped,
    missing,
  })
  if (files.length === 0)
    return deepFreezeCandidate({
      status: 'unavailable' as const,
      reason:
        source.coverageComplete && skipped.length === 0
          ? ('no-transcript' as const)
          : ('nothing-carried' as const),
      skipped: [...skipped, ...missing.map((reason) => ({ path: receipt.executionId, reason }))],
    })
  return deepFreezeCandidate({
    status: 'retained' as const,
    descriptor,
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    skippedCount: skipped.length,
  })
}

/** Read native metadata without archive I/O, or verify retained bytes before projecting bounded text. */
export function resolveHarnessTranscriptCapture(
  capture: HarnessTranscriptCapture,
  options: HarnessTranscriptReadOptions & { content: false },
): Promise<HarnessTranscriptMetadata | undefined>
export function resolveHarnessTranscriptCapture(
  capture: HarnessTranscriptCapture,
  options?: HarnessTranscriptReadOptions & { content?: true },
): Promise<HarnessTranscriptArtifact | undefined>
export async function resolveHarnessTranscriptCapture(
  capture: HarnessTranscriptCapture,
  options: HarnessTranscriptReadOptions = {},
): Promise<HarnessTranscriptArtifact | HarnessTranscriptMetadata | undefined> {
  if (capture.status === 'unavailable') return undefined
  if (capture.status === 'captured') {
    for (const file of capture.artifact.files) {
      if (Buffer.byteLength(file.content, 'utf8') !== file.bytes)
        throw new ValidationError(`Transcript file has an invalid byte count: ${file.path}`)
    }
    if (options.content !== false) return capture.artifact
    return {
      ...capture.artifact,
      files: capture.artifact.files.map(({ path, bytes, content }) => ({
        path,
        bytes,
        sha256: `sha256:${createHash('sha256').update(content).digest('hex')}`,
      })),
    }
  }
  const descriptor = parseRetainedHarnessTranscript(capture.descriptor)
  if (options.content === false) {
    const { snapshot: _snapshot, kind: _kind, ...metadata } = descriptor
    return metadata
  }
  if (!options.artifacts)
    throw new ValidationError('Retained transcript content requires an ArtifactPort')
  const limits = { ...defaults, ...options.limits }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new ValidationError(`Invalid transcript read limit: ${name}`)
  }
  if (descriptor.snapshot.manifest.byteLength > limits.maxManifestBytes)
    throw new ValidationError('Retained transcript manifest exceeds maxManifestBytes')
  const manifestChunks: Uint8Array[] = []
  for await (const chunk of verifiedArtifactChunks(
    descriptor.snapshot.manifest,
    options.artifacts,
    options.signal,
  ))
    manifestChunks.push(Uint8Array.from(chunk))
  const material = agentCandidateWorkspaceManifestMaterialSchema.parse(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(manifestChunks))),
  )
  const snapshot = { ...descriptor.snapshot, material }
  // The inventory supplies attribution. An archive copy only supplies content with that exact digest.
  const byContent = new Map<string, string>()
  for (const file of material.files) byContent.set(`${file.sha256}:${file.byteLength}`, file.path)
  const selected: {
    file: RetainedHarnessTranscriptDescriptor['files'][number]
    archivePath: string
  }[] = []
  const skipped = [...descriptor.skipped]
  let total = 0
  for (const file of descriptor.files) {
    const archivePath = byContent.get(`${file.sha256}:${file.bytes}`)
    if (archivePath === undefined)
      throw new ValidationError(`Retained native file is missing from archive: ${file.path}`)
    const reason =
      file.bytes > limits.maxFileBytes
        ? 'read-limit:maxFileBytes'
        : selected.length >= limits.maxFiles
          ? 'read-limit:maxFiles'
          : total + file.bytes > limits.maxTotalBytes
            ? 'read-limit:maxTotalBytes'
            : undefined
    if (reason) skipped.push({ path: file.path, reason })
    else {
      selected.push({ file, archivePath })
      total += file.bytes
    }
  }
  const contents = await readAgentCandidateWorkspaceArtifactFiles({
    role: 'candidate',
    snapshot,
    artifacts: options.artifacts,
    paths: [...new Set(selected.map(({ archivePath }) => archivePath))],
    maxReadBytes: limits.maxTotalBytes,
    ...(options.workspaceLimits === undefined ? {} : { limits: options.workspaceLimits }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  const files: HarnessTranscriptFile[] = []
  for (const { file, archivePath } of selected) {
    const bytes = contents.get(archivePath)
    if (bytes === undefined)
      throw new ValidationError(`Verified native file was not returned: ${file.path}`)
    try {
      const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
      if (content.includes('\0')) throw new Error('NUL in native file')
      files.push({ path: file.path, bytes: file.bytes, content })
    } catch {
      skipped.push({
        path: file.path,
        reason: 'binary-or-invalid-utf8; bytes remain retained in workspace archive',
      })
    }
  }
  return deepFreezeCandidate({
    schemaVersion: 1 as const,
    harness: descriptor.harness,
    files,
    skipped,
  })
}
