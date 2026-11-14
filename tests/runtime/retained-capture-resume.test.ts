import { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { captureAgentCandidateWorkspace } from '../../src/candidate-execution'
import { contentAddress } from '../../src/durable/content-address'
import type { ProviderWorkspaceCaptureReceipt } from '../../src/runtime/provider-workspace-retention'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import type { SpawnEvent, SupervisedResult } from '../../src/runtime/supervise/types'
import { compileFixture } from '../helpers/compile-fixture'
import { fileWorkspaceArtifacts } from '../helpers/complete-workspace-capture'

let fixture: Awaited<ReturnType<typeof compileFixture>>
beforeAll(async () => {
  fixture = await compileFixture('tests/helpers/retained-capture-resume-child.ts')
})
afterAll(async () => {
  await fixture?.dispose()
})
const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})
const runId = 'retained-capture-restart'
const contextFor = (directory: string) => createFileRunContext(join(directory, 'run'))
const eventsIn = async (directory: string) =>
  (await contextFor(directory).journal.loadTree(runId)) ?? []
const resultsIn = (events: readonly SpawnEvent[]) =>
  events.filter((event) => event.kind === 'execution-result')
const rows = async (directory: string, name: string): Promise<any[]> =>
  (await readFile(join(directory, name), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
async function runPhase(directory: string, phase: string) {
  return await new Promise<{
    code: number | null
    signal: NodeJS.Signals | null
    stdout: string
    stderr: string
  }>((resolve, reject) => {
    const child = spawn(process.execPath, [fixture.path, directory, phase], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20_000,
      killSignal: 'SIGKILL',
    })
    let stdout = '',
      stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }))
  })
}
async function killedRun(phase = 'kill') {
  const directory = await mkdtemp(join(tmpdir(), 'retained-native-restart-'))
  directories.push(directory)
  const killed = await runPhase(directory, phase)
  expect(killed.signal, killed.stderr + killed.stdout).toBe('SIGKILL')
  const events = await eventsIn(directory)
  expect(resultsIn(events)).toHaveLength(1)
  expect(
    events
      .filter((event) => event.kind === 'execution-input')
      .every((event) => !('workspaceRetention' in event)),
  ).toBe(true)
  expect(events.filter((event) => event.kind === 'execution-evidence')).toEqual([])
  const native = await rows(directory, 'native-receipts.jsonl')
  expect(native).toHaveLength(1)
  expect(native[0].pid).not.toBe(process.pid)
  const outputs = await rows(directory, 'native-output.jsonl')
  expect(outputs[0]).toMatchObject({ exitCode: 0, stderr: '' })
  expect(JSON.parse(outputs[0].stdout).success).toBe(phase !== 'kill-failed')
  return directory
}

