import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { expect, it } from 'vitest'
import { contentAddress } from '../../src/durable/content-address'
import {
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
} from '../../src/durable/in-memory-spawn-stores'
import type { CoordinationTools, MakeWorkerAgent } from '../../src/mcp/tools/coordination-contracts'
import { runSettledCommand } from '../../src/mcp/worktree-harness'
import type { CoordinationHttpAudit } from '../../src/runtime/supervise/coordination-http'
import {
  type CoordinationControlAccess,
  type CoordinationMcpHandle,
  serveCoordinationMcpForManager,
} from '../../src/runtime/supervise/coordination-mcp'
import { connectRemoteSupervisorControl } from '../../src/runtime/supervise/remote-supervisor'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  AgentSpec,
  Executor,
  ExecutorResult,
  Scope,
} from '../../src/runtime/supervise/types'

async function rpc(
  url: string,
  headers: Readonly<Record<string, string>>,
  method = 'tools/list',
  params?: unknown,
) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }),
    signal: AbortSignal.timeout(5000),
  })
  return { status: response.status, body: await response.json() }
}

/** An actual OS process admitted through the public custom worker seam. No model or native
 * profile-materialization claim is made; this worker honestly has no steering inbox. */
function processWorker(directory: string): MakeWorkerAgent {
  return (profile) => {
    const stop = new AbortController()
    let pending: Promise<ExecutorResult<unknown>> | undefined
    let artifact: ExecutorResult<unknown> | undefined
    let executionSignal: AbortSignal | undefined
    let started: number | undefined
    const executor: Executor<unknown> = {
      runtime: 'control-http-process',
      execute(_task, signal) {
        started = performance.now()
        executionSignal = AbortSignal.any([signal, stop.signal])
        pending = runSettledCommand({
          command: process.execPath,
          args: [
            '-e',
            "require('node:fs').writeFileSync('worker.pid',String(process.pid));setInterval(()=>{},100)",
          ],
          cwd: directory,
          timeoutMs: 10000,
          signal: executionSignal,
        }).then((child) => {
          const out = { content: child.stdout }
          artifact = {
            out,
            outRef: contentAddress(out),
            verdict: { valid: child.exitCode === 0, score: child.exitCode === 0 ? 1 : 0 },
            spent: {
              iterations: 1,
              tokens: { input: 0, output: 0 },
              tokensKnown: true,
              usd: 0,
              usdKnown: true,
              ms: performance.now() - started!,
            },
          }
          return artifact
        })
        return pending
      },
      async teardown() {
        stop.abort('control process fixture teardown')
        await pending?.catch((error) => {
          // The maintained runner throws the caller's abort reason only AFTER process-tree
          // termination is confirmed. A different failure must not become destroyed:true.
          const reason = executionSignal?.reason
          const aborted =
            executionSignal?.aborted &&
            (error === reason ||
              (!(reason instanceof Error) &&
                error instanceof Error &&
                error.message === String(reason)))
          if (!aborted) throw error
        })
        return { destroyed: true }
      },
      accounting() {
        const spent = artifact?.spent ?? {
          iterations: started === undefined ? 0 : 1,
          tokens: { input: 0, output: 0 },
          tokensKnown: true,
          usd: 0,
          usdKnown: true,
          ms: started === undefined ? 0 : performance.now() - started,
        }
        return { reported: spent, reservation: spent }
      },
      resultArtifact() {
        if (!artifact) throw new Error('process has not produced an artifact')
        return artifact
      },
    }
    const executorSpec: AgentSpec = { profile, harness: null, executor }
    return {
      name: profile.name,
      act: async () => {
        throw new Error('executor owns this process')
      },
      executorSpec,
    } as Agent<unknown, unknown> & { executorSpec: AgentSpec }
  }
}

/** MCP permits object structuredContent and JSON text content; refuse JSON-RPC errors first. */
function toolOutput(response: Awaited<ReturnType<typeof rpc>>): Record<string, unknown> {
  expect(response.status).toBe(200)
  expect(response.body.error, JSON.stringify(response.body)).toBeUndefined()
  const result = response.body.result
  expect(result?.isError, JSON.stringify(response.body)).not.toBe(true)
  const output = result?.structuredContent ?? JSON.parse(result?.content?.[0]?.text ?? 'null')
  expect(output, JSON.stringify(response.body)).toBeTruthy()
  expect(typeof output).toBe('object')
  return output
}

