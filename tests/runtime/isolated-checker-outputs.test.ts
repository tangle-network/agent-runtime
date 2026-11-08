import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { canonicalCandidateDigest } from '@tangle-network/agent-interface'
import type { SandboxInstance } from '@tangle-network/sandbox'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanMaterializedWorkspaceManifest } from '../../src/candidate-execution/artifacts'
import { sha256Bytes } from '../../src/candidate-execution/digest'
import { isolatedCheckResultSchema } from '../../src/runtime/isolated-check-result'
import { runIsolatedCheck } from '../../src/runtime/isolated-checker'
import {
  isolatedCheckOutputCaptureProgram,
  localCheckOutputReader,
  prepareIsolatedCheckOutputs,
  retainIsolatedCheckOutputs,
  validateIsolatedCheckOutputs,
} from '../../src/runtime/isolated-checker-outputs'
import { createPrivateCasArtifactPort } from '../../src/runtime/private-cas'

const executeFile = promisify(execFile)
let scratch: string
let tree: string
beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'check-output-proof-'))
  tree = join(scratch, 'tree')
  await mkdir(tree)
  await writeFile(join(tree, 'input.txt'), 'fixture input\n')
})
afterEach(async () => {
  await rm(scratch, { recursive: true, force: true })
})

function request(paths: string[], limits = { maxFileBytes: 1_024, maxTotalBytes: 2_048 }) {
  return prepareIsolatedCheckOutputs({
    paths,
    ...limits,
    executionId: 'isolated-output-fixture',
    artifacts: createPrivateCasArtifactPort(join(scratch, 'cas'), 'isolated-output-fixture'),
  })!
}

describe('isolated check output retention on real files and private CAS', () => {
  it('roundtrips retained and incomplete output receipts through the canonical result decoder', async () => {
    const inputDigest = canonicalCandidateDigest(await scanMaterializedWorkspaceManifest(tree))
    await writeFile(join(tree, 'report.txt'), 'retained fixture bytes')
    for (const paths of [['report.txt'], ['report.txt', 'missing.txt']]) {
      const captured = await retainIsolatedCheckOutputs(
        request(paths),
        inputDigest,
        localCheckOutputReader(tree),
      )
      const outputs =
        captured.status === 'retained'
          ? captured
          : {
              ...captured,
              source: { kind: 'local' as const, path: tree },
            }
      for (const result of [
        { succeeded: true, value: { stdout: 'ok', stderr: '' }, outputs },
        { succeeded: false, reason: 'failed', diagnostic: 'fixture failure', exitCode: 7, outputs },
      ])
        assert.deepEqual(isolatedCheckResultSchema.parse(result), result)
    }
  })

  it('retains exact bytes from a real nonzero command and reads them through a reopened store', async () => {
    const inputDigest = canonicalCandidateDigest(await scanMaterializedWorkspaceManifest(tree))
    let exitCode: number | undefined
    try {
      await executeFile(
        process.execPath,
        [
          '-e',
          'require("node:fs").writeFileSync("report.bin",Buffer.from([0,255,10,42])); process.exit(7)',
        ],
        { cwd: tree },
      )
    } catch (error) {
      exitCode = (error as { code: number }).code
    }
    assert.equal(exitCode, 7)
    const outputs = await retainIsolatedCheckOutputs(
      request(['report.bin']),
      inputDigest,
      localCheckOutputReader(tree),
    )
    assert.equal(outputs.status, 'retained')
    assert.equal(outputs.inputDigest, inputDigest)
    assert.deepEqual(outputs.missing, [])
    const artifact = outputs.files[0]!.artifact
    assert.equal(artifact.sha256, sha256Bytes(Uint8Array.from([0, 255, 10, 42])))
    assert.equal(artifact.byteLength, 4)
    await rm(tree, { recursive: true })
    const reopened = createPrivateCasArtifactPort(join(scratch, 'cas'), 'isolated-output-fixture')
    assert.deepEqual(Buffer.from(await reopened.read(artifact)), Buffer.from([0, 255, 10, 42]))
  })

  it('keeps verified files and names missing and over-budget files without reading arbitrary entries', async () => {
    const inputDigest = canonicalCandidateDigest(await scanMaterializedWorkspaceManifest(tree))
    await writeFile(join(tree, 'a.bin'), '1234')
    await writeFile(join(tree, 'b.bin'), '5678')
    await symlink('/unrelated/private/path', join(tree, 'ignored-link'))
    const outputs = await retainIsolatedCheckOutputs(
      request(['a.bin', 'b.bin', 'absent.json'], { maxFileBytes: 4, maxTotalBytes: 6 }),
      inputDigest,
      localCheckOutputReader(tree),
    )
    assert.equal(outputs.status, 'incomplete')
    assert.deepEqual(
      outputs.files.map((file) => file.path),
      ['a.bin'],
    )
    assert.deepEqual(outputs.missing, [
      { path: 'b.bin', reason: 'size-limit' },
      { path: 'absent.json', reason: 'missing' },
    ])
  })

  it('refuses file, directory and hard-link escapes without retaining their target bytes', async () => {
    const inputDigest = canonicalCandidateDigest(await scanMaterializedWorkspaceManifest(tree))
    await writeFile(join(scratch, 'private.bin'), 'private fixture bytes')
    await symlink('../private.bin', join(tree, 'leaf.bin'))
    await symlink(scratch, join(tree, 'parent'))
    await link(join(scratch, 'private.bin'), join(tree, 'hard.bin'))
    const outputs = await retainIsolatedCheckOutputs(
      request(['leaf.bin', 'parent/private.bin', 'hard.bin']),
      inputDigest,
      localCheckOutputReader(tree),
    )
    assert.deepEqual(outputs.files, [])
    assert.deepEqual(
      outputs.missing.map((file) => file.reason),
      ['unsafe-path', 'unsafe-path', 'unsafe-path'],
    )
  })

  it('reports a real filesystem store failure and leaves the source file untouched', async () => {
    const inputDigest = canonicalCandidateDigest(await scanMaterializedWorkspaceManifest(tree))
    await writeFile(join(tree, 'report.txt'), 'recoverable fixture bytes')
    await writeFile(join(scratch, 'blocked-store'), 'a file cannot be a CAS directory')
    const options = prepareIsolatedCheckOutputs({
      paths: ['report.txt'],
      maxFileBytes: 1_024,
      maxTotalBytes: 1_024,
      executionId: 'failed-store-fixture',
      artifacts: createPrivateCasArtifactPort(
        join(scratch, 'blocked-store'),
        'failed-store-fixture',
      ),
    })!
    const outputs = await retainIsolatedCheckOutputs(
      options,
      inputDigest,
      localCheckOutputReader(tree),
    )
    assert.equal(outputs.status, 'incomplete')
    assert.deepEqual(outputs.missing, [{ path: 'report.txt', reason: 'store-failed' }])
    assert.equal(await readFile(join(tree, 'report.txt'), 'utf8'), 'recoverable fixture bytes')
  })

  it('refuses unsafe declarations and stale input files before invoking a command', async () => {
    for (const path of ['../private.bin', '/private.bin', 'a//b', 'a\\b', '*.json', '.git/config'])
      expect(() =>
        validateIsolatedCheckOutputs({ paths: [path], maxFileBytes: 4, maxTotalBytes: 4 }),
      ).toThrow()
    expect(() =>
      validateIsolatedCheckOutputs({ paths: ['a', 'a'], maxFileBytes: 4, maxTotalBytes: 4 }),
    ).toThrow()
    const result = await runIsolatedCheck({
      workspaceRoot: scratch,
      tree,
      command: ['/bin/sh', '-c', 'exit 0'],
      outputs: request(['input.txt']),
    })
    assert.equal(result.succeeded, false)
    if (result.succeeded) throw new Error('stale output was admitted')
    assert.equal(result.reason, 'refused')
    assert.match(result.diagnostic, /overlaps an input file/u)
  })
})

