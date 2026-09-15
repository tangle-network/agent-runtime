import assert from 'node:assert/strict'
import test from 'node:test'

import { captureNativeSessionEvidence } from './native-session-evidence'

function blobs() {
  const store = new Map<string, unknown>()
  return { put: async (ref: string, value: unknown) => void store.set(ref, value), store }
}

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

test('a live environment yields the harness transcript as a content-addressed artifact', async () => {
  const sink = blobs()
  const evidence = await captureNativeSessionEvidence(
    environment({
      '/root/.claude/projects/a/session.jsonl': '{"role":"assistant","text":"the answer"}',
      '/root/.claude/history.jsonl': '{"prompt":"the question"}',
    }),
    'claude-code',
    sink,
  )
  assert.equal(evidence.status, 'available')
  if (evidence.status !== 'available') return
  assert.equal(evidence.fileCount, 2)
  assert.equal(evidence.skippedCount, 0)
  const artifact = sink.store.get(evidence.sessionRef) as { files: { path: string; content: string }[] }
  // The assistant text the tool-span receipt never carried is present here.
  assert.match(artifact.files.map((f) => f.content).join(''), /the answer/u)
})

test('a credential inside a session tree is never read', async () => {
  const sink = blobs()
  const reads: string[] = []
  const env = {
    exec: async () => ({
      stdout: ['/root/.codex/sessions/rollout.jsonl', '/root/.codex/sessions/auth.json'].join('\n'),
      exitCode: 0,
    }),
    read: async (path: string) => {
      reads.push(path)
      return '{"ok":true}'
    },
  }
  const evidence = await captureNativeSessionEvidence(env, 'codex', sink)
  assert.equal(evidence.status, 'available')
  if (evidence.status !== 'available') return
  assert.equal(evidence.fileCount, 1)
  assert.equal(evidence.skippedCount, 1)
  assert.deepEqual(reads, ['/root/.codex/sessions/rollout.jsonl'])
})

test('a capability the environment lacks is reported, never assumed', async () => {
  // The Tangle provider gates `read` behind capabilities.workspace.read && box.read, so an
  // environment without it must not produce an empty artifact that reads as coverage.
  assert.deepEqual(await captureNativeSessionEvidence(environment({}, { read: false }), 'codex', blobs()), {
    status: 'unavailable',
    reason: 'unsupported-environment',
  })
  // `read` takes one path and gives no listing, so enumeration needs exec.
  assert.deepEqual(await captureNativeSessionEvidence(environment({}, { exec: false }), 'codex', blobs()), {
    status: 'unavailable',
    reason: 'enumeration-failed',
  })
  assert.deepEqual(await captureNativeSessionEvidence(environment({}), 'no-such-harness', blobs()), {
    status: 'unavailable',
    reason: 'unknown-harness',
  })
  assert.deepEqual(await captureNativeSessionEvidence(environment({}), 'codex', blobs()), {
    status: 'unavailable',
    reason: 'no-transcript',
  })
})

test('a failed persist is reported rather than claimed as captured', async () => {
  const evidence = await captureNativeSessionEvidence(
    environment({ '/root/.codex/sessions/r.jsonl': '{}' }),
    'codex',
    { put: async () => { throw new Error('blob store down') } },
  )
  assert.deepEqual(evidence, { status: 'unavailable', reason: 'persistence-failed' })
})

test('the same transcript captures to the same ref twice', async () => {
  const files = { '/root/.codex/sessions/r.jsonl': '{"a":1}' }
  const first = await captureNativeSessionEvidence(environment(files), 'codex', blobs())
  const second = await captureNativeSessionEvidence(environment(files), 'codex', blobs())
  assert.equal(first.status, 'available')
  assert.equal(second.status, 'available')
  if (first.status !== 'available' || second.status !== 'available') return
  assert.equal(first.sessionRef, second.sessionRef)
})