/** Offline pre-upgrade fixture: write canonical journal rows through its maintained owner. */
async function rewriteEvents(directory: string, rewrite: (event: SpawnEvent) => SpawnEvent) {
  const events = await eventsIn(directory)
  await rm(join(directory, 'run', 'spawn-journal.jsonl'))
  const journal = contextFor(directory).journal
  await journal.beginTree(runId, events[0]!.at)
  for (const event of events) await journal.appendEvent(runId, rewrite(event))
}
async function legacyReceipt(directory: string, mismatch?: string) {
  const context = contextFor(directory)
  const events = await eventsIn(directory)
  const input = events.find((event) => event.kind === 'execution-input')!
  const result = resultsIn(events)[0]!
  const admitted = events.find(
    (event) => event.kind === 'execution-admitted' && event.admission.phase === 'dispatched',
  )!
  const intent = events.find(
    (event) => event.kind === 'execution-admitted' && event.admission.phase === 'intent',
  )!
  const bound = events
    .slice(events.indexOf(input), events.indexOf(result))
    .findLast((event) => event.kind === 'execution-bound')
  if (
    input.kind !== 'execution-input' ||
    admitted.kind !== 'execution-admitted' ||
    admitted.admission.phase !== 'dispatched' ||
    intent.kind !== 'execution-admitted' ||
    intent.admission.phase !== 'intent' ||
    bound?.kind !== 'execution-bound'
  )
    throw new Error('missing exact historical invocation identity')
  const controlRef = admitted.admission.controlRef
  const native = (await rows(directory, 'native-receipts.jsonl'))[0]
  const output = (await rows(directory, 'native-output.jsonl'))[0]
  expect(native.control).toEqual(controlRef)
  expect(output.controlRef).toEqual(controlRef)
  await rewriteEvents(directory, (event) =>
    event === input || (event.kind === 'execution-input' && event.seq === input.seq)
      ? ({ ...event, workspaceRetention: true } as SpawnEvent)
      : event,
  )
  if (mismatch === 'missing') return
  const artifactDirectory = await mkdtemp(join(tmpdir(), 'legacy-native-artifacts-'))
  directories.push(artifactDirectory)
  const artifacts = fileWorkspaceArtifacts(artifactDirectory)
  const { snapshot } = await captureAgentCandidateWorkspace(directory, {
    limits: { maxEmbeddedArtifactBytes: 64 },
    artifactPersistence: { executionId: `${runId}:input:${input.seq}`, outputArtifacts: artifacts },
  })
  if (!('locator' in snapshot.manifest)) throw new Error('fixture manifest must be durable')
  const manifest = JSON.parse(Buffer.from(await artifacts.read(snapshot.manifest)).toString())
  const directoryCount = (
    await readdir(directory, { recursive: true, withFileTypes: true })
  ).filter((entry) => entry.isDirectory()).length
  const accepted = (await context.blobs.get(result.outRef)) as { events: Array<{ type: string }> }
  const receipt: ProviderWorkspaceCaptureReceipt = {
    executionId: `${runId}:input:${input.seq}`,
    environmentId: controlRef.environmentId,
    controlRef,
    node: {
      rootId: runId,
      parentId: runId,
      nodeId: runId,
      depth: 0,
      attemptId: bound.binding.attemptId,
    },
    profileDigest: intent.admission.requestedProfileDigest!,
    providerSessionId: controlRef.sessionId,
    nativeSessionId: controlRef.sessionId,
    snapshot,
    coverageComplete: true,
    provenance: {
      status: 'reported',
      environmentId: controlRef.environmentId,
      executionId: `${runId}:input:${input.seq}`,
      controlRef,
      workspaceScope: 'environment',
      workspaceRoot: directory,
      entries: manifest.files.map((entry: any) => ({
        path: entry.path,
        type: 'file',
        mode: entry.mode,
        sizeBytes: entry.byteLength,
      })),
      workspace: {
        scannedFiles: manifest.files.length,
        reportedFiles: manifest.files.length,
        scannedDirectories: directoryCount,
        reportedDirectories: directoryCount,
        complete: true,
      },
      attempts: [
        {
          executionId: controlRef.executionId!,
          ordinal: 1,
          providerSessionId: controlRef.sessionId,
          nativeSessionIds: [controlRef.sessionId],
          processIds: [String(native.pid)],
          outcome: JSON.parse(output.stdout).success ? 'succeeded' : 'failed',
          missingReasons: [],
        },
      ],
      sessions: [
        {
          id: controlRef.sessionId,
          executionId: `${runId}:input:${input.seq}`,
          nativeSessionId: controlRef.sessionId,
          transportEvents: 'complete',
          eventCount: accepted.events.length,
          messageCount: accepted.events.filter(
            (event) => event.type === 'text' || event.type === 'message',
          ).length,
          processStreams: {
            complete: true,
            streamCount: 2,
            stdinBytes: 0,
            stdoutBytes: Buffer.byteLength(output.stdout),
            stderrBytes: Buffer.byteLength(output.stderr),
            protocolBytes: 0,
          },
          nativeEvents: { complete: true, count: 1 },
        },
      ],
      missing: [],
    },
  }
  const amended = {
    ...receipt,
    ...(mismatch === 'execution' ? { executionId: 'foreign-execution' } : {}),
    ...(mismatch === 'environment' ? { environmentId: 'foreign-environment' } : {}),
    ...(mismatch === 'control'
      ? { controlRef: { ...controlRef, executionId: 'foreign-control' } }
      : {}),
    ...(mismatch === 'coverage' ? { coverageComplete: false } : {}),
    ...(mismatch === 'profile' ? { profileDigest: `sha256:${'f'.repeat(64)}` } : {}),
    ...(mismatch === 'profile-missing' ? { profileDigest: undefined } : {}),
    ...(mismatch === 'node-root' ? { node: { ...receipt.node, rootId: 'foreign-root' } } : {}),
    ...(mismatch === 'node-parent'
      ? { node: { ...receipt.node, parentId: 'foreign-parent' } }
      : {}),
    ...(mismatch === 'node-id' ? { node: { ...receipt.node, nodeId: 'foreign-node' } } : {}),
    ...(mismatch === 'node-depth' ? { node: { ...receipt.node, depth: 1 } } : {}),
    ...(mismatch === 'node-attempt'
      ? { node: { ...receipt.node, attemptId: 'foreign-attempt' } }
      : {}),
    ...(mismatch === 'node-missing' ? { node: undefined } : {}),
    ...(mismatch === 'snapshot'
      ? { snapshot: { ...snapshot, digest: `sha256:${'f'.repeat(64)}` } }
      : {}),
  }
  const retained = { workspaceSnapshot: snapshot, workspaceCapture: amended }
  const outRef = contentAddress(retained)
  await context.blobs.put(outRef, retained)
  await context.journal.appendEvent(runId, {
    kind: 'execution-evidence',
    id: runId,
    outRef,
    seq: Math.max(...events.map((event) => event.seq)) + 1,
    at: new Date().toISOString(),
  })
}
async function resumed(directory: string, phase = 'resume') {
  const before = resultsIn(await eventsIn(directory))
  const result = await runPhase(directory, phase)
  expect(result.code, result.stderr + result.stdout).toBe(0)
  const events = await eventsIn(directory)
  expect(resultsIn(events).slice(0, before.length)).toEqual(before)
  const native = await rows(directory, 'native-receipts.jsonl')
  expect(resultsIn(events)).toHaveLength(native.length)
  expect(new Set(native.map((entry) => entry.control.executionId)).size).toBe(native.length)
  expect(new Set(native.map((entry) => entry.pid)).size).toBe(native.length)
  for (const input of events.filter((event) => event.kind === 'execution-input').slice(1))
    expect(input).not.toHaveProperty('workspaceRetention')
  return {
    result: JSON.parse(result.stdout) as SupervisedResult<unknown>,
    events,
    history: await rows(directory, 'moments.jsonl'),
    native,
  }
}

