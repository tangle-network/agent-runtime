import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  captureBoundHarnessTranscript,
  harnessTranscriptArtifact,
  harnessTranscriptFileBytes,
  InMemoryResultBlobStore,
  persistHarnessTranscript,
  readBoundHarnessSessions,
  readHarnessTranscriptSessions,
} from '@tangle-network/agent-runtime/kernel'
import type { HarnessSession } from '@tangle-network/harness-sessions'
import * as harnessSessions from '@tangle-network/harness-sessions'
import { describe, expect, it } from 'vitest'
import { sha256Bytes } from '../../src/candidate-execution/digest'

const rootId = 'ses_e23464143ffe9edyHNWQGSpDEB'
const childId = 'ses_controlled_capture_child'
const node = { rootId: 'run', parentId: 'run', nodeId: 'worker', depth: 1, attemptId: 'attempt' }
const binding = {
  kind: 'bridge' as const,
  sessionId: 'bridge-session',
  nativeSessionId: rootId,
  node,
  profileDigest: `sha256:${'a'.repeat(64)}`,
  runs: [{ runId: 'bridge-run', requestDigest: `sha256:${'b'.repeat(64)}` }],
}

// Optional owner capabilities keep the current published dependency floor compilable.
const captureSnapshot = Reflect.get(harnessSessions, 'captureOpenCodeSessionStore') as
  | ((
      path: string,
      ids: readonly string[],
    ) => Promise<{ bytes: Uint8Array; nativeSessionIds: string[] }>)
  | undefined
const readSnapshot = Reflect.get(harnessSessions, 'readOpenCodeSessionSnapshot') as
  | ((
      bytes: Uint8Array,
      id: string,
      options?: { label?: string; signal?: AbortSignal },
    ) => Promise<HarnessSession>)
  | undefined

describe('binary native transcript custody', () => {
  it('requires the shared byte reader and round-trips its actual SQLite snapshot through the public capture and replay owners', async () => {
    if (!captureSnapshot || !readSnapshot) {
      let reads = 0
      await expect(
        captureBoundHarnessTranscript({
          harness: 'opencode',
          binding,
          nativeSessionId: rootId,
          files: [{ path: 'native/sessions.db', nativeSessionId: rootId }],
          read: async () => {
            reads++
            return new Uint8Array()
          },
          parseBytes: async () => {
            throw new Error('An unsupported owner must never parse')
          },
        }),
      ).rejects.toThrow('harness-sessions build with readOpenCodeSessionSnapshot')
      expect(reads).toBe(0)
      return
    }
    const dir = await mkdtemp(join(tmpdir(), 'runtime-native-binary-'))
    try {
      const source = join(dir, 'native.db')
      await copyFile(
        join(import.meta.dirname, '../fixtures/harness-transcripts/opencode-2.3-native.db'),
        source,
      )
      const db = new DatabaseSync(source)
      // The parent is an actual CLI2.3 session. This empty child is an explicit family-binding control.
      db.prepare(
        'INSERT INTO session_v2(id,parent_id,directory,time_created,time_updated) SELECT ?,id,directory,time_created,time_updated FROM session_v2 WHERE id=?',
      ).run(childId, rootId)
      db.close()
      const snapshot = await captureSnapshot(source, [rootId])
      expect(snapshot.nativeSessionIds).toEqual([rootId, childId])
      const files = snapshot.nativeSessionIds.map((nativeSessionId) => ({
        path: 'native/sessions.db',
        nativeSessionId,
        sha256: sha256Bytes(snapshot.bytes),
        byteLength: snapshot.bytes.byteLength,
      }))
      let reads = 0
      const input = {
        harness: 'opencode',
        binding,
        nativeSessionId: rootId,
        files,
        read: async () => {
          reads++
          return snapshot.bytes
        },
        parseBytes: (
          bytes: Uint8Array,
          file: { path: string; nativeSessionId: string },
          signal?: AbortSignal,
        ) => readSnapshot(bytes, file.nativeSessionId, { label: file.path, signal }),
      }
      const capture = await captureBoundHarnessTranscript(input)
      expect(reads).toBe(1)
      expect(capture).toMatchObject({
        status: 'captured',
        fileCount: 1,
        totalBytes: snapshot.bytes.byteLength,
        coverageComplete: true,
      })
      if (capture.status !== 'captured') throw new Error('Expected native capture')
      expect(capture.artifact.files[0]).toMatchObject({
        encoding: 'base64',
        nativeSessionIds: [rootId, childId],
      })
      const blobs = new InMemoryResultBlobStore()
      const evidence = await persistHarnessTranscript(capture, blobs)
      const metadata = await harnessTranscriptArtifact(evidence, blobs, { content: false })
      expect(metadata?.files).toEqual([
        {
          path: 'native/sessions.db',
          bytes: snapshot.bytes.byteLength,
          sha256: sha256Bytes(snapshot.bytes),
          encoding: 'base64',
          nativeSessionIds: [rootId, childId],
        },
      ])
      const artifact = await harnessTranscriptArtifact(evidence, blobs)
      expect(harnessTranscriptFileBytes(artifact!.files[0]!)).toEqual(Buffer.from(snapshot.bytes))
      const replay = await readHarnessTranscriptSessions(evidence, blobs, {
        node,
        binary: 'base64',
        readSessions: async (retained) => {
          const result = await readBoundHarnessSessions({
            nativeSessionId: rootId,
            files: retained.files.flatMap((file) =>
              (file.nativeSessionIds ?? []).map((nativeSessionId) => ({
                path: file.path,
                nativeSessionId,
                byteLength: file.bytes,
              })),
            ),
            read: async (file) =>
              harnessTranscriptFileBytes(retained.files.find((entry) => entry.path === file.path)!),
            parseBytes: input.parseBytes,
          })
          return result.sessions
        },
      })
      expect(replay.succeeded).toBe(true)
      if (!replay.succeeded) throw new Error(replay.error)
      expect(replay.value.sessions.map((session) => session.nativeSessionId)).toEqual([
        rootId,
        childId,
      ])
      expect(replay.value.sessions[0]!.modelCalls).toHaveLength(4)
      expect(replay.value.sessions[0]!.toolCalls).toHaveLength(3)
      await expect(
        captureBoundHarnessTranscript({
          ...input,
          files: [files[0]!, { ...files[1]!, sha256: '0'.repeat(64) }],
        }),
      ).rejects.toThrow('bytes changed')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses noncanonical encodings and stale byte counts through the shared decoder', () => {
    const file = {
      path: 'native/session.db',
      encoding: 'base64' as const,
      content: 'YQ==',
      bytes: 1,
    }
    expect(harnessTranscriptFileBytes(file)).toEqual(Buffer.from('a'))
    for (const content of ['YR==', 'YQ', 'YQ==\n', 'YQ__'])
      expect(() => harnessTranscriptFileBytes({ ...file, content })).toThrow()
    expect(() => harnessTranscriptFileBytes({ ...file, bytes: 2 })).toThrow('byte count')
    expect(() => harnessTranscriptFileBytes({ ...file, encoding: 'hex' as 'base64' })).toThrow(
      'unsupported encoding',
    )
    expect(
      harnessTranscriptFileBytes({ path: 'legacy.jsonl', content: '\uFEFFhello', bytes: 8 }),
    ).toEqual(Buffer.from('\uFEFFhello'))
  })
})
