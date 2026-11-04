import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { parseErrorResponse, ServerError, TimeoutError } from '@tangle-network/sandbox'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import type { SpawnEvent, SpawnJournal } from '../../src/runtime/supervise/types'
import { coordinationProxy } from '../helpers/coordination-proxy'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { superviseForTest } from '../helpers/runtime-with-test-brain'
import { driverWakeEvents, scriptedDriverBrain } from './scripted-brain'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

const MALFORMED = 'Agent terminal outcome is malformed'
// The refusal magnetar-rust-sandbox-20261031f's Codex agents met: :s0:s1 passed on its 7th
// identical send, while :s1:s2 and :s2:s0 were refused 9 and 10 times in a row.
const CONTENT_FILTERED =
  'codex execution failed: This content was flagged for possible cybersecurity risk. If this ' +
  'seems wrong, try rephrasing your request. (exit code 1)'
// us-legal-exploits-20261103b:s1's turns: one refusal, coded on the stream (A) or read uncoded
// from the exact result (B), a reconciliation that timed out (R), another refusal (C), a pass (.).
const EFFORT_REFUSED =
  'opencode execution failed: reasoning_effort "medium" is not supported for model ' +
  '"deepseek-v4.1-flash". Use one of: none, low, high, max. (exit code 1)'
const EFFORT_TURNS: Partial<Record<string, string>> = {
  'effort-refused': 'AB',
  'effort-changes': 'ACACA.',
  // us-legal-exploits-20261104a: an in-box runtime restart (I) is the platform's, not the turn's.
  'restart-recovers': 'II.',
}
const RESTARTED =
  'Execution interrupted: the agent runtime restarted before the run produced a terminal event.'
// Setup smoke 403b5c4c's second worker turn: its subscription re-read the execution from the first
// frame, 5,470 reasoning deltas in 12 s, and the exact result settled inside that burst.
const REPLAYED = 5_470
// What magnetar-rust-sandbox-20261102a's managers' reconciliations met 1,407 times, in the shape
// agent-provider-tangle gives it, coded or bare; stopping met it too. The 13th read answers.
const capacityRefusal = (read: number) =>
  Object.assign(new Error('Subscription account capacity is unavailable'), {
    name: 'TangleCredentialCapacityError',
    status: 429,
    ...(read % 2 ? {} : { code: 'upstream_unavailable', reason: 'busy' }),
  })
// The down settlement's reason, by the failure each mode replays.
const DOWN_REASONS: Partial<Record<string, readonly string[]>> = {
  failed: [MALFORMED],
  'capability-refused': ['stopped by terminal-error', 'Capability discovery returned'],
  'same-failure': ['stopped by repeated-failure', 'Bad Gateway'],
  'shape-refused': ['stopped by terminal-error', '32000m > 16000m'],
  'preflight-refused': ['stopped by terminal-error', 'preflight failed: HTTP 404'],
  // zro-w4a16-hopper-20261104b s4: every eligible seat resets after the run's deadline.
  'quota-past-deadline': ['stopped by quota-unavailable', 'Subscription account capacity'],
  'content-filtered': [
    "stopped by repeated-failure: refused by the model provider's content filter",
    CONTENT_FILTERED,
  ],
  'effort-refused': ['after 2 attempt(s) — stopped by repeated-failure', EFFORT_REFUSED],
}
// What the Sandbox answered managers s0 and s1 of magnetar-rust-sandbox-20261031g on every turn
// after their first, from the SDK's in-box profile file apply.
const FILE_CONFLICT =
  'materializeProfileFileMounts: [eval]:24\nError: Refusing to replace existing profile file: inputs/repository.md'
// The same conflict once Sandbox types it; only the code and status say what it is.
const TYPED_FILE_CONFLICT = 'inputs/repository.md changed in the box and in the profile'
// What it answered 20261031h's managers s0, s1 and s2 on their second turn: each profile mounted
// inputs/commission.md and /home/agent/inputs/commission.md, one target since Sandbox SDK 1.0.157.
const DUPLICATE_TARGET =
  'materializeProfileFileMounts: [eval]:62\nError: Duplicate profile file target: /home/agent/inputs/commission.md'
// What Sandbox answered creates for magnetar-rust-sandbox-20261101a's :s1:s1, :s1:s3, :s5 and
// :s6:s1 while every cpx62's room was held, and the same refusal for a box no cpx62 can ever hold.
const shapeRefusal = (reason: string) =>
  parseErrorResponse(
    409,
    JSON.stringify({
      error: `HTTP 409: Provision failed — (container) — Provision failed during container phase: ${reason}`,
      code: 'NO_HOST_FITS_SHAPE',
    }),
  )
