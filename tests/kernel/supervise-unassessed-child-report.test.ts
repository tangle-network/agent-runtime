import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'
import { describe, expect, it } from 'vitest'
import { contentAddress } from '../../src/durable/spawn-journal'
import { ValidationError } from '../../src/errors'
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

async function childReportFlow(
  mode: 'unassessed' | 'nested' | 'checked' | 'submitted' | 'failed' | 'seat-leaf',
  nativeGrantAvailable = true,
) {
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
    ...(mode === 'seat-leaf'
      ? {
          model: { provider: 'anthropic', default: 'claude-opus-4-1' },
          seats: [
            {
              harness: 'claude-code',
              provider: 'anthropic',
              model: 'claude-opus-4-1',
              selector: { kind: 'all-eligible' as const },
            },
            {
              harness: 'codex',
              provider: 'openai',
              model: 'gpt-6-sol',
              selector: { kind: 'all-eligible' as const },
              tools: {},
            },
          ],
        }
      : {}),
    tools:
      mode === 'seat-leaf'
        ? {}
        : mode === 'nested'
          ? runtimeToolDeclarations('spawn_worker', 'observe_agent')
          : runtimeToolDeclarations(mode === 'submitted' ? 'submit_result' : 'observe_agent'),
  })
  const grandchild = testAgentProfile('checked-specialist', {
    harness: 'claude-code',
    tools: runtimeToolDeclarations('submit_result'),
  })
  let childCheckCalls = 0
  let childDispatches = 0
  const childSeatMarkers: string[] = []
  const childInvocations: Array<{ environmentId: string; sessionId: string }> = []
  const nativeGrants: string[] = []
  const seatSelectionEnvironments: Array<string | undefined> = []
  const checkpoints = new Map<string, Map<string, string>>()
  const environmentFiles = new Map<string, Map<string, string>>()
  const filesOf = (id: string) => {
    const files = environmentFiles.get(id) ?? new Map<string, string>()
    environmentFiles.set(id, files)
    return files
  }
  // A woken manager reattaches its environment through `get`, so each environment keeps its wrapper.
  const wrappers = new Map<string, (environment: AgentEnvironment) => AgentEnvironment>()
  const provider: AgentEnvironmentProvider = {
    ...base,
    capabilities: async () => ({
      ...(await base.capabilities()),
      create: { runtimeAttachments: { mcp: true }, workspaceCheckpoint: true },
    }),
    create: async (input) => {
      const environment = await base.create(input)
      if (input.workspace?.checkpoint) {
        environmentFiles.set(
          environment.id,
          new Map(checkpoints.get(input.workspace.checkpoint.checkpointId)),
        )
      }
      if (
        mode === 'seat-leaf' &&
        typeof input.profile !== 'string' &&
        input.profile.name === child.name
      ) {
        childSeatMarkers.push(input.env?.SEAT_MARKER ?? '<missing>')
      }
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
        read: async (path) => filesOf(environment.id).get(path) ?? '',
        write: async (path, content) => {
          filesOf(environment.id).set(path, content)
        },
        workspaceBranching: {
          checkpoint: async (request) => {
            const checkpointId = `checkpoint-${checkpoints.size + 1}`
            checkpoints.set(checkpointId, new Map(filesOf(environment.id)))
            return {
              status: 'created' as const,
              idempotencyKey: request.idempotencyKey,
              requestDigest: request.requestDigest,
              checkpoint: {
                checkpointId,
                provider: environment.provider,
                source: request.source,
                idempotencyKey: request.idempotencyKey,
                requestDigest: request.requestDigest,
                createdAt: new Date().toISOString(),
              },
            }
          },
          deleteCheckpoint: async (request) => ({ ...request, status: 'deleted' as const }),
          lookupCheckpoint: async () => {
            throw new Error('not used')
          },
          fork: async () => {
            throw new Error('not used')
          },
          lookupFork: async () => {
            throw new Error('not used')
          },
          destroyFork: async () => {
            throw new Error('not used')
          },
        },
        dispatch: async (turn) => {
          const dispatched = await environment.dispatch!(turn)
          if (mode === 'seat-leaf' && !isRoot && !isGrandchild) {
            childInvocations.push({ environmentId: environment.id, sessionId: dispatched.id })
          }
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
          if (!isRoot && !isGrandchild) childDispatches++
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
              ...(mode === 'seat-leaf' && !isRoot && childDispatches <= 2
                ? { success: false, error: "You've hit your weekly limit" }
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
  const providerForSeat = (seat: string): AgentEnvironmentProvider => ({
    ...provider,
    get: async (id) => {
      const environment = await provider.get!(id)
      if (environment === null) return null
      return {
        ...environment,
        dispatch: async (turn) => {
          if (seat === 'b') {
            if (!nativeGrantAvailable)
              throw new ValidationError('native credential grant unavailable')
            nativeGrants.push(`${environment.id}:${seat}`)
          }
          return environment.dispatch!(turn)
        },
      }
    },
  })
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
        budget: {
          maxIterations: 20,
          maxTokens: 1000,
          deadlineMs: nativeGrantAvailable ? 30000 : 3000,
        },
        perWorker: { maxIterations: 4, maxTokens: 100 },
        maxDepth: 3,
        driverRetry:
          mode === 'seat-leaf'
            ? { enabled: true, unavailablePauseMs: 1, maxUnavailablePauseMs: 1 }
            : { enabled: false },
        ...(mode === 'seat-leaf'
          ? {
              selectSeat: async (request: {
                stageIndex: number
                excludedSeatIds: readonly string[]
                retainedEnvironmentId?: string
              }) => {
                seatSelectionEnvironments.push(request.retainedEnvironmentId)
                return request.stageIndex === 0 && request.excludedSeatIds.length > 1
                  ? { resumeAt: '2026-10-08T00:00:00.000Z' }
                  : {
                      seat:
                        request.stageIndex === 1
                          ? 'codex-seat-c'
                          : request.excludedSeatIds.length === 0
                            ? 'claude-seat-a'
                            : 'claude-seat-b',
                      backend: {
                        backend: 'provider' as const,
                        provider:
                          request.stageIndex === 0 && request.excludedSeatIds.length > 0
                            ? providerForSeat('b')
                            : provider,
                        defaults: { env: { SEAT_MARKER: request.stageIndex === 1 ? 'c' : 'a' } },
                      },
                      ...(request.stageIndex === 0 &&
                      request.excludedSeatIds.length > 0 &&
                      nativeGrantAvailable
                        ? { nativeTurnGrant: true as const }
                        : {}),
                    }
              },
            }
          : {}),
        // The deadline here is short; a warning due at once would wake a manager that heard nothing.
        wake: { deadlineWarningMs: 0 },
        deliverable: { check: (value) => (value as { answer?: unknown })?.answer === 42 },
        continuation: testContinuation({ deadline: 1 }),
        resolveDeliverable: (input) =>
          mode === 'checked' ||
          mode === 'submitted' ||
          mode === 'seat-leaf' ||
          input.profile.name === grandchild.name
            ? {
                check: (value) => {
                  childCheckCalls++
                  return mode === 'seat-leaf'
                    ? (value as { content?: unknown })?.content === JSON.stringify(report)
                    : (value as { answer?: unknown })?.answer === 42
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
    const nestedEvents = (await reopened.journal.loadTree(`${runId}/${runId}:s0`)) ?? []
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
      childSeatMarkers,
      childInvocations,
      nativeGrants,
      seatSelectionEnvironments,
      nestedEvents,
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

  it('continues a seat-bearing leaf after a committed limit and checks its final report', async () => {
    const flow = await childReportFlow('seat-leaf')
    expect(flow.childSeatMarkers).toEqual(['a', 'c'])
    expect(flow.nativeGrants).toEqual([`${flow.childInvocations[0]?.environmentId}:b`])
    expect(flow.seatSelectionEnvironments[0]).toBeUndefined()
    expect(flow.seatSelectionEnvironments[1]).toBe(flow.childInvocations[0]?.environmentId)
    expect(flow.childInvocations).toHaveLength(3)
    expect(flow.childInvocations[1]).toEqual(flow.childInvocations[0])
    expect(flow.childInvocations[2]?.environmentId).not.toBe(
      flow.childInvocations[0]?.environmentId,
    )
    expect(flow.childCheckCalls).toBe(1)
    expect(flow.settlement).toMatchObject({ status: 'done', verdict: { valid: true } })
    expect(
      flow.nestedEvents
        .filter((event) => event.kind === 'materialized' || event.kind === 'seat-materialized')
        .map((event) => (event.receipt.status === 'known' ? event.receipt.model : undefined)),
    ).toEqual([
      { status: 'known', id: 'claude-opus-4-1' },
      { status: 'known', id: 'gpt-6-sol' },
    ])
    expect(
      flow.nestedEvents
        .filter((event) => event.kind === 'seat-segment')
        .map((event) =>
          event.kind === 'seat-segment' ? [event.phase, event.seat, event.reason] : undefined,
        ),
    ).toEqual([
      ['started', 'claude-seat-a', undefined],
      ['ended', 'claude-seat-a', 'usage-limit'],
      ['started', 'claude-seat-b', undefined],
      ['ended', 'claude-seat-b', 'usage-limit'],
      ['started', 'codex-seat-c', undefined],
      ['ended', 'codex-seat-c', 'completed'],
    ])
  })

  it('refuses a same-provider seat without a native credential grant before dispatch', async () => {
    const flow = await childReportFlow('seat-leaf', false)
    expect(flow.childInvocations).toHaveLength(1)
    expect(flow.nativeGrants).toEqual([])
    expect(flow.childSeatMarkers).toEqual(['a'])
    expect(
      flow.nestedEvents
        .filter((event) => event.kind === 'seat-segment' && event.phase === 'started')
        .map((event) => event.seat),
    ).toEqual(['claude-seat-a'])
    expect(
      flow.nestedEvents
        .filter((event) => event.kind === 'driver-attempt')
        .map((event) => event.record.error),
    ).toContain('selectSeat: same-environment seat requires a verified native turn grant')
    expect(
      flow.nestedEvents.some(
        (event) => event.kind === 'seat-segment' && event.seat === 'codex-seat-c',
      ),
    ).toBe(false)
    expect(flow.settlement).not.toMatchObject({ status: 'done', verdict: { valid: true } })
  })
})
