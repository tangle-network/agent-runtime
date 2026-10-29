import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createInterface } from 'node:readline'
import type {
  AgentInteractiveSessionControlClaim,
  AgentInteractiveSessionControlClaimRequest,
  AgentInteractiveSessionPromptCommand,
  AgentInteractiveSessionRef,
} from '@tangle-network/agent-interface'
import {
  agentExecutionPreparationReceiptSchema,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import type {
  AgentEnvironment,
  AgentEnvironmentProvider,
} from '@tangle-network/agent-interface/environment-provider'

const preparationReceipt = {
  kind: 'agent-execution-preparation' as const,
  schemaVersion: 1 as const,
  preparationId: 'preparation-1',
  requestDigest: `sha256:${'1'.repeat(64)}`,
  authoredProfileDigest: `sha256:${'2'.repeat(64)}`,
  effectiveProfileDigest: `sha256:${'2'.repeat(64)}`,
  backend: 'test-backend',
  harness: 'pi',
  harnessVersion: 'test-harness-1',
  resolvedModel: {
    requested: 'test/model',
    resolved: 'test/model',
  },
  workspace: {
    leaseId: 'workspace-lease-1',
    provider: 'test-provider',
    identityDigest: `sha256:${'3'.repeat(64)}`,
    isolation: 'per-run' as const,
    sourceSnapshotDigest: `sha256:${'4'.repeat(64)}`,
    sourceSnapshotPolicy: {
      kind: 'provider-declared' as const,
      name: 'test-snapshot',
      version: 1,
      digest: `sha256:${'5'.repeat(64)}`,
    },
    preparedWorkspaceDigest: `sha256:${'6'.repeat(64)}`,
    profileActivationDigest: `sha256:${'7'.repeat(64)}`,
  },
  axisResults: [],
  executionPlanDigest: `sha256:${'8'.repeat(64)}`,
  materializer: { name: 'test-materializer', version: '1' },
  expiresAtMs: 4102444800000,
}

export const ref: AgentInteractiveSessionRef = {
  run: {
    provider: 'test-provider',
    environmentId: 'environment-1',
    sessionId: 'session-1',
    executionId: 'execution-1',
    runId: 'run-1',
    requestDigest: `sha256:${'1'.repeat(64)}`,
  },
  preparationReceipt: agentExecutionPreparationReceiptSchema.parse({
    ...preparationReceipt,
    digest: canonicalCandidateDigest(preparationReceipt),
  }),
  incarnationId: 'incarnation-1',
  startedAt: '2026-08-16T00:00:00.000Z',
}

export const capabilities = {
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

/** HTTP provider plus a real stdin-driven process. Authority follows Sidecar's active-lease law. */
export async function interactiveControlServer() {
  const actor = spawn(
    process.execPath,
    [
      '-e',
      "require('node:readline').createInterface({input:process.stdin}).on('line',s=>process.stdout.write(s+'\\n'))",
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  )
  const output = createInterface({ input: actor.stdout })
  const work = new Map<number, (value: unknown) => void>()
  let message = 0
  output.on('line', (line) => {
    const value = JSON.parse(line)
    work.get(value.id)?.(value)
    work.delete(value.id)
  })
  const execute = (kind: string, value: unknown) =>
    new Promise((resolve) => {
      const id = ++message
      work.set(id, resolve)
      actor.stdin.write(JSON.stringify({ id, kind, value }) + '\n')
    })
  let control: AgentInteractiveSessionControlClaim = {
    refDigest: canonicalCandidateDigest(ref),
    generation: 1,
    leaseId: 'bootstrap',
    holderId: 'tangle-sidecar',
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  }
  let running = true
  let releaseDetach: (() => void) | undefined
  let detached: (() => void) | undefined
  let detachBarrier: Promise<void> | undefined
  const prompts = new Map<string, { digest: string; prompt: string }>()
  const claims = new Map<string, unknown>()
  const calls: string[] = []
  const writes: string[] = []
  const sizes: unknown[] = []
  const authorize = (claim: unknown) => {
    if (
      canonicalCandidateDigest(claim) !== canonicalCandidateDigest(control) ||
      Date.parse(control.expiresAt) <= Date.now()
    )
      throw new Error('current exact terminal authority required')
  }
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const args = JSON.parse(Buffer.concat(chunks).toString())
      const method = request.url?.slice(1) ?? ''
      calls.push(method)
      let result: unknown
      if (method === 'capabilities') result = capabilities
      else if (method === 'status')
        result = running
          ? { state: 'running', ref }
          : { state: 'exited', ref, endedAt: new Date().toISOString(), reason: 'stopped' }
      else if (method === 'claim') {
        const command = args as AgentInteractiveSessionControlClaimRequest
        const prior = claims.get(command.operationId)
        if (prior) result = prior
        else if (
          command.expectedGeneration !== control.generation ||
          (Date.parse(control.expiresAt) > Date.now() &&
            control.holderId !== 'tangle-sidecar' &&
            control.holderId !== command.holderId)
        )
          result = {
            ...command,
            status: 'conflict',
            conflictReason: 'generation_mismatch',
            currentGeneration: control.generation,
          }
        else {
          control = {
            refDigest: canonicalCandidateDigest(ref),
            generation: control.generation + 1,
            leaseId: `lease-${control.generation + 1}`,
            holderId: command.holderId,
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
          }
          result = {
            operationId: command.operationId,
            requestDigest: command.requestDigest,
            ref,
            status: 'accepted',
            control,
          }
          claims.set(command.operationId, result)
        }
        // Claim replies contain only the canonical envelope, not request-only fields.
        if ((result as { status: string }).status === 'conflict')
          result = {
            operationId: command.operationId,
            requestDigest: command.requestDigest,
            ref,
            status: 'conflict',
            conflictReason: 'generation_mismatch',
            currentGeneration: control.generation,
          }
      } else if (method === 'prompt') {
        const command = args as AgentInteractiveSessionPromptCommand
        const held = prompts.get(command.operationId)
        let status = 'accepted'
        if (held) status = held.digest === command.requestDigest ? 'replayed' : 'conflict'
        else {
          authorize(command.control)
          await execute('prompt', command.prompt)
          prompts.set(command.operationId, {
            digest: command.requestDigest,
            prompt: command.prompt,
          })
        }
        result = {
          operationId: command.operationId,
          requestDigest: command.requestDigest,
          ref,
          control: command.control,
          status,
          ...(status === 'conflict' ? { existingRequestDigest: held?.digest } : {}),
        }
      } else if (method === 'input') {
        authorize(args.control)
        await execute('input', args.data)
        writes.push(args.data)
        result = {}
      } else if (method === 'resize') {
        authorize(args.control)
        await execute('resize', args.size)
        sizes.push(args.size)
        result = {}
      } else if (method === 'attach') {
        authorize(args.control)
        result = {}
      } else if (method === 'detach') {
        authorize(args.control)
        control = { ...control, expiresAt: new Date(0).toISOString() }
        detached?.()
        await detachBarrier
        result = { status: 'detached', terminalSessionId: 'terminal-1' }
      } else if (method === 'stop') {
        authorize(args.control)
        running = false
        actor.stdin.end()
        result = {
          operationId: args.operationId,
          requestDigest: args.requestDigest,
          ref,
          control: args.control,
          status: 'accepted',
          effect: 'stopped',
        }
      } else throw new Error('unknown provider route')
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(result))
    } catch (error) {
      response.statusCode = 409
      response.end(JSON.stringify({ error: String(error) }))
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    prompts,
    writes,
    sizes,
    calls,
    generation: () => control.generation,
    expire: () => {
      control = { ...control, expiresAt: new Date(0).toISOString() }
    },
    pauseDetach: () => {
      detachBarrier = new Promise<void>((resolve) => {
        releaseDetach = resolve
      })
      return {
        released: new Promise<void>((resolve) => {
          detached = resolve
        }),
        resume: () => releaseDetach?.(),
      }
    },
    close: async () => {
      actor.kill()
      output.close()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

export function networkInteractiveControlProvider(endpoint: string): AgentEnvironmentProvider {
  const call = async (
    method: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> => {
    const response = await fetch(`${endpoint}/${method}`, {
      method: 'POST',
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    })
    const data = (await response.json()) as Record<string, unknown>
    if (!response.ok) throw new Error((data as { error: string }).error)
    return data
  }
  const terminalRef = {
    terminalSessionId: 'terminal-1',
    parentExecutionId: ref.run.executionId,
    name: 'interactive',
    shell: 'node',
    cwd: '/workspace',
    cols: 80,
    rows: 24,
    createdAt: ref.startedAt,
    lastActivityAt: ref.startedAt,
    expiresAt: '2099-01-01T00:00:00.000Z',
    isRunning: true,
    attachCount: 1,
  }
  const environment = {
    id: ref.run.environmentId,
    provider: ref.run.provider,
    status: async () => 'running',
    async *stream() {},
    destroy: async () => {},
    startInteractive: async () => {
      throw new Error('reconnect-only fixture')
    },
    interactive: () => ({
      ref,
      status: (options?: { signal?: AbortSignal }) => call('status', {}, options?.signal),
      claimControl: (command: unknown, options?: { signal?: AbortSignal }) =>
        call('claim', command, options?.signal),
      sendPrompt: (command: unknown, options?: { signal?: AbortSignal }) =>
        call('prompt', command, options?.signal),
      stop: (command: unknown, options?: { signal?: AbortSignal }) =>
        call('stop', command, options?.signal),
      attach: async (command: { control: AgentInteractiveSessionControlClaim }) => {
        await call('attach', command)
        return {
          ref: terminalRef,
          control: command.control,
          cursors: { earliest: 0, latest: 0 },
          input: (input: { data: string }) =>
            call('input', { control: command.control, ...input }).then(() => undefined),
          resize: (size: unknown) =>
            call('resize', { control: command.control, size }).then(() => undefined),
          detach: () => call('detach', { control: command.control }),
          close: () => call('detach', { control: command.control }),
          async *events() {},
        }
      },
    }),
  } as unknown as AgentEnvironment
  return {
    name: ref.run.provider,
    capabilities: async () => capabilities,
    create: async () => environment,
    get: async (id) => (id === environment.id ? environment : null),
  }
}