const HELD_ROOM =
  'No cpx62 host can hold 8000m / 16384 MiB, and none would be bought: its room is held placeable on cpx62'
// What Sandbox answered magnetar-rust-sandbox-20261101b's :s1:s3 and :s2:s1 while eu1 was braked.
const NO_HOSTS = parseErrorResponse(
  503,
  JSON.stringify({
    error:
      'Provision failed — (container) — Provision failed during container phase: No available hosts with capacity: production-host-agent-02: cpu brake: pressure 57.6% at the 40% pressure brake',
    code: 'CAPACITY_EXHAUSTED',
  }),
)
// The signal each waiting mode's two paused attempts carry, before the attempt that completes.
const WAITS: Partial<Record<string, string>> = {
  'capacity-waits': 'host-room-held',
  'capacity-503': 'capacity_exhausted',
  // :s2:s2 and :s1:s1 of the same run settled down on this preflight's `timed out`.
  'preflight-waits': 'coordination-unreachable',
}
const directories: string[] = []
const proxies: Awaited<ReturnType<typeof coordinationProxy>>[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(proxies.splice(0).map((proxy) => proxy.close()))
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('nested retained owner journal isolation', () => {
  for (const mode of [
    'normal',
    'retry',
    'pending',
    'parent-meter-before',
    'parent-meter-loss',
    'parent-terminal-loss',
    'failed',
    'capability-refused',
    'same-failure',
    'content-filtered',
    'content-filter-recovers',
    'effort-refused',
    'effort-changes',
    'restart-recovers',
    'file-conflict',
    'file-conflict-409',
    'file-duplicate',
    'capacity-waits',
    'shape-refused',
    'capacity-503',
    'preflight-waits',
    'preflight-refused',
    'replayed',
    'unreconciled',
    'quota-past-deadline',
    'unreconciled-restart',
  ] as const) {
    const retry = mode === 'retry' || mode === 'pending' || mode === 'unreconciled-restart'
    // The manager's turns: refused until the refusal streak stops it, or passing on the 7th.
    const sends =
      { 'content-filtered': 8, 'content-filter-recovers': 7 }[mode as string] ??
      EFFORT_TURNS[mode]?.length ??
      1
    const refusing = sends > 1
    const parentInterruption = mode.startsWith('parent-')
    it(`keeps backend evidence inside its owned tree (${mode})`, async () => {
      const directory = await mkdtemp(join(tmpdir(), 'nested-retained-owner-'))
      directories.push(directory)
      const context = createFileRunContext(join(directory, 'run'))
      const providerFile = join(directory, 'provider.json')
      let creates = 0
      let injected = false
      // The clock alone is faked: each refused create takes 40 s of it.
      let skew = 0
      const realNow = Date.now
      vi.spyOn(Date, 'now').mockImplementation(() => realNow() + skew)
      // Each refused execution's refusal, and whether its stream carries it.
      const refused = new Map<string, { error: string; streamed: boolean }>()
      let dispatches = 0
      let attempts = 0
      let reads = 0
      const subscriptions: Array<{ since: string | undefined; frames: number }> = []
      const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
        ...environment,
        dispatch: async (turn) => {
          if (mode === 'file-conflict-409')
            throw new ServerError(TYPED_FILE_CONFLICT, 409, undefined, 'PROFILE_FILE_CONFLICT')
          if (mode === 'file-conflict') throw new ServerError(FILE_CONFLICT)
          if (mode === 'file-duplicate') throw new ServerError(DUPLICATE_TARGET)
          const effort = EFFORT_TURNS[mode]?.[attempts++]
          if (effort === 'R') throw new TimeoutError(30_000, 'Request timed out after 30000ms')
          const dispatched = await environment.dispatch!(turn)
          dispatches += 1
          const executionId = dispatched.controlRef?.executionId ?? ''
          // Each copy names its own request and time, which never make a failure different.
          const error =
            effort === 'I'
              ? RESTARTED
              : `${effort === 'C' ? EFFORT_REFUSED.replace('medium', 'high') : EFFORT_REFUSED} [request ${randomUUID()} at ${new Date(Date.now()).toISOString()}]`
          if (effort !== undefined && effort !== '.')
            refused.set(executionId, { error, streamed: effort === 'A' })
          else if (refusing && (mode === 'content-filtered' || dispatches < sends))
            refused.set(executionId, { error: CONTENT_FILTERED, streamed: true })
          return dispatched
        },
        session: (id, options) => {
          const session = environment.session!(id, options)
          const refusal = refused.get(options?.controlRef?.executionId ?? '')
          const exact = async () => {
            // The restarted process's read answers.
            if (mode === 'unreconciled-restart' ? injected : mode !== 'unreconciled' || reads >= 12)
              return session.result()
            skew += 40_000
            throw capacityRefusal(reads++)
          }
          return {
            ...session,
            async *events(eventOptions) {
              const read = { since: eventOptions?.since, frames: 0 }
              subscriptions.push(read)
              for await (const frame of session.events!(eventOptions)) {
                read.frames += 1
                yield frame
              }
              for (let n = 0; mode === 'replayed' && n < REPLAYED; n++) {
                const part = { id: `prt-${n}`, type: 'reasoning', text: 'x' }
                yield { id: `replay-${n}`, type: 'message.part.updated', data: { part } }
              }
              // A streamed refusal arrives under the Sandbox SDK's generic code.
              if (refusal?.streamed)
                yield {
                  id: 'event-error',
                  type: 'error',
                  data: { message: refusal.error, code: 'AGENT_EXECUTION_FAILED' },
                }
            },
            ...(mode === 'unreconciled'
              ? { cancelRun: () => Promise.reject(capacityRefusal(0)) }
              : {}),
            result: async () => ({
              ...(await exact()),
              // s1's refused turns metered no tokens.
              usage:
                EFFORT_TURNS[mode] !== undefined && refusal
                  ? { inputTokens: 0, outputTokens: 0 }
                  : { inputTokens: 3, outputTokens: 2 },
              // institutional-compiler-20261031c:s9's turn, as the Sandbox SDK settled it.
              ...(mode === 'failed' ? { success: false, error: MALFORMED } : {}),
              ...(refusal ? { success: false, error: refusal.error } : {}),
            }),
          }
        },
      })
      const providerOver = (base: AgentEnvironmentProvider): AgentEnvironmentProvider => ({
        ...base,
        capabilities: async () => ({
          ...(await base.capabilities()),
          create: { runtimeAttachments: { mcp: true } },
        }),
        create: async (input) => {
          creates++
          // zro-w4a16-hopper-20261104b s4: refused before anything ran, its reset past the deadline.
          if (mode === 'quota-past-deadline')
            throw Object.assign(capacityRefusal(0), { resetAt: '2099-01-01T00:00:00.000Z' })
          if (mode === 'capability-refused') {
            throw new ServerError(
              "Capability discovery returned a malformed 'nativeSessionCaptureHarnesses' group",
              502,
              { origin: 'runtime', endpoint: '/capabilities' },
              'INVALID_CAPABILITY_DOCUMENT',
            )
          }
          if (mode === 'same-failure') {
            skew += 40_000
            throw new ServerError('Bad Gateway', 502)
          }
          if (mode === 'capacity-waits' && creates < 3) throw shapeRefusal(HELD_ROOM)
          if (mode === 'capacity-503' && creates < 3) throw NO_HOSTS
          if (mode === 'shape-refused')
            throw shapeRefusal(
              'No cpx62 host can hold 32000m / 16384 MiB, and none would be bought: 32000m > 16000m placeable on cpx62',
            )
          return wrap(await base.create(input))
        },
        get: async (id) => {
          const environment = await base.get!(id)
          return environment ? wrap(environment) : null
        },
      })
      const provider = providerOver(durableRetainedProvider(providerFile))
      const journal: SpawnJournal = {
        beginTree: context.journal.beginTree.bind(context.journal),
        loadTree: context.journal.loadTree.bind(context.journal),
        appendEvent: async (root, event) => {
          const meter = event.kind === 'metered' && event.spend.tokens.input > 0
          const parentMeter = root === 'root' && meter && event.id !== 'root'
          if (!injected && mode === 'parent-meter-before' && parentMeter) {
            injected = true
            throw new Error('parent inference write failed before persistence')
          }
          await context.journal.appendEvent(root, event)
          if (
            !injected &&
            ((mode === 'parent-meter-loss' && parentMeter) ||
              (mode === 'parent-terminal-loss' &&
                root === 'root' &&
                event.kind === 'settled' &&
                event.id !== 'root'))
          ) {
            injected = true
            throw new Error('parent settlement acknowledgement lost')
          }
          // The restart mode's process ends at its first pause, after a refused reconciliation.
          const cut = mode === 'unreconciled-restart' ? event.kind === 'paused' : meter
          if (retry && !injected && root !== 'root' && cut) {
            injected = true
            throw new Error('nested observation interrupted after usage commit')
          }
        },
      }
      // The public route: its first two answers never arrive, or it is not this manager's route.
      let unanswered = mode === 'preflight-waits' ? 2 : 0
      const proxy = await coordinationProxy(() =>
        mode === 'preflight-refused' ? 404 : unanswered-- > 0 ? 'hang' : undefined,
      )
      proxies.push(proxy)
      const coordination = {
        ...(mode === 'preflight-waits' ? { requestTimeoutMs: 1_000 } : {}),
        authentication: {
          signingKeys: { activeKeyId: 'test', keys: { test: 'nested-test-secret-'.repeat(3) } },
        },
        publicUrl: ({ port }: { port: number }) => {
          proxy.forwardTo(port)
          return `${proxy.url}/nested`
        },
      }
      const finalizer = () => ({ finalizedBy: 'manager' })
      const rootSaw: Array<ReadonlyArray<Record<string, unknown>>> = []
      const manager = testAgentProfile('manager', {
        harness: 'codex',
        tools: runtimeToolDeclarations('stop'),
      })
      const root = testAgentProfile('root', {
        harness: 'cli-base',
        tools: runtimeToolDeclarations('spawn_worker'),
      })
      await superviseForTest(root, 'Delegate.', {
        runDir: join(directory, 'run'),
        runId: 'root',
        journal,
        blobs: context.blobs,
        backend: { backend: 'provider', provider },
        // Room for 20 refused turns: only the refusal streak's own bound may stop the manager.
        budget: refusing
          ? { maxIterations: 40, maxTokens: 400 }
          : {
              maxIterations: 8,
              maxTokens: 100,
              ...(mode === 'quota-past-deadline' ? { deadlineMs: 3_600_000 } : {}),
            },
        perWorker: refusing
          ? { maxIterations: 20, maxTokens: 200 }
          : { maxIterations: 3, maxTokens: 20 },
        driverRetry: {
          maxAttempts:
            refusing || mode.startsWith('file-')
              ? 20
              : mode === 'pending' || mode in WAITS || mode in DOWN_REASONS
                ? 1
                : 2,
          ...(refusing ? { maxConsecutiveFailures: 20 } : {}),
          // A capacity wait spends no attempt, so the refusals fit in one.
          ...(mode in WAITS || mode.startsWith('unreconciled') || mode.startsWith('quota-')
            ? { unavailablePauseMs: 0 }
            : {}),
          initialBackoffMs: 0,
          maxBackoffMs: 0,
          // Discovery's window: an idle transient streak is never charged against maxAttempts.
          transientOutageMs: Number.MAX_SAFE_INTEGER,
        },
        coordination,
        finalizer,
        brain: scriptedDriverBrain(
          [
            {
              toolCalls: [
                {
                  name: 'spawn_worker',
                  arguments: { profile: manager, task: 'Manage.', key: 'manager' },
                },
              ],
            },
            { content: 'waiting for the manager' },
            { content: 'done' },
          ],
          rootSaw,
        ),
      }).catch((error: unknown) => {
        if (!injected) throw error
        expect(error).toMatchObject({
          message: expect.stringContaining('durable state unavailable'),
        })
      })
      const parent = (await context.journal.loadTree('root')) ?? []
      const spawn = parent.find((event) => event.kind === 'spawned' && event.key === 'manager')
      if (spawn?.kind !== 'spawned' || !spawn.ownedTreeRoot)
        throw new Error('manager was not admitted')
      const nested = (await context.journal.loadTree(spawn.ownedTreeRoot)) ?? []
      const { parent: _parent, ownedTreeRoot: _tree, ...expectedOwner } = spawn
      expect(nested[0]).toEqual(expectedOwner)
      if (mode.startsWith('file-')) {
        // The refusal recurs on every turn and nothing ran: one attempt, never a lost transport,
        // and the lead is woken with the file it names.
        expect(dispatches).toBe(0)
        expect(nested.filter((event) => event.kind === 'driver-attempt')).toMatchObject([
          { record: { attempt: 1, classification: 'terminal', pendingCause: 'request-rejected' } },
        ])
        expect(rootSaw.flatMap(driverWakeEvents)).toContainEqual(
          expect.objectContaining({
            settled: spawn.id,
            status: 'down',
            reason: expect.stringContaining(
              mode === 'file-duplicate'
                ? '/home/agent/inputs/commission.md'
                : 'inputs/repository.md',
            ),
          }),
        )
        return
      }
      // A refused route ends the drive before the harness is admitted.
      const admitted = mode !== 'preflight-refused'
      expect(nested.filter((event) => event.kind === 'execution-input')).toHaveLength(
        admitted ? sends : 0,
      )
      if (mode === 'unreconciled') {
        // Each refused read pauses the manager, never abandoned, until the 13th answers.
        const observed = { replayPosition: 'event-2' }
        const paused = ['upstream_unavailable', 'http-429'].map((unavailableSignal) => ({
          record: { classification: 'unavailable', unavailableSignal, observed },
        }))
        expect(nested.filter((event) => event.kind === 'driver-attempt')).toMatchObject([
          ...Array(6).fill(paused).flat(),
          { record: { stop: 'completed', reentry: 'upstream-unavailable' } },
        ])
        expect(nested.some((event) => event.kind === 'execution-abandoned')).toBe(false)
        // Each attempt records its last frame; each reconciliation resumes after it, reading none.
        expect(subscriptions).toEqual([
          { since: undefined, frames: 3 },
          ...Array(12).fill({ since: 'event-2', frames: 0 }),
        ])
        const settled = parent.find((e) => e.kind === 'settled' && e.id === spawn.id)
        expect(settled).toMatchObject({ status: 'done' })
        return expect(dispatches).toBe(1)
      }
      expect(nested.filter((event) => event.kind === 'execution-result')).toHaveLength(
        retry || (mode in DOWN_REASONS && mode !== 'failed' && !refusing) ? 0 : sends,
      )
      const downReasons = DOWN_REASONS[mode]
      if (downReasons !== undefined) {
        // Nothing is in doubt: the turn committed a failed result, or no create ever answered, so
        // the manager settles down with that reason instead of holding its slot open.
        expect(parent.some((event) => event.kind === 'reconciled' && event.id === spawn.id)).toBe(
          false,
        )
        const down = parent.find((event) => event.kind === 'settled' && event.id === spawn.id)
        expect(down, JSON.stringify(parent)).toMatchObject({ status: 'down' })
        for (const reason of downReasons)
          expect(down?.kind === 'settled' ? down.reason : '').toContain(reason)
        expect(down).not.toHaveProperty('retainedExecution')
        // The capability refusal ends the first attempt; the same 502 ends the tenth, 6 min in.
        expect(creates).toBe(mode === 'same-failure' ? 10 : admitted ? 1 : 0)
        // The lead is woken with the reason, so it can reword or re-scope the refused task.
        for (const reason of refusing ? downReasons : [])
          expect(rootSaw.flatMap(driverWakeEvents)).toContainEqual(
            expect.objectContaining({
              failure: expect.objectContaining({ cause: expect.stringContaining(reason) }),
            }),
          )
        return
      }
      if (retry || parentInterruption) {
        const terminalWritten = mode === 'parent-terminal-loss'
        expect(parent.some((event) => event.kind === 'settled' && event.id === spawn.id)).toBe(
          terminalWritten,
        )
        if (parentInterruption) {
          expect(injected).toBe(true)
          expect(tokens(parent)).toBe(mode === 'parent-meter-before' ? 0 : 5)
          if (terminalWritten) {
            expect(
              parent.findIndex((event) => event.kind === 'metered' && event.id === spawn.id),
            ).toBeLessThan(
              parent.findIndex((event) => event.kind === 'settled' && event.id === spawn.id),
            )
          }
        }
        expect(nested.some((event) => event.kind === 'execution-admitted')).toBe(true)
        expect(creates).toBe(1)
        const restartedProvider = providerOver(durableRetainedProvider(providerFile))
        const restarted = createFileRunContext(join(directory, 'run'))
        await superviseForTest(root, 'Delegate.', {
          runDir: join(directory, 'run'),
          runId: 'root',
          journal: restarted.journal,
          blobs: restarted.blobs,
          backend: { backend: 'provider', provider: restartedProvider },
          budget: { maxIterations: 8, maxTokens: 100 },
          perWorker: { maxIterations: 3, maxTokens: 20 },
          driverRetry: { maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0 },
          coordination,
          finalizer,
          brain: scriptedDriverBrain([{ content: 'waiting for the manager' }, { content: 'done' }]),
        })
        // A restart resumes after the position the last driver attempt recorded, reading no frame;
        // one before any attempt was recorded replays the execution from its first frame.
        if (retry)
          expect(subscriptions.slice(1)).toEqual([
            mode === 'unreconciled-restart' ? { since: 'event-2', frames: 0 } : subscriptions[0],
          ])
        const recoveredParent = (await restarted.journal.loadTree('root')) ?? []
        const recoveredNested = (await restarted.journal.loadTree(spawn.ownedTreeRoot)) ?? []
        const settlement = recoveredParent.find((e) => e.kind === 'settled' && e.id === spawn.id)
        expect(settlement, JSON.stringify(recoveredParent)).toMatchObject({ status: 'done' })
        if (settlement?.kind === 'settled' && settlement.outRef) {
          expect(await restarted.blobs.get(settlement.outRef)).toEqual({ finalizedBy: 'manager' })
        }
        expect(recoveredNested.filter((event) => event.kind === 'execution-input')).toHaveLength(1)
        expect(recoveredNested.filter((event) => event.kind === 'execution-result')).toHaveLength(1)
        expect(
          recoveredParent.filter((event) => event.kind === 'spawned' && event.id === spawn.id),
        ).toHaveLength(1)
        expect(tokens(recoveredNested)).toBe(5)
        expect(tokens(recoveredParent)).toBe(5)
        expect(
          recoveredParent.filter((event) => event.kind === 'settled' && event.id === spawn.id),
        ).toHaveLength(1)
        expect(
          recoveredParent.filter(
            (event) =>
              event.kind === 'metered' && event.id === spawn.id && event.spend.tokens.input > 0,
          ),
        ).toHaveLength(1)
        expect(creates).toBe(1)
        return
      }
      expect(
        parent.some((event) => event.kind === 'execution-result' && event.id === spawn.id),
      ).toBe(false)
      const settlement = parent.find((event) => event.kind === 'settled' && event.id === spawn.id)
      expect(settlement, JSON.stringify(parent)).toMatchObject({ kind: 'settled', status: 'done' })
      // The manager's own harness session reaches its settlement through the driver: this fake
      // environment has no `read`, so the capture itself names why, instead of the driver
      // reporting that it offers no transcript at all.
      expect(settlement?.kind === 'settled' ? settlement.harnessTranscript : null).toEqual({
        status: 'unavailable',
        reason: 'unsupported-environment',
      })
      if (settlement?.kind === 'settled' && settlement.outRef) {
        expect(await context.blobs.get(settlement.outRef)).not.toEqual(
          expect.objectContaining({ content: 'durable result' }),
        )
      }
      // A refusal that changes is retried past the identical-failure bound until a turn passes.
      const failedTurns = (EFFORT_TURNS[mode] ?? '').replace('.', '').length
      const passed = failedTurns > 0 ? 1 : sends
      if (failedTurns > 0)
        expect(nested.filter((event) => event.kind === 'driver-attempt')).toMatchObject([
          ...Array(failedTurns).fill({
            record: {
              classification: 'transient',
              failureKind: mode === 'restart-recovers' ? 'infra' : 'deterministic',
              madeProgress: false,
            },
          }),
          { record: { stop: 'completed', reentry: 'driver-failure' } },
        ])
      expect(tokens(nested)).toBe(5 * passed)
      expect(tokens(parent)).toBe(5 * passed)
      // The manager waited it out: two paused attempts, then the one that completed.
      expect(creates).toBe(mode.startsWith('capacity-') ? 3 : 1)
      const signal = WAITS[mode]
      if (signal !== undefined)
        expect(nested.filter((event) => event.kind === 'driver-attempt')).toMatchObject([
          { record: { classification: 'unavailable', unavailableSignal: signal } },
          { record: { classification: 'unavailable', unavailableSignal: signal } },
          { record: { stop: 'completed', reentry: 'upstream-unavailable' } },
        ])
      expect(injected).toBe(retry)
    })
  }
})

function tokens(events: SpawnEvent[]) {
  return events.reduce(
    (total, event) =>
      event.kind === 'metered'
        ? total + event.spend.tokens.input + event.spend.tokens.output
        : total,
    0,
  )
}
