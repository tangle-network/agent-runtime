/**
 * Bare closed-loop proof:
 *   Scope.spawn -> git workspace worker -> observe(trace) -> steer_worker/Scope.send -> fix worker
 *
 * This intentionally avoids a `defineLoop` facade. The driver uses the same
 * coordination MCP verbs a sandbox driver would see, but runs locally so the
 * join is reproducible without cloud credentials.
 *
 *   pnpm exec tsx bench/src/observe-steer-workspace-loop.mts
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatClient, type AnalystFinding } from '@tangle-network/agent-eval'
import type { AgentProfile } from '@tangle-network/sandbox'
import { createCoordinationTools } from '../../src/mcp/tools/coordination'
import {
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  contentAddress,
  createExecutorRegistry,
  createSupervisor,
  gitWorkspace,
  observe,
  type Agent,
  type AgentSpec,
  type Executor,
  type ExecutorResult,
  type ResultBlobStore,
  type Scope,
  type Spend,
  type Workspace,
} from '../../src/runtime/index'

const bareRepo = '/tmp/observe-steer-workspace-loop.git'

type WorkerPhase = 'initial' | 'fix'

interface WorkerOutput {
  readonly kind: 'worker'
  readonly phase: WorkerPhase
  readonly ok: boolean
  readonly output: string
  readonly trace: ReadonlyArray<unknown>
  readonly rev?: string
  readonly steer?: string
}

interface DriverOutput {
  readonly kind: 'driver'
  readonly ok: boolean
  readonly initialWorker: string
  readonly fixWorker: string
  readonly finding: string
  readonly finalRev: string
  readonly integration: string
}

type TreeOutput = WorkerOutput | DriverOutput

const zeroSpend = (ms: number): Spend => ({
  iterations: 1,
  tokens: { input: 0, output: 0 },
  usd: 0,
  ms,
})

const sh = (cmd: string, args: string[], cwd?: string): string =>
  execFileSync(cmd, args, { cwd, encoding: 'utf-8', stdio: 'pipe' })

const git = (args: string[], cwd?: string): string =>
  sh(
    'git',
    ['-c', 'core.hooksPath=/dev/null', '-c', 'user.email=loop@tangle', '-c', 'user.name=loop', ...args],
    cwd,
  )

function initWorkspace(): void {
  rmSync(bareRepo, { recursive: true, force: true })
  git(['init', '--bare', '-b', 'main', bareRepo])
  const seed = mkdtempSync(join(tmpdir(), 'osw-seed-'))
  try {
    git(['clone', bareRepo, seed])
    writeFileSync(
      join(seed, 'test_answer.py'),
      'from answer import answer\n\nassert answer() == 42, answer()\nprint("INTEGRATION OK")\n',
    )
    git(['add', '-A'], seed)
    git(['commit', '-m', 'seed integration test'], seed)
    git(['push', 'origin', 'main'], seed)
  } finally {
    rmSync(seed, { recursive: true, force: true })
  }
}

function integrationCheck(): string {
  const check = mkdtempSync(join(tmpdir(), 'osw-check-'))
  try {
    git(['clone', bareRepo, check])
    return sh('python3', ['test_answer.py'], check).trim()
  } finally {
    rmSync(check, { recursive: true, force: true })
  }
}

class WorkspaceWorkerExecutor implements Executor<WorkerOutput> {
  readonly runtime = 'workspace-proof'
  private artifact?: ExecutorResult<WorkerOutput>
  private inbox: unknown[] = []
  private waiter?: (msg: unknown) => void

  constructor(
    private readonly phase: WorkerPhase,
    private readonly workspace: Workspace,
  ) {}

  deliver(msg: unknown): void {
    if (this.waiter) {
      const w = this.waiter
      this.waiter = undefined
      w(msg)
      return
    }
    this.inbox.push(msg)
  }

  async execute(task: unknown, signal: AbortSignal): Promise<ExecutorResult<WorkerOutput>> {
    const started = Date.now()
    const out =
      this.phase === 'initial'
        ? await this.writeBadAttempt()
        : await this.writeCorrectedAttempt(await this.waitForSteer(signal), task)
    this.artifact = {
      outRef: contentAddress(out),
      out,
      spent: zeroSpend(Date.now() - started),
    }
    return this.artifact
  }

  async teardown(): Promise<{ destroyed: boolean }> {
    return { destroyed: true }
  }

  resultArtifact(): ExecutorResult<WorkerOutput> {
    if (!this.artifact) throw new Error('workspace worker read before execute')
    return this.artifact
  }

  private async waitForSteer(signal: AbortSignal): Promise<string> {
    const existing = this.inbox.shift()
    if (existing) return steerText(existing)
    if (signal.aborted) throw new Error('fix worker aborted before steer')
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.waiter = undefined
        reject(new Error('fix worker aborted before steer'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.waiter = (msg) => {
        signal.removeEventListener('abort', onAbort)
        resolve(steerText(msg))
      }
    })
  }

  private async writeBadAttempt(): Promise<WorkerOutput> {
    const dir = mkdtempSync(join(tmpdir(), 'osw-worker-'))
    try {
      await this.workspace.materialize(dir)
      writeFileSync(join(dir, 'answer.py'), 'def answer():\n    return 0\n')
      const test = runTest(dir)
      const committed = await this.workspace.commit(dir, 'initial bad answer')
      if (!committed.ok) throw new Error(`workspace conflict: ${committed.conflict}`)
      return {
        kind: 'worker',
        phase: 'initial',
        ok: false,
        output: test.output,
        rev: committed.rev,
        trace: [
          { type: 'status', data: { status: 'wrote answer.py returning 0' } },
          { type: 'error', data: { message: test.output } },
        ],
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  private async writeCorrectedAttempt(steer: string, task: unknown): Promise<WorkerOutput> {
    const dir = mkdtempSync(join(tmpdir(), 'osw-worker-'))
    try {
      await this.workspace.materialize(dir)
      writeFileSync(join(dir, 'answer.py'), 'def answer():\n    return 42\n')
      const test = runTest(dir)
      const committed = await this.workspace.commit(dir, 'apply observer steer')
      if (!committed.ok) throw new Error(`workspace conflict: ${committed.conflict}`)
      return {
        kind: 'worker',
        phase: 'fix',
        ok: test.ok,
        output: `${taskSummary(task)}\n${test.output}`,
        rev: committed.rev,
        steer,
        trace: [
          { type: 'status', data: { status: 'received observer steer' } },
          { type: 'status', data: { status: 'ran python3 test_answer.py' } },
        ],
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

function runTest(cwd: string): { ok: boolean; output: string } {
  try {
    return { ok: true, output: sh('python3', ['test_answer.py'], cwd).trim() }
  } catch (err) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string }
    return { ok: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}${e.message ?? ''}`.trim() }
  }
}

function steerText(msg: unknown): string {
  const steer = (msg as { steer?: unknown }).steer
  if (typeof steer !== 'string' || steer.length === 0) throw new Error('missing steer text')
  return steer
}

function taskSummary(task: unknown): string {
  return typeof task === 'string' ? task : JSON.stringify(task)
}

function workerOutput(v: unknown): WorkerOutput {
  if (!v || typeof v !== 'object' || (v as { kind?: unknown }).kind !== 'worker') {
    throw new Error('expected worker output')
  }
  return v as WorkerOutput
}

function makeWorkerAgent(workspace: Workspace, profile: unknown): Agent<unknown, unknown> {
  const phase = (profile as { phase?: unknown }).phase
  if (phase !== 'initial' && phase !== 'fix') throw new Error('profile.phase must be initial or fix')
  const executor = new WorkspaceWorkerExecutor(phase, workspace)
  const spec: AgentSpec = {
    profile: { name: `workspace-${phase}` } as AgentProfile,
    harness: null,
    executor,
  }
  return {
    name: `workspace-${phase}`,
    act: async () => {
      throw new Error('workspace worker is executed through Executor')
    },
    executorSpec: spec,
  } as Agent<unknown, unknown> & { executorSpec: AgentSpec }
}

function mockObserverChat() {
  return createChatClient({
    transport: 'mock',
    defaultModel: 'mock-observer',
    handler: async () => ({
      content: JSON.stringify({
        findings: [
          {
            area: 'verification',
            severity: 'high',
            claim: 'Trace shows the integration test failed after answer.py returned the wrong value.',
            recommended_action:
              'Open answer.py, make answer() return 42, then run python3 test_answer.py before committing.',
            audience: 'agent',
            confidence: 0.99,
          },
        ],
      }),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      costUsd: null,
      model: 'mock-observer',
      durationMs: 0,
      raw: {},
    }),
  })
}

function tool(tools: ReturnType<typeof createCoordinationTools>, name: string) {
  const t = tools.tools.find((x) => x.name === name)
  if (!t) throw new Error(`missing coordination tool ${name}`)
  return t
}

async function call<T>(
  tools: ReturnType<typeof createCoordinationTools>,
  name: string,
  raw: unknown,
): Promise<T> {
  return (await tool(tools, name).handler(raw)) as T
}

async function main(): Promise<void> {
  initWorkspace()
  const workspace = gitWorkspace({ ref: bareRepo })
  const blobs: ResultBlobStore = new InMemoryResultBlobStore()
  const observerChat = mockObserverChat()
  const driver: Agent<string, TreeOutput> = {
    name: 'driver',
    async act(task, scope) {
      const tools = createCoordinationTools({
        scope: scope as Scope<unknown>,
        blobs,
        perWorker: { maxIterations: 2, maxTokens: 10_000 },
        makeWorkerAgent: (profile) => makeWorkerAgent(workspace, profile),
        analysts: {
          kinds: [{ id: 'observe', description: 'trace observer', area: 'verification' }],
          run: async (kind, artifact) => {
            if (kind !== 'observe') throw new Error(`unknown analyst ${kind}`)
            const out = workerOutput(artifact)
            const observation = await observe(
              {
                task,
                output: out.output,
                trace: out.trace,
                outcome: out.ok ? 'passed' : 'failed',
                runId: out.rev,
              },
              { chat: observerChat, maxTraceLines: 20 },
            )
            return observation.findings
          },
        },
      })

      const initial = await call<{ workerId: string }>(tools, 'spawn_worker', {
        profile: { phase: 'initial' },
        task: 'write answer.py',
        label: 'initial-worker',
      })
      const first = await call<{ settled: string; outRef: string }>(tools, 'await_next', {})
      const analyzed = await call<{ findings: AnalystFinding[] }>(tools, 'run_analyst', {
        kind: 'observe',
        workerId: first.settled,
      })
      const finding = analyzed.findings[0]
      if (!finding?.recommended_action) throw new Error('observer produced no steer')

      const fix = await call<{ workerId: string }>(tools, 'spawn_worker', {
        profile: { phase: 'fix' },
        task: 'apply observer finding and verify',
        label: 'fix-worker',
      })
      const steer = await call<{ delivered: boolean }>(tools, 'steer_worker', {
        workerId: fix.workerId,
        instruction: finding.recommended_action,
      })
      if (!steer.delivered) throw new Error('observer steer was not delivered')

      const second = await call<{ settled: string; outRef: string }>(tools, 'await_next', {})
      const fixed = workerOutput(await blobs.get(second.outRef))
      if (!fixed.ok || !fixed.rev) throw new Error(`fix worker failed: ${fixed.output}`)
      await call<{ stopped: true }>(tools, 'stop', { reason: 'observer steer applied and verified' })

      return {
        kind: 'driver',
        ok: true,
        initialWorker: initial.workerId,
        fixWorker: fix.workerId,
        finding: finding.recommended_action,
        finalRev: fixed.rev,
        integration: integrationCheck(),
      }
    },
  }

  const result = await createSupervisor<string, TreeOutput>().run(driver, 'make answer() return 42', {
    runId: 'observe-steer-workspace',
    budget: { maxIterations: 10, maxTokens: 100_000 },
    journal: new InMemorySpawnJournal(),
    blobs,
    executors: createExecutorRegistry(),
  })

  if (result.kind !== 'winner' || result.out.kind !== 'driver' || !result.out.ok) {
    throw new Error(`loop failed: ${JSON.stringify(result)}`)
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        initialWorker: result.out.initialWorker,
        fixWorker: result.out.fixWorker,
        finalRev: result.out.finalRev,
        integration: result.out.integration,
        nodes: result.tree.nodes.length,
      },
      null,
      2,
    ),
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err)
  process.exit(1)
})
