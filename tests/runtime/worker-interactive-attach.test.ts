/**
 * Attaching a human terminal to the exact process ONE supervised worker is running in.
 *
 * The failure this guards is the one issue #773 names: a client that cannot reach a selected
 * child, or that is handed something that merely looks like an attachment — a second process
 * resuming the same conversation, or a headless run dressed up as a terminal. `scope.interactive`
 * therefore either returns THAT child's session, or says why there is none.
 */

import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type AgentInteractiveSessionAttach,
  type AgentInteractiveSessionControlClaim,
  type AgentInteractiveSessionRef,
  AgentInteractiveSessionRefSchema,
  type AgentInteractiveSessionStart,
  type AgentInteractiveTerminalSession,
  agentInteractiveSessionControlClaimRequestDigest,
  canonicalCandidateDigest,
  type TerminalOutputEvent,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentCapabilities,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FileResultBlobStore,
  FileSpawnJournal,
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
} from '../../src/durable/spawn-journal'
import { startRetainedInteractiveRun } from '../../src/runtime/retained-run'
import { createBudgetPool } from '../../src/runtime/supervise/budget'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createScope } from '../../src/runtime/supervise/scope'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  Scope,
  UsageEvent,
  WorkerInteractiveSession,
} from '../../src/runtime/supervise/types'
import {
  attachWorker,
  workerInteractiveBindingFile,
  writeWorkerInteractiveBinding,
} from '../../src/runtime/supervise/worker-interactive'
import { testAgentProfile } from '../kernel/test-agent-profile'

const budget: Budget = { maxIterations: 50, maxTokens: 100_000 }
const cleanups: string[] = []

afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'worker-interactive-'))
  cleanups.push(dir)
  return dir
}

function digest(seed: string): `sha256:${string}` {
  return `sha256:${seed.repeat(64).slice(0, 64)}`
}

function interactiveCapabilities(): AgentEnvironmentCapabilities {
  return {
    profile: {
      namedProfiles: true,
      systemPrompt: { replace: true, append: true },
      instructions: true,
      tools: true,
      permissions: true,
      mcp: true,
      subagents: true,
      resources: { files: true, instructions: true },
      runtimeUpdate: true,
      validation: true,
    },
    streaming: { live: true, replay: true, detach: true, turnIdempotency: true },
    sessions: { continue: true, list: true, messages: true },
    workspace: { read: true, write: true, exec: true, git: true, upload: true, download: true },
    branching: { checkpoint: true, fork: true },
    placement: true,
    usage: true,
    confidential: false,
    interactiveAgent: {
      start: true,
      control: true,
      status: true,
      attach: true,
      reattach: true,
      sendPrompt: true,
      input: true,
      resize: true,
      stop: true,
    },
  }
}

/**
 * One in-memory coding-agent TUI per environment. `history` is the server-side ordered record:
 * every attach replays it from `since`, so a detach and a later reattach observe ONE history,
 * exactly as a real PTY-backed provider must.
 */
