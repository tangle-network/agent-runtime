import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { afterEach, describe, expect, it } from 'vitest'
import type { ExecutorConfig } from '../../src/runtime/supervise/runtime'
import { supervise } from '../../src/runtime/supervise/supervise'

interface BridgeRequest {
  model: string
  run_id: string
  session_id: string
  effort?: string
  agent_profile: AgentProfile
  messages: Array<{ role: string; content: string }>
}

const testRunDigest = `sha256:${'e'.repeat(64)}`

async function readJson(req: AsyncIterable<Uint8Array>): Promise<BridgeRequest> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as BridgeRequest
}

function respondWithSuccess(res: ServerResponse, request: BridgeRequest, content: string): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'x-run-id': request.run_id,
    'x-run-request-digest': testRunDigest,
  })
  res.end(
    [
      `id: 1\ndata: ${JSON.stringify({ choices: [{ delta: { content } }] })}`,
      '',
      `id: 2\ndata: ${JSON.stringify({ usage: { prompt_tokens: 11, completion_tokens: 7, cost: 0.01 } })}`,
      '',
      'data: [DONE]',
      '',
    ].join('\n'),
  )
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
  const body = (await response.json()) as {
    error?: { message?: string }
    result?: { isError?: boolean; content?: Array<{ text?: string }> }
  }
  if (body.error) throw new Error(body.error.message ?? `coordination ${name} failed`)
  if (body.result?.isError) {
    throw new Error(body.result.content?.map((entry) => entry.text ?? '').join('\n'))
  }
  const outputText = body.result?.content?.[0]?.text
  if (outputText) {
    const output = JSON.parse(outputText) as { error?: string }
    if (output.error) throw new Error(`coordination ${name}: ${output.error}`)
  }
}

