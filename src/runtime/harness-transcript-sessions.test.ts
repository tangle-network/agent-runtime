import { describe, expect, it } from 'vitest'
import { contentAddress } from '../durable/content-address'
import { InMemoryResultBlobStore } from '../durable/in-memory-spawn-stores'
import {
  type BoundHarnessSession,
  type HarnessTranscriptArtifact,
  persistHarnessTranscript,
} from './harness-transcript'
import { readHarnessTranscriptSessions } from './harness-transcript-sessions'

const node = { rootId: 'run', parentId: 'run', nodeId: 'worker', depth: 1, attemptId: 'attempt-1' }
const root: BoundHarnessSession = {
  nativeSessionId: 'native-root',
  children: [{ nativeSessionId: 'native-child' }],
  integrity: { truncated: false, unparsedRecords: 0, gaps: [] },
}
const child: BoundHarnessSession = {
  nativeSessionId: 'native-child',
  parentNativeSessionId: 'native-root',
  children: [],
  integrity: { truncated: false, unparsedRecords: 0, gaps: [] },
}

async function fixture(sessions = [root, child], nativeSessionIds?: readonly string[]) {
  const blobs = new InMemoryResultBlobStore()
  const artifact: HarnessTranscriptArtifact = {
    schemaVersion: 1,
    harness: 'codex',
    binding: {
      kind: 'bridge',
      node,
      sessionId: 'bridge-session',
      nativeSessionId: 'native-root',
      ...(nativeSessionIds ? { nativeSessionIds } : {}),
      profileDigest: `sha256:${'a'.repeat(64)}`,
      runs: [{ runId: 'bridge-run', requestDigest: `sha256:${'b'.repeat(64)}` }],
    },
    files: sessions.map((session) => {
      const content = JSON.stringify(session)
      return {
        path: `${session.nativeSessionId}.jsonl`,
        bytes: Buffer.byteLength(content),
        content,
      }
    }),
    skipped: [],
  }
  const receipt = await persistHarnessTranscript(
    {
      status: 'captured',
      artifact,
      fileCount: artifact.files.length,
      totalBytes: artifact.files.reduce((sum, file) => sum + file.bytes, 0),
      skippedCount: 0,
      coverageComplete: true,
      missing: [],
    },
    blobs,
  )
  let parsed = 0
  const readSessions = async (value: HarnessTranscriptArtifact): Promise<BoundHarnessSession[]> => {
    parsed += 1
    return value.files.map((file) => JSON.parse(file.content) as BoundHarnessSession)
  }
  return { blobs, receipt, artifact, readSessions, parsed: () => parsed }
}

describe('readHarnessTranscriptSessions', () => {
  it('keeps every attested native retry family in execution order', async () => {
    const retried: BoundHarnessSession = { ...root, nativeSessionId: 'native-retry', children: [] }
    const f = await fixture([root, child, retried], ['native-root', 'native-retry'])
    expect(
      await readHarnessTranscriptSessions(f.receipt, f.blobs, {
        node,
        readSessions: f.readSessions,
      }),
    ).toEqual({ succeeded: true, value: { sessions: [root, retried, child] } })
    const missing = await fixture([root, child], ['native-root', 'native-retry'])
    expect(
      await readHarnessTranscriptSessions(missing.receipt, missing.blobs, {
        node,
        readSessions: missing.readSessions,
      }),
    ).toMatchObject({ succeeded: false })
  })

  it('joins verified native bytes to the exact manager attempt and its child family', async () => {
    const { blobs, receipt, readSessions } = await fixture()
    expect(await readHarnessTranscriptSessions(receipt, blobs, { node, readSessions })).toEqual({
      succeeded: true,
      value: { sessions: [root, child] },
    })
  })

  it.each(['rootId', 'nodeId', 'attemptId'] as const)(
    'refuses another %s before parsing',
    async (key) => {
      const f = await fixture()
      expect(
        await readHarnessTranscriptSessions(f.receipt, f.blobs, {
          node: { ...node, [key]: 'another' },
          readSessions: f.readSessions,
        }),
      ).toEqual({
        succeeded: false,
        error: `Native transcript ${key} does not match the requested execution`,
      })
      expect(f.parsed()).toBe(0)
    },
  )

  it.each([
    { coverageComplete: false },
    { coverageComplete: undefined },
    { missing: ['lost attempt'] },
    { skippedCount: 1 },
    { status: 'unavailable', reason: 'capture-failed' },
  ])('does not promote an incomplete receipt %j', async (gap) => {
    const f = await fixture()
    expect(
      await readHarnessTranscriptSessions({ ...f.receipt, ...gap }, f.blobs, {
        node,
        readSessions: f.readSessions,
      }),
    ).toMatchObject({ succeeded: false })
    expect(f.parsed()).toBe(0)
  })

  it('refuses changed content and an internally inconsistent byte count', async () => {
    const f = await fixture()
    if (f.receipt.status !== 'available') throw new Error('expected fixture receipt')
    const changed = { ...f.artifact, files: [{ ...f.artifact.files[0]!, bytes: 1 }] }
    expect(
      await readHarnessTranscriptSessions(
        f.receipt,
        { get: async () => changed },
        { node, readSessions: f.readSessions },
      ),
    ).toMatchObject({ succeeded: false })
    const receipt = {
      ...f.receipt,
      transcriptRef: contentAddress(changed),
      fileCount: 1,
      totalBytes: 1,
    }
    expect(
      await readHarnessTranscriptSessions(
        receipt,
        { get: async () => changed },
        { node, readSessions: f.readSessions },
      ),
    ).toMatchObject({ succeeded: false })
    expect(f.parsed()).toBe(0)
  })

  it.each([
    [root],
    [root, { ...child, integrity: { ...child.integrity, gaps: ['missing tool result'] } }],
    [root, { ...child, parentNativeSessionId: 'another-parent' }],
    [root, { ...child, children: [{ nativeSessionId: 'native-root' }] }],
    [root, child, { ...child, nativeSessionId: 'unrelated' }],
  ])('refuses an incomplete or incorrectly attributed native family %#', async (...sessions) => {
    const f = await fixture(sessions)
    expect(
      await readHarnessTranscriptSessions(f.receipt, f.blobs, {
        node,
        readSessions: f.readSessions,
      }),
    ).toMatchObject({ succeeded: false })
  })
})