function interactiveProvider(name: string): AgentEnvironmentProvider {
  let ref: AgentInteractiveSessionRef | undefined
  let generation = 0
  let running = true
  const history: TerminalOutputEvent[] = []
  const environmentId = `${name}-environment`

  const terminal = (
    control: AgentInteractiveSessionControlClaim,
  ): AgentInteractiveTerminalSession =>
    ({
      ref: {
        terminalSessionId: `${name}-terminal`,
        parentExecutionId: ref!.run.executionId,
        name: `${name}-tui`,
        shell: '/bin/sh',
        cwd: '/workspace',
        cols: 80,
        rows: 24,
        createdAt: '2026-08-16T00:00:00.000Z',
        lastActivityAt: '2026-08-16T00:00:00.000Z',
        expiresAt: '2126-08-16T00:00:00.000Z',
        isRunning: true,
        attachCount: 1,
      },
      cursors: { earliest: 0, latest: Math.max(0, history.length - 1) },
      control,
      input: async (input) => {
        history.push({ type: 'output', seq: history.length, data: input.data })
      },
      resize: async (resize) => {
        history.push({ type: 'resize', cols: resize.cols, rows: resize.rows })
      },
      detach: async () => ({ status: 'detached' as const, terminalSessionId: `${name}-terminal` }),
      close: async () => {
        running = false
        return { status: 'closed' as const, terminalSessionId: `${name}-terminal` }
      },
      events: async function* (options?: { since?: number }) {
        yield* history.slice(options?.since ?? 0)
      },
    }) as unknown as AgentInteractiveTerminalSession

  const environment: AgentEnvironment = {
    id: environmentId,
    provider: name,
    status: async () => 'running',
    async *stream() {},
    dispatch: async () => {
      throw new Error('a headless dispatch must not run for an interactive worker')
    },
    startInteractive: async (request: AgentInteractiveSessionStart) => {
      const preparationReceipt = {
        kind: 'agent-execution-preparation' as const,
        schemaVersion: 1 as const,
        preparationId: `${name}-preparation`,
        requestDigest: request.run.requestDigest,
        authoredProfileDigest: request.requestedProfileDigest,
        effectiveProfileDigest: request.requestedProfileDigest,
        backend: 'test-backend',
        harness: request.profile.harness,
        harnessVersion: 'test-harness-1',
        resolvedModel: {
          requested: request.profile.model?.default ?? 'test-model',
          resolved: request.profile.model?.default ?? 'test-model',
        },
        workspace: {
          leaseId: `${name}-workspace-lease`,
          provider: name,
          identityDigest: digest('2'),
          isolation: 'per-run' as const,
          sourceSnapshotDigest: digest('3'),
          sourceSnapshotPolicy: {
            kind: 'provider-declared' as const,
            name: 'test-snapshot',
            version: 1,
            digest: digest('4'),
          },
          preparedWorkspaceDigest: digest('5'),
          profileActivationDigest: digest('6'),
        },
        axisResults: [],
        executionPlanDigest: digest('7'),
        materializer: { name: 'test-materializer', version: '1' },
        expiresAtMs: 4102444800000,
      }
      ref = AgentInteractiveSessionRefSchema.parse({
        run: request.run,
        preparationReceipt: {
          ...preparationReceipt,
          digest: canonicalCandidateDigest(preparationReceipt),
        },
        incarnationId: `${name}-incarnation`,
        startedAt: '2026-08-16T00:00:00.000Z',
      })
      return ref
    },
    interactive: () => ({
      ref: ref!,
      claimControl: async (request) => {
        generation += 1
        return {
          operationId: request.operationId,
          requestDigest: request.requestDigest,
          ref: ref!,
          status: 'accepted' as const,
          control: controlFor(ref!, generation),
        }
      },
      status: async () =>
        running
          ? { state: 'running' as const, ref: ref! }
          : {
              state: 'exited' as const,
              ref: ref!,
              endedAt: '2026-08-28T00:00:00.000Z',
              reason: 'stopped' as const,
            },
      attach: async (request: AgentInteractiveSessionAttach) => terminal(request.control),
      sendPrompt: async (command) => ({
        operationId: command.operationId,
        requestDigest: command.requestDigest,
        ref: ref!,
        control: command.control,
        status: 'accepted' as const,
      }),
      stop: async (command) => ({
        operationId: command.operationId,
        requestDigest: command.requestDigest,
        ref: ref!,
        control: command.control,
        status: 'accepted' as const,
        effect: 'stopped' as const,
      }),
    }),
    destroy: async () => {},
  }

  return {
    name,
    capabilities: async () => interactiveCapabilities(),
    create: async () => environment,
    get: async (id) => (id === environmentId ? environment : null),
  }
}