describe('native continuation and read-only legacy capture receipts after a real process kill', () => {
  it('continues fresh native work without a client writer or persisted capture obligation', async () => {
    const directory = await killedRun()
    const continued = await resumed(directory)
    expect(continued.native).toHaveLength(2)
    expect(continued.native[1].control.environmentId).toBe(
      continued.native[0].control.environmentId,
    )
    expect(continued.events.filter((event) => event.kind === 'evidence-pending')).toEqual([])
    expect(continued.result.teardownUnconfirmed).toBeUndefined()
  })
  it.each(['valid', 'seat-valid'])(
    'reuses a stored verified %s receipt without invoking a capture writer',
    async (mode) => {
      const directory = await killedRun(mode === 'seat-valid' ? 'seat-kill' : 'kill')
      await legacyReceipt(directory)
      if (mode === 'seat-valid')
        expect(
          (await eventsIn(directory)).some(
            (event) => event.kind === 'seat-segment' && event.harness === 'codex',
          ),
        ).toBe(true)
      const continued = await resumed(directory, mode === 'seat-valid' ? 'seat-resume' : 'resume')
      expect(continued.native).toHaveLength(2)
      expect(continued.native[1].control.environmentId).toBe(
        continued.native[0].control.environmentId,
      )
      // The stored legacy receipt, then the resumed invocation's harness-transcript receipt. The
      // killed invocation died before its receipt (killedRun) and is reused, not run again.
      const evidence = continued.events.filter((event) => event.kind === 'execution-evidence')
      const blobs = contextFor(directory).blobs
      const records = await Promise.all(
        evidence.map(async (event) => (await blobs.get(event.outRef)) as Record<string, unknown>),
      )
      expect(
        records.map((out) =>
          out.kind === 'harness-transcript'
            ? `harness-transcript:${String((out.harnessTranscript as { status?: unknown }).status)}`
            : out.workspaceCapture === undefined
              ? 'other'
              : 'legacy-workspace-receipt',
        ),
      ).toEqual(['legacy-workspace-receipt', 'harness-transcript:unavailable'])
      expect(records[1]).toMatchObject({
        schemaVersion: 1,
        node: { nodeId: runId },
        outRef: (
          resultsIn(continued.events).at(-1) as Extract<SpawnEvent, { kind: 'execution-result' }>
        ).outRef,
      })
      expect(continued.events.filter((event) => event.kind === 'evidence-pending')).toEqual([])
      expect(continued.result.teardownUnconfirmed).toBeUndefined()
    },
  )
  it.each([
    'missing',
    'execution',
    'environment',
    'control',
    'coverage',
    'snapshot',
    'profile',
    'profile-missing',
    'node-root',
    'node-parent',
    'node-id',
    'node-depth',
    'node-attempt',
    'node-missing',
  ])('preserves source custody and never recaptures a %s legacy receipt', async (mismatch) => {
    const directory = await killedRun()
    await legacyReceipt(directory, mismatch)
    const continued = await resumed(directory)
    const source = continued.native[0].control.environmentId
    expect(continued.native).toHaveLength(2)
    expect(continued.native[1].control.environmentId).not.toBe(source)
    expect(
      continued.history.some((entry) => entry.what === 'destroy' && entry.environmentId === source),
    ).toBe(false)
    expect(
      continued.events.filter(
        (event) => event.kind === 'evidence-pending' && event.environmentId === source,
      ),
    ).toEqual([
      expect.objectContaining({
        error: expect.stringContaining('client capture writers are retired'),
      }),
    ])
    expect(continued.result.teardownUnconfirmed?.flatMap((entry) => entry.kept ?? [])).toEqual([
      {
        provider: continued.native[0].control.provider,
        environmentId: source,
        keptFor: 'evidence',
      },
    ])
    expect(
      continued.result.teardownUnconfirmed?.flatMap((entry) => entry.environments ?? []) ?? [],
    ).not.toContainEqual(expect.objectContaining({ environmentId: source }))
  })
  it('never certifies an uncaptured historical source after a later completed invocation mutated it', async () => {
    const directory = await killedRun()
    const later = await runPhase(directory, 'kill')
    expect(later.signal, later.stderr + later.stdout).toBe('SIGKILL')
    const nativeBefore = await rows(directory, 'native-receipts.jsonl')
    expect(nativeBefore).toHaveLength(2)
    expect(nativeBefore[1].control.environmentId).toBe(nativeBefore[0].control.environmentId)
    expect(resultsIn(await eventsIn(directory))).toHaveLength(2)
    await legacyReceipt(directory, 'missing')
    const continued = await resumed(directory)
    expect(continued.native).toHaveLength(3)
    expect(continued.native.slice(0, 2)).toEqual(nativeBefore)
    const source = nativeBefore[0].control.environmentId
    expect(continued.native[2].control.environmentId).not.toBe(source)
    expect(
      continued.history.some((entry) => entry.what === 'destroy' && entry.environmentId === source),
    ).toBe(false)
    expect(
      continued.events.filter(
        (event) => event.kind === 'evidence-pending' && event.environmentId === source,
      ),
    ).toHaveLength(1)
  })
  it('keeps a failed prior native invocation pending instead of inventing complete capture', async () => {
    const directory = await killedRun('kill-failed')
    await legacyReceipt(directory, 'missing')
    const continued = await resumed(directory)
    expect(continued.native).toHaveLength(1)
    expect(JSON.stringify(continued.result)).toContain('retained workspace capture pending')
    expect(continued.history.filter((entry) => entry.what === 'destroy')).toEqual([])
  })
  it.each(['kill-before-input', 'kill-before-dispatch'])(
    'isolates uncaptured historical source after death at %s',
    async (phase) => {
      const directory = await killedRun()
      const interrupted = await runPhase(directory, phase)
      expect(interrupted.signal, interrupted.stderr + interrupted.stdout).toBe('SIGKILL')
      await legacyReceipt(directory, 'missing')
      const continued = await resumed(directory)
      const source = continued.native[0].control.environmentId
      expect(continued.native[1].control.environmentId).not.toBe(source)
      expect(
        continued.history.some(
          (entry) => entry.what === 'destroy' && entry.environmentId === source,
        ),
      ).toBe(false)
      expect(continued.events.filter((event) => event.kind === 'execution-abandoned')).toHaveLength(
        phase === 'kill-before-dispatch' ? 1 : 0,
      )
    },
  )
})