async function withControl(
  body: (input: {
    mcp: CoordinationMcpHandle
    controls: CoordinationTools
    access: CoordinationControlAccess
    scope: Scope<unknown>
    stopScope(): void
    directory: string
    journal: InMemorySpawnJournal
    audits: CoordinationHttpAudit[]
  }) => Promise<void>,
  options: { signed?: boolean; ttlMs?: number; lifetime?: AbortSignal } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), 'coordination-control-http-'))
  const blobs = new InMemoryResultBlobStore()
  const journal = new InMemorySpawnJournal()
  const audits: CoordinationHttpAudit[] = []
  const scopeStop = new AbortController()
  let checked = false
  let exercise: Promise<void> | undefined
  const root: Agent<unknown, unknown> = {
    name: 'control-http-owner',
    async act(_task, scope) {
      let access: CoordinationControlAccess | undefined
      const { handle: mcp, controls } = await serveCoordinationMcpForManager(
        {
          scope,
          blobs,
          makeWorkerAgent: processWorker(directory),
          perWorker: { maxIterations: 2, maxTokens: 1000 },
          toolNames: ['spawn_worker'],
          authentication: {
            ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
            ...(options.signed
              ? {
                  signingKeys: {
                    activeKeyId: 'test',
                    keys: { test: 'synthetic-integration-signing-key-'.repeat(2) },
                  },
                }
              : {}),
          },
          ...(options.signed ? { publicUrl: ({ port }) => `http://127.0.0.1:${port}/mcp` } : {}),
          identity: { runId: 'control-http', actorId: scope.view.root },
          onControlReady: (published) => {
            access = published
          },
          onAudit: (event) => {
            audits.push(event)
          },
        },
        options.lifetime,
      )
      try {
        if (!access) throw new Error('operator capability was not published')
        exercise = body({
          mcp,
          controls,
          access,
          scope,
          stopScope: () => scopeStop.abort('scope integration stopped'),
          directory,
          journal,
          audits,
        }).then(() => {
          checked = true
        })
        await exercise
        return { checked }
      } finally {
        await mcp.close()
      }
    },
  }
  try {
    const result = await createSupervisor().run(
      root,
      {},
      {
        budget: { maxIterations: 20, maxTokens: 10000, deadlineMs: 15000 },
        runId: 'control-http',
        journal,
        blobs,
        executors: createExecutorRegistry(),
        signal: scopeStop.signal,
      },
    )
    // Scope cancellation may settle the root before its async body resumes. The independent
    // HTTP assertions must complete (and propagate failures) before temporary files are removed.
    await exercise
    expect(checked, JSON.stringify(result)).toBe(true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function workerPid(directory: string): Promise<number> {
  const until = Date.now() + 5000
  while (Date.now() < until) {
    try {
      const pid = Number(await readFile(join(directory, 'worker.pid'), 'utf8'))
      if (Number.isSafeInteger(pid) && pid > 0) return pid
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
    }
    await sleep(20)
  }
  throw new Error('real worker process did not start')
}

it.each([false, true])(
  'separates operator HTTP authority and controls the same live process (signed manager=%s)',
  async (signed) => {
    const lifetime = new AbortController()
    await withControl(
      async ({ mcp, controls, access, scope, directory, journal, audits }) => {
        expect(access).toMatchObject({ runId: 'control-http', actorId: scope.view.root })
        const listed = await rpc(access.url, access.headers)
        expect(listed.status).toBe(200)
        expect(listed.body.result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual([
          'cancel_worker',
          'observe_agent',
          'read_journal',
          'steer_agent',
        ])
        for (const [url, headers] of [
          [access.url, mcp.readOnly.headers],
          [access.url, mcp.headers],
          [mcp.url, access.headers],
          [mcp.readOnly.url, access.headers],
        ] as const)
          expect((await rpc(url, headers)).status).toBe(401)
        expect(
          (
            await rpc(access.url, access.headers, 'tools/call', {
              name: 'spawn_worker',
              arguments: {},
            })
          ).body.error.code,
        ).toBe(-32601)
        expect(
          (
            await rpc(mcp.readOnly.url, mcp.readOnly.headers, 'tools/call', {
              name: 'cancel_worker',
              arguments: { workerId: 'unknown' },
            })
          ).body.error.code,
        ).toBe(-32601)
        const spawned = await rpc(mcp.url, mcp.headers, 'tools/call', {
          name: 'spawn_worker',
          arguments: {
            profile: {
              name: 'real-process',
              harness: 'cli-base',
              model: { provider: 'offline', default: 'offline/local-process' },
            },
            task: 'Remain live until the operator cancels this process.',
          },
        })
        const { workerId } = toolOutput(spawned)
        expect(typeof workerId).toBe('string')
        if (typeof workerId !== 'string') throw new Error('spawn_worker did not return workerId')
        const pid = await workerPid(directory)
        process.kill(pid, 0)
        const operator = await connectRemoteSupervisorControl(access)
        try {
          expect((await operator.tree()).nodes.some((node) => node.id === workerId)).toBe(true)
          expect((await operator.observe(workerId)).agent.id).toBe(workerId)
          // Raw processes have no inbox; truthful refusal is required, never a fabricated delivery.
          expect(
            await operator.steer(workerId, 'keep the existing task', { interrupt: true }),
          ).toMatchObject({
            delivered: false,
            outcome: 'runtime-has-no-inbox',
          })
          expect(await operator.cancel('not-owned')).toMatchObject({ error: 'not-live' })
          expect(await operator.cancel(workerId, 'operator integration finished')).toMatchObject({
            cancelled: true,
            workerId,
          })
          await controls.awaitSettlement([workerId], AbortSignal.timeout(5000))
          expect(() => process.kill(pid, 0)).toThrow()
          const oldManager = mcp.headers
          const oldReader = mcp.readOnly
          mcp.rotateCredential()
          expect((await rpc(access.url, access.headers)).status).toBe(401)
          expect((await rpc(mcp.url, oldManager)).status).toBe(401)
          expect((await rpc(oldReader.url, oldReader.headers)).status).toBe(401)
          expect((await rpc(mcp.url, mcp.headers)).status).toBe(200)
          const current = mcp.control
          expect((await rpc(current.url, current.headers)).status).toBe(200)
          lifetime.abort('operator ownership ended')
          expect((await rpc(current.url, current.headers)).status).toBe(401)
          expect((await rpc(mcp.readOnly.url, mcp.readOnly.headers)).status).toBe(401)
          expect((await rpc(mcp.url, mcp.headers)).status).toBe(200)
          const evidence = JSON.stringify({
            audits,
            bus: mcp.history(),
            journal: await journal.loadTree('control-http'),
          })
          for (const headers of [
            access.headers,
            current.headers,
            oldManager,
            mcp.headers,
            oldReader.headers,
          ]) {
            expect(evidence).not.toContain(headers.Authorization!.slice('Bearer '.length))
          }
          expect(
            audits.some(
              (event) => event.action === 'cancel_worker' && event.outcome === 'completed',
            ),
          ).toBe(true)
        } finally {
          await operator.close()
        }
      },
      { signed, lifetime: lifetime.signal },
    )
  },
)

it('expires the separate operator capability at its actual TTL and revokes on scope stop', async () => {
  await withControl(
    async ({ mcp, access, stopScope }) => {
      expect((await rpc(access.url, access.headers)).status).toBe(200)
      await sleep(Math.max(0, mcp.credentialExpiresAt! - Date.now() + 1))
      expect((await rpc(access.url, access.headers)).status).toBe(401)
      mcp.rotateCredential()
      const current = mcp.control
      expect((await rpc(current.url, current.headers)).status).toBe(200)
      stopScope()
      expect((await rpc(current.url, current.headers)).status).toBe(401)
    },
    { ttlMs: 1000 },
  )
})
