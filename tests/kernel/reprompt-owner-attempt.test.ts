import {
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import {
  recordScopeOwnerMaterialization,
  scopeOwnerExecutorNodeContext,
} from '../../src/runtime/supervise/scope'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type { DriveHarness } from '../../src/runtime/supervise/supervisor-agent'
import type { Agent, Budget, ExecutorExecutionBinding } from '../../src/runtime/supervise/types'
import { supervisorAgent } from '../helpers/runtime-with-test-brain'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

const perWorker: Budget = { maxIterations: 4, maxTokens: 1000 }

async function jsonRpc(url: string, method: string, params: unknown): Promise<unknown> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return r.json()
}

function deliveringLeaf(name: string, out: unknown): Agent<unknown, unknown> {
  return {
    name,
    async act() {
      return out
    },
  }
}

function declarationFor(profile: ReturnType<typeof testAgentProfile>) {
  return {
    effectiveProfile: profile,
    backend: 'test-bridge',
    model: { status: 'known' as const, id: 'test/model' },
    execution: { kind: 'session', id: 'test-session' },
    materializer: 'test-materializer',
    plan: { kind: 'test-plan', model: 'test/model' },
  }
}

function bindingFor(attemptId: string, session: string): ExecutorExecutionBinding {
  return {
    attemptId,
    binding: { endpoint: 'https://router.example.test', session },
    descriptor: { kind: 'test-session', transport: 'http' },
  }
}

describe('a re-prompted root is a new execution attempt (#1085)', () => {
  it('journals the second drive under a fresh attempt id instead of refusing it as a duplicate binding', async () => {
    // The measured shape: a Runtime-owned CLI root (deferred materialization) reports its
    // execution binding on every drive. The first drive returns with the completion check unmet;
    // `repromptOnUnmet` re-enters the harness, which reports again — a NEW session, hence a new
    // binding — and before this the report carried the first drive's attempt id, the journal
    // refused it as "duplicate execution binding", and the driver retried into the same wall.
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const profile = testAgentProfile('sup', {
      harness: 'pi',
      model: { provider: 'offline', default: 'test/model' },
      prompt: { systemPrompt: 'solve or delegate' },
      tools: runtimeToolDeclarations('submit_result'),
    })
    const reported: string[] = []
    const driveHarness: DriveHarness = async ({ coordinationMcpUrl, scope }) => {
      const { attemptId } = scopeOwnerExecutorNodeContext(scope)
      reported.push(attemptId)
      await recordScopeOwnerMaterialization(
        scope,
        'cli',
        declarationFor(profile),
        bindingFor(attemptId, `session-${reported.length}`),
      )
      if (reported.length === 1) return
      await jsonRpc(coordinationMcpUrl, 'tools/call', {
        name: 'submit_result',
        arguments: { result: { answer: 42 } },
      })
    }
    const root = supervisorAgent(profile, {
      blobs,
      makeWorkerAgent: () => deliveringLeaf('unused', {}),
      perWorker,
      driveHarness,
      deliverable: {
        describe: 'an object whose answer is 42',
        check: (result) => (result as { answer?: unknown }).answer === 42,
      },
      repromptOnUnmet: 1,
    })

    const result = await createSupervisor<unknown, unknown>().run(root, 'solve it', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'sup',
      journal,
      blobs,
      executors: createExecutorRegistry(),
      maxDepth: 4,
      now: () => 0,
      rootIdentity: {
        profileDigest: canonicalAgentProfileDigest(profile),
        taskDigest: canonicalCandidateDigest('solve it'),
      },
      rootMaterialization: { runtime: 'cli', declaration: 'deferred', authoredProfile: profile },
    })

    expect(result.kind).toBe('winner')
    if (result.kind === 'winner') expect(result.out).toEqual({ answer: 42 })
    expect(reported).toHaveLength(2)
    expect(reported[0]).not.toBe(reported[1])

    const events = (await journal.loadTree('sup')) ?? []
    const bindings = events.filter((e) => e.kind === 'execution-bound' && e.id === 'sup')
    expect(bindings.map((e) => (e.kind === 'execution-bound' ? e.binding.attemptId : ''))).toEqual(
      reported,
    )
    expect(events.some((e) => JSON.stringify(e).includes('spawn journal corrupted'))).toBe(false)
  })
})

describe('a re-prompted root in a new execution environment (#1225, #1230)', () => {
  // The fleet shape: a sandbox-placed root gets a NEW environment for its re-prompted attempt, so
  // the second report carries a different execution id. Measured on
  // mech-interp-foundations-pi-20260914e, -20260915g and -20260915h: the first turn completes, the
  // reprompt fires, and every attempt after it is refused. This drives the real supervisor and
  // the real reprompt loop with no sandbox and no model, so the guard is the only thing under test.
  it('accepts the second attempt when only the execution instance moved', async () => {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    const profile = testAgentProfile('sup', {
      harness: 'pi',
      model: { provider: 'offline', default: 'test/model' },
      prompt: { systemPrompt: 'solve or delegate' },
      tools: runtimeToolDeclarations('submit_result'),
    })
    const reported: string[] = []
    const driveHarness: DriveHarness = async ({ coordinationMcpUrl, scope }) => {
      const { attemptId } = scopeOwnerExecutorNodeContext(scope)
      reported.push(attemptId)
      const environment = `sandbox-${reported.length}`
      await recordScopeOwnerMaterialization(
        scope,
        'tangle-sandbox',
        { ...declarationFor(profile), backend: 'tangle-sandbox', execution: { kind: 'environment', id: environment } },
        bindingFor(attemptId, environment),
      )
      if (reported.length === 1) return
      await jsonRpc(coordinationMcpUrl, 'tools/call', {
        name: 'submit_result',
        arguments: { result: { answer: 42 } },
      })
    }
    const root = supervisorAgent(profile, {
      blobs,
      makeWorkerAgent: () => deliveringLeaf('unused', {}),
      perWorker,
      driveHarness,
      deliverable: {
        describe: 'an object whose answer is 42',
        check: (result) => (result as { answer?: unknown }).answer === 42,
      },
      repromptOnUnmet: 1,
    })

    const result = await createSupervisor<unknown, unknown>().run(root, 'solve it', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'sup',
      journal,
      blobs,
      executors: createExecutorRegistry(),
      maxDepth: 4,
      now: () => 0,
      rootIdentity: {
        profileDigest: canonicalAgentProfileDigest(profile),
        taskDigest: canonicalCandidateDigest('solve it'),
      },
      rootMaterialization: { runtime: 'tangle-sandbox', declaration: 'deferred', authoredProfile: profile },
    })

    expect(result.kind).toBe('winner')
    expect(reported).toHaveLength(2)

    const events = (await journal.loadTree('sup')) ?? []
    const materialized = events.filter((e) => e.kind === 'materialized' && e.id === 'sup')
    expect(materialized).toHaveLength(1)
    const bindings = events.filter((e) => e.kind === 'execution-bound' && e.id === 'sup')
    expect(bindings.map((e) => (e.kind === 'execution-bound' ? e.binding.status : ''))).toEqual([
      'known',
      'known',
    ])
  })
})