function controlFor(
  ref: AgentInteractiveSessionRef,
  generation: number,
): AgentInteractiveSessionControlClaim {
  return {
    refDigest: canonicalCandidateDigest(ref),
    generation,
    leaseId: 'interactive-lease-1',
    holderId: 'operator',
    expiresAt: '2126-08-16T00:00:00.000Z',
  }
}

async function claim(
  session: WorkerInteractiveSession,
): Promise<AgentInteractiveSessionControlClaim> {
  if (session.status !== 'available') throw new Error('expected an attachable worker')
  const material = {
    operationId: `${session.handle.ref.run.runId}:claim`,
    ref: session.handle.ref,
    holderId: 'operator',
    expectedGeneration: 0,
  }
  const acknowledgement = await session.handle.claimControl({
    ...material,
    requestDigest: agentInteractiveSessionControlClaimRequestDigest(material),
  })
  if (acknowledgement.status !== 'accepted' || !acknowledgement.control) {
    throw new Error('expected an accepted control claim')
  }
  return acknowledgement.control
}

/** A gate the test opens by hand, so "still running" is a fact rather than a race. */
function gate() {
  let open!: () => void
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { opened, open }
}

/** A worker that runs as one attachable native TUI: its executor holds the exact session. */
async function interactiveWorker(
  name: string,
  pause: Promise<void>,
  provider: AgentEnvironmentProvider = interactiveProvider(name),
): Promise<Agent<unknown, unknown>> {
  const profile = testAgentProfile(name, { harness: 'pi' })
  const handle = await startRetainedInteractiveRun({
    provider,
    environment: { profile, idempotencyKey: `${name}-workspace` },
    interactiveIdempotencyKey: `${name}-native`,
    onAdmission: async () => {},
  })
  const executor: Executor<unknown> = {
    runtime: 'sandbox',
    execute() {
      return (async function* () {
        yield { kind: 'tokens', input: 10, output: 5 } as UsageEvent
        yield { kind: 'iteration' } as UsageEvent
        await pause
      })()
    },
    interactive: (): WorkerInteractiveSession => ({ status: 'available', handle }),
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: (): ExecutorResult<unknown> => ({
      outRef: `interactive:${name}`,
      out: { worker: name },
      spent: { iterations: 1, tokens: { input: 10, output: 5 }, usd: 0, ms: 0 },
    }),
  }
  const spec: AgentSpec = { profile, harness: null, executor }
  return { name, act: async () => 0, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

/** A worker whose executor states that its runner publishes no interactive contract. */
function bridgeWorker(name: string): Agent<unknown, unknown> {
  const executor: Executor<unknown> = {
    runtime: 'cli',
    execute() {
      return (async function* () {
        yield { kind: 'iteration' } as UsageEvent
      })()
    },
    interactive: (): WorkerInteractiveSession => ({
      status: 'unavailable',
      reason: 'provider-has-no-interactive-contract',
    }),
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: (): ExecutorResult<unknown> => ({
      outRef: `bridge:${name}`,
      out: {},
      spent: { iterations: 1, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 },
    }),
  }
  const spec: AgentSpec = { profile: testAgentProfile(name), harness: null, executor }
  return { name, act: async () => 0, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

/** A worker that exposes no interactive capability at all — the headless default. */
function headlessWorker(name: string): Agent<unknown, unknown> {
  const executor: Executor<unknown> = {
    runtime: 'router',
    execute() {
      return (async function* () {
        yield { kind: 'iteration' } as UsageEvent
      })()
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: (): ExecutorResult<unknown> => ({
      outRef: `headless:${name}`,
      out: {},
      spent: { iterations: 1, tokens: { input: 0, output: 0 }, usd: 0, ms: 0 },
    }),
  }
  const spec: AgentSpec = { profile: testAgentProfile(name), harness: null, executor }
  return { name, act: async () => 0, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

function scopeOf(): Scope<unknown> {
  const journal = new InMemorySpawnJournal()
  void journal.beginTree('root', new Date().toISOString())
  return createScope<unknown>({
    parentId: 'root',
    root: 'root',
    depth: 0,
    pool: createBudgetPool(budget, Date.now()),
    journal,
    blobs: new InMemoryResultBlobStore(),
    executors: createExecutorRegistry(),
    signal: new AbortController().signal,
    seams: {},
    now: Date.now,
  })
}

async function durableScopeOf(dir: string): Promise<Scope<unknown>> {
  const journal = new FileSpawnJournal(join(dir, 'spawn-journal.jsonl'))
  await journal.beginTree('root', '2026-08-28T00:00:00.000Z')
  return createScope<unknown>({
    parentId: 'root',
    root: 'root',
    depth: 0,
    pool: createBudgetPool(budget, Date.now()),
    journal,
    blobs: new FileResultBlobStore(join(dir, 'blobs')),
    executors: createExecutorRegistry(),
    signal: new AbortController().signal,
    seams: {},
    interactiveBindingDir: dir,
    now: Date.now,
  })
}

async function readHistory(
  terminal: AgentInteractiveTerminalSession,
  since = 0,
): Promise<string[]> {
  const out: string[] = []
  for await (const event of terminal.events({ since })) {
    if (event.type === 'output') out.push(event.data)
  }
  return out
}

describe('scope.interactive — attaching to the exact process one worker runs in', () => {
  it('reaches the selected worker and replays one ordered history across detach and reconnect', async () => {
    const scope = scopeOf()
    const running = gate()
    const alphaAgent = await interactiveWorker('alpha', running.opened)
    const betaAgent = await interactiveWorker('beta', running.opened)
    const first = scope.spawn(alphaAgent, 'work', {
      budget: { maxIterations: 4, maxTokens: 1_000 },
      label: 'alpha',
    })
    const second = scope.spawn(betaAgent, 'work', {
      budget: { maxIterations: 4, maxTokens: 1_000 },
      label: 'beta',
    })
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) throw new Error('unreachable')

    const alpha = scope.interactive(first.handle.id)
    const beta = scope.interactive(second.handle.id)
    expect(alpha.status).toBe('available')
    expect(beta.status).toBe('available')
    if (alpha.status !== 'available' || beta.status !== 'available') throw new Error('unreachable')

    // Each node id reaches ITS OWN process, never the sibling's.
    expect(alpha.handle.ref.run.executionId).not.toBe(beta.handle.ref.run.executionId)

    const control = await claim(alpha)
    const attached = await alpha.handle.attach({ control, cols: 80, rows: 24 })
    await attached.input({ data: 'pnpm test\n' })
    await attached.resize({ cols: 120, rows: 40 })
    await attached.input({ data: 'git status\n' })
    expect(await attached.detach()).toMatchObject({ status: 'detached' })

    // Reconnecting through the SAME node id observes exactly one history, not a second one.
    const again = scope.interactive(first.handle.id)
    if (again.status !== 'available') throw new Error('expected the worker to stay attachable')
    const reattached = await again.handle.attach({ control: await claim(again) })
    expect(await readHistory(reattached)).toEqual(['pnpm test\n', 'git status\n'])

    // The sibling's terminal is untouched by what was typed into alpha.
    const betaTerminal = await beta.handle.attach({ control: await claim(beta) })
    expect(await readHistory(betaTerminal)).toEqual([])

    running.open()
    await scope.next()
    await scope.next()
  })

  it('refuses every worker that has no attachable process, each with its own reason', async () => {
    const scope = scopeOf()
    const bridge = scope.spawn(bridgeWorker('bridge'), 'work', {
      budget: { maxIterations: 2, maxTokens: 500 },
      label: 'bridge',
    })
    const headless = scope.spawn(headlessWorker('headless'), 'work', {
      budget: { maxIterations: 2, maxTokens: 500 },
      label: 'headless',
    })
    expect(bridge.ok && headless.ok).toBe(true)
    if (!bridge.ok || !headless.ok) throw new Error('unreachable')

    expect(scope.interactive(bridge.handle.id)).toEqual({
      status: 'unavailable',
      reason: 'provider-has-no-interactive-contract',
    })
    expect(scope.interactive(headless.handle.id)).toEqual({
      status: 'unavailable',
      reason: 'executor-exposes-no-interactive-session',
    })
    expect(scope.interactive('root:s99')).toEqual({
      status: 'unavailable',
      reason: 'unknown-node',
    })

    await scope.next()
    await scope.next()

    // A settled worker holds no process: it must read as not-live, never as a stale handle.
    expect(scope.interactive(bridge.handle.id)).toEqual({
      status: 'unavailable',
      reason: 'not-live',
    })
  })

  it('reconstructs the exact worker across a new client process boundary and fails closed after close', async () => {
    const dir = tempDir()
    const scope = await durableScopeOf(dir)
    const running = gate()
    const provider = interactiveProvider('durable-alpha')
    const spawned = scope.spawn(
      await interactiveWorker('durable-alpha', running.opened, provider),
      'work',
      {
        budget: { maxIterations: 4, maxTokens: 1_000 },
        label: 'durable-alpha',
      },
    )
    if (!spawned.ok) throw new Error(`spawn failed: ${spawned.reason}`)

    await vi.waitFor(async () => {
      expect(existsSync(workerInteractiveBindingFile(dir, spawned.handle.id))).toBe(true)
      await expect(
        attachWorker(dir, spawned.handle.id, { providers: provider }),
      ).resolves.toMatchObject({ status: 'available' })
    })
    const first = await attachWorker(dir, spawned.handle.id, { providers: provider })
    if (first.status !== 'available') throw new Error(`attach failed: ${first.reason}`)
    const control = await claim(first)
    const terminal = await first.handle.attach({ control })
    await terminal.input({ data: 'first process\n' })
    await terminal.detach()

    // A new caller reconstructs from the durable exact ref and sees the same ordered history.
    const restarted = await attachWorker(dir, spawned.handle.id, { providers: provider })
    if (restarted.status !== 'available') throw new Error(`reattach failed: ${restarted.reason}`)
    const reattached = await restarted.handle.attach({ control: await claim(restarted) })
    expect(await readHistory(reattached)).toEqual(['first process\n'])
    await reattached.close()
    await expect(attachWorker(dir, spawned.handle.id, { providers: provider })).resolves.toEqual({
      status: 'unavailable',
      reason: 'interactive-binding-stale',
    })

    running.open()
    await scope.next()
    await expect(attachWorker(dir, spawned.handle.id, { providers: provider })).resolves.toEqual({
      status: 'unavailable',
      reason: 'not-live',
    })
  })

  it('persists headless and unsupported reasons and refuses corrupt or symlinked bindings', async () => {
    const dir = tempDir()
    const scope = await durableScopeOf(dir)
    const pause = gate()
    const unsupported = (
      name: string,
      reason: Extract<WorkerInteractiveSession, { status: 'unavailable' }>,
    ) => {
      const executor: Executor<unknown> = {
        runtime: 'sandbox',
        execute: async () => {
          await pause.opened
          return {
            outRef: `out:${name}`,
            out: name,
            spent: { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 0 },
          }
        },
        interactive: () => reason,
        teardown: async () => ({ destroyed: true }),
        resultArtifact: () => {
          throw new Error('one-shot result is returned from execute')
        },
      }
      const spec: AgentSpec = { profile: testAgentProfile(name), harness: null, executor }
      return { name, act: async () => name, executorSpec: spec } as Agent<unknown, unknown> & {
        executorSpec: AgentSpec
      }
    }
    const headless = scope.spawn(
      unsupported('headless-durable', {
        status: 'unavailable',
        reason: 'executor-exposes-no-interactive-session',
      }),
      'work',
      { budget: { maxIterations: 2, maxTokens: 100 }, label: 'headless-durable' },
    )
    const unsupportedSpawn = scope.spawn(
      unsupported('unsupported-durable', {
        status: 'unavailable',
        reason: 'provider-has-no-interactive-contract',
      }),
      'work',
      { budget: { maxIterations: 2, maxTokens: 100 }, label: 'unsupported-durable' },
    )
    if (!headless.ok || !unsupportedSpawn.ok) throw new Error('spawn failed')
    await vi.waitFor(async () => {
      await expect(
        attachWorker(dir, headless.handle.id, { providers: interactiveProvider('unused') }),
      ).resolves.toEqual({
        status: 'unavailable',
        reason: 'executor-exposes-no-interactive-session',
      })
    })
    await vi.waitFor(async () => {
      await expect(
        attachWorker(dir, unsupportedSpawn.handle.id, { providers: interactiveProvider('unused') }),
      ).resolves.toEqual({
        status: 'unavailable',
        reason: 'provider-has-no-interactive-contract',
      })
    })

    writeFileSync(workerInteractiveBindingFile(dir, headless.handle.id), '{broken', 'utf8')
    await expect(
      attachWorker(dir, headless.handle.id, { providers: interactiveProvider('unused') }),
    ).rejects.toThrow()

    const symlinkDir = tempDir()
    const outside = tempDir()
    symlinkSync(outside, join(symlinkDir, 'interactive-workers'))
    expect(() => workerInteractiveBindingFile(symlinkDir, 'root:s0')).not.toThrow()
    expect(() =>
      writeWorkerInteractiveBinding(symlinkDir, 'root:s0', 'worker', 'root', {
        status: 'unavailable',
        reason: 'executor-exposes-no-interactive-session',
      }),
    ).toThrow(/symbolic link/)

    const actualDir = tempDir()
    const aliasParent = tempDir()
    const aliasDir = join(aliasParent, 'run-alias')
    symlinkSync(actualDir, aliasDir)
    expect(() =>
      writeWorkerInteractiveBinding(aliasDir, 'root:s0', 'worker', 'root', {
        status: 'unavailable',
        reason: 'executor-exposes-no-interactive-session',
      }),
    ).toThrow(/symbolic link/)

    pause.open()
    await scope.next()
    await scope.next()
  })

  it('preserves not-started when an executor has no readiness signal', async () => {
    const dir = tempDir()
    const scope = await durableScopeOf(dir)
    const execution = gate()
    const profile = testAgentProfile('not-started', { harness: 'pi' })
    const executor: Executor<unknown> = {
      runtime: 'sandbox',
      execute: async () => {
        await execution.opened
        return {
          outRef: 'not-started',
          out: 'done',
          spent: { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 0 },
        }
      },
      interactive: () => ({
        status: 'unavailable',
        reason: 'interactive-session-not-started',
      }),
      teardown: async () => ({ destroyed: true }),
      resultArtifact: () => {
        throw new Error('one-shot result is returned from execute')
      },
    }
    const spec: AgentSpec = { profile, harness: null, executor }
    const agent = {
      name: 'not-started',
      act: async () => 'done',
      executorSpec: spec,
    } as Agent<unknown, unknown> & { executorSpec: AgentSpec }
    const spawned = scope.spawn(agent, 'work', {
      budget: { maxIterations: 2, maxTokens: 100 },
      label: 'not-started',
    })
    if (!spawned.ok) throw new Error(`spawn failed: ${spawned.reason}`)

    await vi.waitFor(async () => {
      await expect(
        attachWorker(dir, spawned.handle.id, { providers: interactiveProvider('unused') }),
      ).resolves.toEqual({
        status: 'unavailable',
        reason: 'interactive-session-not-started',
      })
    })

    execution.open()
    await scope.next()
  })

  it('does not let a never-resolving readiness signal block worker settlement', async () => {
    const dir = tempDir()
    const scope = await durableScopeOf(dir)
    const profile = testAgentProfile('never-ready', { harness: 'pi' })
    const executor: Executor<unknown> = {
      runtime: 'sandbox',
      execute: async () => ({
        outRef: 'never-ready',
        out: 'done',
        spent: { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 0 },
      }),
      interactive: () => ({
        status: 'unavailable',
        reason: 'interactive-session-not-started',
      }),
      interactiveReady: () => new Promise<WorkerInteractiveSession>(() => {}),
      teardown: async () => ({ destroyed: true }),
      resultArtifact: () => {
        throw new Error('one-shot result is returned from execute')
      },
    }
    const spec: AgentSpec = { profile, harness: null, executor }
    const agent = {
      name: 'never-ready',
      act: async () => 'done',
      executorSpec: spec,
    } as Agent<unknown, unknown> & { executorSpec: AgentSpec }
    const spawned = scope.spawn(agent, 'work', {
      budget: { maxIterations: 2, maxTokens: 100 },
      label: 'never-ready',
    })
    if (!spawned.ok) throw new Error(`spawn failed: ${spawned.reason}`)

    await expect(scope.next()).resolves.toMatchObject({ out: 'done' })
  })

  it('publishes no exact binding until a delayed interactive handle is attachable', async () => {
    const dir = tempDir()
    const scope = await durableScopeOf(dir)
    const provider = interactiveProvider('delayed-interactive')
    const profile = testAgentProfile('delayed-interactive', { harness: 'pi' })
    const retained = await startRetainedInteractiveRun({
      provider,
      environment: { profile, idempotencyKey: 'delayed-workspace' },
      interactiveIdempotencyKey: 'delayed-native',
      onAdmission: async () => {},
    })
    const execution = gate()
    let current: WorkerInteractiveSession = {
      status: 'unavailable',
      reason: 'interactive-session-not-started',
    }
    let markInteractiveRead!: () => void
    const interactiveRead = new Promise<void>((resolve) => {
      markInteractiveRead = resolve
    })
    let markReady!: (session: WorkerInteractiveSession) => void
    const ready = new Promise<WorkerInteractiveSession>((resolve) => {
      markReady = resolve
    })
    const executor: Executor<unknown> = {
      runtime: 'sandbox',
      execute: async () => {
        await execution.opened
        return {
          outRef: 'delayed-interactive',
          out: 'done',
          spent: { iterations: 1, tokens: { input: 1, output: 1 }, usd: 0, ms: 0 },
        }
      },
      interactive: () => {
        markInteractiveRead()
        return current
      },
      interactiveReady: () => ready,
      teardown: async () => ({ destroyed: true }),
      resultArtifact: () => {
        throw new Error('one-shot result is returned from execute')
      },
    }
    const spec: AgentSpec = { profile, harness: null, executor }
    const agent = {
      name: 'delayed-interactive',
      act: async () => 'done',
      executorSpec: spec,
    } as Agent<unknown, unknown> & { executorSpec: AgentSpec }
    const spawned = scope.spawn(agent, 'work', {
      budget: { maxIterations: 2, maxTokens: 100 },
      label: 'delayed-interactive',
    })
    if (!spawned.ok) throw new Error(`spawn failed: ${spawned.reason}`)

    await interactiveRead
    expect(existsSync(workerInteractiveBindingFile(dir, spawned.handle.id))).toBe(false)
    await expect(attachWorker(dir, spawned.handle.id, { providers: provider })).resolves.toEqual({
      status: 'unavailable',
      reason: 'interactive-binding-not-found',
    })

    current = { status: 'available', handle: retained }
    markReady(current)
    await vi.waitFor(() => {
      expect(existsSync(workerInteractiveBindingFile(dir, spawned.handle.id))).toBe(true)
    })
    await expect(
      attachWorker(dir, spawned.handle.id, { providers: provider }),
    ).resolves.toMatchObject({ status: 'available' })

    execution.open()
    await scope.next()
  })
})