describe('supervise — full AgentProfiles over cli-bridge', () => {
  let server: Server | undefined

  afterEach(async () => {
    if (server) await new Promise((resolve) => server?.close(resolve))
    server = undefined
  })

  it('runs an external root, lets it author a worker, and preserves every profile axis', async () => {
    const requests: BridgeRequest[] = []
    const serverErrors: string[] = []
    const workerProfile: AgentProfile = {
      name: 'experiment-worker',
      description: 'Execute the discriminating measurement',
      version: '1.0.0',
      tags: ['measurement'],
      harness: 'codex',
      prompt: {
        systemPrompt: 'Return the exact measured result.',
        instructions: ['Measure twice.'],
      },
      model: {
        default: 'gpt-5.6',
        small: 'gpt-5-mini',
        provider: 'openai',
        reasoningEffort: 'medium',
        metadata: { tier: 'priority' },
      },
      permissions: { shell: 'allow', network: { outbound: 'deny' } },
      tools: { shell: true, web: false },
      mcp: { disabled: { enabled: false } },
      connections: [{ connectionId: 'dataset-1', capabilities: ['read'], alias: 'dataset' }],
      subagents: {
        critic: {
          description: 'Challenge the measurement',
          prompt: 'Find one confound.',
          model: 'gpt-5-mini',
          tools: { shell: false },
          permissions: { web: 'deny' },
          maxSteps: 3,
          metadata: { role: 'critic' },
        },
      },
      resources: {
        files: [
          {
            path: 'protocol.txt',
            resource: {
              kind: 'inline',
              name: 'protocol',
              content: 'Measure twice and report both observations.',
            },
          },
        ],
        skills: [
          {
            kind: 'inline',
            name: 'experimental-method',
            content: '# Experimental method\nChange one variable at a time.',
          },
        ],
        instructions: 'Keep observations separate from interpretations.',
        failOnError: true,
      },
      hooks: {
        stop: [{ command: 'npm test', timeoutMs: 60_000, blocking: true, matcher: 'done' }],
      },
      modes: {
        adversarial: {
          description: 'Try to falsify the claim',
          model: 'gpt-5.6',
          prompt: 'Search for a counterexample.',
          tools: { web: false },
          permissions: { shell: 'allow' },
          metadata: { strict: true },
        },
      },
      confidential: { tee: 'any', sealed: true, attestationRefresh: true },
      metadata: { role: 'worker', family: 'scientific-method' },
      extensions: { codex: { sandbox: 'workspace-write' } },
    }

    server = createServer(async (req, res) => {
      try {
        const body = await readJson(req)
        requests.push(body)
        const coordination = body.agent_profile.mcp?.['agent-runtime-coordination']
        if (coordination?.enabled !== false && coordination?.url) {
          await callCoordination(coordination.url, 'spawn_agent', {
            profile: workerProfile,
            task: 'Measure and return RESULT=42.',
          })
          await callCoordination(coordination.url, 'await_event', {})
        }
        respondWithSuccess(
          res,
          body,
          body.agent_profile.name === workerProfile.name ? 'RESULT=42' : 'managed',
        )
      } catch (error) {
        serverErrors.push(error instanceof Error ? error.message : String(error))
        res.writeHead(500, { 'content-type': 'text/plain' })
        res.end(error instanceof Error ? error.message : String(error))
      }
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo

    const rootProfile: AgentProfile = {
      name: 'research-leader',
      description: 'Lead the pursuit',
      version: '2.0.0',
      tags: ['discovery'],
      harness: 'codex',
      prompt: {
        systemPrompt: 'Choose and supervise the most informative experiment.',
        instructions: ['Stop when the evidence answers the pursuit.'],
      },
      model: {
        default: 'gpt-5.6',
        small: 'gpt-5-mini',
        provider: 'openai',
        reasoningEffort: 'xhigh',
        metadata: { tier: 'priority' },
      },
      permissions: { shell: 'allow' },
      tools: { shell: true, web: true },
      mcp: {
        literature: { transport: 'http', url: 'https://papers.example.test/mcp' },
      },
      connections: [{ connectionId: 'papers-1', capabilities: ['search'] }],
      subagents: {
        skeptic: { description: 'Challenge assumptions', prompt: 'Look for a disproof.' },
      },
      resources: {
        instructions: 'Separate hypotheses from observations.',
        failOnError: true,
      },
      hooks: { stop: [{ command: 'npm test', blocking: true }] },
      modes: { exploratory: { prompt: 'Prefer informative experiments.' } },
      confidential: { tee: 'any', sealed: true },
      metadata: { role: 'driver', family: 'discovery-native' },
      extensions: { codex: { sandbox: 'workspace-write' } },
    }
    const backend: ExecutorConfig = {
      backend: 'bridge',
      bridgeUrl: `http://127.0.0.1:${port}`,
      bridgeBearer: 'test-token',
      model: 'claude-code/sonnet',
    }

    const result = await supervise(rootProfile, 'Resolve the pursuit.', {
      backend,
      // Worker and root each report 18 tokens. Ending exactly at zero must
      // still finalize the worker's already-delivered result.
      budget: { maxIterations: 8, maxTokens: 36 },
      perWorker: { maxIterations: 3, maxTokens: 18 },
      maxDepth: 3,
      deliverable: {
        check: (out) =>
          typeof out === 'object' &&
          out !== null &&
          (out as { content?: unknown }).content === 'RESULT=42',
        describe: 'worker reports RESULT=42',
      },
    })

    expect(serverErrors).toEqual([])
    expect(result.kind).toBe('winner')
    if (result.kind !== 'winner') throw new Error('expected the delivered worker to win')
    expect(result.out).toMatchObject({ content: 'RESULT=42' })
    expect(result.spentTotal.tokens).toEqual({ input: 22, output: 14 })
    expect(requests.map((request) => request.agent_profile.name)).toEqual([
      'research-leader',
      'experiment-worker',
    ])
    expect(requests.map((request) => request.model)).toEqual(['codex/gpt-5.6', 'codex/gpt-5.6'])
    expect(requests.map((request) => request.effort)).toEqual(['xhigh', 'medium'])
    expect(requests.every((request) => request.messages[0]?.role === 'user')).toBe(true)

    const root = requests[0]!.agent_profile
    expect(root).toMatchObject(rootProfile)
    expect(root.mcp?.['agent-runtime-coordination']).toMatchObject({ transport: 'http' })

    const worker = requests[1]!.agent_profile
    expect(worker).toEqual(workerProfile)
    expect(worker.mcp?.['agent-runtime-coordination']).toBeUndefined()
  })

  it('turns a driver-marked authored profile into a nested supervisor', async () => {
    const requests: BridgeRequest[] = []
    const leafProfile: AgentProfile = {
      name: 'experiment-leaf',
      harness: 'codex',
      model: { default: 'gpt-5.6' },
      prompt: { systemPrompt: 'Return RESULT=42.' },
      metadata: { role: 'worker' },
    }
    const nestedProfile: AgentProfile = {
      name: 'nested-leader',
      harness: 'codex',
      model: { default: 'gpt-5.6' },
      prompt: { systemPrompt: 'Supervise the measurement.' },
      metadata: { role: 'driver' },
    }

    server = createServer(async (req, res) => {
      const body = await readJson(req)
      requests.push(body)
      const coordination = body.agent_profile.mcp?.['agent-runtime-coordination']
      if (coordination?.enabled !== false && coordination?.url) {
        if (body.agent_profile.name === 'research-leader') {
          await callCoordination(coordination.url, 'spawn_agent', {
            profile: nestedProfile,
            task: 'Supervise one measurement.',
          })
          await callCoordination(coordination.url, 'await_event', {})
        } else if (body.agent_profile.name === 'nested-leader') {
          await callCoordination(coordination.url, 'spawn_agent', {
            profile: leafProfile,
            task: 'Measure and return RESULT=42.',
            budget: { maxIterations: 1, maxTokens: 18 },
          })
          await callCoordination(coordination.url, 'await_event', {})
        }
      }
      respondWithSuccess(
        res,
        body,
        body.agent_profile.name === leafProfile.name ? 'RESULT=42' : 'managed',
      )
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo

    const result = await supervise(
      {
        name: 'research-leader',
        harness: 'codex',
        model: { default: 'gpt-5.6' },
        prompt: { systemPrompt: 'Create the right research hierarchy.' },
        metadata: { role: 'driver' },
      },
      'Resolve the pursuit.',
      {
        backend: {
          backend: 'bridge',
          bridgeUrl: `http://127.0.0.1:${port}`,
          bridgeBearer: 'test-token',
          model: 'codex/gpt-5.6',
        },
        budget: { maxIterations: 3, maxTokens: 54 },
        perWorker: { maxIterations: 2, maxTokens: 36 },
        maxDepth: 3,
        deliverable: {
          check: (out) =>
            typeof out === 'object' &&
            out !== null &&
            (out as { content?: unknown }).content === 'RESULT=42',
          describe: 'leaf reports RESULT=42',
        },
      },
    )

    expect(result.kind).toBe('winner')
    expect(result.spentTotal.tokens).toEqual({ input: 33, output: 21 })
    expect(requests.map((request) => request.agent_profile.name)).toEqual([
      'research-leader',
      'nested-leader',
      'experiment-leaf',
    ])
    expect(requests[1]?.agent_profile.mcp?.['agent-runtime-coordination']).toMatchObject({
      transport: 'http',
    })
    expect(requests[2]?.agent_profile.mcp?.['agent-runtime-coordination']).toBeUndefined()
  })

  it('refuses an external root whose bridge omits dollar cost under a dollar cap', async () => {
    server = createServer(async (req, res) => {
      const body = await readJson(req)
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'x-run-id': body.run_id,
        'x-run-request-digest': testRunDigest,
      })
      res.end(
        [
          `id: 1\ndata: ${JSON.stringify({
            choices: [{ delta: { content: 'finished without cost telemetry' } }],
          })}`,
          '',
          `id: 2\ndata: ${JSON.stringify({
            usage: { prompt_tokens: 2, completion_tokens: 1 },
          })}`,
          '',
          'data: [DONE]',
          '',
        ].join('\n'),
      )
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo

    const result = await supervise(
      {
        name: 'research-leader',
        harness: 'codex',
        model: { default: 'gpt-5.6' },
        prompt: { systemPrompt: 'Lead the research.' },
      },
      'Resolve the pursuit.',
      {
        backend: {
          backend: 'bridge',
          bridgeUrl: `http://127.0.0.1:${port}`,
          bridgeBearer: 'test-token',
          model: 'codex/gpt-5.6',
        },
        budget: { maxIterations: 2, maxTokens: 10, maxUsd: 1 },
      },
    )

    expect(result.kind).toBe('no-winner')
    expect(result.spentTotal.usdKnown).toBe(false)
  })
})
