import { type ChildProcess, spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { RunParkedError, readRunParking, supervisePursuit } from '../../../src/durable/index'
import { BackendTransportError } from '../../../src/index'
import {
  type Agent,
  type AgentSpec,
  cancelRun,
  type DriveHarness,
  type ExecutorResult,
  readWorkerSteerAcknowledgement,
  supervisorRunDir,
  writeWorkerSteer,
} from '../../../src/runtime/index'
import { durableRetainedProvider } from '../../helpers/durable-retained-provider'
import { runtimeToolDeclarations, testAgentProfile } from '../../kernel/test-agent-profile'

const [runDir, mode = 'pause', phase = 'park'] = process.argv.slice(2)
if (runDir === undefined) throw new Error('run directory required')
const timingPath = join(runDir, 'process-timing.jsonl')
function recordTiming(stage: string): void {
  const resources: Record<string, number> = {}
  for (const resource of process.getActiveResourcesInfo()) {
    resources[resource] = (resources[resource] ?? 0) + 1
  }
  appendFileSync(
    timingPath,
    `${JSON.stringify({ stage, uptime: process.uptime(), cpu: process.cpuUsage(), resources })}\n`,
  )
}
recordTiming('module-ready')
process.once('beforeExit', () => recordTiming('beforeExit'))
process.once('exit', () => recordTiming('exit'))
const now = () => Date.now() + (phase === 'resume' ? 600_000 : 0)
const base = durableRetainedProvider(join(runDir, 'provider.json'))
const provider = {
  ...base,
  capabilities: async () => ({
    ...(await base.capabilities()),
    create: { runtimeAttachments: { mcp: true } },
  }),
}
const backend = { backend: 'provider' as const, provider }
const profile = testAgentProfile('parking-root', {
  harness: 'opencode',
  ...(mode === 'tool' || mode === 'steer'
    ? {
        tools: runtimeToolDeclarations(mode === 'tool' ? 'slow_effect' : 'stop'),
      }
    : {}),
  ...(mode === 'seat'
    ? {
        model: { provider: 'anthropic', default: 'claude-opus-4-1' },
        seats: [
          {
            harness: 'opencode',
            provider: 'anthropic',
            model: 'claude-opus-4-1',
            selector: { kind: 'all-eligible' as const },
          },
        ],
      }
    : {}),
})
const abort = new AbortController()
let cancelTimer: ReturnType<typeof setTimeout> | undefined
let drives = 0
let releaseTool!: () => void
const toolMayFinish = new Promise<void>((resolve) => {
  releaseTool = resolve
})
const driveHarness: DriveHarness = async ({
  scope,
  task,
  coordinationMcpUrl,
  coordinationMcpHeaders,
}) => {
  drives += 1
  appendFileSync(
    join(runDir, 'drives.jsonl'),
    `${JSON.stringify({ phase, drive: drives, task, at: now() })}\n`,
  )
  if (phase === 'resume' || phase === 'reopen') return
  if (mode === 'steer') {
    if (drives > 1) {
      await callTool(coordinationMcpUrl, coordinationMcpHeaders, 'stop')
      return
    }
    cancelTimer = setTimeout(
      () =>
        writeWorkerSteer(runDir, 'parking-proof', 'parking-proof', {
          operationId: 'parking-steer',
          source: 'integration',
          message: 'Continue after this durable correction.',
          eventDir: supervisorRunDir(runDir, 'parking-proof'),
        }),
      100,
    )
  }
  if (mode === 'tool') {
    const receipt = await callTool(coordinationMcpUrl, coordinationMcpHeaders, 'slow_effect')
    if (receipt.running !== true) throw new Error('expected a live tool receipt')
    appendFileSync(join(runDir, 'tool-receipt'), 'running\n')
    setTimeout(releaseTool, 100)
  }
  if (mode === 'active' || mode === 'draining' || mode === 'foreign') {
    let started!: () => void
    const childStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    const child = scope.spawn(processWorker(started), 'work', {
      label: 'active-work',
      budget: { maxIterations: 1, maxTokens: 100 },
    })
    if (!child.ok) throw new Error(`child refused: ${child.reason}`)
    await childStarted
    if (mode === 'active')
      cancelTimer = setTimeout(() => abort.abort(new Error('stop active proof')), 150)
  }
  if (mode === 'foreign')
    throw new RunParkedError('foreign-run', {
      reason: 'paused-root',
      since: new Date(now()).toISOString(),
      wakeAt: new Date(now() + 300_000).toISOString(),
    })
  throw new BackendTransportError('parking-fixture', 'transient failure', { status: 500 })
}
if (phase === 'cancel')
  cancelRun(runDir, 'parking-cancel', {
    source: 'integration',
    operator: 'parking-proof',
    reason: 'Cancel before the parked wake.',
  })
try {
  recordTiming('before-supervise')
  const outcome = await supervisePursuit(profile, 'Park and resume this same objective.', {
    pursuitId: 'parking-proof',
    runId: 'parking-proof',
    runDir,
    parking: { afterMs: mode === 'steer' ? 10_000 : 30 },
    now,
    budget: {
      maxIterations: 20,
      maxTokens: 10_000,
      deadlineMs: mode === 'deadline' ? 60_000 : 3_600_000,
    },
    perWorker: { maxIterations: 2, maxTokens: 500 },
    driverRetry: { pauseRootStops: true, maxAttempts: 1, transientOutageMs: 0 },
    ...(phase === 'reopen'
      ? {
          reopen: {
            operator: 'parking-proof',
            operationId: 'parking-reopen',
            reason: 'Resume the cancelled objective.',
          },
        }
      : {}),
    ...(mode === 'tool'
      ? {
          coordination: { requestTimeoutMs: 400 },
          resolveSupervisorTools: () => [
            {
              name: 'slow_effect',
              description: 'Commit a delayed local effect.',
              inputSchema: { type: 'object', properties: {}, additionalProperties: false },
              handler: async () => {
                appendFileSync(join(runDir, 'tool-started'), 'started\n')
                await toolMayFinish
                appendFileSync(join(runDir, 'tool-finished'), 'finished\n')
                cancelTimer = setTimeout(
                  () => abort.abort(new Error('unread tool outcome proof')),
                  100,
                )
                return { committed: true }
              },
            },
          ],
        }
      : {}),
    ...(mode === 'seat'
      ? {
          backend,
          driverBackend: backend,
          selectSeat: async () =>
            phase === 'resume'
              ? { seat: 'ready-seat', backend }
              : { resumeAt: new Date(now() + 120_000).toISOString() },
          coordination: {
            authentication: {
              signingKeys: {
                activeKeyId: 'fixture',
                keys: { fixture: 'fixture-signing-key-'.repeat(4) },
              },
            },
            publicUrl: (address: { port: number }) => `http://127.0.0.1:${address.port}/manager`,
          },
        }
      : { driveHarness, makeWorkerAgent: () => ({ name: 'unused', act: async () => undefined }) }),
    signal: abort.signal,
    childSettleGraceMs: 0,
  })
  process.stdout.write(
    `${JSON.stringify({
      kind: 'settled',
      result: outcome.result,
      projection: (await readRunParking(runDir)) ?? null,
      ...(mode === 'steer'
        ? {
            steer: readWorkerSteerAcknowledgement(
              supervisorRunDir(runDir, 'parking-proof'),
              'parking-steer',
            ),
          }
        : {}),
    })}\n`,
  )
} catch (error) {
  if (!(error instanceof RunParkedError)) throw error
  process.stdout.write(
    `${JSON.stringify({
      kind: 'parked',
      runId: error.runId,
      parking: error.parking,
      projection: await readRunParking(runDir),
    })}\n`,
  )
} finally {
  recordTiming('finally')
  if (cancelTimer !== undefined) clearTimeout(cancelTimer)
}

async function callTool(
  url: string,
  headers: Readonly<Record<string, string>> | undefined,
  name: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: name,
      method: 'tools/call',
      params: { name, arguments: {} },
    }),
  })
  const envelope = (await response.json()) as {
    error?: unknown
    result?: {
      structuredContent?: Record<string, unknown>
      content?: Array<{ type: string; text?: string }>
    }
  }
  if (!response.ok || envelope.error)
    throw new Error(`coordination call failed: ${JSON.stringify(envelope)}`)
  return (
    envelope.result?.structuredContent ??
    JSON.parse(envelope.result?.content?.find((item) => item.type === 'text')?.text ?? '{}')
  )
}

