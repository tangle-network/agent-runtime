import { spawn } from 'node:child_process'
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../durable/spawn-journal'
import type { SupervisorControlEffectRequest, SupervisorControlEffectResult } from './control'
import {
  createFileSupervisorControlClient,
  createInProcessSupervisorControlClient,
  startSupervisorControlRoute,
  supervisorControlFiles,
} from './control'
import { deserializeCommand, isCommand, serializeCommand, steerCommand } from './control-command'
import { commandAuthorization, encryptCommandPayload } from './control-crypto'
import { createExecutorRegistry } from './runtime'
import { createRootHandle, createSupervisor } from './supervisor'
import type {
  Agent,
  AgentSpec,
  ControllableRootHandle,
  Executor,
  ExecutorResult,
  TreeView,
} from './types'

const controlChildScript = new URL(
  '../../../tests/helpers/supervisor-control-child.ts',
  import.meta.url,
).pathname

interface ControlChildExit {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly stderr: string
}

function runControlChild(...args: string[]): Promise<ControlChildExit> {
  return new Promise<ControlChildExit>((resolveChild, rejectChild) => {
    const child = spawn(process.execPath, ['--import', 'tsx', controlChildScript, ...args], {
      cwd: process.cwd(),
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', rejectChild)
    child.once('close', (code, signal) => resolveChild({ code, signal, stderr }))
  })
}

async function waitForFile(path: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path)) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${path}`)
}

describe('in-process supervisor control', () => {
  it('watches revisions and returns exact steer and cancel effects', async () => {
    const fixture = rootFixture()
    const client = createInProcessSupervisorControlClient(fixture.handle)
    const first = await client.snapshot()
    expect(first).toMatchObject({ runId: 'supervisor-run', revision: 1, status: 'running' })

    const steer = await client.steer({
      operationId: 'steer-1',
      workerId: 'worker-1',
      message: { instruction: 'focus on the failing test' },
    })
    expect(steer).toMatchObject({ status: 'accepted', effect: 'delivered' })
    expect(fixture.steers).toEqual([
      { workerId: 'worker-1', message: { instruction: 'focus on the failing test' } },
    ])
    await expect(
      client.steer({
        operationId: 'steer-1',
        workerId: 'worker-1',
        message: { instruction: 'focus on the failing test' },
      }),
    ).resolves.toEqual(steer)
    expect(fixture.steers).toHaveLength(1)
    await expect(
      client.steer({
        operationId: 'steer-1',
        workerId: 'worker-1',
        message: { instruction: 'different command' },
      }),
    ).resolves.toMatchObject({ status: 'conflict', effect: 'unknown' })
    expect(fixture.steers).toHaveLength(1)

    await expect(
      client.cancel({ operationId: 'cancel-worker', workerId: 'worker-1', reason: 'stop' }),
    ).resolves.toMatchObject({ status: 'accepted', effect: 'cancel_requested' })
    await expect(
      client.cancel({ operationId: 'cancel-root', reason: 'stop everything' }),
    ).resolves.toMatchObject({ status: 'accepted', effect: 'cancel_requested' })
    expect(fixture.workerCancels).toEqual([{ workerId: 'worker-1', reason: 'stop' }])
    expect(fixture.rootCancels).toEqual(['stop everything'])

    fixture.tree = { ...fixture.tree, waiting: 1 }
    const next = await client
      .watch({ afterRevision: first?.revision, pollMs: 1 })
      [Symbol.asyncIterator]()
      .next()
    expect(next.value).toMatchObject({ revision: 2, tree: { waiting: 1 } })
  })

  it('retains the terminal in-process snapshot and ends a watch at completion', async () => {
    let release!: () => void
    let markEntered!: () => void
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve
    })
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const handle = createRootHandle<string>()
    const supervisor = createSupervisor<unknown, string>()
    supervisor.attach(handle)
    const running = supervisor.run(
      {
        name: 'root',
        async act() {
          markEntered()
          await held
          return 'done'
        },
      },
      'work',
      {
        budget: { maxIterations: 1, maxTokens: 10 },
        runId: 'in-process-terminal',
        journal: new InMemorySpawnJournal(),
        blobs: new InMemoryResultBlobStore(),
        executors: createExecutorRegistry(),
      },
    )
    await entered

    const client = createInProcessSupervisorControlClient(handle, { pollMs: 1 })
    const live = await client.snapshot()
    if (!live) throw new Error('in-process supervisor did not publish a live snapshot')
    expect(live).toMatchObject({ runId: 'in-process-terminal', status: 'running' })
    const terminalNext = client
      .watch({ afterRevision: live.revision, pollMs: 1 })
      [Symbol.asyncIterator]()
      .next()
    release()
    await running

    const terminal = await terminalNext
    expect(terminal.value).toMatchObject({
      runId: 'in-process-terminal',
      status: 'completed',
    })
    expect(() => handle.view()).toThrow('not bound to a live run')
    await expect(client.snapshot()).resolves.toMatchObject({ status: 'completed' })
  })
})

describe('reconnectable supervisor control route', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'agent-runtime-control-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('passes the authenticated actor and run binding to the live effect boundary', async () => {
    const seen: SupervisorControlEffectRequest[] = []
    const route = startSupervisorControlRoute({
      runDir: directory,
      runId: 'actor-bound-run',
      snapshot: () => emptyTree('actor-bound-run'),
      effectReceiver: (request) => {
        seen.push(request)
        return { status: 'accepted', effect: 'cancel_requested' }
      },
      pollMs: 2,
    })
    const client = createFileSupervisorControlClient(directory, {
      capabilityToken: route.capabilityToken,
      pollMs: 1,
      timeoutMs: 500,
    })

    await expect(
      client.cancel({
        operationId: 'actor-bound-cancel',
        source: 'operator:17',
        reason: 'stop this run',
      }),
    ).resolves.toMatchObject({ status: 'accepted', effect: 'cancel_requested' })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      operationId: 'actor-bound-cancel',
      source: 'operator:17',
      target: { kind: 'supervisor', runId: 'actor-bound-run' },
    })
    route.close('completed')
  })

  it('reconnects clients and routes commands once across a route restart', async () => {
    const effects = routeEffects()
    const route = startSupervisorControlRoute({
      runDir: directory,
      runId: 'supervisor-run',
      snapshot: () => effects.tree,
      steer: effects.steer,
      cancelWorker: effects.cancelWorker,
      cancelSupervisor: effects.cancelSupervisor,
      pollMs: 2,
    })
    const firstClient = createFileSupervisorControlClient(directory, {
      pollMs: 2,
      timeoutMs: 500,
      capabilityToken: route.capabilityToken,
    })
    const firstSnapshot = await firstClient.snapshot()
    expect(firstSnapshot).toMatchObject({
      runId: 'supervisor-run',
      revision: 1,
      status: 'running',
    })

    const steer = await firstClient.steer({
      operationId: 'durable-steer',
      workerId: 'worker-1',
      message: 'change direction',
    })
    expect(steer).toMatchObject({ status: 'accepted', effect: 'delivered' })
    expect(effects.steers).toEqual([{ workerId: 'worker-1', message: 'change direction' }])

    const reconnectedClient = createFileSupervisorControlClient(directory, {
      pollMs: 2,
      timeoutMs: 500,
      capabilityToken: route.capabilityToken,
    })
    await expect(
      reconnectedClient.steer({
        operationId: 'durable-steer',
        workerId: 'worker-1',
        message: 'change direction',
      }),
    ).resolves.toEqual(steer)
    expect(effects.steers).toHaveLength(1)
    await expect(
      reconnectedClient.cancel({
        operationId: 'durable-worker-cancel',
        workerId: 'worker-1',
        reason: 'finished elsewhere',
      }),
    ).resolves.toMatchObject({ status: 'accepted', effect: 'cancel_requested' })
    expect(effects.workerCancels).toEqual([{ workerId: 'worker-1', reason: 'finished elsewhere' }])

    const beforeTerminal = await reconnectedClient.snapshot()
    route.close('cancelled')
    const terminal = await reconnectedClient
      .watch({ afterRevision: beforeTerminal?.revision, pollMs: 1 })
      [Symbol.asyncIterator]()
      .next()
    expect(terminal.value).toMatchObject({ status: 'cancelled' })
    const terminalRevision = terminal.value?.revision ?? 0

    const countsBeforeRestart = {
      steers: effects.steers.length,
      workerCancels: effects.workerCancels.length,
    }
    const resumedRoute = startSupervisorControlRoute({
      runDir: directory,
      runId: 'supervisor-run',
      capabilityToken: route.capabilityToken,
      snapshot: () => effects.tree,
      steer: effects.steer,
      cancelWorker: effects.cancelWorker,
      cancelSupervisor: effects.cancelSupervisor,
      pollMs: 2,
    })
    const resumedSnapshot = await reconnectedClient.snapshot()
    expect(resumedSnapshot?.revision).toBeGreaterThan(terminalRevision)
    expect(effects.steers).toHaveLength(countsBeforeRestart.steers)
    expect(effects.workerCancels).toHaveLength(countsBeforeRestart.workerCancels)
    resumedRoute.close('completed')

    const files = supervisorControlFiles(directory)
    expect(existsSync(files.commands)).toBe(true)
    expect(existsSync(files.acknowledgements)).toBe(true)
    expect(
      readFileSync(files.acknowledgements, 'utf8')
        .split('\n')
        .filter((line) => line.trim().length > 0),
    ).toHaveLength(2)
    expect(existsSync(join(directory, 'cancel.request.json'))).toBe(false)
    expect(() => createFileSupervisorControlClient(directory, { runId: 'another-run' })).toThrow(
      'does not match snapshot',
    )
  })

  it('returns unknown when no live route acknowledges a durable command', async () => {
    const route = startSupervisorControlRoute({
      runDir: directory,
      runId: 'offline-run',
      snapshot: () => emptyTree('offline-run'),
      effectReceiver: () => ({ status: 'rejected', effect: 'not_live' }),
    })
    route.close('completed')
    const client = createFileSupervisorControlClient(directory, {
      runId: 'offline-run',
      pollMs: 1,
      timeoutMs: 5,
      capabilityToken: route.capabilityToken,
    })
    await expect(
      client.cancel({ operationId: 'offline-cancel', reason: 'stop' }),
    ).resolves.toMatchObject({ status: 'unknown', effect: 'unknown' })
  })

  it.each(['completed', 'cancelled', 'failed'] as const)(
    'preserves %s after a durable route restart and rejects controls',
    async (terminalStatus) => {
      const effects = routeEffects()
      const route = startSupervisorControlRoute({
        runDir: directory,
        runId: 'terminal-restart-run',
        snapshot: () => emptyTree('terminal-restart-run'),
        effectReceiver: effects.effect,
        pollMs: 2,
      })
      route.close(terminalStatus)

      const restarted = startSupervisorControlRoute({
        runDir: directory,
        runId: 'terminal-restart-run',
        capabilityToken: route.capabilityToken,
        snapshot: () => emptyTree('terminal-restart-run'),
        effectReceiver: effects.effect,
        pollMs: 2,
      })
      const client = createFileSupervisorControlClient(directory, {
        pollMs: 1,
        timeoutMs: 500,
        capabilityToken: restarted.capabilityToken,
      })
      await expect(client.snapshot()).resolves.toMatchObject({ status: terminalStatus })
      await expect(
        client.steer({
          operationId: `steer-after-${terminalStatus}`,
          workerId: 'worker-1',
          message: 'must not be delivered',
        }),
      ).resolves.toMatchObject({
        status: 'rejected',
        effect: 'not_live',
        message: `supervisor run is already ${terminalStatus}`,
      })
      await expect(
        client.cancel({
          operationId: `cancel-after-${terminalStatus}`,
          reason: 'must not be delivered',
        }),
      ).resolves.toMatchObject({ status: 'rejected', effect: 'not_live' })
      expect(effects.steers).toHaveLength(0)
      expect(effects.rootCancels).toHaveLength(0)
      restarted.close('completed')
    },
  )

  it('keeps the capability out of the run directory and steering secrets out of logs', async () => {
    const effects = routeEffects()
    const route = startSupervisorControlRoute({
      runDir: directory,
      runId: 'authorized-run',
      snapshot: () => emptyTree('authorized-run'),
      effectReceiver: effects.effect,
      pollMs: 2,
    })
    const unauthorized = createFileSupervisorControlClient(directory, {
      pollMs: 1,
      timeoutMs: 20,
    })
    await expect(
      unauthorized.steer({
        operationId: 'unauthorized-operation',
        workerId: 'worker-1',
        message: 'same-UID attacker',
      }),
    ).resolves.toMatchObject({ status: 'rejected', effect: 'not_live' })
    expect(effects.steers).toHaveLength(0)
    expect(existsSync(supervisorControlFiles(directory).commands)).toBe(false)
    const capabilityRecord = readFileSync(supervisorControlFiles(directory).capability, 'utf8')
    const ownerRecord = readFileSync(supervisorControlFiles(directory).owner, 'utf8')
    expect(capabilityRecord).not.toContain(route.capabilityToken)
    expect(ownerRecord).not.toContain(route.capabilityToken)
    expect(capabilityRecord).not.toContain('"token"')
    expect(ownerRecord).not.toContain('"token"')

    const childResult = join(directory, 'unauthorized-child.json')
    const child = runControlChild('unauthorized', directory, childResult)
    await waitForFile(childResult)
    await expect(child).resolves.toMatchObject({ code: 0, signal: null })
    await expect(readFile(childResult, 'utf8')).resolves.toContain('capability does not match run')
    expect(existsSync(supervisorControlFiles(directory).commands)).toBe(false)

    const sentinel = 'CONTROL_STEERING_SECRET_SENTINEL'
    const authorized = createFileSupervisorControlClient(directory, {
      pollMs: 1,
      timeoutMs: 500,
      capabilityToken: route.capabilityToken,
    })
    await expect(
      authorized.steer({
        operationId: 'authorized-operation',
        workerId: 'worker-1',
        message: sentinel,
      }),
    ).resolves.toMatchObject({ status: 'accepted', effect: 'delivered' })
    const commandLog = readFileSync(supervisorControlFiles(directory).commands, 'utf8')
    expect(commandLog).not.toContain(sentinel)
    expect(commandLog).toContain('"payload"')
    expect(effects.steers).toEqual([{ workerId: 'worker-1', message: sentinel }])
    route.close('completed')
  })

  it('rejects symlinked control directories and command files', async () => {
    const targetDirectory = join(directory, 'symlink-target')
    mkdirSync(targetDirectory)
    symlinkSync(targetDirectory, join(directory, 'control'), 'dir')
    expect(() =>
      startSupervisorControlRoute({
        runDir: directory,
        runId: 'symlink-directory-run',
        snapshot: () => emptyTree('symlink-directory-run'),
      }),
    ).toThrow('cannot be a symlink')

    await rm(join(directory, 'control'), { force: true })
    const route = startSupervisorControlRoute({
      runDir: directory,
      runId: 'symlink-file-run',
      snapshot: () => emptyTree('symlink-file-run'),
      effectReceiver: () => ({ status: 'accepted', effect: 'delivered' }),
    })
    route.close('completed')
    const files = supervisorControlFiles(directory)
    const redirected = join(directory, 'redirected-commands.ndjson')
    writeFileSync(redirected, '', { mode: 0o600 })
    symlinkSync(redirected, files.commands)
    const client = createFileSupervisorControlClient(directory, {
      runId: 'symlink-file-run',
      capabilityToken: route.capabilityToken,
      pollMs: 1,
      timeoutMs: 50,
    })
    await expect(
      client.steer({
        operationId: 'symlink-write',
        workerId: 'worker-1',
        message: 'must not follow the link',
      }),
    ).rejects.toThrow(/ELOOP|symlink/)
    expect(readFileSync(redirected, 'utf8')).toBe('')
  })

  it('records an unknown effect after mutate-then-throw and never retries it', async () => {
    const effects = routeEffects()
    let throwAfterEffect = true
    const route = startSupervisorControlRoute({
      runDir: directory,
      runId: 'supervisor-run',
      snapshot: () => effects.tree,
      effectReceiver: (request) => {
        const result = effects.effect(request)
        if (throwAfterEffect) {
          throwAfterEffect = false
          throw new Error('response lost after effect')
        }
        return result
      },
      pollMs: 2,
    })
    const client = createFileSupervisorControlClient(directory, {
      pollMs: 2,
      timeoutMs: 500,
      capabilityToken: route.capabilityToken,
    })
    const first = await client.steer({
      operationId: 'mutate-then-throw',
      workerId: 'worker-1',
      message: 'deliver once',
    })
    expect(first).toMatchObject({ status: 'unknown', effect: 'unknown' })
    expect(effects.steers).toHaveLength(1)

    route.close('completed')
    const restarted = startSupervisorControlRoute({
      runDir: directory,
      runId: 'supervisor-run',
      capabilityToken: route.capabilityToken,
      snapshot: () => effects.tree,
      effectReceiver: effects.effect,
      pollMs: 2,
    })
    await expect(
      client.steer({
        operationId: 'mutate-then-throw',
        workerId: 'worker-1',
        message: 'deliver once',
      }),
    ).resolves.toMatchObject({ status: 'unknown', effect: 'unknown' })
    expect(effects.steers).toHaveLength(1)
    restarted.close('completed')
  })

  it('replays a committed effect result when its acknowledgement was lost', async () => {
    const effects = routeEffects()
    const route = startSupervisorControlRoute({
      runDir: directory,
      runId: 'supervisor-run',
      snapshot: () => effects.tree,
      effectReceiver: effects.effect,
      pollMs: 2,
    })
    const client = createFileSupervisorControlClient(directory, {
      pollMs: 2,
      timeoutMs: 500,
      capabilityToken: route.capabilityToken,
    })
    const original = await client.steer({
      operationId: 'lost-ack',
      workerId: 'worker-1',
      message: 'replay the stored result',
    })
    expect(original).toMatchObject({ status: 'accepted', effect: 'delivered' })
    expect(effects.steers).toHaveLength(1)
    route.close('completed')
    unlinkSync(supervisorControlFiles(directory).acknowledgements)

    const restarted = startSupervisorControlRoute({
      runDir: directory,
      runId: 'supervisor-run',
      capabilityToken: route.capabilityToken,
      snapshot: () => effects.tree,
      effectReceiver: effects.effect,
      pollMs: 2,
    })
    await expect(
      client.steer({
        operationId: 'lost-ack',
        workerId: 'worker-1',
        message: 'replay the stored result',
      }),
    ).resolves.toMatchObject({ status: 'accepted', effect: 'delivered' })
    expect(effects.steers).toHaveLength(1)
    restarted.close('completed')
  })

  it('retries one operation after a delayed acknowledgement without a second delivery', async () => {
    const effects = routeEffects()
    const route = startSupervisorControlRoute({
      runDir: directory,
      runId: 'supervisor-run',
      snapshot: () => effects.tree,
      effectReceiver: effects.effect,
      pollMs: 10_000,
    })
    const client = createFileSupervisorControlClient(directory, {
      pollMs: 1,
      timeoutMs: 2,
      capabilityToken: route.capabilityToken,
    })
    const timedOut = await client.steer({
      operationId: 'delayed-ack',
      workerId: 'worker-1',
      message: 'retry the same operation',
    })
    expect(timedOut).toMatchObject({ status: 'unknown', effect: 'unknown' })
    route.refresh()
    await expect(
      client.steer({
        operationId: 'delayed-ack',
        workerId: 'worker-1',
        message: 'retry the same operation',
      }),
    ).resolves.toMatchObject({ status: 'accepted', effect: 'delivered' })
    expect(effects.steers).toHaveLength(1)
    route.close('completed')
  })

  it('allows only one live route to own a run directory', async () => {
    const effects = routeEffects()
    const options = {
      runDir: directory,
      runId: 'supervisor-run',
      capabilityToken: 'single-owner-capability',
      snapshot: () => effects.tree,
      steer: effects.steer,
      cancelWorker: effects.cancelWorker,
      cancelSupervisor: effects.cancelSupervisor,
      pollMs: 2,
    }
    const route = startSupervisorControlRoute(options)
    expect(() => startSupervisorControlRoute(options)).toThrow('already owned by process')

    const client = createFileSupervisorControlClient(directory, {
      pollMs: 2,
      timeoutMs: 500,
      capabilityToken: route.capabilityToken,
    })
    await expect(
      client.steer({
        operationId: 'single-owner-steer',
        workerId: 'worker-1',
        message: 'exactly once',
      }),
    ).resolves.toMatchObject({ status: 'accepted', effect: 'delivered' })
    expect(effects.steers).toEqual([{ workerId: 'worker-1', message: 'exactly once' }])

    route.close('completed')
    expect(JSON.parse(readFileSync(supervisorControlFiles(directory).owner, 'utf8'))).toMatchObject(
      {
        state: 'released',
        runId: 'supervisor-run',
      },
    )
  })

  it('wins exactly one cross-process ownership race', async () => {
    const start = join(directory, 'race-start')
    const release = join(directory, 'race-release')
    const firstReady = join(directory, 'race-first.ready')
    const secondReady = join(directory, 'race-second.ready')
    const firstResult = join(directory, 'race-first.json')
    const secondResult = join(directory, 'race-second.json')
    const first = runControlChild(
      'owner-race',
      directory,
      'race-run',
      firstReady,
      start,
      release,
      firstResult,
      'race-capability-delivered-out-of-band',
    )
    const second = runControlChild(
      'owner-race',
      directory,
      'race-run',
      secondReady,
      start,
      release,
      secondResult,
      'race-capability-delivered-out-of-band',
    )
    await Promise.all([waitForFile(firstReady), waitForFile(secondReady)])
    writeFileSync(start, 'go\n', { mode: 0o600 })
    await Promise.all([waitForFile(firstResult), waitForFile(secondResult)])
    const results = await Promise.all([
      readFile(firstResult, 'utf8').then(
        (value) => JSON.parse(value) as { status: string; message?: string },
      ),
      readFile(secondResult, 'utf8').then(
        (value) => JSON.parse(value) as { status: string; message?: string },
      ),
    ])
    expect(results.filter((result) => result.status === 'started')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'failed')).toHaveLength(1)
    expect(results.find((result) => result.status === 'failed')?.message).toContain('already owned')
    writeFileSync(release, 'done\n', { mode: 0o600 })
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ code: 0, signal: null }),
      expect.objectContaining({ code: 0, signal: null }),
    ])
  })

  it('publishes unknown after SIGKILL and requires an explicit live rebind', async () => {
    const ready = join(directory, 'crash-owner.ready')
    const child = runControlChild(
      'crash-owner',
      directory,
      'dead-owner-run',
      ready,
      '',
      '',
      '',
      'dead-owner-capability',
    )
    await waitForFile(ready)
    const pid = Number(readFileSync(ready, 'utf8').trim())
    process.kill(pid, 'SIGKILL')
    await expect(child).resolves.toMatchObject({ signal: 'SIGKILL' })

    const effects = routeEffects()
    const route = startSupervisorControlRoute({
      runDir: directory,
      runId: 'dead-owner-run',
      capabilityToken: 'dead-owner-capability',
      snapshot: () => ({ ...effects.tree, root: 'dead-owner-run' }),
      effectReceiver: effects.effect,
      pollMs: 2,
    })
    const client = createFileSupervisorControlClient(directory, {
      pollMs: 1,
      timeoutMs: 500,
      capabilityToken: route.capabilityToken,
    })
    await expect(client.snapshot()).resolves.toMatchObject({ status: 'unknown' })
    const pendingCancel = client.cancel({
      operationId: 'dead-owner-cancel',
      reason: 'must wait for rebind',
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(effects.rootCancels).toHaveLength(0)
    route.rebind()
    await expect(pendingCancel).resolves.toMatchObject({
      status: 'accepted',
      effect: 'cancel_requested',
    })
    await expect(client.snapshot()).resolves.toMatchObject({ status: 'running' })
    await expect(
      client.cancel({ operationId: 'dead-owner-cancel', reason: 'must wait for rebind' }),
    ).resolves.toMatchObject({ status: 'accepted', effect: 'cancel_requested' })
    await expect(
      client.cancel({ operationId: 'after-live-rebind', reason: 'stop now' }),
    ).resolves.toMatchObject({ status: 'accepted', effect: 'cancel_requested' })
    expect(effects.rootCancels).toEqual(['must wait for rebind', 'stop now'])
    route.close('completed')
  })

  it('releases ownership when explicit rebind fails before the route becomes live', async () => {
    const seeded = startSupervisorControlRoute({
      runDir: directory,
      runId: 'rebind-failure-run',
      capabilityToken: 'rebind-failure-capability',
      snapshot: () => ({
        root: 'rebind-failure-run',
        nodes: [],
        inFlight: 0,
        waiting: 0,
      }),
      effectReceiver: () => ({ status: 'accepted', effect: 'cancel_requested' }),
      pollMs: 2,
    })
    seeded.close('completed')
    const seededFiles = supervisorControlFiles(directory)
    writeFileSync(
      seededFiles.snapshot,
      `${JSON.stringify({
        version: 1,
        runId: 'rebind-failure-run',
        revision: 99,
        status: 'unknown',
        observedAt: new Date().toISOString(),
        tree: { root: 'rebind-failure-run', nodes: [], inFlight: 0, waiting: 0 },
      })}\n`,
    )

    let snapshotCalls = 0
    const failed = startSupervisorControlRoute({
      runDir: directory,
      runId: 'rebind-failure-run',
      capabilityToken: 'rebind-failure-capability',
      snapshot: () => {
        snapshotCalls += 1
        if (snapshotCalls > 2) throw new Error('rebind snapshot failed')
        return {
          root: 'rebind-failure-run',
          nodes: [],
          inFlight: 0,
          waiting: 0,
        }
      },
      effectReceiver: () => ({ status: 'accepted', effect: 'cancel_requested' }),
      pollMs: 2,
    })

    await expect(Promise.resolve().then(() => failed.rebind())).rejects.toThrow(
      'rebind snapshot failed',
    )
    await expect(Promise.resolve().then(() => failed.close('failed'))).rejects.toThrow(
      'explicit live rebind',
    )

    const replacement = startSupervisorControlRoute({
      runDir: directory,
      runId: 'rebind-failure-run',
      capabilityToken: 'rebind-failure-capability',
      snapshot: () => ({
        root: 'rebind-failure-run',
        nodes: [],
        inFlight: 0,
        waiting: 0,
      }),
      effectReceiver: () => ({ status: 'accepted', effect: 'cancel_requested' }),
      pollMs: 2,
    })
    replacement.rebind()
    replacement.close('failed')
  })

  it('allows exactly one replacement after a dead owner releases its operating-system lock', async () => {
    const crashedReady = join(directory, 'dead-race-owner.ready')
    const crashed = runControlChild(
      'crash-owner',
      directory,
      'dead-race-run',
      crashedReady,
      '',
      '',
      '',
      'dead-race-capability',
    )
    await waitForFile(crashedReady)
    process.kill(Number(readFileSync(crashedReady, 'utf8').trim()), 'SIGKILL')
    await expect(crashed).resolves.toMatchObject({ signal: 'SIGKILL' })

    const start = join(directory, 'dead-race-start')
    const release = join(directory, 'dead-race-release')
    const firstReady = join(directory, 'dead-race-first.ready')
    const secondReady = join(directory, 'dead-race-second.ready')
    const firstResult = join(directory, 'dead-race-first.json')
    const secondResult = join(directory, 'dead-race-second.json')
    const first = runControlChild(
      'owner-race',
      directory,
      'dead-race-run',
      firstReady,
      start,
      release,
      firstResult,
      'dead-race-capability',
    )
    const second = runControlChild(
      'owner-race',
      directory,
      'dead-race-run',
      secondReady,
      start,
      release,
      secondResult,
      'dead-race-capability',
    )
    await Promise.all([waitForFile(firstReady), waitForFile(secondReady)])
    writeFileSync(start, 'go\n', { mode: 0o600 })
    await Promise.all([waitForFile(firstResult), waitForFile(secondResult)])
    const results = [firstResult, secondResult].map(
      (file) => JSON.parse(readFileSync(file, 'utf8')) as { status: string },
    )
    expect(results.filter((result) => result.status === 'started')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'failed')).toHaveLength(1)

    writeFileSync(release, 'done\n', { mode: 0o600 })
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ code: 0, signal: null }),
      expect.objectContaining({ code: 0, signal: null }),
    ])
  })

  it.runIf(process.platform === 'linux')(
    'does not treat a reused PID with a different Linux process identity as a live owner',
    () => {
      const route = startSupervisorControlRoute({
        runDir: directory,
        runId: 'pid-reuse-run',
        snapshot: () => emptyTree('pid-reuse-run'),
        effectReceiver: () => ({ status: 'rejected', effect: 'not_live' }),
      })
      const files = supervisorControlFiles(directory)
      const capabilityDigest = JSON.parse(readFileSync(files.capability, 'utf8'))
        .capabilityDigest as string
      const capabilityToken = route.capabilityToken
      route.close('completed')
      writeFileSync(
        files.owner,
        JSON.stringify({
          version: 3,
          ownerId: 'stale-owner-id',
          runId: 'pid-reuse-run',
          pid: process.pid,
          startIdentity: 'definitely-not-this-process',
          capabilityDigest,
          acquiredAt: new Date().toISOString(),
          state: 'owned',
        }),
        { mode: 0o600 },
      )

      const recovered = startSupervisorControlRoute({
        runDir: directory,
        runId: 'pid-reuse-run',
        capabilityToken,
        snapshot: () => emptyTree('pid-reuse-run'),
        effectReceiver: () => ({ status: 'rejected', effect: 'not_live' }),
      })
      expect(readFileSync(files.owner, 'utf8')).toContain('"pid"')
      recovered.close('completed')
    },
  )

  it('rejects a snapshot for another tree and releases an attached handle on route failure', async () => {
    expect(() =>
      startSupervisorControlRoute({
        runDir: directory,
        runId: 'expected-run',
        snapshot: () => emptyTree('another-run'),
        effectReceiver: () => ({ status: 'rejected', effect: 'not_live' }),
      }),
    ).toThrow('does not match run')
    expect(existsSync(supervisorControlFiles(directory).owner)).toBe(false)

    const blocker = startSupervisorControlRoute({
      runDir: directory,
      runId: 'blocked-run',
      snapshot: () => emptyTree('blocked-run'),
      effectReceiver: () => ({ status: 'rejected', effect: 'not_live' }),
    })
    const handle = createRootHandle<string>()
    const supervisor = createSupervisor<unknown, string>()
    supervisor.attach(handle)
    const root: Agent<unknown, string> = {
      name: 'root',
      act: async () => 'done',
    }
    await expect(
      supervisor.run(root, 'work', {
        budget: { maxIterations: 1, maxTokens: 10 },
        runId: 'blocked-run',
        journal: new InMemorySpawnJournal(),
        blobs: new InMemoryResultBlobStore(),
        executors: createExecutorRegistry(),
        controlDir: directory,
        controlCapabilityToken: blocker.capabilityToken,
      }),
    ).rejects.toThrow('already owned by process')
    expect(() => handle.view()).toThrow('handle is not bound to a live run')
    blocker.close('completed')
  })

  it('rejects queued controls once the run has reached a terminal state', async () => {
    const effects = routeEffects()
    const route = startSupervisorControlRoute({
      runDir: directory,
      runId: 'supervisor-run',
      snapshot: () => effects.tree,
      steer: effects.steer,
      cancelWorker: effects.cancelWorker,
      cancelSupervisor: effects.cancelSupervisor,
      pollMs: 10_000,
    })
    const client = createFileSupervisorControlClient(directory, {
      pollMs: 1,
      timeoutMs: 500,
      capabilityToken: route.capabilityToken,
    })
    const pending = client.cancel({ operationId: 'terminal-race', reason: 'too late' })
    route.close('completed')

    await expect(pending).resolves.toMatchObject({
      status: 'rejected',
      effect: 'not_live',
      message: 'supervisor run is already completed',
    })
    expect(effects.rootCancels).toHaveLength(0)
  })

  it('fails loudly when an existing snapshot is corrupt', () => {
    const effects = routeEffects()
    const route = startSupervisorControlRoute({
      runDir: directory,
      runId: 'supervisor-run',
      snapshot: () => effects.tree,
      steer: effects.steer,
      cancelWorker: effects.cancelWorker,
      cancelSupervisor: effects.cancelSupervisor,
    })
    route.close('completed')
    const files = supervisorControlFiles(directory)
    writeFileSync(files.snapshot, '{not-json', 'utf8')
    chmodSync(files.snapshot, 0o600)
    expect(() => createFileSupervisorControlClient(directory, { runId: 'supervisor-run' })).toThrow(
      'snapshot is not valid JSON',
    )
  })

  it('recovers after a partial command record and rejects invalid input before appending', async () => {
    const effects = routeEffects()
    const route = startSupervisorControlRoute({
      runDir: directory,
      runId: 'supervisor-run',
      snapshot: () => effects.tree,
      steer: effects.steer,
      cancelWorker: effects.cancelWorker,
      cancelSupervisor: effects.cancelSupervisor,
      pollMs: 2,
    })
    const files = supervisorControlFiles(directory)
    appendFileSync(files.commands, '{"kind":"steer"', 'utf8')
    chmodSync(files.commands, 0o600)
    const client = createFileSupervisorControlClient(directory, {
      pollMs: 2,
      timeoutMs: 500,
      capabilityToken: route.capabilityToken,
    })

    await expect(
      client.steer({
        operationId: 'after-partial-write',
        workerId: 'worker-1',
        message: 'continue safely',
      }),
    ).resolves.toMatchObject({ status: 'accepted', effect: 'delivered' })
    expect(effects.steers).toEqual([{ workerId: 'worker-1', message: 'continue safely' }])

    const beforeInvalid = readFileSync(files.commands, 'utf8')
    expect(() =>
      client.cancel({ operationId: 'invalid-timeout', timeoutMs: 0, reason: 'stop' }),
    ).toThrow('supervisor command timeout must be a positive safe integer')
    expect(() =>
      client.steer({
        operationId: 'invalid-source',
        workerId: 'worker-1',
        message: 'ignored',
        source: ' ',
      }),
    ).toThrow('supervisor command source must be non-empty')
    expect(readFileSync(files.commands, 'utf8')).toBe(beforeInvalid)
    route.close('completed')
  })

  it('truncates an interrupted command tail after earlier durable commands', async () => {
    const effects = routeEffects()
    const route = startSupervisorControlRoute({
      runDir: directory,
      runId: 'partial-tail-run',
      snapshot: () => ({ ...effects.tree, root: 'partial-tail-run' }),
      steer: effects.steer,
      cancelWorker: effects.cancelWorker,
      cancelSupervisor: effects.cancelSupervisor,
      pollMs: 2,
    })
    const files = supervisorControlFiles(directory)
    const client = createFileSupervisorControlClient(directory, {
      pollMs: 2,
      timeoutMs: 500,
      capabilityToken: route.capabilityToken,
      runId: 'partial-tail-run',
    })
    await expect(
      client.steer({ operationId: 'before-partial', workerId: 'worker-1', message: 'first' }),
    ).resolves.toMatchObject({ status: 'accepted', effect: 'delivered' })
    appendFileSync(files.commands, '{"kind":"steer"', 'utf8')
    chmodSync(files.commands, 0o600)

    await expect(
      client.steer({ operationId: 'after-partial', workerId: 'worker-1', message: 'second' }),
    ).resolves.toMatchObject({ status: 'accepted', effect: 'delivered' })
    expect(effects.steers).toEqual([
      { workerId: 'worker-1', message: 'first' },
      { workerId: 'worker-1', message: 'second' },
    ])
    route.close('completed')
  })

  it('rejects encrypted commands with ignored payload fields', () => {
    const token = 'payload-shape-secret'
    const command = steerCommand(
      'payload-shape-run',
      {
        operationId: 'payload-shape-operation',
        workerId: 'worker-1',
        message: 'deliver only this field',
      },
      Date.now,
    )
    const wire = serializeCommand(command, token)
    const forged = {
      ...wire,
      payload: encryptCommandPayload(
        { message: 'deliver only this field', ignored: 'must not be accepted' },
        token,
      ),
      authorization: commandAuthorization(token, command.commandDigest),
    }
    expect(deserializeCommand(forged, token)).toBeUndefined()
    expect(isCommand({ ...command, ignored: 'must be rejected' })).toBe(false)
  })

  it('fails closed on a corrupt acknowledgement log during route recovery', async () => {
    const route = startSupervisorControlRoute({
      runDir: directory,
      runId: 'corrupt-ack-run',
      snapshot: () => emptyTree('corrupt-ack-run'),
      effectReceiver: () => ({ status: 'accepted', effect: 'delivered' }),
    })
    route.close('completed')
    const files = supervisorControlFiles(directory)
    appendFileSync(files.acknowledgements, `${JSON.stringify({ forged: true })}\n`, 'utf8')
    chmodSync(files.acknowledgements, 0o600)
    expect(() =>
      startSupervisorControlRoute({
        runDir: directory,
        runId: 'corrupt-ack-run',
        capabilityToken: route.capabilityToken,
        snapshot: () => emptyTree('corrupt-ack-run'),
        effectReceiver: () => ({ status: 'accepted', effect: 'delivered' }),
      }),
    ).toThrow('acknowledgement log is corrupt')
    await expect(readFile(supervisorControlFiles(directory).owner, 'utf8')).resolves.toContain(
      '"state":"released"',
    )
  })

  it('fails closed on conflicting durable effect records', async () => {
    const route = startSupervisorControlRoute({
      runDir: directory,
      runId: 'conflicting-effect-run',
      snapshot: () => emptyTree('conflicting-effect-run'),
      effectReceiver: () => ({ status: 'accepted', effect: 'delivered' }),
    })
    route.close('completed')
    const files = supervisorControlFiles(directory)
    writeFileSync(
      files.effects,
      `${JSON.stringify({ version: 1, operationId: 'op', commandDigest: 'digest-a', status: 'started' })}\n${JSON.stringify({ version: 1, operationId: 'op', commandDigest: 'digest-b', status: 'completed' })}\n`,
      'utf8',
    )
    chmodSync(files.effects, 0o600)
    await expect(
      Promise.resolve().then(() =>
        startSupervisorControlRoute({
          runDir: directory,
          runId: 'conflicting-effect-run',
          capabilityToken: route.capabilityToken,
          snapshot: () => emptyTree('conflicting-effect-run'),
          effectReceiver: () => ({ status: 'accepted', effect: 'delivered' }),
        }),
      ),
    ).rejects.toThrow('effect log has conflicting records')
    await expect(readFile(files.owner, 'utf8')).resolves.toContain('"state":"released"')
  })

  it('fails closed on duplicate started effect records', async () => {
    const route = startSupervisorControlRoute({
      runDir: directory,
      runId: 'duplicate-started-effect-run',
      snapshot: () => emptyTree('duplicate-started-effect-run'),
      effectReceiver: () => ({ status: 'accepted', effect: 'delivered' }),
    })
    route.close('completed')
    const files = supervisorControlFiles(directory)
    writeFileSync(
      files.effects,
      `${JSON.stringify({ version: 1, operationId: 'op', commandDigest: 'digest', status: 'started' })}\n${JSON.stringify({ version: 1, operationId: 'op', commandDigest: 'digest', status: 'started' })}\n`,
      'utf8',
    )
    chmodSync(files.effects, 0o600)
    await expect(
      Promise.resolve().then(() =>
        startSupervisorControlRoute({
          runDir: directory,
          runId: 'duplicate-started-effect-run',
          capabilityToken: route.capabilityToken,
          snapshot: () => emptyTree('duplicate-started-effect-run'),
          effectReceiver: () => ({ status: 'accepted', effect: 'delivered' }),
        }),
      ),
    ).rejects.toThrow('effect log has invalid ordering')
    await expect(readFile(files.owner, 'utf8')).resolves.toContain('"state":"released"')
  })

  it('fails closed when a durable effect acknowledgement targets another worker', async () => {
    const route = startSupervisorControlRoute({
      runDir: directory,
      runId: 'effect-target-binding-run',
      snapshot: () => emptyTree('effect-target-binding-run'),
      effectReceiver: () => ({ status: 'accepted', effect: 'delivered' }),
    })
    route.close('completed')
    const files = supervisorControlFiles(directory)
    const command = steerCommand(
      'effect-target-binding-run',
      { operationId: 'effect-target-op', workerId: 'worker-a', message: 'continue' },
      Date.now,
    )
    appendFileSync(
      files.commands,
      `${JSON.stringify(serializeCommand(command, route.capabilityToken))}\n`,
      'utf8',
    )
    writeFileSync(
      files.effects,
      `${JSON.stringify({
        version: 1,
        operationId: command.operationId,
        commandDigest: command.commandDigest,
        status: 'completed',
        acknowledgement: {
          operationId: command.operationId,
          commandDigest: command.commandDigest,
          target: { kind: 'worker', runId: 'effect-target-binding-run', workerId: 'worker-b' },
          status: 'accepted',
          effect: 'delivered',
          acknowledgedAt: new Date().toISOString(),
        },
      })}\n`,
      'utf8',
    )
    chmodSync(files.commands, 0o600)
    chmodSync(files.effects, 0o600)
    await expect(
      Promise.resolve().then(() =>
        startSupervisorControlRoute({
          runDir: directory,
          runId: 'effect-target-binding-run',
          capabilityToken: route.capabilityToken,
          snapshot: () => emptyTree('effect-target-binding-run'),
          effectReceiver: () => ({ status: 'accepted', effect: 'delivered' }),
        }),
      ),
    ).rejects.toThrow('effect acknowledgement targets another command')
    await expect(readFile(files.owner, 'utf8')).resolves.toContain('"state":"released"')
  })

  it('fails closed on acknowledgements that reuse an operation id for another command', async () => {
    const route = startSupervisorControlRoute({
      runDir: directory,
      runId: 'conflicting-ack-identity-run',
      snapshot: () => emptyTree('conflicting-ack-identity-run'),
      effectReceiver: () => ({ status: 'accepted', effect: 'delivered' }),
    })
    route.close('completed')
    const files = supervisorControlFiles(directory)
    const base = {
      operationId: 'same-operation',
      target: { kind: 'supervisor' as const, runId: 'conflicting-ack-identity-run' },
      status: 'accepted' as const,
      effect: 'delivered' as const,
      acknowledgedAt: new Date().toISOString(),
    }
    writeFileSync(
      files.acknowledgements,
      `${JSON.stringify({ ...base, commandDigest: 'digest-a' })}\n${JSON.stringify({ ...base, commandDigest: 'digest-b' })}\n`,
      'utf8',
    )
    chmodSync(files.acknowledgements, 0o600)
    await expect(
      Promise.resolve().then(() =>
        startSupervisorControlRoute({
          runDir: directory,
          runId: 'conflicting-ack-identity-run',
          capabilityToken: route.capabilityToken,
          snapshot: () => emptyTree('conflicting-ack-identity-run'),
          effectReceiver: () => ({ status: 'accepted', effect: 'delivered' }),
        }),
      ),
    ).rejects.toThrow('conflicting operation identities')
    await expect(readFile(files.owner, 'utf8')).resolves.toContain('"state":"released"')
  })

  it('fails closed when a durable effect terminal record is followed by another terminal state', async () => {
    const route = startSupervisorControlRoute({
      runDir: directory,
      runId: 'invalid-effect-order-run',
      snapshot: () => emptyTree('invalid-effect-order-run'),
      effectReceiver: () => ({ status: 'accepted', effect: 'delivered' }),
    })
    route.close('completed')
    const files = supervisorControlFiles(directory)
    writeFileSync(
      files.effects,
      `${JSON.stringify({ version: 1, operationId: 'op', commandDigest: 'digest', status: 'unknown', acknowledgement: { operationId: 'op', commandDigest: 'digest', target: { kind: 'supervisor', runId: 'invalid-effect-order-run' }, status: 'unknown', effect: 'unknown', acknowledgedAt: new Date().toISOString() } })}\n${JSON.stringify({ version: 1, operationId: 'op', commandDigest: 'digest', status: 'completed', acknowledgement: { operationId: 'op', commandDigest: 'digest', target: { kind: 'supervisor', runId: 'invalid-effect-order-run' }, status: 'accepted', effect: 'delivered', acknowledgedAt: new Date().toISOString() } })}\n`,
      'utf8',
    )
    chmodSync(files.effects, 0o600)
    await expect(
      Promise.resolve().then(() =>
        startSupervisorControlRoute({
          runDir: directory,
          runId: 'invalid-effect-order-run',
          capabilityToken: route.capabilityToken,
          snapshot: () => emptyTree('invalid-effect-order-run'),
          effectReceiver: () => ({ status: 'accepted', effect: 'delivered' }),
        }),
      ),
    ).rejects.toThrow('effect log has invalid ordering')
    await expect(readFile(files.owner, 'utf8')).resolves.toContain('"state":"released"')
  })

  it('controls live workers and the root through the running supervisor', async () => {
    const delivered: Array<{ worker: string; message: unknown }> = []
    const aborted: Array<{ worker: string; reason: unknown }> = []
    const startedResolvers = new Map<string, () => void>()
    const started = ['first', 'second'].map(
      (worker) =>
        new Promise<void>((resolve) => {
          startedResolvers.set(worker, resolve)
        }),
    )

    const blockedWorker = (worker: string): Agent<unknown, unknown> => {
      const executor: Executor<unknown> = {
        runtime: 'router',
        execute(_task, signal): Promise<ExecutorResult<unknown>> {
          startedResolvers.get(worker)?.()
          return new Promise((_resolve, reject) => {
            const onAbort = () => {
              aborted.push({ worker, reason: signal.reason })
              reject(new DOMException(String(signal.reason), 'AbortError'))
            }
            if (signal.aborted) onAbort()
            else signal.addEventListener('abort', onAbort, { once: true })
          })
        },
        deliver(message) {
          delivered.push({ worker, message })
          return true
        },
        teardown: async () => ({ destroyed: true }),
        resultArtifact() {
          throw new Error('cancelled worker has no result')
        },
      }
      const executorSpec: AgentSpec = {
        profile: { name: worker } as AgentProfile,
        harness: null,
        executor,
      }
      return { name: worker, act: async () => undefined, executorSpec } as Agent<
        unknown,
        unknown
      > & {
        executorSpec: AgentSpec
      }
    }

    const root: Agent<unknown, unknown> = {
      name: 'root',
      async act(task, scope) {
        for (const worker of ['first', 'second']) {
          const spawned = scope.spawn(blockedWorker(worker), task, {
            budget: { maxIterations: 2, maxTokens: 100 },
            label: worker,
          })
          if (!spawned.ok) throw new Error(spawned.reason)
        }
        await scope.next()
        await scope.next()
        return 'unexpected completion'
      },
    }
    const capabilityToken = 'live-control-secret-delivered-out-of-band'
    const running = createSupervisor<unknown, unknown>().run(root, 'work', {
      budget: { maxIterations: 10, maxTokens: 1_000 },
      runId: 'live-control',
      journal: new InMemorySpawnJournal(),
      blobs: new InMemoryResultBlobStore(),
      executors: createExecutorRegistry(),
      controlDir: directory,
      controlCapabilityToken: capabilityToken,
    })

    await Promise.all(started)
    const client = createFileSupervisorControlClient(directory, {
      pollMs: 2,
      timeoutMs: 1_000,
      capabilityToken,
    })
    await expect.poll(async () => (await client.snapshot())?.tree.inFlight).toBe(2)
    const live = await client.snapshot()
    expect(live).toMatchObject({ runId: 'live-control', status: 'running', tree: { inFlight: 2 } })
    const firstId = live?.tree.nodes.find((node) => node.label === 'first')?.id
    const secondId = live?.tree.nodes.find((node) => node.label === 'second')?.id
    expect(firstId).toBe('live-control:s0')
    expect(secondId).toBe('live-control:s1')

    await expect(
      client.steer({
        operationId: 'live-steer',
        workerId: firstId ?? '',
        message: { instruction: 'inspect the parser' },
      }),
    ).resolves.toMatchObject({ status: 'accepted', effect: 'delivered' })
    expect(delivered).toEqual([{ worker: 'first', message: { instruction: 'inspect the parser' } }])

    await expect(
      client.cancel({
        operationId: 'live-worker-cancel',
        workerId: firstId,
        reason: 'replace this worker',
      }),
    ).resolves.toMatchObject({ status: 'accepted', effect: 'cancel_requested' })
    await expect
      .poll(() => aborted.find((entry) => entry.worker === 'first'))
      .toMatchObject({
        reason: 'replace this worker',
      })

    await expect(
      client.cancel({ operationId: 'live-root-cancel', reason: 'stop the run' }),
    ).resolves.toMatchObject({ status: 'accepted', effect: 'cancel_requested' })
    const result = await running
    expect(result).toMatchObject({ kind: 'no-winner', reason: 'aborted' })
    expect(aborted).toContainEqual({ worker: 'second', reason: 'stop the run' })
    await expect(client.snapshot()).resolves.toMatchObject({
      runId: 'live-control',
      status: 'cancelled',
      tree: { inFlight: 0 },
    })
  })
})

function rootFixture(): {
  handle: ControllableRootHandle<unknown>
  tree: TreeView
  steers: Array<{ workerId: string; message: unknown }>
  workerCancels: Array<{ workerId: string; reason?: string }>
  rootCancels: Array<string | undefined>
} {
  const fixture = {
    tree: emptyTree(),
    steers: [] as Array<{ workerId: string; message: unknown }>,
    workerCancels: [] as Array<{ workerId: string; reason?: string }>,
    rootCancels: [] as Array<string | undefined>,
  }
  const handle: ControllableRootHandle<unknown> = {
    view: () => fixture.tree,
    steer(workerId, message) {
      if (workerId !== 'worker-1') return false
      fixture.steers.push({ workerId, message })
      return true
    },
    cancelWorker(workerId, reason) {
      if (workerId !== 'worker-1') return false
      fixture.workerCancels.push({ workerId, ...(reason === undefined ? {} : { reason }) })
      return true
    },
    signal(message) {
      fixture.rootCancels.push(message.kind === 'cancel' ? message.reason : undefined)
    },
    abort(reason) {
      fixture.rootCancels.push(reason)
    },
  }
  return {
    get tree() {
      return fixture.tree
    },
    set tree(value: TreeView) {
      fixture.tree = value
    },
    steers: fixture.steers,
    workerCancels: fixture.workerCancels,
    rootCancels: fixture.rootCancels,
    handle,
  }
}

function routeEffects() {
  const effects = {
    tree: emptyTree(),
    steers: [] as Array<{ workerId: string; message: unknown }>,
    workerCancels: [] as Array<{ workerId: string; reason?: string }>,
    rootCancels: [] as Array<string | undefined>,
  }
  return {
    ...effects,
    steer(workerId: string, message: unknown) {
      if (workerId !== 'worker-1') return false
      effects.steers.push({ workerId, message })
      return true
    },
    cancelWorker(workerId: string, reason?: string) {
      if (workerId !== 'worker-1') return false
      effects.workerCancels.push({ workerId, ...(reason === undefined ? {} : { reason }) })
      return true
    },
    cancelSupervisor(reason?: string) {
      effects.rootCancels.push(reason)
      return true
    },
    effect(request: SupervisorControlEffectRequest): SupervisorControlEffectResult {
      if (request.kind === 'steer') {
        const accepted = request.target.kind === 'worker' && request.target.workerId === 'worker-1'
        if (accepted)
          effects.steers.push({ workerId: request.target.workerId, message: request.message })
        return accepted
          ? { status: 'accepted', effect: 'delivered' }
          : { status: 'rejected', effect: 'not_live' }
      }
      if (request.target.kind === 'worker') {
        const accepted = request.target.workerId === 'worker-1'
        if (accepted) {
          effects.workerCancels.push({
            workerId: request.target.workerId,
            ...(request.reason === undefined ? {} : { reason: request.reason }),
          })
        }
        return accepted
          ? { status: 'accepted', effect: 'cancel_requested' }
          : { status: 'rejected', effect: 'not_live' }
      }
      effects.rootCancels.push(request.reason)
      const accepted = true
      return accepted
        ? { status: 'accepted', effect: 'cancel_requested' }
        : { status: 'rejected', effect: 'not_live' }
    },
  }
}

function emptyTree(root = 'supervisor-run'): TreeView {
  return { root, nodes: [], inFlight: 0, waiting: 0 }
}
