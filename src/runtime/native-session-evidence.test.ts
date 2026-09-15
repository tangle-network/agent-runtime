import { describe, expect, it } from 'vitest'

import { captureNativeSessionEvidence } from './native-session-evidence'

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

describe('captureNativeSessionEvidence', () => {
  it('carries the assistant text the tool-span receipt never had', async () => {
    const evidence = await captureNativeSessionEvidence(
      environment({
        '/root/.claude/projects/a/session.jsonl': '{"role":"assistant","text":"the answer"}',
        '/root/.claude/history.jsonl': '{"prompt":"the question"}',
      }),
      'claude-code',
    )
    expect(evidence.status).toBe('available')
    if (evidence.status !== 'available') return
    expect(evidence.fileCount).toBe(2)
    expect(evidence.skippedCount).toBe(0)
    // Inline in the artifact the executor settles with; supervise blobs it under the outRef.
    expect(evidence.artifact.files.map((f) => f.content).join('')).toMatch(/the answer/u)
  })

  it('never reads a credential that sits inside a session tree', async () => {
    const reads: string[] = []
    const evidence = await captureNativeSessionEvidence(
      {
        exec: async () => ({
          stdout: ['/root/.codex/sessions/rollout.jsonl', '/root/.codex/sessions/auth.json'].join('\n'),
          exitCode: 0,
        }),
        read: async (path: string) => {
          reads.push(path)
          return '{"ok":true}'
        },
      },
      'codex',
    )
    expect(evidence.status).toBe('available')
    if (evidence.status !== 'available') return
    expect(evidence.fileCount).toBe(1)
    expect(evidence.skippedCount).toBe(1)
    // The assertion that matters: the read never happened, not merely that it is absent.
    expect(reads).toEqual(['/root/.codex/sessions/rollout.jsonl'])
  })

  it('reports a missing capability instead of an empty artifact that reads as coverage', async () => {
    // agent-provider-tangle gates read behind capabilities.workspace.read && box.read.
    expect(await captureNativeSessionEvidence(environment({}, { read: false }), 'codex')).toEqual({
      status: 'unavailable',
      reason: 'unsupported-environment',
    })
    // read takes one path and offers no listing, so enumeration needs exec.
    expect(await captureNativeSessionEvidence(environment({}, { exec: false }), 'codex')).toEqual({
      status: 'unavailable',
      reason: 'enumeration-failed',
    })
    expect(await captureNativeSessionEvidence(environment({}), 'no-such-harness')).toEqual({
      status: 'unavailable',
      reason: 'unknown-harness',
    })
    expect(await captureNativeSessionEvidence(environment({}), 'codex')).toEqual({
      status: 'unavailable',
      reason: 'no-transcript',
    })
  })

  it('produces an identical artifact for an identical transcript', async () => {
    const files = { '/root/.codex/sessions/r.jsonl': '{"a":1}' }
    const first = await captureNativeSessionEvidence(environment(files), 'codex')
    const second = await captureNativeSessionEvidence(environment(files), 'codex')
    expect(first.status).toBe('available')
    expect(second.status).toBe('available')
    if (first.status !== 'available' || second.status !== 'available') return
    // Keeps supervise's contentRef over the settled result stable across a re-capture.
    expect(first.artifact).toEqual(second.artifact)
  })
})
