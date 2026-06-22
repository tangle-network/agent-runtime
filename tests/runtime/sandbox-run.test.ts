import type { SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import {
  type AgentRunSpec,
  type Deliverable,
  openSandboxRun,
  SandboxRunAbortError,
} from '../../src/runtime'
import type { RuntimeHookEvent } from '../../src/runtime-hooks'

interface FakeOpts {
  /** Resolves the artifact read; throw to exercise the `readError` path. Default: canned. */
  fsRead?: (path: string) => string | Promise<string>
  /** `box.session(id).status()` non-null (live) vs null (reaped). Default live. */
  sessionLive?: boolean
  /** Called 1-based at the start of each `streamPrompt` — lets a test abort mid-run. */
  onStream?: (callIndex: number) => void
  /** Events the stream yields, in order. Default: one terminal `result`. A test
   *  drives partial-event abort by emitting an intermediate event then aborting. */
  events?: SandboxEvent[]
  /** Called after each yielded event (1-based) — lets a test abort between events. */
  onEvent?: (eventIndex: number) => void
}

/** One recorded `streamPrompt`: the box it ran on + the session id it carried. */
interface StreamCall {
  boxId: string
  sessionId?: string
}

/**
 * A fake sandbox client whose box additionally exposes `fs.read` (the artifact
 * seam `openSandboxRun` adds over the pure events path) and a live `session`
 * accessor (so `resume`'s `assertSessionLive` passes). Records every
 * `streamPrompt` so a test can prove `resume` reuses the same box + session id.
 */
function createFakeClient(opts: FakeOpts = {}) {
  const streamCalls: StreamCall[] = []
  const created: string[] = []
  const deleted: string[] = []
  const readPaths: string[] = []
  let boxSeq = 0

  function makeBox(id: string): SandboxInstance {
    const box = {
      id,
      async *streamPrompt(
        _message: string,
        options?: { sessionId?: string; signal?: AbortSignal },
      ): AsyncGenerator<SandboxEvent> {
        streamCalls.push({ boxId: id, sessionId: options?.sessionId })
        opts.onStream?.(streamCalls.length)
        const stream = opts.events ?? [
          { type: 'result', data: { ok: true, text: 'streamed' } } satisfies SandboxEvent,
        ]
        let i = 0
        for (const event of stream) {
          // Model the real backend: a cancelled stream throws AbortError on its
          // next pull rather than silently completing.
          if (options?.signal?.aborted) {
            const abort = new Error('aborted')
            abort.name = 'AbortError'
            throw abort
          }
          yield event
          i += 1
          opts.onEvent?.(i)
        }
      },
      fs: {
        async read(path: string): Promise<string> {
          readPaths.push(path)
          if (opts.fsRead) return opts.fsRead(path)
          return 'diff --git a/x b/x'
        },
      },
      async delete() {
        deleted.push(id)
      },
      session(_id: string) {
        return {
          async status() {
            return opts.sessionLive === false ? null : { id: _id, status: 'completed' as const }
          },
        }
      },
    }
    return box as unknown as SandboxInstance
  }

  const client = {
    async create(): Promise<SandboxInstance> {
      const id = `box-${boxSeq++}`
      created.push(id)
      return makeBox(id)
    },
    async criuStatus() {
      return { available: false }
    },
  }
  return { client, streamCalls, created, deleted, readPaths }
}

function spec(name = 'w'): AgentRunSpec<string> {
  return { profile: { name }, name, taskToPrompt: (t) => t }
}

function backendSpec(name = 'w'): AgentRunSpec<string> {
  return {
    profile: { name },
    name,
    taskToPrompt: (t) => t,
    sandboxOverrides: { backend: { type: 'opencode' } },
  }
}

const eventsDeliverable: Deliverable<{ text: string }> = {
  kind: 'events',
  fromEvents: (events) => ({
    text: String((events.at(-1)?.data as { text?: string } | undefined)?.text ?? ''),
  }),
}

function artifactDeliverable(path: string): Deliverable<{ raw: string; n: number }> {
  return {
    kind: 'artifact',
    path,
    fromArtifact: (raw, events) => ({ raw, n: events.length }),
  }
}

describe('openSandboxRun — events deliverable', () => {
  it('parses the drained event stream and exposes box + session id after start', async () => {
    const { client, streamCalls, created } = createFakeClient()
    const run = await openSandboxRun(
      client,
      { agentRun: spec(), signal: new AbortController().signal },
      eventsDeliverable,
    )
    const turn = await run.start('solve it')
    expect(turn.out).toEqual({ text: 'streamed' })
    expect(turn.readError).toBeUndefined()
    expect(turn.events).toHaveLength(1)
    expect(created).toHaveLength(1)
    expect(streamCalls).toHaveLength(1)
    expect(run.box.id).toBe('box-0')
    expect(run.sessionId).toBe(streamCalls[0]!.sessionId)
    expect(run.sessionId).toBeDefined()
  })
})

describe('openSandboxRun — artifact deliverable (the file-read seam over OutputAdapter)', () => {
  it('reads the workspace-relative artifact after the turn drains and maps it', async () => {
    const { client, readPaths } = createFakeClient({ fsRead: () => 'PATCH-CONTENT' })
    const run = await openSandboxRun(
      client,
      { agentRun: spec(), signal: new AbortController().signal },
      artifactDeliverable('solution.patch'),
    )
    const turn = await run.start('write the patch')
    expect(turn.out).toEqual({ raw: 'PATCH-CONTENT', n: 1 })
    expect(turn.readError).toBeUndefined()
    expect(readPaths).toEqual(['solution.patch'])
  })

  it('surfaces a persistently failed read in readError WITHOUT throwing (fault ≠ empty deliverable)', async () => {
    const { client, readPaths } = createFakeClient({
      fsRead: () => {
        throw new Error('outside allowed roots')
      },
    })
    const run = await openSandboxRun(
      // readRetryDelayMs: 0 — exercise the retry path without the production backoff wait.
      client,
      { agentRun: spec(), signal: new AbortController().signal, readRetryDelayMs: 0 },
      artifactDeliverable('solution.patch'),
    )
    const turn = await run.start('write the patch')
    expect(turn.readError).toMatch(/outside allowed roots/)
    // The deliverable still maps over the empty read — the caller decides what to do.
    expect(turn.out).toEqual({ raw: '', n: 1 })
    // A persistent failure exhausts the bounded retries (4 attempts), it does not loop forever.
    expect(readPaths.length).toBe(4)
  })

  it('RETRIES a transient read failure and recovers', async () => {
    let calls = 0
    const { client } = createFakeClient({
      // Fail the first two reads (a transient edge 404), succeed on the third.
      fsRead: () => {
        calls += 1
        if (calls < 3) throw new Error('Resource not found: unknown')
        return 'RECOVERED-PATCH'
      },
    })
    const run = await openSandboxRun(
      client,
      { agentRun: spec(), signal: new AbortController().signal, readRetryDelayMs: 0 },
      artifactDeliverable('solution.patch'),
    )
    const turn = await run.start('write the patch')
    expect(turn.readError).toBeUndefined()
    expect(turn.out).toEqual({ raw: 'RECOVERED-PATCH', n: 1 })
    expect(calls).toBe(3)
  })
})

describe('openSandboxRun — resume continues the SAME session over the SAME box', () => {
  it('reuses the box + session id and does not re-create', async () => {
    const { client, streamCalls, created } = createFakeClient({ sessionLive: true })
    const run = await openSandboxRun(
      client,
      { agentRun: spec(), signal: new AbortController().signal },
      eventsDeliverable,
    )
    await run.start('turn 1')
    await run.resume('turn 2')
    expect(created).toHaveLength(1)
    expect(streamCalls).toHaveLength(2)
    expect(streamCalls[1]!.boxId).toBe(streamCalls[0]!.boxId)
    expect(streamCalls[1]!.sessionId).toBe(streamCalls[0]!.sessionId)
  })

  it('fails loud when the platform reports the resumed session is unknown', async () => {
    const { client } = createFakeClient({ sessionLive: false })
    const run = await openSandboxRun(
      client,
      { agentRun: spec(), signal: new AbortController().signal },
      eventsDeliverable,
    )
    await run.start('turn 1')
    await expect(run.resume('turn 2')).rejects.toThrow(/not known to the sandbox/)
  })
})

describe('openSandboxRun — lifecycle guardrails', () => {
  it('throws on a second start() (use resume to continue)', async () => {
    const { client } = createFakeClient()
    const run = await openSandboxRun(
      client,
      { agentRun: spec(), signal: new AbortController().signal },
      eventsDeliverable,
    )
    await run.start('turn 1')
    await expect(run.start('turn 1 again')).rejects.toThrow(/already called/)
  })

  it('throws on resume() before start()', async () => {
    const { client } = createFakeClient()
    const run = await openSandboxRun(
      client,
      { agentRun: spec(), signal: new AbortController().signal },
      eventsDeliverable,
    )
    await expect(run.resume('too early')).rejects.toThrow(/before start/)
  })

  it('throws on box / sessionId access before start()', async () => {
    const { client } = createFakeClient()
    const run = await openSandboxRun(
      client,
      { agentRun: spec(), signal: new AbortController().signal },
      eventsDeliverable,
    )
    expect(() => run.box).toThrow(/before start/)
    expect(() => run.sessionId).toThrow(/before start/)
  })

  it('close() before start() is a safe no-op (no box to reap, no throw)', async () => {
    const { client, deleted } = createFakeClient()
    const run = await openSandboxRun(
      client,
      { agentRun: spec(), signal: new AbortController().signal },
      eventsDeliverable,
    )
    await expect(run.close()).resolves.toBeUndefined()
    expect(deleted).toHaveLength(0)
  })

  it('close() tears down the started box', async () => {
    const { client, deleted } = createFakeClient()
    const run = await openSandboxRun(
      client,
      { agentRun: spec(), signal: new AbortController().signal },
      eventsDeliverable,
    )
    await run.start('turn 1')
    await run.close()
    expect(deleted).toEqual(['box-0'])
  })
})

describe('openSandboxRun — abort-aware artifact read preserves the partial trace', () => {
  it('throws a SandboxRunAbortError carrying the drained events (does not read) on pre-read abort', async () => {
    const controller = new AbortController()
    const partialEvents: SandboxEvent[] = [
      { type: 'step', data: { i: 0 } } as SandboxEvent,
      { type: 'step', data: { i: 1 } } as SandboxEvent,
    ]
    // Abort once the whole stream has drained but before the artifact read — the
    // events collected so far must ride out on the thrown error, never silently
    // read a stale workspace after cancel.
    const { client, readPaths } = createFakeClient({
      events: partialEvents,
      onEvent: (i) => {
        if (i === partialEvents.length) controller.abort()
      },
    })
    const run = await openSandboxRun(
      client,
      { agentRun: spec(), signal: controller.signal },
      artifactDeliverable('solution.patch'),
    )
    const err = await run.start('write the patch').then(
      () => {
        throw new Error('expected abort')
      },
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(SandboxRunAbortError)
    expect((err as Error).name).toBe('AbortError')
    // The partial trace is preserved — diagnosable as "looped/ran", not "never started".
    expect((err as SandboxRunAbortError).events).toEqual(partialEvents)
    expect(readPaths).toHaveLength(0)
  })

  it('carries ONLY the events drained before a mid-stream abort (never-started stays empty)', async () => {
    const controller = new AbortController()
    const streamed: SandboxEvent[] = [
      { type: 'step', data: { i: 0 } } as SandboxEvent,
      { type: 'step', data: { i: 1 } } as SandboxEvent,
      { type: 'result', data: { ok: true } } as SandboxEvent,
    ]
    // Abort after the FIRST event is drained; the stream throws on its next pull,
    // so only that one event is carried out.
    const { client } = createFakeClient({
      events: streamed,
      onEvent: (i) => {
        if (i === 1) controller.abort()
      },
    })
    const run = await openSandboxRun(
      client,
      { agentRun: spec(), signal: controller.signal },
      eventsDeliverable,
    )
    const err = await run.start('go').then(
      () => {
        throw new Error('expected abort')
      },
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(SandboxRunAbortError)
    expect((err as SandboxRunAbortError).events).toEqual([streamed[0]])
  })

  it('preserves partial events when the read loop is aborted mid-retry, with the last readError', async () => {
    const controller = new AbortController()
    const partialEvents: SandboxEvent[] = [{ type: 'result', data: { ok: true } } as SandboxEvent]
    let reads = 0
    const { client } = createFakeClient({
      events: partialEvents,
      // The first read fails (transient), and the signal aborts during the backoff;
      // the next attempt's guard must throw the typed error carrying both the events
      // and the last readError so the failure is diagnosable, not masked as empty.
      fsRead: () => {
        reads += 1
        controller.abort()
        throw new Error('Resource not found: still flushing')
      },
    })
    const run = await openSandboxRun(
      client,
      { agentRun: spec(), signal: controller.signal, readRetryDelayMs: 0 },
      artifactDeliverable('solution.patch'),
    )
    const err = await run.start('write the patch').then(
      () => {
        throw new Error('expected abort')
      },
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(SandboxRunAbortError)
    expect((err as SandboxRunAbortError).events).toEqual(partialEvents)
    expect((err as SandboxRunAbortError).readError).toMatch(/still flushing/)
    // One read attempted, then the post-backoff guard short-circuits the retries.
    expect(reads).toBe(1)
  })
})

describe('openSandboxRun — runtime hooks', () => {
  it('emits passive run and turn lifecycle events for start, resume, and close', async () => {
    const { client } = createFakeClient({ sessionLive: true })
    const events: RuntimeHookEvent[] = []
    let t = 1_000
    const run = await openSandboxRun(
      client,
      {
        agentRun: backendSpec('coder'),
        signal: new AbortController().signal,
        hooks: { onEvent: (event) => void events.push(event) },
        runId: 'bench-run-1',
        scenarioId: 'case-1',
        now: () => t++,
      },
      artifactDeliverable('solution.patch'),
    )

    await run.start('first turn')
    await run.resume('second turn')
    await run.close()

    expect(
      events.map((event) => `${event.target}:${event.phase}:${event.stepIndex ?? '-'}`),
    ).toEqual([
      'agent.run:before:-',
      'agent.turn:before:0',
      'agent.turn:after:0',
      'agent.turn:before:1',
      'agent.turn:after:1',
      'agent.run:after:-',
    ])
    expect(events.every((event) => event.runId === 'bench-run-1')).toBe(true)
    expect(events.every((event) => event.scenarioId === 'case-1')).toBe(true)
    expect(events.every((event) => event.metadata?.producer === 'openSandboxRun')).toBe(true)
    expect(events[0]!.payload).toMatchObject({
      agentName: 'coder',
      profileName: 'coder',
      backendType: 'opencode',
      deliverableKind: 'artifact',
      deliverablePath: 'solution.patch',
      turnCount: 0,
    })
    expect(events[2]!.payload).toMatchObject({
      agentName: 'coder',
      turnKind: 'start',
      promptChars: 'first turn'.length,
      eventCount: 1,
      eventTypes: { result: 1 },
      sessionId: expect.any(String),
      sandboxId: 'box-0',
    })
    expect(events[4]!.payload).toMatchObject({
      turnKind: 'resume',
      promptChars: 'second turn'.length,
      eventCount: 1,
      eventTypes: { result: 1 },
      sessionId: (events[2]!.payload as { sessionId: string }).sessionId,
      sandboxId: 'box-0',
    })
    expect(events[5]!.payload).toMatchObject({
      turnCount: 2,
      sessionId: (events[2]!.payload as { sessionId: string }).sessionId,
      sandboxId: 'box-0',
    })
  })

  it('keeps hook failures non-fatal and reports them through onHookError', async () => {
    const { client } = createFakeClient()
    const hookErrors: string[] = []
    const run = await openSandboxRun(
      client,
      {
        agentRun: spec(),
        signal: new AbortController().signal,
        hooks: {
          onEvent: () => {
            throw new Error('hook down')
          },
          onHookError: (error, context) => {
            hookErrors.push(`${context.hook}:${context.target}:${context.phase}:${error.message}`)
          },
        },
        runId: 'bench-run-2',
      },
      eventsDeliverable,
    )

    const turn = await run.start('still runs')

    expect(turn.out).toEqual({ text: 'streamed' })
    expect(hookErrors).toContain('onEvent:agent.run:before:hook down')
    expect(hookErrors).toContain('onEvent:agent.turn:after:hook down')
  })
})