describe('the box capture program on a real Python process (not a Sandbox transport proof)', () => {
  async function capture(path: string, maxBytes = 1_024) {
    const result = await executeFile(
      '/usr/bin/python3',
      ['-I', '-S', '-c', isolatedCheckOutputCaptureProgram, tree, path, String(maxBytes)],
      { env: {}, timeout: 5_000, maxBuffer: 4_096 },
    )
    return JSON.parse(result.stdout)
  }

  it('captures bounded binary bytes and rejects ancestor links, leaf links, hard links, and oversized files', async () => {
    await writeFile(join(tree, 'report.bin'), Uint8Array.from([0, 255, 10, 42]))
    const actual = await capture('report.bin')
    assert.deepEqual(Buffer.from(actual.content, 'base64'), Buffer.from([0, 255, 10, 42]))
    assert.equal(actual.sha256, sha256Bytes(Buffer.from([0, 255, 10, 42])))
    assert.deepEqual(await capture('report.bin', 3), { error: 'size-limit' })
    await writeFile(join(scratch, 'secret.bin'), 'private fixture bytes')
    await symlink('../secret.bin', join(tree, 'leaf.bin'))
    await symlink(scratch, join(tree, 'parent'))
    await link(join(scratch, 'secret.bin'), join(tree, 'hard.bin'))
    for (const path of ['leaf.bin', 'parent/secret.bin', 'hard.bin'])
      assert.deepEqual(await capture(path), { error: 'unsafe-path' })
    assert.deepEqual(await capture('missing.bin'), { error: 'missing' })
  })
})

