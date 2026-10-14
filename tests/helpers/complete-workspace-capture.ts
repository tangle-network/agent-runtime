import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentCandidateOutputArtifactPort } from '../../src/candidate-execution'
import { captureAgentCandidateWorkspaceFiles } from '../../src/candidate-execution'
import { sha256Bytes } from '../../src/candidate-execution/digest'
import type {
  ProviderWorkspaceCaptureResult,
  ProviderWorkspaceRetentionContext,
} from '../../src/runtime/provider-workspace-retention'

/** A capture whose coverage is complete, so a release may destroy the source it came from. */
export async function completeCapture(
  context: ProviderWorkspaceRetentionContext,
  artifacts: AgentCandidateOutputArtifactPort,
): Promise<ProviderWorkspaceCaptureResult> {
  const { snapshot } = await captureAgentCandidateWorkspaceFiles(
    [{ path: 'turn.txt', mode: 0o644, bytes: Uint8Array.from(Buffer.from(context.executionId)) }],
    { artifactPersistence: { executionId: context.executionId, outputArtifacts: artifacts } },
  )
  const controlRef = context.controlRef!
  const nativeId = `native-${controlRef.sessionId}`
  return {
    snapshot,
    provenance: {
      status: 'reported',
      environmentId: context.environment.id,
      executionId: context.executionId,
      controlRef,
      workspace: {
        scannedFiles: 1,
        scannedDirectories: 0,
        reportedFiles: 1,
        reportedDirectories: 0,
        complete: true,
      },
      sessions: [
        {
          id: controlRef.sessionId,
          executionId: context.executionId,
          transportEvents: 'complete',
          eventCount: 1,
          messageCount: 1,
          backendType: context.profile.harness,
          executionIds: [controlRef.executionId],
          eventCountsByExecutionId: { [controlRef.executionId]: 1 },
          nativeSessionId: nativeId,
          sidecarImageDigest: `sha256:${'1'.repeat(64)}`,
          sidecarBundleRevision: '2'.repeat(40),
          nativeStore: {
            scope: 'session',
            roots: [],
            complete: true,
            entries: [],
            excludedPaths: [],
            inventory: {
              scannedFiles: 0,
              reportedFiles: 0,
              scannedDirectories: 0,
              reportedDirectories: 0,
              scannedSymlinks: 0,
              reportedSymlinks: 0,
              skippedEntries: 0,
            },
          },
          processStreams: {
            complete: true,
            streamCount: 0,
            stdinBytes: 0,
            stdoutBytes: 0,
            stderrBytes: 0,
            protocolBytes: 0,
          },
          nativeEvents: { complete: true, count: 1 },
        },
      ],
      attempts: [
        {
          executionId: controlRef.executionId,
          ordinal: 1,
          providerSessionId: controlRef.sessionId,
          nativeSessionIds: [nativeId],
          processIds: [],
          outcome: 'succeeded',
          missingReasons: [],
        },
      ],
      missing: [],
    },
  }
}

/** Artifact bytes persist independently of either coordinator process. */
export function fileWorkspaceArtifacts(directory: string): AgentCandidateOutputArtifactPort {
  mkdirSync(directory, { recursive: true })
  return {
    async put({ bytes }) {
      const digest = sha256Bytes(bytes)
      writeFileSync(join(directory, digest.slice(7)), bytes)
      return {
        locator: { kind: 's3', bucket: 'retained-capture-test', key: digest.slice(7) },
        sha256: digest,
        byteLength: bytes.byteLength,
      }
    },
    async read(reference) {
      return Uint8Array.from(readFileSync(join(directory, reference.sha256.slice(7))))
    },
  }
}
