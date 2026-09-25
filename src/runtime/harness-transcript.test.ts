import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { contentAddress } from '../durable/content-address'
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

  it('enumerates the opencode session records a Tangle box and a shared-box worker keep', async () => {
    let command = ''
    const evidence = await captureHarnessTranscript(
      {
        exec: async (next: string) => {
          command = next
          return {
            stdout: [
              '/home/agent/.opencode/sessions/retained-session-1.json',
              '/home/agent/.opencode/messages/retained-session-1/m1.json',
            ].join('\n'),
            exitCode: 0,
          }
        },
        read: async () => '{"role":"assistant","text":"found it"}',
      },
      'opencode',
    )
    // opencode keeps its own sessions in SQLite, so the roots name the JSON records instead.
    for (const root of [
      '.opencode/sessions',
      '.opencode/messages',
      '.local/share/opencode/export',
    ]) {
      expect(command).toContain(`"$HOME/${root}"`)
    }
    expect(evidence.status).toBe('captured')
    if (evidence.status === 'captured') expect(evidence.fileCount).toBe(2)
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

describe('enumeration omissions are reported, never folded into no-transcript', () => {
  // A box whose `find -printf` answers `size<TAB>path` per file, as a real one does.
  const boxWith = (listing: [number, string][], reads: string[]) => ({
    exec: async () => ({
      stdout: listing.map(([size, path]) => `${size}\t${path}`).join('\n'),
      exitCode: 0,
    }),
    read: async (path: string) => {
      reads.push(path)
      return '{}'
    },
  })

  it('lists an oversized file as skipped without ever reading it', async () => {
    const reads: string[] = []
    const capture = await captureHarnessTranscript(
      boxWith(
        [
          [2, '/root/.codex/sessions/small.jsonl'],
          [3 * 1024 * 1024, '/root/.codex/sessions/huge.jsonl'],
        ],
        reads,
      ),
      'codex',
    )
    expect(capture.status).toBe('captured')
    if (capture.status !== 'captured') return
    expect(reads).toEqual(['/root/.codex/sessions/small.jsonl'])
    expect(capture.skippedCount).toBe(1)
    expect(capture.artifact.skipped).toEqual([
      { path: '/root/.codex/sessions/huge.jsonl', reason: 'file-exceeds-byte-bound' },
    ])
  })

  it('names a listing that overflowed the file bound instead of reading as complete', async () => {
    const reads: string[] = []
    const all = Array.from(
      { length: 1001 },
      (_, i) => [2, `/root/.codex/sessions/${i}.jsonl`] as [number, string],
    )
    const capture = await captureHarnessTranscript(boxWith(all, reads), 'codex')
    expect(capture.status).toBe('captured')
    if (capture.status !== 'captured') return
    expect(capture.fileCount).toBe(1000)
    expect(capture.artifact.skipped).toEqual([
      { path: '.codex/sessions .codex/history.jsonl', reason: 'enumeration-truncated-at-1000' },
    ])
  })

  it('reports a transcript made only of files it could not carry', async () => {
    const capture = await captureHarnessTranscript(
      boxWith([[3 * 1024 * 1024, '/root/.codex/sessions/huge.jsonl']], []),
      'codex',
    )
    expect(capture).toEqual({
      status: 'unavailable',
      reason: 'nothing-carried',
      skipped: [{ path: '/root/.codex/sessions/huge.jsonl', reason: 'file-exceeds-byte-bound' }],
    })
  })
})

describe('harnessTranscriptArtifact refuses a malformed blob', () => {
  it('throws on an entry that is not a file rather than returning it as a transcript', async () => {
    const blobs = new InMemoryResultBlobStore()
    const bad = { schemaVersion: 1, harness: 'codex', files: [null], skipped: [] }
    // Content-addressed like every real blob: the ref is right, the bytes are not a transcript.
    const ref = contentAddress(bad)
    await blobs.put(ref, bad)
    await expect(
      harnessTranscriptArtifact(
        {
          status: 'available',
          transcriptRef: ref,
          harness: 'codex',
          fileCount: 1,
          totalBytes: 0,
          skippedCount: 0,
        },
        blobs,
      ),
    ).rejects.toThrow(/no transcript artifact/u)
  })
})

describe('opencode subagent sessions in a Tangle box', () => {
  it('names each subagent session the export could not write, and carries the ones it did', async () => {
    const commands: string[] = []
    const evidence = await captureHarnessTranscript(
      {
        exec: async (command: string) => {
          commands.push(command)
          if (command.includes('opencode export')) {
            return {
              stdout: [
                'exported ses_one',
                'exported ses_two',
                'failed ses_three',
                'unexported ses_four',
                'done',
              ].join('\n'),
              exitCode: 0,
            }
          }
          return {
            stdout: [
              '/home/agent/.opencode/sessions/retained-session-1.json',
              '/home/agent/.local/share/opencode/export/ses_one.json',
              '/home/agent/.local/share/opencode/export/ses_two.json',
            ].join('\n'),
            exitCode: 0,
          }
        },
        read: async (path: string) => `{"path":"${path}"}`,
      },
      'opencode',
    )
    // The export runs before the listing, so what it wrote is listed with the rest.
    expect(commands).toHaveLength(2)
    expect(commands[0]).toContain('opencode export')
    expect(commands[1]).toContain('find ')
    expect(evidence.status).toBe('captured')
    if (evidence.status !== 'captured') return
    expect(evidence.fileCount).toBe(3)
    expect(evidence.artifact.skipped).toEqual([
      { path: '~/.local/share/opencode/export/ses_three.json', reason: 'subagent-export-failed' },
      {
        path: '~/.local/share/opencode/export/ses_four.json',
        reason: 'subagent-export-over-bound',
      },
    ])
    expect(evidence.skippedCount).toBe(2)
  })

  it('names an export that did not run instead of reading as a complete capture', async () => {
    const evidence = await captureHarnessTranscript(
      {
        exec: async (command: string) => {
          if (command.includes('opencode export')) throw new Error('box went away')
          return { stdout: '/home/agent/.opencode/sessions/retained-session-1.json', exitCode: 0 }
        },
        read: async () => '{}',
      },
      'opencode',
    )
    expect(evidence.status).toBe('captured')
    if (evidence.status !== 'captured') return
    expect(evidence.artifact.skipped).toEqual([
      { path: '~/.local/share/opencode/export', reason: 'subagent-export-did-not-run' },
    ])
  })

  it('names an export the box stopped before it finished, and gives it room to finish', async () => {
    let exportOptions: Record<string, unknown> | undefined
    const evidence = await captureHarnessTranscript(
      {
        exec: async (command: string, options?: Record<string, unknown>) => {
          if (command.includes('opencode export')) {
            exportOptions = options
            // Killed after one export: no `done` line.
            return { stdout: 'exported ses_one\n', exitCode: 137 }
          }
          return { stdout: '/home/agent/.local/share/opencode/export/ses_one.json', exitCode: 0 }
        },
        read: async () => '{}',
      },
      'opencode',
    )
    // The Sandbox SDK's exec default is 30 s; the export may run up to its own bound.
    expect(exportOptions?.timeoutMs).toBe(180_000)
    expect(evidence.status).toBe('captured')
    if (evidence.status !== 'captured') return
    expect(evidence.artifact.skipped).toEqual([
      { path: '~/.local/share/opencode/export', reason: 'subagent-export-incomplete' },
    ])
  })

  it('runs no export for another harness', async () => {
    const commands: string[] = []
    await captureHarnessTranscript(
      {
        exec: async (command: string) => {
          commands.push(command)
          return { stdout: '', exitCode: 0 }
        },
        read: async () => '{}',
      },
      'claude-code',
    )
    expect(commands).toHaveLength(1)
    expect(commands[0]).not.toContain('opencode export')
  })

  // The script runs for real under /bin/sh, against a sidecar's layout and a stub `opencode`.
  // The listing uses GNU find's -printf, as in a Tangle box, so this needs Linux.
  it.skipIf(process.platform !== 'linux')(
    'exports each subagent session a sidecar record names, from the runtime home it names',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'subagent-export-'))
      const home = join(root, 'home')
      const runtimeHome = join(home, '.sidecar/cli-runtime-homes/opencode/abc')
      const bin = join(root, 'bin')
      const calls = join(root, 'calls.log')
      const store = join(runtimeHome, '.local/share/opencode')
      mkdirSync(store, { recursive: true })
      mkdirSync(join(home, '.opencode/sessions'), { recursive: true })
      mkdirSync(join(home, '.opencode/messages/retained-session-1'), { recursive: true })
      mkdirSync(bin)
      writeFileSync(join(store, 'opencode.db'), 'sqlite')
      writeFileSync(
        join(home, '.opencode/sessions/retained-session-1.json'),
        JSON.stringify(
          {
            id: 'retained-session-1',
            providerSessionId: 'ses_parent',
            providerSessionHome: runtimeHome,
          },
          null,
          2,
        ),
      )
      // As the sidecar keeps them: the task result escaped inside a JSON string, and a failure.
      writeFileSync(
        join(home, '.opencode/messages/retained-session-1/m1.json'),
        JSON.stringify(
          {
            output: '<task id="ses_child1" state="completed">\n<task_result>done</task_result>',
            note: 'from ses_parent',
          },
          null,
          2,
        ),
      )
      writeFileSync(
        join(home, '.opencode/messages/retained-session-1/m2.json'),
        JSON.stringify({ error: 'Subagent failed (task_id: ses_child2): Invalid API key' }),
      )
      // opencode answers only for the session its store holds, and says which home it read.
      writeFileSync(
        join(bin, 'opencode'),
        [
          '#!/bin/sh',
          'echo "$2" >> "$STUB_CALLS"',
          '[ "$1" = export ] || exit 2',
          '[ "$2" = ses_child1 ] || { echo "Session not found: $2" >&2; exit 1; }',
          'printf \'{"info":{"id":"%s","parentID":"ses_parent"},"home":"%s","data":"%s","messages":[{"parts":[{"type":"text","text":"subagent step"}]}]}\' "$2" "$HOME" "$XDG_DATA_HOME"',
        ].join('\n'),
      )
      chmodSync(join(bin, 'opencode'), 0o755)
      const environment = {
        exec: async (command: string) => {
          const run = spawnSync('/bin/sh', ['-c', command], {
            env: {
              ...process.env,
              HOME: home,
              PATH: `${bin}:${process.env.PATH}`,
              STUB_CALLS: calls,
            },
            encoding: 'utf8',
          })
          return { stdout: run.stdout, exitCode: run.status ?? 1 }
        },
        read: async (path: string) => readFileSync(path, 'utf8'),
      }
      const exported = join(home, '.local/share/opencode/export/ses_child1.json')
      const first = await captureHarnessTranscript(environment, 'opencode')
      expect(readFileSync(calls, 'utf8').split('\n').filter(Boolean).sort()).toEqual([
        'ses_child1',
        'ses_child2',
      ])
      expect(first.status).toBe('captured')
      if (first.status !== 'captured') return
      const file = first.artifact.files.find((f) => f.path === exported)
      expect(file?.content).toContain('subagent step')
      // Read from the runtime home the record names, not the box's own home.
      expect(JSON.parse(file?.content ?? '{}')).toMatchObject({
        home: runtimeHome,
        data: join(runtimeHome, '.local/share'),
      })
      expect(first.artifact.skipped).toEqual([
        {
          path: '~/.local/share/opencode/export/ses_child2.json',
          reason: 'subagent-export-failed',
        },
      ])
      // The parent's own session is the sidecar's record, never exported again.
      expect(existsSync(join(home, '.local/share/opencode/export/ses_parent.json'))).toBe(false)

      // The next turn's capture exports again: a later turn can continue a subagent.
      writeFileSync(calls, '')
      await captureHarnessTranscript(environment, 'opencode')
      expect(readFileSync(calls, 'utf8').split('\n').filter(Boolean).sort()).toEqual([
        'ses_child1',
        'ses_child2',
      ])
    },
  )
})
