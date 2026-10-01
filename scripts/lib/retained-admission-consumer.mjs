import assert from 'node:assert/strict'

/** Exercise retained admission through public Runtime APIs without network or inference. */
export async function verifyRetainedAdmissionConsumer(kernel) {
  const cases = [
    [400, 'dispatch', 'terminal'],
    [401, 'dispatch', 'terminal'],
    [429, 'dispatch', 'unavailable'],
    [408, 'dispatch', 'transient'],
    [500, 'dispatch', 'transient'],
    [502, 'dispatch', 'transient'],
    [503, 'dispatch', 'unavailable'],
    [529, 'dispatch', 'unavailable'],
    [404, 'lookup', 'transient'],
    [404, 'result', 'transient'],
  ]
  for (const [status, stage, expected] of cases) {
    const original = Object.assign(new Error('fixture refusal'), {
      status,
      ...(stage === 'dispatch'
        ? {}
        : { cause: Object.assign(new Error('nested refusal'), { status: 400 }) }),
    })
    assert.equal(
      kernel.classifyDriverFailure(Object.assign(new Error('direct control'), { status })),
      [429, 503, 529].includes(status) ? 'unavailable' : status === 408 || status >= 500 ? 'transient' : 'terminal',
    )
    const fixture = retainedFixture(original, stage)
    const base = kernel.providerAsExecutor(fixture.provider, { destroyOnSettle: false, unavailablePause: false })
    let observed
    const factory = Object.assign((spec, context) => {
      const executor = base(spec, context)
      return {
        ...executor,
        async *execute(task, signal) {
          try {
            yield* executor.execute(task, signal)
          } catch (error) {
            observed = error
            throw error
          }
        },
      }
    }, base)
    const journal = new kernel.InMemorySpawnJournal()
    const runId = 'packed-admission-' + status + '-' + stage
    const result = await kernel.createSupervisor().run({
      name: runId,
      async act(_task, scope) {
        const spawned = scope.spawn({
          name: 'fixture',
          act: async () => { throw new Error('fixture must use its provider executor') },
          executorSpec: {
            harness: 'opencode',
            executorFactory: factory,
            profile: {
              name: 'fixture',
              harness: 'opencode',
              model: { provider: 'fixture', default: 'fixture/model' },
            },
          },
        }, 'fixture task', { key: 'probe', budget: { maxIterations: 1, maxTokens: 10 } })
        assert.equal(spawned.ok, true)
        await scope.next()
      },
    }, 'fixture task', {
      runId,
      retainedAtSettlement: 'keep',
      budget: { maxIterations: 2, maxTokens: 20, deadlineMs: 2_000 },
      journal,
      blobs: new kernel.InMemoryResultBlobStore(),
      executors: kernel.createExecutorRegistry(),
    })
    assert.ok(observed instanceof Error, JSON.stringify({
      result,
      counts: fixture.counts,
      journal: await journal.loadTree(runId),
    }))
    assert.equal(observed.name, 'RetainedExecutionPendingError')
    assert.equal(kernel.classifyDriverFailure(observed), expected)
    if ([429, 503, 529].includes(status))
      assert.equal(kernel.upstreamUnavailableSignal(observed), 'http-' + status)
    const admissions = (await journal.loadTree(runId))
      .filter((event) => event.kind === 'execution-admitted')
      .map((event) => event.admission.phase)
    assert.deepEqual(
      admissions,
      stage === 'dispatch' ? ['intent', 'environment'] : ['intent', 'environment', 'dispatched'],
    )
    assert.deepEqual(fixture.counts, { creates: 1, dispatches: 1 })
  }
}

function retainedFixture(failure, stage) {
  const counts = { creates: 0, dispatches: 0 }
  let session
  let accepted = false
  const environment = {
    id: 'fixture-environment',
    provider: 'fixture-provider',
    status: async () => 'running',
    async *stream() { throw new Error('retained fixture must not stream directly') },
    destroy: async () => {},
    async dispatch(input) {
      counts.dispatches += 1
      if (stage === 'dispatch') throw failure
      const controlRef = {
        runId: 'fixture-native-run',
        provider: 'fixture-provider',
        environmentId: environment.id,
        sessionId: input.sessionId,
        executionId: input.executionId,
        requestDigest: 'sha256:' + 'a'.repeat(64),
      }
      session = {
        id: input.sessionId,
        provider: 'fixture-provider',
        controlRef,
        status: async () => 'running',
        async *events() {},
        result: async () => { throw failure },
      }
      accepted = true
      return { id: session.id, provider: 'fixture-provider', controlRef }
    },
    session: () => session,
  }
  return {
    counts,
    provider: {
      name: 'fixture-provider',
      capabilities: async () => ({
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
        retainedControl: {
          exactRunIdentity: true,
          resultIdentity: true,
          eventIdentity: true,
          cancellationIdempotency: true,
        },
        workspace: {
          read: false, write: false, exec: false, git: false, upload: false, download: false,
        },
        branching: { checkpoint: false, fork: false },
        placement: false,
        usage: false,
        confidential: false,
      }),
      async create() {
        counts.creates += 1
        return environment
      },
      async get() {
        if (accepted && stage === 'lookup') throw failure
        return environment
      },
    },
  }
}
