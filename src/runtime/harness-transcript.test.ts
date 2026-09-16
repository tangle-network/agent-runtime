import { describe, expect, it } from 'vitest'

import { InMemoryResultBlobStore } from '../durable/spawn-journal'
import {
  captureHarnessTranscript,
  harnessTranscriptArtifact,
  persistHarnessTranscript,
} from './harness-transcript'

function environment(files: Record<string, string>, opts: { read?: boolean; exec?: boolean } = {}) {
  const listing = Object.keys(files).join('\n')
  return {
    ...(opts.exec === false ? {} : { exec: async () => ({ stdout: listing, exitCode: 0 }) }),
    ...(opts.read === false
      ? {}
      : {
          read: async (path: string) => {
            const content = files[path]
            if (content === undefined) throw new Error(`no such file: ${path}`)
            return content
          },
        }),
  }
}

describe('captureHarnessTranscript', () => {
  it('carries the assistant text the tool-span receipt never had', async () => {
    const evidence = await captureHarnessTranscript(
      environment({
        '/root/.claude/projects/a/session.jsonl': '{"role":"assistant","text":"the answer"}',
        '/root/.claude/history.jsonl': '{"prompt":"the question"}',
      }),
      'claude-code',
    )
    expect(evidence.status).toBe('captured')
    if (evidence.status !== 'captured') return
    expect(evidence.fileCount).toBe(2)
    expect(evidence.skippedCount).toBe(0)
    // Inline in the artifact the executor settles with; supervise blobs it under the outRef.
    expect(evidence.artifact.files.map((f) => f.content).join('')).toMatch(/the answer/u)
  })

  it('never reads a credential that sits inside a session tree', async () => {
    const reads: string[] = []
    const evidence = await captureHarnessTranscript(
      {
        exec: async () => ({
          stdout: ['/root/.codex/sessions/rollout.jsonl', '/root/.codex/sessions/auth.json'].join(
            '\n',
          ),
          exitCode: 0,
        }),
        read: async (path: string) => {
          reads.push(path)
          return '{"ok":true}'
        },
      },
      'codex',
    )
    expect(evidence.status).toBe('captured')
    if (evidence.status !== 'captured') return
    expect(evidence.fileCount).toBe(1)
    expect(evidence.skippedCount).toBe(1)
    // The assertion that matters: the read never happened, not merely that it is absent.
    expect(reads).toEqual(['/root/.codex/sessions/rollout.jsonl'])
  })

  it('reports a missing capability instead of an empty artifact that reads as coverage', async () => {
    // agent-provider-tangle gates read behind capabilities.workspace.read && box.read.
    expect(await captureHarnessTranscript(environment({}, { read: false }), 'codex')).toEqual({
      status: 'unavailable',
      reason: 'unsupported-environment',
    })
    // read takes one path and offers no listing, so enumeration needs exec.
    expect(await captureHarnessTranscript(environment({}, { exec: false }), 'codex')).toEqual({
      status: 'unavailable',
      reason: 'enumeration-failed',
    })
    expect(await captureHarnessTranscript(environment({}), 'no-such-harness')).toEqual({
      status: 'unavailable',
      reason: 'unknown-harness',
    })
    expect(await captureHarnessTranscript(environment({}), 'codex')).toEqual({
      status: 'unavailable',
      reason: 'no-transcript',
    })
  })

  it('produces an identical artifact for an identical transcript', async () => {
    const files = { '/root/.codex/sessions/r.jsonl': '{"a":1}' }
    const first = await captureHarnessTranscript(environment(files), 'codex')
    const second = await captureHarnessTranscript(environment(files), 'codex')
    expect(first.status).toBe('captured')
    expect(second.status).toBe('captured')
    if (first.status !== 'captured' || second.status !== 'captured') return
    // Keeps supervise's contentRef over the settled result stable across a re-capture.
    expect(first.artifact).toEqual(second.artifact)
  })

  it('stops reading when the run is aborted rather than draining a dying environment', async () => {
    // Without the run's linked signal a cancelled run still enumerated and read up to
    // MAX_FILES out of an environment the `finally` was already tearing down.
    const controller = new AbortController()
    const reads: string[] = []
    const evidence = await captureHarnessTranscript(
      {
        exec: async () => ({
          stdout: Array.from({ length: 50 }, (_, i) => `/root/.codex/sessions/r${i}.jsonl`).join(
            '\n',
          ),
          exitCode: 0,
        }),
        read: async (path: string, options?: { signal?: AbortSignal }) => {
          options?.signal?.throwIfAborted()
          reads.push(path)
          if (reads.length === 3) controller.abort()
          return '{}'
        },
      },
      'codex',
      controller.signal,
    )
    expect(reads.length).toBe(3)
    expect(evidence.status).toBe('captured')
    if (evidence.status !== 'captured') return
    // The reads that never happened are named, not silently missing.
    expect(evidence.skippedCount).toBe(47)
  })

  it('refuses every credential shape, not just the lowercase ones', async () => {
    const reads: string[] = []
    const denied = [
      '/root/.codex/sessions/.netrc',
      '/root/.codex/sessions/ID_RSA',
      '/root/.codex/sessions/server.key',
      '/root/.codex/sessions/bundle.p12',
      '/root/.codex/sessions/AUTH.JSON',
    ]
    await captureHarnessTranscript(
      {
        exec: async () => ({
          stdout: ['/root/.codex/sessions/r.jsonl', ...denied].join('\n'),
          exitCode: 0,
        }),
        read: async (path: string) => {
          reads.push(path)
          return '{}'
        },
      },
      'codex',
    )
    expect(reads).toEqual(['/root/.codex/sessions/r.jsonl'])
  })
})

