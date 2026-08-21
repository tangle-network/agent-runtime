import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type AgentProfile,
  canonicalAgentProfileDigest,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import { afterEach, describe, expect, it } from 'vitest'
import { InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import type { DriverAttemptRecord } from '../../src/runtime/supervise/driver-retry'
import type { ExecutorConfig } from '../../src/runtime/supervise/runtime'
import { createRootHandle } from '../../src/runtime/supervise/supervisor'
import type { NodeId, SpawnEvent, SpawnJournal } from '../../src/runtime/supervise/types'
import { supervise } from '../helpers/runtime-with-test-brain'

type BridgeRequest = {
  model: string
  run_id: string
  session_id: string
  agent_profile: AgentProfile
  runtime_attachments?: { mcp: Record<string, { transport?: string; url?: string }> }
  messages: Array<{ role: string; content: string }>
}

const TEST_RUN_DIGEST = `sha256:${'c'.repeat(64)}`

/** An in-memory journal that also exposes every appended event in append order. */
function recordingJournal(into: SpawnEvent[]): SpawnJournal {
  const journal = new InMemorySpawnJournal()
  return {
    loadTree: (root: NodeId) => journal.loadTree(root),
    beginTree: (root: NodeId, at: string) => journal.beginTree(root, at),
    appendEvent: async (root: NodeId, event: SpawnEvent) => {
      into.push(event)
      await journal.appendEvent(root, event)
    },
  }
}

function codexTestProfile(name: string, systemPrompt?: string): AgentProfile {
  return {
    name,
    harness: 'codex',
    model: { provider: 'openai', default: 'test' },
    ...(systemPrompt ? { prompt: { systemPrompt } } : {}),
  }
}

function routerTestProfile(name: string, systemPrompt?: string): AgentProfile {
  return {
    name,
    harness: 'cli-base',
    model: { provider: 'tangle-router', default: 'test' },
    ...(systemPrompt ? { prompt: { systemPrompt } } : {}),
  }
}

/**
 * The fake bridge enforces the real one's exact session binding: cli-bridge records the canonical
 * AgentProfile digest plus the model on a session's first request and answers 400 to any later
 * request that changes either (`assertSessionProfileBinding`). Without that rule a resume test
 * passes even when the runtime moves the digest between turns, which is exactly how the coordination
 * port reached the bound profile unnoticed.
 */
const bridgeRequestBodies = new WeakMap<object, BridgeRequest>()

function createBridgeServer(handler: Parameters<typeof createServer>[0]): Server {
  const sessionBindings = new Map<string, string>()
  return createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          capabilities: {
            profileMaterialization: 'cli-bridge.profile-materialization.v2',
            usageCostProvenance: 'cli-bridge.usage-cost.v1',
            runtimeAttachments: { mcp: true },
          },
        }),
      )
      return
    }
    if (req.method !== 'POST' || !req.url?.startsWith('/v1/chat/completions')) {
      return handler(req, res)
    }
    void (async () => {
      const body = await readJson(req)
      bridgeRequestBodies.set(req, body)
      const binding = JSON.stringify({
        effectiveProfileDigest: canonicalAgentProfileDigest(body.agent_profile),
        model: body.model,
      })
      const bound = sessionBindings.get(body.session_id)
      if (bound === undefined) sessionBindings.set(body.session_id, binding)
      else if (bound !== binding) {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            error: {
              message: `session ${JSON.stringify(body.session_id)} is bound to a different AgentProfile/model`,
              type: 'parse_error',
            },
          }),
        )
        return
      }
      await handler(req, res)
    })()
  })
}

function numberSseDataFrames(body: string): string {
  let seq = 0
  return body.replace(/^data: (?!\[DONE\])/gmu, () => `id: ${++seq}\ndata: `)
}

function respondWithBridgeStream(
  res: ServerResponse,
  request: BridgeRequest,
  stream: string,
  withInference = false,
): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'x-run-id': request.run_id,
    'x-run-request-digest': TEST_RUN_DIGEST,
  })
  const normalized = stream
    .split('\n')
    .map((line) => {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') return line
      const payload = JSON.parse(line.slice('data: '.length)) as { usage?: Record<string, unknown> }
      if (!payload.usage) return line
      payload.usage = {
        ...payload.usage,
        ...(typeof payload.usage.cost === 'number'
          ? { cost_known: true, cost_provenance: 'provider-receipt' }
          : { cost_known: false }),
      }
      return `data: ${JSON.stringify(payload)}`
    })
    .join('\n')
  const parts = request.model.split('/')
  const requested = request.agent_profile.model?.reasoningEffort ?? null
  const applied =
    requested === 'none'
      ? 'minimal'
      : requested === 'xhigh' || requested === 'ultracode'
        ? 'high'
        : requested
  const receipt = `data: ${JSON.stringify({
    profile_materialization: {
      schema: 'cli-bridge.profile-materialization.v2',
      effectiveProfileDigest: canonicalAgentProfileDigest(request.agent_profile),
      harness: parts[0],
      provider: parts[1] ?? null,
      model: request.model,
      reasoningEffort: { requested, applied },
      workspacePlanDigest: `sha256:${'d'.repeat(64)}`,
      files: [],
      unsupported: [],
      // A jailed harness reaches its model only through the bridge-owned loopback transport, and
      // cli-bridge reports that endpoint in the same v2 receipt. Present here because the real
      // bridge sends it on every pi run.
      ...(withInference
        ? {
            inference: {
              effectiveEndpoint: 'http://127.0.0.1:41234/v1',
              apiMode: 'openai-chat',
              transport: 'scoped-loopback',
            },
          }
        : {}),
    },
  })}`
  const withReceipt = normalized.replace('data: [DONE]', `${receipt}\n\ndata: [DONE]`)
  res.end(numberSseDataFrames(withReceipt))
}

function cancelledRunId(url: string | undefined): string | undefined {
  const match = url?.match(/^\/v1\/runs\/([^/]+)\/cancel(?:\?|$)/u)
  return match?.[1] ? decodeURIComponent(match[1]) : undefined
}

function respondWithTerminalCancellation(res: ServerResponse, runId: string): void {
  res.writeHead(200, {
    'content-type': 'application/json',
    'x-run-id': runId,
    'x-run-request-digest': TEST_RUN_DIGEST,
  })
  res.end(
    JSON.stringify({
      terminal: true,
      run: {
        id: runId,
        requestDigest: TEST_RUN_DIGEST,
        terminal: true,
      },
    }),
  )
}

async function readJson(req: AsyncIterable<Uint8Array>): Promise<BridgeRequest> {
  const buffered = bridgeRequestBodies.get(req as object)
  if (buffered) return buffered
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as BridgeRequest
}

async function callCoordination(url: string, name: string, args: unknown): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `${name}-${Date.now()}`,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  if (!response.ok) throw new Error(`coordination ${name} returned ${response.status}`)
}

function successStream(content: string): string {
  return [
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`,
    `data: ${JSON.stringify({ usage: { prompt_tokens: 11, completion_tokens: 7, cost: 0.01 } })}`,
    'data: [DONE]',
    '',
  ].join('\n\n')
}

function unknownCostStream(content: string): string {
  return [
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`,
    `data: ${JSON.stringify({ usage: { prompt_tokens: 11, completion_tokens: 7 } })}`,
    'data: [DONE]',
    '',
  ].join('\n\n')
}