describe('box command settlement (transport fault injection, not native isolation)', () => {
  async function runInterruptedBox(
    mode: 'stop-rejected' | 'spawn-unsettled' | 'stop-confirmed' | 'recovery-stop-rejected',
  ) {
    const never = new Promise<never>(() => {})
    let processStopped = false
    let captures = 0
    let boxStops = 0
    let deletions = 0
    const completed = (stdout: string) => ({
      async *logs() {
        yield { type: 'stdout', data: stdout }
      },
      async *stdout() {
        yield stdout
      },
      async *stderr() {},
      async wait() {
        return 0
      },
      async status() {
        return { running: false, exitCode: 0 }
      },
      async kill() {},
    })
    const command = {
      async *logs() {
        yield { type: 'stdout', data: 'output before interruption' }
        await never
      },
      async wait() {
        return processStopped ? 137 : never
      },
      async kill() {
        if (mode === 'stop-rejected' || mode === 'recovery-stop-rejected')
          throw new Error('injected kill transport failure')
        processStopped = true
      },
    }
    // Only the Sandbox boundary is injected. Runtime's execution, retention and private CAS
    // code remain real; this fixture cannot qualify native process or whole-box termination.
    const box = {
      id: 'fault-injection-check-box',
      createReceipt: () => ({ outcome: 'created', ownerContext: 'isolated', injectedSecrets: [] }),
      egress: { get: async () => ({ policy: { mode: 'blocked' } }) },
      fs: { uploadDir: async () => {} },
      process: {
        async spawnExact(executable: string) {
          if (executable === 'find')
            return completed(
              `${sha256Bytes(Buffer.from('fixture input\n')).slice(7)}  ./input.txt\n`,
            )
          if (executable === 'fixture-check') return mode === 'spawn-unsettled' ? never : command
          if (executable === '/usr/bin/python3') {
            captures++
            const bytes = Buffer.from('fixture output')
            return completed(
              JSON.stringify({ content: bytes.toString('base64'), sha256: sha256Bytes(bytes) }),
            )
          }
          throw new Error(`Unexpected executable ${executable}`)
        },
      },
      async stop() {
        boxStops++
        if (mode === 'recovery-stop-rejected') throw new Error('injected whole-box stop failure')
      },
      async delete() {
        deletions++
      },
    } as unknown as SandboxInstance
    const result = await runIsolatedCheck({
      workspaceRoot: scratch,
      tree,
      command: ['fixture-check'],
      timeoutMs: 25,
      outputs: request(['report.bin']),
      box: {
        client: {
          getIdentity: async () => ({ customerId: 'checker-account' }),
          createIsolated: async () => box,
        },
        builderAccounts: ['builder-account'],
        environment: 'fault-injection-only',
      },
    })
    return { result, captures, boxStops, deletions }
  }

  it.each(['stop-rejected', 'spawn-unsettled'] as const)(
    'skips file capture when command termination is unconfirmed: %s',
    async (mode) => {
      const { result, captures, boxStops, deletions } = await runInterruptedBox(mode)
      assert.equal(result.succeeded, false)
      if (result.succeeded) throw new Error('interrupted command succeeded')
      assert.equal(result.reason, 'timeout')
      assert.equal(captures, 0)
      assert.equal(boxStops, 1)
      assert.equal(deletions, 0)
      assert.equal(result.outputs?.status, 'incomplete')
      assert.deepEqual(result.outputs?.missing, [{ path: 'report.bin', reason: 'capture-failed' }])
      assert.deepEqual(result.outputs?.source, {
        kind: 'sandbox',
        sandboxId: 'fault-injection-check-box',
        state: 'stopped',
      })
      if (mode === 'stop-rejected') assert.equal(result.stdout, 'output before interruption')
    },
  )

  it('retains timeout evidence only after process termination is confirmed', async () => {
    const { result, captures, boxStops, deletions } = await runInterruptedBox('stop-confirmed')
    assert.equal(result.succeeded, false)
    if (result.succeeded) throw new Error('interrupted command succeeded')
    assert.equal(result.reason, 'timeout')
    assert.equal(result.stdout, 'output before interruption')
    assert.equal(captures, 1)
    assert.equal(boxStops, 0)
    assert.equal(deletions, 1)
    assert.equal(result.outputs?.status, 'retained')
  })

  it('requests deletion without claiming recovery custody when the whole-box stop fails', async () => {
    const { result, captures, boxStops, deletions } =
      await runInterruptedBox('recovery-stop-rejected')
    assert.equal(result.succeeded, false)
    if (result.succeeded) throw new Error('interrupted command succeeded')
    assert.equal(result.reason, 'timeout')
    assert.equal(result.stdout, 'output before interruption')
    assert.equal(captures, 0)
    assert.equal(boxStops, 1)
    assert.equal(deletions, 1)
    assert.equal(result.outputs?.status, 'incomplete')
    assert.equal(result.outputs?.source, undefined)
    assert.match(result.cleanupDiagnostic ?? '', /Recovery source stop was not confirmed/u)
  })
})
