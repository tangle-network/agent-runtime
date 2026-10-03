import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { captureAgentCandidateWorkspaceFiles } from '../candidate-execution'
import { sha256Bytes } from '../candidate-execution/digest'
import { InMemoryResultBlobStore } from '../durable/spawn-journal'
import { ValidationError } from '../errors'
import {
  harnessTranscriptArtifact,
  persistHarnessTranscript,
  resolveHarnessTranscriptCapture,
  retainHarnessTranscript,
} from './harness-transcript'
import { createPrivateCasArtifactPort } from './private-cas'
import type { ProviderWorkspaceCaptureReceipt } from './provider-workspace-retention'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})
async function fixture(contents = [Buffer.from('\uFEFF{"role":"assistant","text":"proved"}\n')]) {
  const root = await mkdtemp(join(tmpdir(), 'retained-transcript-'))
  roots.push(root)
  const artifacts = createPrivateCasArtifactPort(join(root, 'cas'), 'research')
  const { snapshot } = await captureAgentCandidateWorkspaceFiles(
    contents.flatMap((bytes, index) => [
      { path: `arbitrary-provider-layout/${index}`, bytes, mode: 0o600 },
      { path: `unrelated-duplicate/${index}`, bytes, mode: 0o600 },
    ]),
    { artifactPersistence: { executionId: 'execution', outputArtifacts: artifacts } },
  )
  const receipt: ProviderWorkspaceCaptureReceipt = {
    executionId: 'execution',
    environmentId: 'environment',
    profileDigest: `sha256:${'1'.repeat(64)}`,
    node: { rootId: 'tree', parentId: 'parent', nodeId: 'worker', attemptId: 'attempt' },
    providerSessionId: 'session',
    nativeSessionId: 'native-session',
    snapshot,
    coverageComplete: true,
    provenance: {
      status: 'reported',
      provider: 'any-provider',
      environmentId: 'environment',
      executionId: 'execution',
      workspace: {
        scannedFiles: contents.length,
        scannedDirectories: 0,
        reportedFiles: contents.length,
        reportedDirectories: 0,
        complete: true,
      },
      missing: [],
      sessions: [
        {
          id: 'session',
          executionId: 'execution',
          backendType: 'future-harness',
          transportEvents: 'complete',
          eventCount: 1,
          messageCount: 1,
          nativeStore: {
            scope: 'session',
            roots: [{ scope: 'session-home', path: '/provider-owned-home' }],
            inventory: {
              scannedFiles: contents.length,
              reportedFiles: contents.length,
              scannedDirectories: 0,
              reportedDirectories: 0,
              scannedSymlinks: 0,
              reportedSymlinks: 0,
              skippedEntries: 0,
            },
            complete: true,
            excludedPaths: [],
            entries: contents.map((bytes, index) => ({
              sourceId: 'native-execution',
              rootScope: 'session-home',
              path: `native/${index}.jsonl`,
              kind: 'file',
              mode: 0o600,
              sizeBytes: bytes.byteLength,
              sha256: sha256Bytes(bytes),
              linkTarget: null,
            })),
          },
        },
      ],
    },
  }
  return { receipt, artifacts, contents }
}

