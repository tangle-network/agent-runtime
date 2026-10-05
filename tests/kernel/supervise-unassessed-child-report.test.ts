import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import { contentAddress } from '../../src/durable/spawn-journal'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { supervise } from '../../src/runtime/supervise/supervise'
import { testContinuation } from '../helpers/continuation'
import { durableRetainedProvider } from '../helpers/durable-retained-provider'
import { runtimeToolDeclarations, testAgentProfile } from './test-agent-profile'

/** The events a woken manager's input lists, in order. A first turn lists none. */
function wakeEventsIn(prompt: unknown): Array<Record<string, any>> {
  return String(prompt ?? '')
    .split('\n')
    .filter((line) => line.startsWith('- {'))
    .map((line) => JSON.parse(line.slice(2)) as Record<string, any>)
}

async function childReportFlow(mode: 'unassessed' | 'nested' | 'checked' | 'submitted' | 'failed') {
  const directory = await mkdtemp(join(tmpdir(), 'unassessed-child-report-'))
  const runId = 'child-report'
  const context = createFileRunContext(join(directory, 'run'))
  const base = durableRetainedProvider(join(directory, 'provider.json'))
  const receipts: unknown[] = []
  const reads: unknown[] = []
  const report = {
    text: 'A useful hypothesis with retained replay evidence.',
    evidence: ['output/replay.sh', 'output/evidence.json'],
  }
  const accepted = { answer: 42 }
  const child = testAgentProfile('specialist', {
    harness: 'claude-code',
    tools:
      mode === 'nested'
        ? runtimeToolDeclarations('spawn_worker', 'observe_agent')
        : runtimeToolDeclarations(mode === 'submitted' ? 'submit_result' : 'observe_agent'),
  })
  const grandchild = testAgentProfile('checked-specialist', {
    harness: 'claude-code',
    tools: runtimeToolDeclarations('submit_result'),
  })
  let childCheckCalls = 0
  // A woken manager reattaches its environment through `get`, so each environment keeps its wrapper.
  const wrappers = new Map<string, (environment: AgentEnvironment) => AgentEnvironment>()
  const provider: AgentEnvironmentProvider = {
    ...base,
    capabilities: async () => ({
      ...(await base.capabilities()),
      create: { runtimeAttachments: { mcp: true } },
    }),
    create: async (input) => {
      const environment = await base.create(input)
      const attachment = input.runtimeAttachments?.mcp?.['agent-runtime-coordination']
      if (attachment?.transport !== 'http') throw new Error('missing coordination attachment')
      const call = async (name: string, args: unknown) => {
        const response = await fetch(attachment.url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${input.env?.AGENT_RUNTIME_COORDINATION_TOKEN}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: name,
            method: 'tools/call',
            params: { name, arguments: args },
          }),
        })
        const body = await response.json()
        if (!response.ok || body.error || body.result?.isError)
          throw new Error(JSON.stringify(body))
        return JSON.parse(body.result.content[0].text)
      }
      const isRoot = typeof input.profile !== 'string' && input.profile.name === 'root'
      const isGrandchild =
        typeof input.profile !== 'string' && input.profile.name === grandchild.name
      const wrap = (environment: AgentEnvironment): AgentEnvironment => ({
        ...environment,
        dispatch: async (turn) => {
          const dispatched = await environment.dispatch!(turn)
          // A manager's first turn spawns and ends; its wake lists what its worker reported.
          const woken = wakeEventsIn(turn.prompt)
          if (isRoot) {
            if (woken.length === 0) {
              await call('spawn_worker', {
                profile: child,
                task: 'Investigate and report the evidence.',
              })
            }
            for (const receipt of woken.filter((event) => event.type === 'settled')) {
              receipts.push(receipt)
              if (receipt.outputRead)
                reads.push(await call(receipt.outputRead.tool, receipt.outputRead.arguments))
            }
          } else if (mode === 'submitted' || isGrandchild) {
            await call('submit_result', { result: accepted })
          } else if (mode === 'nested' && woken.length === 0) {
            await call('spawn_worker', {
              profile: grandchild,
              task: 'Produce an independently checked answer.',
            })
          }
          return dispatched
        },
        session: (id, options) => {
          const session = environment.session!(id, options)
          return {
            ...session,
            result: async () => ({
              ...(await session.result()),
              text: isRoot ? 'Root read its child.' : JSON.stringify(report),
              usage: { inputTokens: 3, outputTokens: 2 },
              ...(mode === 'failed' && !isRoot
                ? { success: false, error: 'native report failed', statusCode: 400 }
                : {}),
            }),
          }
        },
      })
      wrappers.set(environment.id, wrap)
      return wrap(environment)
    },
    get: async (id) => {
      const environment = await base.get!(id)
      const wrap = wrappers.get(id)
      return environment && wrap ? wrap(environment) : environment
    },
  }
  try {
    const result = await supervise(
      testAgentProfile('root', {
        harness: 'claude-code',
        tools: runtimeToolDeclarations('spawn_worker', 'observe_agent'),
      }),
      'Delegate useful research.',
      {
        runId,
        runDir: join(directory, 'run'),
        journal: context.journal,
        blobs: context.blobs,
        backend: { backend: 'provider', provider },
        driverBackend: { backend: 'provider', provider },
        budget: { maxIterations: 20, maxTokens: 1000, deadlineMs: 30000 },
        perWorker: { maxIterations: 4, maxTokens: 100 },
        maxDepth: 3,
        driverRetry: { enabled: false },
        // The deadline here is short; a warning due at once would wake a manager that heard nothing.
        wake: { deadlineWarningMs: 0 },
        deliverable: { check: (value) => (value as { answer?: unknown })?.answer === 42 },
        continuation: testContinuation({ deadline: 1 }),
        resolveDeliverable: (input) =>
          mode === 'checked' || mode === 'submitted' || input.profile.name === grandchild.name
            ? {
                check: (value) => {
                  childCheckCalls++
                  return (value as { answer?: unknown })?.answer === 42
                },
              }
            : null,
        ...(mode === 'nested' ? { finalizer: () => undefined } : {}),
        coordination: {
          authentication: {
            signingKeys: { activeKeyId: 'test', keys: { test: 'test-secret-'.repeat(4) } },
          },
          publicUrl: (address) => `http://127.0.0.1:${address.port}/manager`,
        },
      },
    )
    // Reopen the durable stores: the parent-visible bytes must survive the live read.
    const reopened = createFileRunContext(join(directory, 'run'))
    const events = (await reopened.journal.loadTree(runId)) ?? []
    const settlement = events.find((event) => event.kind === 'settled' && event.id !== runId)
    const outRef = settlement?.kind === 'settled' ? settlement.outRef : undefined
    const persisted = outRef === undefined ? undefined : await reopened.blobs.get(outRef)
    return {
      result,
      receipts,
      reads,
      report,
      accepted,
      settlement,
      persisted,
      outRef,
      childCheckCalls,
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe('managed native child report in the parent wake', () => {
  it('retains a direct report as unassessed without making it a checked winner', async () => {
    const flow = await childReportFlow('unassessed')
    expect(flow.persisted).toMatchObject({ content: JSON.stringify(flow.report) })
    expect(flow.receipts).toEqual([
      expect.objectContaining({ type: 'settled', status: 'done', assessment: 'unassessed' }),
    ])
    expect(flow.receipts[0]).not.toHaveProperty('valid')
    expect(flow.receipts[0]).not.toHaveProperty('score')
    expect(flow.reads).toEqual([
      expect.objectContaining({
        output: expect.objectContaining({ content: JSON.stringify(flow.report) }),
      }),
    ])
    expect(flow.outRef).toBe(contentAddress(flow.persisted))
    expect(flow.settlement).not.toHaveProperty('verdict')
    expect(flow.childCheckCalls).toBe(0)
    expect(flow.result.kind).toBe('no-winner')
  })

  it('cannot bypass a declared completion check with raw native prose', async () => {
    const flow = await childReportFlow('checked')
    expect(flow.persisted).toBeNull()
    expect(flow.receipts[0]).not.toHaveProperty('valid', true)
    expect(flow.childCheckCalls).toBe(0)
    expect(flow.result.kind).toBe('no-winner')
  })

  it('does not inherit a checked descendant verdict for its own unassessed report', async () => {
    const flow = await childReportFlow('nested')
    expect(flow.persisted).toMatchObject({ content: JSON.stringify(flow.report) })
    expect(flow.receipts[0]).toMatchObject({ status: 'done', assessment: 'unassessed' })
    expect(flow.receipts[0]).not.toHaveProperty('valid')
    expect(flow.receipts[0]).not.toHaveProperty('score')
    expect(flow.settlement).not.toHaveProperty('verdict')
    expect(flow.childCheckCalls).toBe(1)
    expect(flow.result.kind).toBe('no-winner')
  })

  it('keeps an independently accepted submit_result eligible', async () => {
    const flow = await childReportFlow('submitted')
    expect(flow.receipts[0]).toMatchObject({ status: 'done', valid: true, score: 1 })
    expect(flow.receipts[0]).not.toHaveProperty('assessment', 'unassessed')
    expect(flow.persisted).toEqual(flow.accepted)
    expect(flow.childCheckCalls).toBe(1)
    expect(flow.result.kind).toBe('winner')
  })

  it('does not retain a failed native attempt as a successful report', async () => {
    const flow = await childReportFlow('failed')
    expect(flow.receipts[0]).toMatchObject({ status: 'down' })
    expect(flow.receipts[0]).not.toHaveProperty('assessment', 'unassessed')
    expect(flow.result.kind).toBe('no-winner')
  })
})
