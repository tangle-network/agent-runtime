import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { afterEach, describe, expect, it } from 'vitest'
import { contentAddress } from '../../src/durable/spawn-journal'
import {
  captureProviderWorkspaceSnapshot,
  workspaceCaptureReceipt,
} from '../../src/runtime/provider-workspace-retention'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import type { ExecutorNodeContext, SpawnEvent } from '../../src/runtime/supervise/types'
import { completeCapture, fileWorkspaceArtifacts } from '../helpers/complete-workspace-capture'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'

const script = new URL('../helpers/retained-capture-resume-child.ts', import.meta.url).pathname
const runId = 'retained-capture-restart'
const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

/** Each phase runs the public pursuit, supervisor, provider adapter and file journal in a new OS process. */
async function runPhase(directory: string, phase: string) {
  return await new Promise<{
    code: number | null
    signal: NodeJS.Signals | null
    stdout: string
    stderr: string
  }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', script, directory, phase], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
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
interface Moment {
  phase: string
  what: string
  environmentId: string
  executionId: string
  node?: ExecutorNodeContext
  profileDigest?: string
  profile?: AgentProfile
}
const moments = async (directory: string): Promise<Moment[]> =>
  (await readFile(join(directory, 'moments.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
const contextFor = (directory: string) => createFileRunContext(join(directory, 'run'))
const eventsIn = async (directory: string) =>
  (await contextFor(directory).journal.loadTree(runId)) ?? []
const resultsIn = (events: readonly SpawnEvent[]) =>
  events.filter(
    (event): event is Extract<SpawnEvent, { kind: 'execution-result' }> =>
      event.kind === 'execution-result',
  )

async function killedRun(phase = 'kill') {
  const directory = await mkdtemp(join(tmpdir(), 'retained-capture-restart-'))
  directories.push(directory)
  const first = await runPhase(directory, phase)
  expect(first.signal, first.stderr + first.stdout).toBe('SIGKILL')
  const events = await eventsIn(directory)
  expect(resultsIn(events)).toHaveLength(1)
  const input = events.find((event) => event.kind === 'execution-input')!
  expect(input).toMatchObject({ workspaceRetention: true })
  if (phase === 'kill')
    expect(events.filter((event) => event.kind === 'execution-evidence')).toHaveLength(0)
  return directory
}

async function expectReenterable(directory: string, phase: string) {
  const result = await runPhase(directory, phase)
  expect(result.code, result.stderr + result.stdout).toBe(1)
  expect(result.stdout).toContain('retained workspace capture pending')
  await expect(readFile(join(directory, 'run', 'result.json'))).rejects.toMatchObject({
    code: 'ENOENT',
  })
  expect(await readFile(join(directory, 'run', 'failure.json'), 'utf8')).toContain(
    'retained workspace capture pending',
  )
  const history = await moments(directory)
  expect(
    history.filter((moment) => moment.phase === phase && moment.what === 'dispatch'),
  ).toHaveLength(0)
  expect(history.filter((moment) => moment.what === 'destroy')).toHaveLength(0)
  const events = await eventsIn(directory)
  expect(resultsIn(events)).toHaveLength(1)
  expect(events.filter((event) => event.kind === 'execution-input')).toHaveLength(1)
  expect(events.filter((event) => event.kind === 'execution-abandoned')).toHaveLength(0)
}

async function expectRecovered(directory: string, phase = 'resume') {
  const beforeEvents = await eventsIn(directory)
  const before = resultsIn(beforeEvents)[0]!
  const beforeSequence = Math.max(...beforeEvents.map((event) => event.seq))
  const result = await runPhase(directory, phase)
  expect(result.code, result.stderr + result.stdout).toBe(0)
  const history = await moments(directory)
  const interrupted = history.find(
    (moment) => moment.what === 'capture-started' || moment.what === 'native-started',
  )!
  const nextDispatch = history.findIndex(
    (moment) => moment.phase === phase && moment.what === 'dispatch',
  )
  const recovered = history.findIndex(
    (moment) =>
      moment.phase === phase &&
      moment.what === 'capture-finished' &&
      moment.executionId === interrupted.executionId,
  )
  expect(nextDispatch).toBeGreaterThan(-1)
  expect(recovered, JSON.stringify(history, null, 2)).toBeGreaterThan(-1)
  expect(recovered).toBeLessThan(nextDispatch)
  expect(interrupted.node).toBeDefined()
  expect(interrupted.profileDigest).toBeDefined()
  expect(history[recovered]?.node).toEqual(interrupted.node)
  expect(history[recovered]?.profileDigest).toBe(interrupted.profileDigest)
  expect(history[nextDispatch]?.environmentId).toBe(interrupted.environmentId)
  const recoveredEvents = await eventsIn(directory)
  const evidence = recoveredEvents.find(
    (event) => event.kind === 'execution-evidence' && event.seq > beforeSequence,
  )
  expect(evidence?.kind).toBe('execution-evidence')
  if (evidence?.kind !== 'execution-evidence') throw new Error('missing recovered evidence')
  expect(await contextFor(directory).blobs.get(evidence.outRef)).toMatchObject({
    workspaceCapture: {
      executionId: interrupted.executionId,
      node: interrupted.node,
      profileDigest: interrupted.profileDigest,
    },
  })
  const nextInput = recoveredEvents.find(
    (event) => event.kind === 'execution-input' && event.seq > beforeSequence,
  )
  expect(nextInput).toBeDefined()
  expect(evidence.seq).toBeLessThan(nextInput!.seq)
  // Capture recovery neither republishes accepted output nor redispatches the paid invocation.
  expect(
    resultsIn(await eventsIn(directory)).filter((event) => event.outRef === before.outRef),
  ).toEqual([before])
  const originalDispatch = history.find((moment) => moment.what === 'dispatch')!
  expect(
    history.filter(
      (moment) => moment.what === 'dispatch' && moment.executionId === originalDispatch.executionId,
    ),
  ).toHaveLength(1)
}

/** Model pre-upgrade journals or corrupted sanitized intent without changing provider state. */
async function rewriteEvents(directory: string, rewrite: (event: SpawnEvent) => SpawnEvent) {
  const path = join(directory, 'run', 'spawn-journal.jsonl')
  const records = (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  await writeFile(
    path,
    `${records.map((record) => JSON.stringify(record.event ? { ...record, event: rewrite(record.event) } : record)).join('\n')}\n`,
  )
}

describe('retained workspace capture across a real process kill', () => {
  it('journals the ordinary result before capture, then gates same-environment dispatch until recovery finishes', {
    timeout: 60_000,
  }, async () => {
    const directory = await killedRun()
    const running = runPhase(directory, 'gate')
    try {
      await expect
        .poll(
          async () =>
            (await moments(directory)).some(
              (moment) => moment.phase === 'gate' && moment.what === 'capture-started',
            ),
          { timeout: 15_000 },
        )
        .toBe(true)
      expect(
        (await moments(directory)).filter(
          (moment) => moment.phase === 'gate' && moment.what === 'dispatch',
        ),
      ).toHaveLength(0)
      expect(resultsIn(await eventsIn(directory))).toHaveLength(1)
    } finally {
      await writeFile(join(directory, 'capture-open'), '')
      await running
    }
    const result = await running
    expect(result.code, result.stderr + result.stdout).toBe(0)
    const history = await moments(directory)
    const firstCapture = history.find(
      (moment) => moment.phase === 'kill' && moment.what === 'capture-started',
    )!
    const recovered = history.findIndex(
      (moment) =>
        moment.phase === 'gate' &&
        moment.what === 'capture-finished' &&
        moment.executionId === firstCapture.executionId,
    )
    const nextDispatch = history.findIndex(
      (moment) => moment.phase === 'gate' && moment.what === 'dispatch',
    )
    expect(recovered).toBeGreaterThan(-1)
    expect(recovered).toBeLessThan(nextDispatch)
  })

  it.each(['reject', 'partial', 'foreign', 'no-retention', 'lookup-hang'])(
    'keeps failed %s recovery re-enterable and later captures without repeating inference',
    { timeout: 60_000 },
    async (phase) => {
      const directory = await killedRun()
      await expectReenterable(directory, phase)
      await expectRecovered(directory)
    },
  )

  it('does not confuse a live rejected handoff with successful capture', {
    timeout: 60_000,
  }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'retained-capture-live-'))
    directories.push(directory)
    const first = await runPhase(directory, 'live-reject')
    expect(first.code, first.stderr + first.stdout).toBe(1)
    expect(first.stdout).toContain('retained workspace capture pending')
    expect((await moments(directory)).filter((moment) => moment.what === 'dispatch')).toHaveLength(
      1,
    )
    expect((await moments(directory)).filter((moment) => moment.what === 'destroy')).toHaveLength(0)
    await expectRecovered(directory)
  })

  it('reuses a durable valid receipt after another process dies, without recapturing the accepted turn', {
    timeout: 60_000,
  }, async () => {
    const directory = await killedRun('kill-after-evidence')
    const before = (await moments(directory)).find((moment) => moment.what === 'capture-started')!
    const second = await runPhase(directory, 'resume')
    expect(second.code, second.stderr + second.stdout).toBe(0)
    expect(
      (await moments(directory)).filter(
        (moment) =>
          moment.phase === 'resume' &&
          moment.what === 'capture-started' &&
          moment.executionId === before.executionId,
      ),
    ).toHaveLength(0)
  })

  it.each([
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
  ])(
    'refuses a durable %s-mismatched receipt before a fresh dispatch',
    { timeout: 60_000 },
    async (mismatch) => {
      const directory = await killedRun()
      const context = contextFor(directory)
      const events = await eventsIn(directory)
      const admitted = events.find(
        (event) => event.kind === 'execution-admitted' && event.admission.phase === 'dispatched',
      )!
      if (admitted.kind !== 'execution-admitted' || admitted.admission.phase !== 'dispatched')
        throw new Error('missing dispatched admission')
      const controlRef = admitted.admission.controlRef
      const environment = await durableRetainedProvider(join(directory, 'provider.json')).get!(
        controlRef.environmentId,
      )
      if (!environment) throw new Error('missing source')
      const artifacts = fileWorkspaceArtifacts(join(directory, 'artifacts'))
      const input = events.find((event) => event.kind === 'execution-input')!
      const originalCapture = (await moments(directory)).find(
        (moment) => moment.what === 'capture-started',
      )!
      expect(originalCapture.node).toBeDefined()
      expect(originalCapture.profileDigest).toBeDefined()
      if (originalCapture.profile === undefined) throw new Error('missing original profile')
      const captureContext = {
        environment,
        executionId: `${runId}:input:${input.seq}`,
        controlRef,
        providerSessionId: controlRef.sessionId,
        node: originalCapture.node,
        profile: originalCapture.profile,
      }
      const captured = await captureProviderWorkspaceSnapshot(
        { timeoutMs: 10_000, artifacts, capture: (next) => completeCapture(next, artifacts) },
        captureContext,
      )
      const receipt = workspaceCaptureReceipt(captureContext, captured)
      expect(receipt.node).toEqual(originalCapture.node)
      expect(receipt.profileDigest).toBe(originalCapture.profileDigest)
      const output = {
        workspaceSnapshot: captured.snapshot,
        workspaceCapture: {
          ...receipt,
          ...(mismatch === 'execution' ? { executionId: 'foreign-execution' } : {}),
          ...(mismatch === 'environment' ? { environmentId: 'foreign-environment' } : {}),
          ...(mismatch === 'control'
            ? { controlRef: { ...controlRef, executionId: 'foreign-control' } }
            : {}),
          ...(mismatch === 'coverage' ? { coverageComplete: false } : {}),
          ...(mismatch === 'profile' ? { profileDigest: `sha256:${'f'.repeat(64)}` } : {}),
          ...(mismatch === 'profile-missing' ? { profileDigest: undefined } : {}),
          ...(mismatch === 'node-root'
            ? { node: { ...originalCapture.node, rootId: 'foreign-root' } }
            : {}),
          ...(mismatch === 'node-parent'
            ? { node: { ...originalCapture.node, parentId: 'foreign-parent' } }
            : {}),
          ...(mismatch === 'node-id'
            ? { node: { ...originalCapture.node, nodeId: 'foreign-node' } }
            : {}),
          ...(mismatch === 'node-depth'
            ? { node: { ...originalCapture.node, depth: (originalCapture.node?.depth ?? 0) + 1 } }
            : {}),
          ...(mismatch === 'node-attempt'
            ? { node: { ...originalCapture.node, attemptId: 'foreign-attempt' } }
            : {}),
          ...(mismatch === 'node-missing' ? { node: undefined } : {}),
          ...(mismatch === 'snapshot'
            ? { snapshot: { ...captured.snapshot, digest: `sha256:${'f'.repeat(64)}` } }
            : {}),
        },
      }
      const outRef = contentAddress(output)
      await context.blobs.put(outRef, output)
      await context.journal.appendEvent(runId, {
        kind: 'execution-evidence',
        id: runId,
        outRef,
        seq: Math.max(...events.map((event) => event.seq)) + 1,
        at: new Date().toISOString(),
      })
      await expectReenterable(directory, 'reject')
      await expectRecovered(directory)
    },
  )
  it('checks the original profile digest before evidence recovery and can resume once corrected', {
    timeout: 60_000,
  }, async () => {
    const directory = await killedRun()
    let original = ''
    await rewriteEvents(directory, (event) => {
      if (event.kind !== 'execution-admitted' || event.admission.phase !== 'intent') return event
      original = event.admission.requestedProfileDigest
      return {
        ...event,
        admission: { ...event.admission, requestedProfileDigest: `sha256:${'f'.repeat(64)}` },
      }
    })
    await expectReenterable(directory, 'resume')
    expect(
      (await moments(directory)).filter(
        (moment) => moment.phase === 'resume' && moment.what === 'capture-started',
      ),
    ).toHaveLength(0)
    await rewriteEvents(directory, (event) =>
      event.kind === 'execution-admitted' && event.admission.phase === 'intent'
        ? {
            ...event,
            admission: {
              ...event.admission,
              requestedProfileDigest: original as `sha256:${string}`,
            },
          }
        : event,
    )
    await expectRecovered(directory, 'corrected')
  })

  it('does not infer a legacy capture obligation from the current retention configuration', {
    timeout: 60_000,
  }, async () => {
    const directory = await killedRun()
    await rewriteEvents(directory, (event) => {
      if (event.kind !== 'execution-input') return event
      const { workspaceRetention: _omitted, ...legacy } = event
      return legacy
    })
    const interrupted = (await moments(directory)).find(
      (moment) => moment.what === 'capture-started',
    )!
    const resumed = await runPhase(directory, 'resume')
    expect(resumed.code, resumed.stderr + resumed.stdout).toBe(0)
    const history = await moments(directory)
    expect(history.some((moment) => moment.phase === 'resume' && moment.what === 'dispatch')).toBe(
      true,
    )
    expect(
      history.filter(
        (moment) =>
          moment.phase === 'resume' &&
          moment.what === 'capture-started' &&
          moment.executionId === interrupted.executionId,
      ),
    ).toHaveLength(0)
  })

  it('does not certify a historical workspace after a later invocation already mutated its environment', {
    timeout: 60_000,
  }, async () => {
    const directory = await killedRun()
    // A pre-upgrade caller without this obligation could admit B after A. Reproduce both real
    // invocations, then restore A's flag to qualify the historical state this repair may meet.
    const initialInput = (await eventsIn(directory)).find(
      (event) => event.kind === 'execution-input',
    )!
    await rewriteEvents(directory, (event) => {
      if (event.kind !== 'execution-input' || event.seq !== initialInput.seq) return event
      const { workspaceRetention: _omitted, ...legacy } = event
      return legacy
    })
    const second = await runPhase(directory, 'kill')
    expect(second.signal, second.stderr + second.stdout).toBe('SIGKILL')
    await rewriteEvents(directory, (event) =>
      event.kind === 'execution-input' && event.seq === initialInput.seq
        ? { ...event, workspaceRetention: true }
        : event,
    )
    const resumed = await runPhase(directory, 'resume')
    expect(resumed.code, resumed.stderr + resumed.stdout).toBe(1)
    expect(resumed.stdout).toContain('historical workspace cannot be recaptured')
    const history = await moments(directory)
    expect(
      history.filter(
        (moment) =>
          moment.phase === 'resume' &&
          (moment.what === 'capture-started' || moment.what === 'dispatch'),
      ),
    ).toHaveLength(0)
    expect(history.filter((moment) => moment.what === 'destroy')).toHaveLength(0)
    expect(resultsIn(await eventsIn(directory))).toHaveLength(2)
    await expect(readFile(join(directory, 'run', 'result.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })
  it('recovers the exact selected-seat profile rather than the authored fallback profile', {
    timeout: 60_000,
  }, async () => {
    const directory = await killedRun('seat-kill')
    const events = await eventsIn(directory)
    expect(
      events.some(
        (event) =>
          event.kind === 'seat-segment' && event.harness === 'codex' && event.model === 'gpt-6-sol',
      ),
    ).toBe(true)
    await expectRecovered(directory, 'seat-resume')
  })

  it.each(['kill-before-input', 'kill-before-dispatch'])(
    'blocks historical uncaptured work even when the latest input is unfinished at %s',
    { timeout: 60_000 },
    async (phase) => {
      const directory = await killedRun()
      const initialInput = (await eventsIn(directory)).find(
        (event) => event.kind === 'execution-input',
      )!
      await rewriteEvents(directory, (event) => {
        if (event.kind !== 'execution-input' || event.seq !== initialInput.seq) return event
        const { workspaceRetention: _omitted, ...legacy } = event
        return legacy
      })
      const second = await runPhase(directory, phase)
      expect(second.signal, second.stderr + second.stdout).toBe('SIGKILL')
      await rewriteEvents(directory, (event) =>
        event.kind === 'execution-input' && event.seq === initialInput.seq
          ? { ...event, workspaceRetention: true }
          : event,
      )
      const before = await eventsIn(directory)
      expect(before.filter((event) => event.kind === 'execution-input')).toHaveLength(2)
      expect(resultsIn(before)).toHaveLength(1)
      const resumed = await runPhase(directory, 'resume')
      expect(resumed.code, resumed.stderr + resumed.stdout).toBe(1)
      expect(resumed.stdout).toContain('historical workspace cannot be recaptured')
      const history = await moments(directory)
      expect(
        history.filter(
          (moment) =>
            moment.phase === 'resume' &&
            (moment.what === 'capture-started' || moment.what === 'dispatch'),
        ),
      ).toHaveLength(0)
      expect(history.filter((moment) => moment.what === 'destroy')).toHaveLength(0)
      expect(resultsIn(await eventsIn(directory))).toHaveLength(1)
      await expect(readFile(join(directory, 'run', 'result.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      })
    },
  )
  // The final native copy runs beside the workspace capture, so death in the copy can
  // land before or after capture-started; either way nothing was settled.
  it('recovers after death in the final native copy that runs beside workspace capture', {
    timeout: 60_000,
  }, async () => {
    const directory = await killedRun('kill-native')
    expect((await moments(directory)).some((moment) => moment.what === 'native-started')).toBe(true)
    expect(
      (await eventsIn(directory)).filter((event) => event.kind === 'execution-evidence'),
    ).toHaveLength(0)
    await expectRecovered(directory)
  })
})