describe('retained native transcript projection', () => {
  it('persists only a descriptor, reads metadata without storage, and preserves native attribution and BOM bytes', async () => {
    const { receipt, artifacts, contents } = await fixture()
    const capture = retainHarnessTranscript(receipt, 'future-harness')
    expect(capture.status).toBe('retained')
    const blobs = new InMemoryResultBlobStore()
    const evidence = await persistHarnessTranscript(capture, blobs)
    expect(evidence).toMatchObject({ status: 'available', coverageComplete: true, missing: [] })
    if (evidence.status !== 'available') throw new Error('expected pointer')
    const stored = await blobs.get(evidence.transcriptRef)
    expect(JSON.stringify(stored)).not.toContain('"material"')
    expect(JSON.stringify(stored)).not.toContain('"content"')
    const metadata = await harnessTranscriptArtifact(evidence, blobs, { content: false })
    expect(metadata).toMatchObject({
      source: { executionId: 'execution', node: receipt.node },
      files: [
        {
          sha256: sha256Bytes(contents[0]!),
          attribution: {
            providerSessionId: 'session',
            sourceId: 'native-execution',
            rootScope: 'session-home',
            nativePath: 'native/0.jsonl',
          },
        },
      ],
    })
    const artifact = await harnessTranscriptArtifact(evidence, blobs, { artifacts })
    expect(artifact?.schemaVersion).toBe(1)
    expect(artifact?.files).toHaveLength(1)
    expect(Buffer.from(artifact!.files[0]!.content)).toEqual(contents[0])
    expect(artifact!.files[0]!.bytes).toBe(contents[0]!.byteLength)
  })

  it('rejects legacy inline metadata with a wrong byte count', async () => {
    const capture = {
      status: 'captured' as const,
      artifact: {
        schemaVersion: 1 as const,
        harness: 'any',
        files: [{ path: 'native.jsonl', bytes: 1, content: 'actual content' }],
        skipped: [],
      },
      fileCount: 1,
      totalBytes: 1,
      skippedCount: 0,
    }
    await expect(resolveHarnessTranscriptCapture(capture, { content: false })).rejects.toThrow(
      ValidationError,
    )
    await expect(resolveHarnessTranscriptCapture(capture)).rejects.toThrow(ValidationError)
  })

  it('reports binary and read limits without claiming native bytes were lost', async () => {
    const { receipt, artifacts } = await fixture([
      Buffer.from([0, 255]),
      Buffer.from('longer text'),
    ])
    const capture = retainHarnessTranscript(receipt, 'future-harness')
    const artifact = await resolveHarnessTranscriptCapture(capture, {
      artifacts,
      limits: { maxFileBytes: 4 },
    })
    expect(artifact?.files).toEqual([])
    expect(artifact?.skipped.map((entry) => entry.reason)).toEqual([
      'read-limit:maxFileBytes',
      'binary-or-invalid-utf8; bytes remain retained in workspace archive',
    ])
    const metadata = await resolveHarnessTranscriptCapture(capture, { content: false })
    expect(metadata?.files).toHaveLength(2)
    await expect(
      resolveHarnessTranscriptCapture(capture, { artifacts, limits: { maxManifestBytes: 1 } }),
    ).rejects.toThrow('maxManifestBytes')
    await expect(
      resolveHarnessTranscriptCapture(capture, { artifacts, limits: { maxTotalBytes: -1 } }),
    ).rejects.toThrow(ValidationError)
  })

  it('keeps valid files and explicitly reports invalid partial native inventory', async () => {
    const { receipt, artifacts } = await fixture([
      Buffer.from('valid'),
      Buffer.from('unidentified'),
    ])
    const source = receipt.provenance.sessions![0]!
    const changed = {
      ...receipt,
      coverageComplete: false,
      provenance: {
        ...receipt.provenance,
        missing: ['attempt incomplete'],
        sessions: [
          {
            ...source,
            nativeStore: {
              ...source.nativeStore!,
              entries: source.nativeStore!.entries.map((entry, index) =>
                index === 0 ? entry : { ...entry, sha256: null },
              ),
            },
          },
        ],
      },
    }
    const capture = retainHarnessTranscript(changed, 'future-harness')
    const metadata = await resolveHarnessTranscriptCapture(capture, { content: false })
    expect(metadata?.files).toHaveLength(1)
    expect(metadata?.missing).toContain('attempt incomplete')
    expect(metadata?.skipped[0]?.reason).toContain('cannot identify verified bytes')
    expect((await resolveHarnessTranscriptCapture(capture, { artifacts }))?.files).toHaveLength(1)
  })

  it('returns an explicit absence when the provider declares no native files', async () => {
    const { receipt } = await fixture()
    const capture = retainHarnessTranscript(
      { ...receipt, provenance: { ...receipt.provenance, sessions: [] } },
      'future-harness',
    )
    expect(capture).toMatchObject({ status: 'unavailable', reason: 'no-transcript' })
  })

  it('rejects duplicate native identity, missing content and mismatched source', async () => {
    const { receipt, artifacts } = await fixture()
    const source = receipt.provenance.sessions![0]!
    expect(() =>
      retainHarnessTranscript(
        {
          ...receipt,
          provenance: {
            ...receipt.provenance,
            sessions: [
              {
                ...source,
                nativeStore: {
                  ...source.nativeStore!,
                  entries: [...source.nativeStore!.entries, ...source.nativeStore!.entries],
                },
              },
            ],
          },
        },
        'future-harness',
      ),
    ).toThrow(ValidationError)
    expect(() => retainHarnessTranscript(receipt, 'another-harness')).toThrow(ValidationError)
    const changed = {
      ...receipt,
      provenance: {
        ...receipt.provenance,
        sessions: [
          {
            ...source,
            nativeStore: {
              ...source.nativeStore!,
              entries: source.nativeStore!.entries.map((entry) => ({
                ...entry,
                sha256: sha256Bytes(Buffer.from('absent')),
              })),
            },
          },
        ],
      },
    }
    await expect(
      resolveHarnessTranscriptCapture(retainHarnessTranscript(changed, 'future-harness'), {
        artifacts,
      }),
    ).rejects.toThrow('missing from archive')
  })

  it('verifies the complete archive before returning selected bytes', async () => {
    const { receipt, artifacts } = await fixture()
    const capture = retainHarnessTranscript(receipt, 'future-harness')
    await expect(
      resolveHarnessTranscriptCapture(capture, {
        artifacts: {
          ...artifacts,
          async *readStream(ref, options) {
            for await (const chunk of artifacts.readStream!(ref, options)) {
              const bytes = Uint8Array.from(chunk)
              if (ref.sha256 === receipt.snapshot.archive.sha256) bytes[0] = bytes[0]! ^ 1
              yield bytes
            }
          },
        },
      }),
    ).rejects.toThrow()
  })
})