/** A real child process admitted through the public executor boundary, with confirmed teardown. */
function processWorker(started: () => void): Agent<unknown, string> & { executorSpec: AgentSpec } {
  let child: ChildProcess | undefined
  let closed: Promise<void> | undefined
  let result: ExecutorResult<string> | undefined
  const executorSpec: AgentSpec = {
    profile: testAgentProfile('parking-child'),
    harness: null,
    executor: {
      runtime: 'parking-process',
      execute: (_task, signal) => {
        const beganAt = Date.now()
        const source = `
          const fs = require('node:fs');
          let finished = false;
          const done = () => {
            if (finished) return;
            finished = true;
            fs.appendFileSync(process.argv[1], 'ended\\n');
            process.exit(0);
          };
          process.on('SIGTERM', done);
          process.stdout.write('ready\\n');
          setTimeout(done, 1000);
        `
        child = spawn(process.execPath, ['-e', source, join(runDir!, 'child-ended')], {
          stdio: ['ignore', 'pipe', 'inherit'],
        })
        const running = child
        running.stdout!.once('data', started)
        const abort = () => {
          running.kill('SIGTERM')
        }
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
        const outcome = new Promise<ExecutorResult<string>>((resolve, reject) => {
          running.once('error', reject)
          running.once('close', (code) => {
            signal.removeEventListener('abort', abort)
            if (code !== 0) {
              reject(new Error(`parking child exited ${code}`))
              return
            }
            result = {
              out: 'done',
              outRef: 'parking:done',
              spent: {
                iterations: 1,
                tokens: { input: 0, output: 0 },
                usd: 0,
                ms: Date.now() - beganAt,
              },
            }
            resolve(result)
          })
        })
        closed = outcome.then(
          () => undefined,
          () => undefined,
        )
        return outcome
      },
      teardown: async () => {
        if (child?.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
        await closed
        return {
          destroyed: child === undefined || child.exitCode !== null || child.signalCode !== null,
        }
      },
      resultArtifact: () => result,
    },
  }
  return { name: 'active-work', act: async () => 'done', executorSpec }
}
