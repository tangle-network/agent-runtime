import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../durable/spawn-journal'
import { createBudgetPool } from './budget'
import { createExecutorRegistry } from './runtime'
import { beginScopeOwnerAttempt, createScope, recordScopeOwnerMaterialization } from './scope'
import type { ExecutorMaterialization, SpawnEvent } from './types'

/**
 * A root that completes a turn and is then re-prompted runs its next attempt in a NEW environment:
 * Runtime asks the provider for one, and a retained environment can be replaced between attempts.
 * The mid-run guard compared whole receipts, so the new environment id read as "materialization
 * changed mid-run", the refusal surfaced as a transient RetainedExecutionPendingError, and every
 * remaining driver attempt hit the same wall. Measured on mech-interp-foundations-pi-20260914e,
 * whose two bindings carry one receipt digest and whose admissions name two sandboxes
 * (agent-runtime#1225).
 */
describe('scope owner materialization across driver attempts', () => {
  const profile: AgentProfile = {
    name: 'owner',
    harness: 'claude-code',
    model: { provider: 'fixture', default: 'fixture/model' },
  }

  const declaration = (
    environmentId: string,
    backend = 'tangle-sandbox',
  ): ExecutorMaterialization => ({
    effectiveProfile: profile,
    authoredProfile: profile,
    backend,
    model: { status: 'known', id: 'zai/glm-5.3' },
    execution: { kind: 'environment', id: environmentId },
    materializer: 'environment-provider-create',
    plan: { image: 'fixture-image' },
    platformAttachments: { coordination: 'http' },
  })

  const scopeUnderTest = async () => {
    const journal = new InMemorySpawnJournal()
    const blobs = new InMemoryResultBlobStore()
    await journal.beginTree('root', new Date(0).toISOString())
    // The journal refuses materialization for a node it has not seen spawned, which the supervisor
    // writes in a real run.
    await journal.appendEvent('root', {
      kind: 'spawned',
      id: 'root',
      label: 'root',
      budget: { maxIterations: 2, maxTokens: 100 },
      runtime: 'tangle-sandbox',
      seq: 0,
      at: new Date(0).toISOString(),
    })
    const scope = createScope({
      parentId: 'root',
      root: 'root',
      journal,
      blobs,
      pool: createBudgetPool({ maxIterations: 2, maxTokens: 100 }, 0),
      executors: createExecutorRegistry(),
      seams: {},
      depth: 0,
      signal: new AbortController().signal,
      ownerMaterialization: {
        runtime: 'tangle-sandbox',
        authoredProfile: profile,
        attemptId: 'root:attempt:1',
      },
    })
    return { scope, journal }
  }

  const publish = (
    scope: Awaited<ReturnType<typeof scopeUnderTest>>['scope'],
    attemptId: string,
    exact: ExecutorMaterialization,
  ) =>
    recordScopeOwnerMaterialization(scope, 'tangle-sandbox', exact, {
      attemptId,
      binding: { url: `https://${exact.execution.id}.example` },
      descriptor: { kind: 'agent-environment', backend: 'tangle-sandbox' },
    })

  const kinds = async (journal: InMemorySpawnJournal, kind: SpawnEvent['kind']) =>
    ((await journal.loadTree('root')) ?? []).filter((event) => event.kind === kind)

  it('accepts a later attempt in a new environment and journals that environment', async () => {
    const { scope, journal } = await scopeUnderTest()
    await publish(scope, 'root:attempt:1', declaration('sandbox-first'))
    const second = beginScopeOwnerAttempt(scope, 2)
    expect(second).toBeTypeOf('string')
    await publish(scope, second as string, declaration('sandbox-second'))

    // One committed materialization per node, and both attempts bind to it as known bindings. The
    // rejected shape wrote an `unknown` binding with reason `invalid-executor-report` instead.
    const materialized = await kinds(journal, 'materialized')
    expect(materialized).toHaveLength(1)
    const bindings = await kinds(journal, 'execution-bound')
    expect(bindings).toHaveLength(2)
    expect(
      bindings.map((event) =>
        event.kind === 'execution-bound' ? event.binding.status : undefined,
      ),
    ).toEqual(['known', 'known'])
    expect(
      new Set(
        bindings.map((event) =>
          event.kind === 'execution-bound' ? event.binding.attemptId : undefined,
        ),
      ).size,
    ).toBe(2)
  })

  it('still refuses a later attempt that changes what the run must hold fixed', async () => {
    const { scope, journal } = await scopeUnderTest()
    await publish(scope, 'root:attempt:1', declaration('sandbox-first'))
    const second = beginScopeOwnerAttempt(scope, 2)
    await expect(
      publish(scope, second as string, declaration('sandbox-second', 'a-different-backend')),
    ).rejects.toThrow('scope owner materialization changed mid-run')
    expect(await kinds(journal, 'materialized')).toHaveLength(1)
  })

  // A rejection that names four candidate fields and identifies none of them cannot be diagnosed
  // from the journal, because the rejected receipt is not written there. Two production runs
  // (mech-interp-foundations-pi-20260915g and -20260915h) lost ten bindings to this guard with no
  // way to tell which field had moved.
  it('names the field that moved, so a rejection can be diagnosed from the message', async () => {
    const { scope } = await scopeUnderTest()
    await publish(scope, 'root:attempt:1', declaration('sandbox-first'))
    const second = beginScopeOwnerAttempt(scope, 2)
    await expect(
      publish(scope, second as string, declaration('sandbox-second', 'a-different-backend')),
    ).rejects.toThrow(/differ: .*\bbackend\b/)
  })

  it('names every field that moved, not just the first', async () => {
    const { scope } = await scopeUnderTest()
    await publish(scope, 'root:attempt:1', declaration('sandbox-first'))
    const second = beginScopeOwnerAttempt(scope, 2)
    const moved = {
      ...declaration('sandbox-second', 'a-different-backend'),
      plan: { image: 'a-different-image' },
    }
    const error = await publish(scope, second as string, moved).catch((thrown: unknown) => thrown)
    const message = error instanceof Error ? error.message : String(error)
    // The receipt stores the plan as a digest, so that is the name an operator sees and the name
    // this test pins. Both moved fields appear, in the receipt's own vocabulary.
    expect(message).toContain('backend')
    expect(message).toContain('materializationPlanDigest')
  })

  it('appends only a binding when the same attempt republishes the same environment', async () => {
    const { scope, journal } = await scopeUnderTest()
    await publish(scope, 'root:attempt:1', declaration('sandbox-first'))
    const second = beginScopeOwnerAttempt(scope, 2)
    await publish(scope, second as string, declaration('sandbox-first'))

    expect(await kinds(journal, 'materialized')).toHaveLength(1)
    expect(await kinds(journal, 'execution-bound')).toHaveLength(2)
  })
})