function unknownTokenStream(content: string): string {
  return [
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`,
    `data: ${JSON.stringify({ usage: { cost: 0.01 } })}`,
    'data: [DONE]',
    '',
  ].join('\n\n')
}

function overBudgetSubmissionStream(): string {
  return [
    `data: ${JSON.stringify({
      model: 'test',
      choices: [{ delta: { content: 'accepted answer' } }],
    })}`,
    `data: ${JSON.stringify({
      usage: {
        prompt_tokens: 229_329,
        completion_tokens: 6_528,
      },
    })}`,
    'data: [DONE]',
    '',
  ].join('\n\n')
}

describe('supervise — complete profiles over recursive cli-bridge managers', () => {
  let server: Server | undefined

  afterEach(async () => {
    if (server) await new Promise((resolve) => server?.close(resolve))
    server = undefined
  })

  it('forcefully steers a live bridge root and resumes the same manager session', async () => {
    const requests: BridgeRequest[] = []
    const cancelled: string[] = []
    let markFirstRequest!: () => void
    const firstRequest = new Promise<void>((resolve) => {
      markFirstRequest = resolve
    })
    server = createBridgeServer(async (req, res) => {
      const cancelledId = cancelledRunId(req.url)
      if (cancelledId !== undefined) {
        cancelled.push(cancelledId)
        respondWithTerminalCancellation(res, cancelledId)
        return
      }
      const body = await readJson(req)
      requests.push(body)
      if (requests.length === 1) {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'x-run-id': body.run_id,
          'x-run-request-digest': TEST_RUN_DIGEST,
        })
        res.write(
          `id: 1\ndata: ${JSON.stringify({ usage: { prompt_tokens: 5, completion_tokens: 2, cost: 0.01, cost_known: true, cost_provenance: 'provider-receipt' } })}\n\n`,
        )
        markFirstRequest()
        return
      }
      respondWithBridgeStream(res, body, successStream('corrected manager turn'))
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const handle = createRootHandle<unknown>()
    const running = supervise(
      {
        name: 'pi-leader',
        harness: 'codex',
        prompt: { systemPrompt: 'Lead the pursuit.' },
        model: { provider: 'openai', default: 'gpt-5.6' },
      },
      'Choose the next experiment.',
      {
        rootHandle: handle,
        backend: {
          backend: 'bridge',
          bridgeUrl: `http://127.0.0.1:${port}`,
          bridgeBearer: 'test-token',
        },
        budget: { maxIterations: 4, maxTokens: 10_000 },
      },
    )

    await firstRequest
    expect(
      handle.deliver({
        steer: 'replace the weak plan with the falsification test',
        interrupt: true,
      }),
    ).toBe(true)
    await running

    expect(requests).toHaveLength(2)
    expect(cancelled).toEqual([requests[0]?.run_id])
    expect(requests[1]?.session_id).toBe(requests[0]?.session_id)
    expect(requests[1]?.messages).toEqual([
      {
        role: 'user',
        content: expect.stringContaining('replace the weak plan with the falsification test'),
      },
    ])
    expect(() => handle.deliver({ steer: 'after completion' })).toThrow()
  })

  it('journals every outstanding served model when a resumed turn dies before terminal proof', async () => {
    const runId = 'bridge-two-outstanding-provider-attempts'
    const journal = new InMemorySpawnJournal()
    const handle = createRootHandle<unknown>()
    const requests: BridgeRequest[] = []
    const firstRequest = new Promise<void>((resolve) => {
      server = createBridgeServer(async (req, res) => {
        const cancelledId = cancelledRunId(req.url)
        if (cancelledId !== undefined) {
          respondWithTerminalCancellation(res, cancelledId)
          return
        }
        const body = await readJson(req)
        requests.push(body)
        if (requests.length === 1) {
          res.writeHead(200, {
            'content-type': 'text/event-stream',
            'x-run-id': body.run_id,
            'x-run-request-digest': TEST_RUN_DIGEST,
          })
          res.write(
            `id: 1\ndata: ${JSON.stringify({
              model: 'openai/test@fp_x',
              usage: {
                prompt_tokens: 13,
                completion_tokens: 5,
                cost: 0.02,
                cost_known: true,
                cost_provenance: 'provider-receipt',
              },
            })}\n\n`,
          )
          setTimeout(resolve, 20)
          return
        }
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'x-run-id': body.run_id,
          'x-run-request-digest': TEST_RUN_DIGEST,
        })
        res.write(
          `id: 1\ndata: ${JSON.stringify({
            model: 'openai/test@fp_y',
            usage: {
              prompt_tokens: 17,
              completion_tokens: 7,
              cost: 0.03,
              cost_known: true,
              cost_provenance: 'provider-receipt',
            },
          })}\n\n`,
        )
        setTimeout(() => res.socket?.destroy(new Error('socket died before terminal receipt')), 10)
      })
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo

    const running = supervise(codexTestProfile('pi-leader', 'Lead.'), 'Choose.', {
      rootHandle: handle,
      backend: {
        backend: 'bridge',
        bridgeUrl: `http://127.0.0.1:${port}`,
        bridgeBearer: 'test-token',
      },
      budget: { maxIterations: 4, maxTokens: 10_000 },
      driverRetry: { enabled: false },
      journal,
      runId,
    })

    await firstRequest
    expect(handle.deliver({ steer: 'continue with the falsification test', interrupt: true })).toBe(
      true,
    )
    const result = await running
    expect(result.kind).toBe('no-winner')
    if (result.kind !== 'no-winner') return
    expect(result.reason).toBe('driver-failed')
    expect(result.providerModel).toMatchObject({
      status: 'unknown',
      reason: 'provider-model-conflict',
    })

    const events = (await journal.loadTree(runId)) ?? []
    const metered = events.filter(
      (event): event is Extract<typeof event, { kind: 'metered' }> => event.kind === 'metered',
    )
    expect(metered.map((event) => event.providerModel?.attempts[0]?.observations[0])).toEqual([
      'openai/test@fp_x',
      'openai/test@fp_y',
    ])
  })

  it('selects heterogeneous leaf completion checks from the exact authorized spawn context', async () => {
    const requests: BridgeRequest[] = []
    server = createBridgeServer(async (req, res) => {
      const body = await readJson(req)
      requests.push(body)
      const content =
        body.agent_profile.name === 'worker'
          ? 'WORK=42'
          : body.agent_profile.name === 'evaluator'
            ? 'EVAL=pass'
            : 'FALLBACK=ready'
      respondWithBridgeStream(res, body, successStream(content))
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const contexts: Array<{
      name: string | undefined
      task: unknown
      key: string | undefined
      assignmentId: string
      depth: number
      frozen: boolean
      candidateDigest: string | undefined
    }> = []
    let turn = 0
    const result = await supervise(
      routerTestProfile('root', 'Run all checks.'),
      'Compare implementation and evaluation evidence.',
      {
        backend: {
          backend: 'bridge',
          bridgeUrl: `http://127.0.0.1:${port}`,
          bridgeBearer: 'test-token',
        },
        budget: { maxIterations: 20, maxTokens: 20_000 },
        perWorker: { maxIterations: 4, maxTokens: 2_000 },
        deliverable: {
          check: (out) =>
            typeof out === 'object' &&
            out !== null &&
            (out as { content?: unknown }).content === 'FALLBACK=ready',
          describe: 'fallback artifact is ready',
        },
        brain: async () => {
          turn += 1
          if (turn === 1) {
            return {
              toolCalls: [
                {
                  id: 'worker',
                  name: 'spawn_agent',
                  arguments: JSON.stringify({
                    profile: codexTestProfile('worker'),
                    task: { kind: 'implement', expected: 'WORK=42' },
                    key: 'worker',
                  }),
                },
                {
                  id: 'evaluator',
                  name: 'spawn_agent',
                  arguments: JSON.stringify({
                    profile: codexTestProfile('evaluator'),
                    task: { kind: 'evaluate', expected: 'EVAL=pass' },
                    key: 'evaluator',
                  }),
                },
                {
                  id: 'fallback',
                  name: 'spawn_agent',
                  arguments: JSON.stringify({
                    profile: codexTestProfile('fallback'),
                    task: { kind: 'archive', expected: 'FALLBACK=ready' },
                    key: 'fallback',
                  }),
                },
              ],
            }
          }
          if (turn <= 4) {
            return {
              toolCalls: [
                { id: `await-${turn}`, name: 'await_event', arguments: JSON.stringify({}) },
              ],
            }
          }
          return { content: 'done', toolCalls: [] }
        },
        authorizeSpawn: (input) => ({
          profile: input.profile,
          execution: {
            candidateDigest: canonicalCandidateDigest({ candidate: input.profile.name }),
            correlation: { campaign: 'heterogeneous-checks' },
          },
        }),
        resolveDeliverable: (input) => {
          contexts.push({
            name: input.profile.name,
            task: input.task,
            key: input.key,
            assignmentId: input.assignmentId,
            depth: input.depth,
            frozen:
              Object.isFrozen(input) &&
              Object.isFrozen(input.profile) &&
              Object.isFrozen(input.parent) &&
              Object.isFrozen(input.parentIdentity) &&
              Object.isFrozen(input.execution) &&
              Object.isFrozen(input.task) &&
              Object.isFrozen(input.budget),
            candidateDigest: input.execution.candidateDigest,
          })
          if (input.profile.name === 'fallback') return undefined
          const expected = input.profile.name === 'worker' ? 'WORK=42' : 'EVAL=pass'
          return {
            check: (out) =>
              typeof out === 'object' &&
              out !== null &&
              (out as { content?: unknown }).content === expected,
            describe: `${input.profile.name} emits ${expected}`,
          }
        },
      },
    )

    expect(result.kind).toBe('winner')
    expect(requests.map((request) => request.agent_profile.name).sort()).toEqual([
      'evaluator',
      'fallback',
      'worker',
    ])
    expect(contexts).toHaveLength(3)
    expect(contexts.map((context) => context.name).sort()).toEqual([
      'evaluator',
      'fallback',
      'worker',
    ])
    expect(contexts.every((context) => context.frozen)).toBe(true)
    expect(contexts.map((context) => context.depth)).toEqual([1, 1, 1])
    expect(contexts.map((context) => context.assignmentId).sort()).toEqual([
      'key:evaluator',
      'key:fallback',
      'key:worker',
    ])
    for (const context of contexts) {
      expect(context.candidateDigest).toBe(canonicalCandidateDigest({ candidate: context.name }))
      expect(context.task).toMatchObject({ expected: expect.any(String) })
      expect(context.key).toBe(context.name)
    }
  })

  it('refuses an opencode child that replaces the system prompt before spawn, naming dimension and reason', async () => {
    const requests: BridgeRequest[] = []
    server = createBridgeServer(async (req, res) => {
      const body = await readJson(req)
      requests.push(body)
      respondWithBridgeStream(res, body, successStream('never reached'))
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const events: SpawnEvent[] = []
    const journal = recordingJournal(events)
    const toolResults: string[] = []
    let turn = 0
    const result = await supervise(
      routerTestProfile('root', 'Delegate the work.'),
      'Delegate the work.',
      {
        backend: {
          backend: 'bridge',
          bridgeUrl: `http://127.0.0.1:${port}`,
          bridgeBearer: 'test-token',
        },
        budget: { maxIterations: 8, maxTokens: 8_000 },
        perWorker: { maxIterations: 2, maxTokens: 1_000 },
        journal,
        runId: 'opencode-prompt-refusal',
        brain: async (messages) => {
          turn += 1
          if (turn === 1) {
            return {
              toolCalls: [
                {
                  id: 'spawn',
                  name: 'spawn_agent',
                  arguments: JSON.stringify({
                    profile: {
                      name: 'oc-worker',
                      harness: 'opencode',
                      model: { provider: 'zai-coding-plan', default: 'glm-5.2' },
                      prompt: { systemPrompt: 'You are the worker. Ignore your own prompt.' },
                    },
                    task: 'do the work',
                    key: 'oc-worker',
                  }),
                },
              ],
            }
          }
          for (const message of messages) {
            if (typeof message.content === 'string') toolResults.push(message.content)
          }
          return { content: 'done', toolCalls: [] }
        },
      },
    )

    expect(result.kind).toBe('no-winner')
    // The verdict is a pure function of the child profile plus the harness, so it lands before the
    // spawn is journaled and before the bridge is asked to run anything.
    expect(events.filter((event) => event.kind === 'spawned' && event.key === 'oc-worker')).toEqual(
      [],
    )
    expect(requests).toEqual([])
    const refusal = toolResults.find((text) => text.includes('cannot materialize the profile'))
    expect(refusal).toBeDefined()
    expect(refusal).toContain('opencode')
    expect(refusal).toContain('systemPrompt')
    expect(refusal).toContain('agent.<name>.prompt')
  })

  it('admits the same replaced system prompt on a harness that has the control', async () => {
    const requests: BridgeRequest[] = []
    server = createBridgeServer(async (req, res) => {
      const body = await readJson(req)
      requests.push(body)
      respondWithBridgeStream(res, body, successStream('WORK=42'))
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const events: SpawnEvent[] = []
    const journal = recordingJournal(events)
    let turn = 0
    await supervise(routerTestProfile('root', 'Delegate the work.'), 'Delegate the work.', {
      backend: {
        backend: 'bridge',
        bridgeUrl: `http://127.0.0.1:${port}`,
        bridgeBearer: 'test-token',
      },
      budget: { maxIterations: 8, maxTokens: 8_000 },
      perWorker: { maxIterations: 2, maxTokens: 1_000 },
      journal,
      runId: 'pi-prompt-admitted',
      brain: async () => {
        turn += 1
        if (turn === 1) {
          return {
            toolCalls: [
              {
                id: 'spawn',
                name: 'spawn_agent',
                arguments: JSON.stringify({
                  profile: {
                    name: 'pi-worker',
                    harness: 'pi',
                    model: { provider: 'tangle-router', default: 'glm-5.2' },
                    prompt: { systemPrompt: 'You are the worker. Ignore your own prompt.' },
                  },
                  task: 'do the work',
                  key: 'pi-worker',
                }),
              },
            ],
          }
        }
        if (turn === 2) {
          return {
            toolCalls: [{ id: 'await', name: 'await_event', arguments: JSON.stringify({}) }],
          }
        }
        return { content: 'done', toolCalls: [] }
      },
    })

    // Same replacement intent, a harness whose launcher owns `--system-prompt`: it spawns and the
    // bridge is asked to run it.
    expect(
      events.filter((event) => event.kind === 'spawned' && event.key === 'pi-worker'),
    ).toHaveLength(1)
    expect(requests.map((request) => request.agent_profile.name)).toEqual(['pi-worker'])
  })

  it('reuses the recorded per-spawn completion result on durable resume', async () => {
    let requests = 0
    server = createBridgeServer(async (req, res) => {
      const body = await readJson(req)
      requests += 1
      respondWithBridgeStream(res, body, successStream('RESULT=durable'))
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const runDir = await mkdtemp(join(tmpdir(), 'per-spawn-deliverable-resume-'))
    let resolutions = 0
    const makeBrain = () => {
      let turn = 0
      return async () => {
        turn += 1
        if (turn === 1) {
          return {
            toolCalls: [
              {
                id: 'spawn',
                name: 'spawn_agent',
                arguments: JSON.stringify({
                  profile: codexTestProfile('durable-worker'),
                  task: 'produce the durable result',
                  key: 'durable-worker',
                }),
              },
            ],
          }
        }
        if (turn === 2) {
          return {
            toolCalls: [{ id: 'await', name: 'await_event', arguments: JSON.stringify({}) }],
          }
        }
        return { content: 'done', toolCalls: [] }
      }
    }
    const common = {
      backend: {
        backend: 'bridge' as const,
        bridgeUrl: `http://127.0.0.1:${port}`,
        bridgeBearer: 'test-token',
      },
      budget: { maxIterations: 8, maxTokens: 10_000 },
      perWorker: { maxIterations: 2, maxTokens: 1_000 },
      runDir,
      runId: 'per-spawn-deliverable-resume',
      resolveDeliverable: () => {
        resolutions += 1
        return {
          check: (out: unknown) =>
            typeof out === 'object' &&
            out !== null &&
            (out as { content?: unknown }).content === 'RESULT=durable',
        }
      },
    }
    const profile = routerTestProfile('root')
    try {
      const first = await supervise(profile, 'resume the exact result', {
        ...common,
        brain: makeBrain(),
      })
      const second = await supervise(profile, 'resume the exact result', {
        ...common,
        brain: makeBrain(),
      })

      expect(first.kind).toBe('winner')
      expect(second.kind).toBe('winner')
      expect(requests).toBe(1)
      // The resumed manager re-authorizes and re-resolves the exact keyed request, but Scope returns
      // the recorded settlement before constructing or executing a replacement backend worker.
      expect(resolutions).toBe(2)
    } finally {
      await rm(runDir, { recursive: true, force: true })
    }
  })

  it('runs PI → nested supervisor → worker without dropping any authored profile axis', async () => {
    const requests: BridgeRequest[] = []
    const journal = new InMemorySpawnJournal()
    const resolvedDeliverables: string[] = []
    const classifications: Array<{
      name: string | undefined
      metadataRole: unknown
      experimentId: string | undefined
      frozen: boolean
      isDriver: boolean
    }> = []
    const authorizations: Array<{
      depth: number
      frozen: boolean
      profile: AgentProfile
      task: unknown
    }> = []
    server = createBridgeServer(async (req, res) => {
      try {
        const body = await readJson(req)
        requests.push(body)
        const profile = body.agent_profile
        const coordination = body.runtime_attachments?.mcp['agent-runtime-coordination']
        const depth = profile.metadata?.depth

        if (coordination?.url) {
          if (depth === 0) {
            await callCoordination(coordination.url, 'spawn_agent', {
              profile: {
                name: 'methods-supervisor',
                description: 'Run the discriminating experiment',
                harness: 'codex',
                prompt: { systemPrompt: 'Supervise one empirical worker.' },
                model: { provider: 'openai', default: 'gpt-5.6', reasoningEffort: 'high' },
                tools: { shell: true },
                resources: {
                  skills: [
                    {
                      kind: 'inline',
                      name: 'experimental-method',
                      content: '# Experimental method\nChange one variable at a time.',
                    },
                  ],
                  failOnError: true,
                },
                subagents: {
                  critic: { description: 'Find a confound', prompt: 'Challenge the result.' },
                },
                modes: { adversarial: { prompt: 'Try to falsify the claim.' } },
                // Deliberately false model-authored authority: product authorization below makes
                // this profile recursive even though the authored metadata calls it a worker.
                metadata: { role: 'worker', depth: 1, family: 'scientific-method' },
              },
              task: 'Run one experiment and return its measured result.',
            })
          } else {
            await callCoordination(coordination.url, 'spawn_agent', {
              profile: {
                name: 'experiment-worker',
                description: 'Execute and report the measurement',
                harness: 'codex',
                prompt: { systemPrompt: 'Return the exact measured result.' },
                model: { provider: 'openai', default: 'gpt-5.6', reasoningEffort: 'medium' },
                permissions: { shell: 'allow' },
                tools: { shell: true, web: false },
                resources: {
                  files: [
                    {
                      path: 'protocol.txt',
                      resource: {
                        kind: 'inline',
                        name: 'protocol',
                        content: 'Measure twice; report both observations.',
                      },
                    },
                  ],
                  failOnError: true,
                },
                // Deliberately false in the other direction: model-authored metadata cannot make a
                // profile recursive when product authorization classifies it as a leaf.
                metadata: { role: 'driver', depth: 2, family: 'scientific-method' },
              },
              task: 'Measure the system and report RESULT=42.',
            })
          }
          await callCoordination(coordination.url, 'await_event', {})
        }

        respondWithBridgeStream(
          res,
          body,
          successStream(profile.name === 'experiment-worker' ? 'RESULT=42' : 'managed'),
        )
      } catch (error) {
        res.writeHead(500, { 'content-type': 'text/plain' })
        res.end(error instanceof Error ? error.message : String(error))
      }
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const backend: ExecutorConfig = {
      backend: 'bridge',
      bridgeUrl: `http://127.0.0.1:${port}`,
      bridgeBearer: 'test-token',
    }
    const rootProfile: AgentProfile = {
      name: 'pi-leader',
      description: 'Lead the full pursuit',
      harness: 'codex',
      prompt: { systemPrompt: 'Choose and supervise the most informative experiment.' },
      model: { provider: 'openai', default: 'gpt-5.6', reasoningEffort: 'xhigh' },
      tools: { web: true },
      mcp: {
        literature: { transport: 'http', url: 'https://papers.example.test/mcp' },
      },
      resources: {
        instructions: 'Keep hypotheses separate from observations.',
        failOnError: true,
      },
      metadata: { role: 'driver', depth: 0, family: 'discovery-native' },
    }
    const rootTask = 'Resolve the pursuit with one measured experiment.'

    const result = await supervise(rootProfile, rootTask, {
      backend,
      budget: { maxIterations: 20, maxTokens: 100_000 },
      perWorker: { maxIterations: 8, maxTokens: 20_000 },
      maxDepth: 4,
      deliverable: {
        check: (out) =>
          typeof out === 'object' &&
          out !== null &&
          (out as { content?: unknown }).content === 'RESULT=42',
        describe: 'worker reports RESULT=42',
      },
      profileSecurity: {
        allowLocalMcp: false,
        allowHooks: false,
        allowedMcpHosts: ['papers.example.test'],
      },
      journal,
      runId: 'identity-run',
      execution: {
        candidateDigest: canonicalCandidateDigest({ candidate: 'pi-leader' }),
        correlation: { pursuitId: 'pursuit-1', experimentId: 'experiment-root' },
      },
      authorizeSpawn: (input) => {
        authorizations.push({
          depth: input.depth,
          frozen:
            Object.isFrozen(input) &&
            Object.isFrozen(input.profile) &&
            Object.isFrozen(input.task) &&
            Object.isFrozen(input.budget),
          profile: input.profile,
          task: input.task,
        })
        const name = input.profile.name ?? 'unnamed'
        return {
          profile: input.profile,
          execution: {
            candidateDigest: canonicalCandidateDigest({ candidate: name }),
            correlation: {
              pursuitId: 'pursuit-1',
              experimentId: `experiment-${input.depth}`,
            },
          },
        }
      },
      isDriverProfile: (input) => {
        const isDriver = input.execution.correlation?.experimentId === 'experiment-1'
        classifications.push({
          name: input.profile.name,
          metadataRole: input.profile.metadata?.role,
          experimentId: input.execution.correlation?.experimentId,
          frozen:
            Object.isFrozen(input) &&
            Object.isFrozen(input.profile) &&
            Object.isFrozen(input.parent) &&
            Object.isFrozen(input.parentIdentity) &&
            Object.isFrozen(input.execution) &&
            Object.isFrozen(input.execution.correlation) &&
            Object.isFrozen(input.task) &&
            Object.isFrozen(input.budget),
          isDriver,
        })
        return isDriver
      },
      resolveDeliverable: (input) => {
        resolvedDeliverables.push(input.profile.name ?? 'unnamed')
        return undefined
      },
    })

    expect(result.kind).toBe('winner')
    expect(requests.map((request) => request.agent_profile.name)).toEqual([
      'pi-leader',
      'methods-supervisor',
      'experiment-worker',
    ])
    expect(requests.map((request) => request.model)).toEqual([
      'codex/openai/gpt-5.6',
      'codex/openai/gpt-5.6',
      'codex/openai/gpt-5.6',
    ])
    expect(requests.map((request) => request.session_id)).toEqual([
      expect.stringMatching(/^supervised-manager-[a-f0-9]{64}$/),
      expect.stringMatching(/^supervised-manager-[a-f0-9]{64}$/),
      expect.stringMatching(/^supervised-worker-[a-f0-9]{64}$/),
    ])
    expect(new Set(requests.map((request) => request.session_id)).size).toBe(3)

    const pi = requests[0]!.agent_profile
    expect(pi.tools).toEqual({ web: true })
    expect(pi.mcp).toEqual({
      literature: { transport: 'http', url: 'https://papers.example.test/mcp' },
    })
    expect(requests[0]?.runtime_attachments?.mcp['agent-runtime-coordination']).toMatchObject({
      transport: 'http',
    })

    const nested = requests[1]!.agent_profile
    expect(nested.resources?.skills?.[0]).toMatchObject({ name: 'experimental-method' })
    expect(nested.subagents?.critic?.prompt).toBe('Challenge the result.')
    expect(nested.modes?.adversarial?.prompt).toBe('Try to falsify the claim.')
    expect(nested.mcp).toBeUndefined()
    expect(requests[1]?.runtime_attachments?.mcp['agent-runtime-coordination']).toMatchObject({
      transport: 'http',
    })

    // A leaf worker drives nothing, so it receives no coordination attachment at all.
    const worker = requests[2]!.agent_profile
    expect(worker.permissions).toEqual({ shell: 'allow' })
    expect(worker.resources?.files?.[0]?.path).toBe('protocol.txt')
    expect(requests[2]?.runtime_attachments).toBeUndefined()
    expect(requests.every((request) => request.messages[0]?.role === 'user')).toBe(true)
    expect(result.spentTotal.tokens).toEqual({
      input: 33,
      output: 21,
      cacheBreakdownKnown: false,
    })
    expect(result.spentTotal.iterations).toBe(1)
    expect(authorizations).toEqual([
      {
        depth: 1,
        frozen: true,
        profile: expect.objectContaining({ name: 'methods-supervisor' }),
        task: 'Run one experiment and return its measured result.',
      },
      {
        depth: 2,
        frozen: true,
        profile: expect.objectContaining({ name: 'experiment-worker' }),
        task: 'Measure the system and report RESULT=42.',
      },
    ])
    expect(classifications).toEqual([
      {
        name: 'methods-supervisor',
        metadataRole: 'worker',
        experimentId: 'experiment-1',
        frozen: true,
        isDriver: true,
      },
      {
        name: 'experiment-worker',
        metadataRole: 'driver',
        experimentId: 'experiment-2',
        frozen: true,
        isDriver: false,
      },
    ])
    expect(resolvedDeliverables).toEqual(['experiment-worker'])

    const rootEvents = await journal.loadTree('identity-run')
    expect(JSON.stringify(rootEvents)).not.toContain(backend.bridgeUrl)
    expect(JSON.stringify(rootEvents)).not.toContain(backend.bridgeBearer)
    expect(JSON.stringify(rootEvents)).not.toContain(
      String(requests[0]?.runtime_attachments?.mcp['agent-runtime-coordination']?.url),
    )
    const rootSpawn = rootEvents?.find(
      (event) => event.kind === 'spawned' && event.id === 'identity-run',
    )
    const nestedSpawn = rootEvents?.find(
      (event) => event.kind === 'spawned' && event.id !== 'identity-run',
    )
    expect(rootSpawn?.identity).toEqual({
      profileDigest: canonicalCandidateDigest(rootProfile),
      taskDigest: canonicalCandidateDigest(rootTask),
      candidateDigest: canonicalCandidateDigest({ candidate: 'pi-leader' }),
      correlation: { pursuitId: 'pursuit-1', experimentId: 'experiment-root' },
    })
    const rootMaterialized = rootEvents?.find(
      (event) => event.kind === 'materialized' && event.id === 'identity-run',
    )
    expect(rootMaterialized).toMatchObject({
      kind: 'materialized',
      id: 'identity-run',
      receipt: {
        status: 'known',
        authoredProfileDigest: canonicalCandidateDigest(rootProfile),
        effectiveProfileDigest: canonicalCandidateDigest(rootProfile),
        runtime: 'cli',
        backend: 'bridge',
        model: { status: 'known', id: 'codex/openai/gpt-5.6' },
        execution: { kind: 'session', id: requests[0]!.session_id },
      },
    })
    expect(
      rootMaterialized?.kind === 'materialized'
        ? rootMaterialized.receipt.platformAttachmentsDigest
        : undefined,
    ).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(
      rootEvents?.find((event) => event.kind === 'execution-bound' && event.id === 'identity-run'),
    ).toMatchObject({
      binding: {
        status: 'known',
        descriptor: { kind: 'bridge-session', transport: 'http', coordination: true },
      },
    })
    expect(nestedSpawn?.identity).toEqual({
      profileDigest: canonicalCandidateDigest(authorizations[0]!.profile),
      taskDigest: canonicalCandidateDigest(authorizations[0]!.task),
      candidateDigest: canonicalCandidateDigest({ candidate: 'methods-supervisor' }),
      correlation: { pursuitId: 'pursuit-1', experimentId: 'experiment-1' },
    })
    const nestedEvents = await journal.loadTree('identity-run/identity-run:s0')
    expect(JSON.stringify(nestedEvents)).not.toContain(backend.bridgeUrl)
    expect(JSON.stringify(nestedEvents)).not.toContain(backend.bridgeBearer)
    const workerSpawn = nestedEvents?.find((event) => event.kind === 'spawned')
    expect(workerSpawn?.identity).toEqual({
      profileDigest: canonicalCandidateDigest(authorizations[1]!.profile),
      taskDigest: canonicalCandidateDigest(authorizations[1]!.task),
      candidateDigest: canonicalCandidateDigest({ candidate: 'experiment-worker' }),
      correlation: { pursuitId: 'pursuit-1', experimentId: 'experiment-2' },
    })
  })

  it('isolates identical concurrent managers but reuses one durable manager session on restart', async () => {
    const sessions: string[] = []
    const coordinationUrls: string[] = []
    const profileMcpAliases: string[][] = []
    server = createBridgeServer(async (req, res) => {
      const body = await readJson(req)
      sessions.push(body.session_id)
      const attachment = body.runtime_attachments?.mcp['agent-runtime-coordination']
      if (attachment?.url) coordinationUrls.push(attachment.url)
      profileMcpAliases.push(Object.keys(body.agent_profile.mcp ?? {}))
      respondWithBridgeStream(res, body, successStream('managed'))
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const profile = {
      name: 'pi-leader',
      harness: 'codex',
      prompt: { systemPrompt: 'Lead the pursuit.' },
      model: { provider: 'openai', default: 'gpt-5.6' },
    } as const
    const backend = {
      backend: 'bridge' as const,
      bridgeUrl: `http://127.0.0.1:${port}`,
      bridgeBearer: 'test-token',
    }
    const task = 'Choose the next experiment.'

    await Promise.all([
      supervise(profile, task, {
        backend,
        budget: { maxIterations: 4, maxTokens: 10_000 },
        runId: 'same-visible-run-id',
      }),
      supervise(profile, task, {
        backend,
        budget: { maxIterations: 4, maxTokens: 10_000 },
        runId: 'same-visible-run-id',
      }),
    ])
    expect(sessions).toHaveLength(2)
    expect(new Set(sessions).size).toBe(2)

    sessions.length = 0
    coordinationUrls.length = 0
    profileMcpAliases.length = 0
    const runDir = await mkdtemp(join(tmpdir(), 'manager-stable-session-'))
    try {
      const options = {
        backend,
        budget: { maxIterations: 4, maxTokens: 10_000 },
        runDir,
        runId: 'durable-manager-session',
      }
      await supervise(profile, task, options)
      await supervise(profile, task, options)

      expect(sessions).toHaveLength(2)
      expect(sessions[0]).toMatch(/^supervised-manager-[a-f0-9]{64}$/)
      expect(sessions[1]).toBe(sessions[0])
      // Each run serves coordination on a fresh ephemeral port. The bridge accepted the second
      // turn on the same durable session, so the rebound endpoint never entered the bound profile:
      // it rode `runtime_attachments`, and the authored profile declared no MCP server at all.
      expect(new Set(coordinationUrls).size).toBe(2)
      expect(profileMcpAliases).toEqual([[], []])
    } finally {
      await rm(runDir, { recursive: true, force: true })
    }
  })

  it('captures mutable supervision policy, profiles, limits, and callback selection at intake', async () => {
    const requests: BridgeRequest[] = []
    server = createBridgeServer(async (req, res) => {
      const body = await readJson(req)
      requests.push(body)
      respondWithBridgeStream(res, body, successStream('RESULT=42'))
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo

    let releaseFirstTurn!: () => void
    const firstTurnHeld = new Promise<void>((resolve) => {
      releaseFirstTurn = resolve
    })
    let markFirstTurnEntered!: () => void
    const firstTurnEntered = new Promise<void>((resolve) => {
      markFirstTurnEntered = resolve
    })
    let turn = 0
    const callbackCalls: string[] = []
    const brain = async () => {
      turn += 1
      if (turn === 1) {
        markFirstTurnEntered()
        await firstTurnHeld
        return {
          toolCalls: [
            {
              id: 'spawn',
              name: 'spawn_agent',
              arguments: JSON.stringify({
                profile: {
                  name: 'policy-worker',
                  harness: 'codex',
                  model: { provider: 'openai', default: 'safe-model' },
                  mcp: {
                    allowed: { transport: 'http', url: 'https://allowed.test/mcp' },
                  },
                },
                task: 'Return RESULT=42.',
              }),
            },
          ],
          usage: { input: 1, output: 1 },
          costUsd: 0,
        }
      }
      if (turn === 2) {
        return {
          toolCalls: [{ id: 'await', name: 'await_event', arguments: JSON.stringify({}) }],
          usage: { input: 1, output: 1 },
          costUsd: 0,
        }
      }
      return { content: 'done', toolCalls: [], usage: { input: 1, output: 1 }, costUsd: 0 }
    }
    const rootProfile: AgentProfile = {
      name: 'original-root',
      harness: 'cli-base',
      model: { provider: 'tangle-router', default: 'safe-model' },
      prompt: { systemPrompt: 'Use the worker.' },
    }
    const backend = {
      backend: 'bridge' as const,
      bridgeUrl: `http://127.0.0.1:${port}`,
      bridgeBearer: 'test-token',
    }
    const profileSecurity = {
      allowLocalMcp: false,
      allowHooks: false,
      allowedMcpHosts: ['allowed.test'],
    }
    const perWorker = { maxIterations: 2, maxTokens: 100 }
    const allowedModels = ['safe-model']
    const deliverable = {
      check: (out: unknown) =>
        typeof out === 'object' &&
        out !== null &&
        (out as { content?: unknown }).content === 'RESULT=42',
      describe: 'the measured result',
    }
    const options = {
      backend,
      budget: { maxIterations: 10, maxTokens: 10_000 },
      perWorker,
      profileSecurity,
      allowedModels,
      deliverable,
      brain,
      maxTurns: 4,
      authorizeSpawn: (input: {
        profile: AgentProfile
        parent: AgentProfile
        task: unknown
        budget: { maxIterations: number; maxTokens: number }
      }) => {
        callbackCalls.push('original-authorizer')
        expect(input.parent.name).toBe('original-root')
        expect(input.budget).toMatchObject({ maxIterations: 2, maxTokens: 100 })
        return { profile: input.profile }
      },
      isDriverProfile: () => false,
    }

    const run = supervise(rootProfile, { pursuit: 'original-task' }, options)
    await firstTurnEntered
    rootProfile.name = 'mutated-root'
    backend.bridgeUrl = 'http://127.0.0.1:1'
    profileSecurity.allowedMcpHosts.splice(0, 1, 'mutated.test')
    perWorker.maxIterations = 0
    perWorker.maxTokens = 1
    allowedModels.splice(0, 1, 'mutated-model')
    deliverable.check = () => false
    options.maxTurns = 1
    options.authorizeSpawn = (input) => {
      callbackCalls.push('replacement-authorizer')
      return { profile: input.profile }
    }
    options.isDriverProfile = () => true
    options.brain = async () => ({ content: 'replacement', toolCalls: [] })
    releaseFirstTurn()

    const result = await run
    expect(result.kind).toBe('winner')
    expect(callbackCalls).toEqual(['original-authorizer'])
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      model: 'codex/openai/safe-model',
      agent_profile: {
        name: 'policy-worker',
        mcp: { allowed: { url: 'https://allowed.test/mcp' } },
      },
    })
    expect(requests[0]?.agent_profile.mcp?.['agent-runtime-coordination']).toBeUndefined()
  })

  it('accepts the v2 receipt a jailed harness produces, inference block and all', async () => {
    // cli-bridge reports the bridge-owned model transport inside the SAME v2 receipt, and its own
    // type declares that block optional under this schema. Pinning the key set exactly made this
    // executor refuse a conformant receipt: every jailed pi run settled `down` with "missing or
    // unknown fields", which reads as a broken bridge rather than a validator holding an older
    // spelling of the same version.
    server = createBridgeServer(async (req, res) => {
      const body = await readJson(req)
      respondWithBridgeStream(res, body, successStream('managed'), true)
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo

    const result = await supervise(codexTestProfile('pi-leader', 'Lead.'), 'Choose.', {
      backend: {
        backend: 'bridge',
        bridgeUrl: `http://127.0.0.1:${port}`,
        bridgeBearer: 'test-token',
      },
      budget: { maxIterations: 2, maxTokens: 10_000 },
    })

    // The run reaches a terminal state on its own terms rather than dying on receipt validation.
    expect(result.kind === 'no-winner' ? result.reason : 'winner').not.toBe('driver-failed')
  })

  it('publishes an acknowledged root receipt when accepted work exceeds the token budget', async () => {
    const journal = new InMemorySpawnJournal()
    server = createBridgeServer(async (req, res) => {
      const body = await readJson(req)
      const coordination = body.runtime_attachments?.mcp['agent-runtime-coordination']
      if (!coordination || typeof coordination.url !== 'string') {
        throw new Error('bridge test request did not carry the coordination MCP')
      }
      await callCoordination(coordination.url, 'submit_result', {
        result: { answer: 42 },
      })
      respondWithBridgeStream(res, body, overBudgetSubmissionStream())
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const runId = 'accepted-submit-terminal-error'

    const result = await supervise(codexTestProfile('pi-leader', 'Lead.'), 'Choose.', {
      backend: {
        backend: 'bridge',
        bridgeUrl: `http://127.0.0.1:${port}`,
        bridgeBearer: 'test-token',
      },
      budget: { maxIterations: 2, maxTokens: 200_000 },
      deliverable: {
        describe: 'an object whose answer is 42',
        check: (value) => (value as { answer?: unknown }).answer === 42,
      },
      driverRetry: { enabled: false },
      journal,
      runId,
    })

    expect(result.kind).toBe('winner')
    if (result.kind === 'winner') expect(result.out).toEqual({ answer: 42 })
    const events = (await journal.loadTree(runId)) ?? []
    expect(events.find((event) => event.kind === 'materialized')).toMatchObject({
      id: runId,
      receipt: {
        status: 'known',
        runtime: 'cli',
        backend: 'bridge',
        model: { status: 'known', id: 'codex/openai/test' },
      },
    })
  })

  it('keeps the budget error when a terminal receipt arrives without an accepted result', async () => {
    const journal = new InMemorySpawnJournal()
    server = createBridgeServer(async (req, res) => {
      const body = await readJson(req)
      respondWithBridgeStream(res, body, overBudgetSubmissionStream())
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const runId = 'unaccepted-submit-terminal-error'
    const attempts: DriverAttemptRecord[] = []

    const result = await supervise(codexTestProfile('pi-leader', 'Lead.'), 'Choose.', {
      backend: {
        backend: 'bridge',
        bridgeUrl: `http://127.0.0.1:${port}`,
        bridgeBearer: 'test-token',
      },
      budget: { maxIterations: 2, maxTokens: 200_000 },
      driverRetry: { enabled: false },
      onDriverAttempt: (record) => void attempts.push(record),
      journal,
      runId,
    })

    expect(result.kind).toBe('no-winner')
    if (result.kind === 'no-winner') {
      expect(result.reason).toBe('budget-exhausted')
    }
    expect(attempts.at(-1)?.error).toContain('supervisor budget exhausted')
    const events = (await journal.loadTree(runId)) ?? []
    expect(events.find((event) => event.kind === 'materialized')).toMatchObject({
      id: runId,
      receipt: {
        status: 'known',
        runtime: 'cli',
        backend: 'bridge',
        model: { status: 'known', id: 'codex/openai/test' },
      },
    })
  })

  it('retries a mid-stream harness death, which is transport and not a refusal', async () => {
    // Measured on a six-arm campaign wave: three arms died on `pi assistant turn failed: The
    // model finished (finish_reason=stop) without emitting any visible output — Retry the
    // request`. That message asks to be retried; typed as a ValidationError it read as Runtime's
    // own deliberate refusal, and the root-driver retry declined. It is the harness's failure
    // relayed mid-stream — transport — so it is retried like any other dropped upstream.
    let executions = 0
    server = createBridgeServer(async (req, res) => {
      const cancelling = cancelledRunId(req.url)
      if (cancelling !== undefined) {
        respondWithTerminalCancellation(res, cancelling)
        return
      }
      const body = await readJson(req)
      executions += 1
      if (executions === 1) {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'x-run-id': body.run_id,
          'x-run-request-digest': TEST_RUN_DIGEST,
        })
        res.end(
          `id: 1\ndata: ${JSON.stringify({
            error: { message: 'pi assistant turn failed: finished without emitting any output' },
          })}\n\ndata: [DONE]\n\n`,
        )
        return
      }
      respondWithBridgeStream(res, body, successStream('managed'))
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo

    const attempts: DriverAttemptRecord[] = []
    const result = await supervise(codexTestProfile('pi-leader', 'Lead.'), 'Choose.', {
      backend: {
        backend: 'bridge',
        bridgeUrl: `http://127.0.0.1:${port}`,
        bridgeBearer: 'test-token',
      },
      budget: { maxIterations: 4, maxTokens: 10_000 },
      driverRetry: { initialBackoffMs: 1 },
      onDriverAttempt: (record) => void attempts.push(record),
    })

    expect(attempts.map((a) => a.stop ?? a.classification)).toEqual(['transient', 'completed'])
    expect(result.kind === 'no-winner' ? result.reason : 'winner').not.toBe('driver-failed')
    expect(executions).toBe(2)
  })

  it('retries a transient bridge failure on the same session and finishes the run (#741)', async () => {
    // The exact production shape: the harness process dies once mid-run (here, the bridge answers
    // 502 on the first execution). Before the fix that ONE failure ended the whole run as
    // `driver-failed`. The retry re-enters the driver on the same scope and the same session id, so
    // the bridge reattaches the harness conversation rather than starting a new one.
    const requests: BridgeRequest[] = []
    let executions = 0
    server = createBridgeServer(async (req, res) => {
      // The failed attempt's executor tears its run down before the retry re-enters, so the fake
      // bridge has to answer the cancel exactly as a real one does.
      const cancelling = cancelledRunId(req.url)
      if (cancelling !== undefined) {
        respondWithTerminalCancellation(res, cancelling)
        return
      }
      const body = await readJson(req)
      requests.push(body)
      executions += 1
      if (executions === 1) {
        res.writeHead(502, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'upstream harness died' }))
        return
      }
      respondWithBridgeStream(res, body, successStream('managed'))
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo

    const attempts: DriverAttemptRecord[] = []
    const result = await supervise(codexTestProfile('pi-leader', 'Lead the pursuit.'), 'Choose.', {
      backend: {
        backend: 'bridge',
        bridgeUrl: `http://127.0.0.1:${port}`,
        bridgeBearer: 'test-token',
      },
      budget: { maxIterations: 4, maxTokens: 10_000 },
      // The wait itself is not under test; the decision to wait is.
      driverRetry: { initialBackoffMs: 1 },
      onDriverAttempt: (record) => void attempts.push(record),
    })

    // One transient failure, one completion — and the run is NOT a driver failure.
    expect(attempts.map((a) => a.stop ?? a.classification)).toEqual(['transient', 'completed'])
    expect(result.kind === 'no-winner' ? result.reason : 'winner').not.toBe('driver-failed')
    expect(requests).toHaveLength(2)
    // The durable execution id is what lets the replacement attempt reattach the same harness
    // conversation instead of opening a second one.
    expect(requests[1]?.session_id).toBe(requests[0]?.session_id)
  })

  it('refuses a manager with unknown cost under a dollar-capped budget', async () => {
    server = createBridgeServer(async (req, res) => {
      const body = await readJson(req)
      respondWithBridgeStream(res, body, unknownCostStream('managed'))
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo

    const result = await supervise(
      {
        name: 'pi-leader',
        harness: 'codex',
        prompt: { systemPrompt: 'Lead the pursuit.' },
        model: { provider: 'openai', default: 'gpt-5.6' },
      },
      'Choose the next experiment.',
      {
        backend: {
          backend: 'bridge',
          bridgeUrl: `http://127.0.0.1:${port}`,
          bridgeBearer: 'test-token',
        },
        budget: { maxIterations: 2, maxTokens: 10_000, maxUsd: 1 },
      },
    )

    expect(result.kind).toBe('no-winner')
    if (result.kind !== 'no-winner') return
    // The pool REFUSES an unknown-dollar observation before mutating, so the run fails on the
    // driver arm carrying the refusal — never an invented figure, never a silently consumed cap.
    expect(result.reason).toBe('driver-failed')
    if (result.reason === 'driver-failed') {
      expect(result.error.message).toMatch(/unknown dollar cost under a dollar-capped budget/)
    }
    // The turn carried no receipt, so its dollars are the catalog price of what it presented —
    // recorded, and explicitly not a measurement. Pricing an estimate does not open the cap: the
    // refusal above is unchanged.
    expect(result.spentTotal.usdKnown).toBe(false)
    expect(result.spentTotal.usd).toBeGreaterThan(0)
    expect(result.spentTotal.usdEstimated).toBe(result.spentTotal.usd)
  })

  it('records a manager with unknown token usage as unknown telemetry without ending the run', async () => {
    server = createBridgeServer(async (req, res) => {
      const body = await readJson(req)
      respondWithBridgeStream(res, body, unknownTokenStream('managed'))
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo

    const result = await supervise(
      {
        name: 'pi-leader',
        harness: 'codex',
        prompt: { systemPrompt: 'Lead the pursuit.' },
        model: { provider: 'openai', default: 'gpt-5.6' },
      },
      'Choose the next experiment.',
      {
        backend: {
          backend: 'bridge',
          bridgeUrl: `http://127.0.0.1:${port}`,
          bridgeBearer: 'test-token',
        },
        budget: { maxIterations: 2, maxTokens: 10_000 },
      },
    )

    expect(result.kind).toBe('no-winner')
    if (result.kind !== 'no-winner') return
    // Tokens are always capped, so ONE unreported turn must not end the run: the manager keeps
    // running, the pool marks the balance a ceiling rather than a measurement, and the terminal
    // accounting carries the unknown instead of a silent zero.
    expect(result.reason).toBe('all-children-down')
    expect(result.spentTotal).toMatchObject({
      tokens: { input: 0, output: 0 },
      tokensKnown: false,
    })
  })

  it('records a partial manager stream as unknown and refuses a replacement after restart', async () => {
    const runDir = await mkdtemp(join(tmpdir(), 'manager-partial-stream-'))
    let requests = 0
    try {
      server = createBridgeServer(async (req, res) => {
        const cancelled = cancelledRunId(req.url)
        if (cancelled !== undefined) {
          respondWithTerminalCancellation(res, cancelled)
          return
        }
        const body = await readJson(req)
        requests += 1
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'x-run-id': body.run_id,
          'x-run-request-digest': TEST_RUN_DIGEST,
        })
        res.write(
          `id: 1\ndata: ${JSON.stringify({ usage: { prompt_tokens: 13, completion_tokens: 5, cost: 0.02, cost_known: true, cost_provenance: 'provider-receipt' } })}\n\n`,
        )
        setTimeout(() => res.socket?.destroy(new Error('socket died before terminal receipt')), 10)
      })
      await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
      const { port } = server.address() as AddressInfo
      const profile = {
        name: 'pi-leader',
        harness: 'codex',
        prompt: { systemPrompt: 'Lead the pursuit.' },
        model: { provider: 'openai', default: 'gpt-5.6' },
      } as const
      const options = {
        backend: {
          backend: 'bridge',
          bridgeUrl: `http://127.0.0.1:${port}`,
          bridgeBearer: 'test-token',
        } as const,
        budget: { maxIterations: 2, maxTokens: 100, maxUsd: 1 },
        runDir,
        runId: 'partial-manager-restart',
      }

      const first = await supervise(profile, 'Choose the next experiment.', options)
      expect(first.kind).toBe('no-winner')
      expect(first.spentTotal).toMatchObject({
        tokens: { input: 13, output: 5 },
        tokensKnown: false,
        usd: 0.02,
        usdKnown: false,
      })

      const resumed = await supervise(profile, 'Choose the next experiment.', options)
      expect(resumed.kind).toBe('no-winner')
      expect(resumed.spentTotal).toMatchObject({
        tokens: { input: 13, output: 5 },
        tokensKnown: false,
        usd: 0.02,
        usdKnown: false,
      })
      // One reconnect under the same durable run id proves the first transport loss before the
      // repeated event id fails continuity. Resume itself starts no replacement manager.
      expect(requests).toBe(2)
    } finally {
      await rm(runDir, { recursive: true, force: true })
    }
  })

  it("preserves a leaf's unknown dollar cost and refuses it under a dollar cap", async () => {
    const requests: BridgeRequest[] = []
    server = createBridgeServer(async (req, res) => {
      const body = await readJson(req)
      requests.push(body)
      const profile = body.agent_profile
      const coordination = body.runtime_attachments?.mcp['agent-runtime-coordination']
      if (coordination?.url) {
        await callCoordination(coordination.url, 'spawn_agent', {
          profile: {
            name: 'worker',
            harness: 'codex',
            prompt: { systemPrompt: 'Return the result.' },
            model: { provider: 'openai', default: 'gpt-5.6' },
          },
          task: 'Return RESULT=42.',
        })
        await callCoordination(coordination.url, 'await_event', {})
      }
      respondWithBridgeStream(
        res,
        body,
        profile.name === 'worker' ? unknownCostStream('RESULT=42') : successStream('managed'),
      )
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo

    const result = await supervise(
      {
        name: 'pi-leader',
        harness: 'codex',
        prompt: { systemPrompt: 'Lead the pursuit.' },
        model: { provider: 'openai', default: 'gpt-5.6' },
      },
      'Choose the next experiment.',
      {
        backend: {
          backend: 'bridge',
          bridgeUrl: `http://127.0.0.1:${port}`,
          bridgeBearer: 'test-token',
        },
        budget: { maxIterations: 4, maxTokens: 10_000, maxUsd: 1 },
      },
    )

    expect(requests.map((request) => request.agent_profile.name)).toEqual(['pi-leader', 'worker'])
    expect(result.kind).toBe('no-winner')
    expect(result.spentTotal.usdKnown).toBe(false)
  })
})