describe('persistHarnessTranscript', () => {
  it('settles a pointer and the files come back only when someone opens them', async () => {
    const blobs = new InMemoryResultBlobStore()
    const capture = await captureHarnessTranscript(
      environment({ '/root/.codex/sessions/s.jsonl': '{"text":"the reasoning"}' }),
      'codex',
    )
    const evidence = await persistHarnessTranscript(capture, blobs)
    expect(evidence.status).toBe('available')
    if (evidence.status !== 'available') return
    // The receipt is small and names what it points at; the bytes are not on it (#1248).
    expect(evidence).toMatchObject({ harness: 'codex', fileCount: 1, skippedCount: 0 })
    expect(JSON.stringify(evidence)).not.toContain('the reasoning')
    const artifact = await harnessTranscriptArtifact(evidence, blobs)
    expect(artifact?.files.map((file) => file.content).join('')).toContain('the reasoning')
  })

  it('names a capture that never reached disk instead of settling a dangling pointer', async () => {
    const capture = await captureHarnessTranscript(
      environment({ '/root/.codex/sessions/s.jsonl': '{}' }),
      'codex',
    )
    const evidence = await persistHarnessTranscript(capture, {
      put: async () => {
        throw new Error('disk full')
      },
    })
    expect(evidence).toEqual({ status: 'unavailable', reason: 'transcript-persistence-failed' })
  })

  it('passes an unavailable capture through untouched', async () => {
    const evidence = await persistHarnessTranscript(
      { status: 'unavailable', reason: 'no-transcript' },
      new InMemoryResultBlobStore(),
    )
    expect(evidence).toEqual({ status: 'unavailable', reason: 'no-transcript' })
    expect(await harnessTranscriptArtifact(evidence, new InMemoryResultBlobStore())).toBeUndefined()
  })
})

describe('captureHarnessTranscript bounds and absences', () => {
  it('names files it found and did not carry instead of reporting no transcript', async () => {
    const controller = new AbortController()
    controller.abort()
    const capture = await captureHarnessTranscript(
      environment({ '/root/.codex/sessions/s.jsonl': '{"text":"was here"}' }),
      'codex',
      controller.signal,
    )
    // An abort before the reads is not "no transcript": the file existed and nobody read it.
    expect(capture.status).toBe('unavailable')
    if (capture.status !== 'unavailable') return
    expect(capture.reason).toBe('nothing-carried')
    expect(capture.skipped).toEqual([{ path: '/root/.codex/sessions/s.jsonl', reason: 'aborted' }])
  })

  it('settles at or under 16 MiB, never 16 MiB plus one more file', async () => {
    const twoMiB = 'x'.repeat(2 * 1024 * 1024)
    const files: Record<string, string> = {}
    for (let i = 0; i < 9; i++) files[`/root/.codex/sessions/${i}.jsonl`] = twoMiB
    const capture = await captureHarnessTranscript(environment(files), 'codex')
    expect(capture.status).toBe('captured')
    if (capture.status !== 'captured') return
    expect(capture.totalBytes).toBe(16 * 1024 * 1024)
    expect(capture.fileCount).toBe(8)
    expect(capture.artifact.skipped).toEqual([
      { path: '/root/.codex/sessions/8.jsonl', reason: 'total-byte-budget-exhausted' },
    ])
  })
})
