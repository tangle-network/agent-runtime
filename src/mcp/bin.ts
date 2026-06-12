#!/usr/bin/env node

/**
 * @experimental
 *
 * `agent-runtime-mcp` — stdio MCP server entry point.
 *
 * Spins up a server with the default coder delegate (wired against the
 * real `@tangle-network/sandbox` client) and, when the optional
 * `@tangle-network/agent-knowledge` peer is installed, a researcher
 * delegate against `multiHarnessResearcherFanout`.
 *
 * Environment variables:
 *   TANGLE_API_KEY                   required — passed to `new Sandbox({ apiKey })`
 *   SANDBOX_BASE_URL                 optional — sandbox-SDK base URL override
 *   TANGLE_FLEET_ID                  optional — when set, delegations dispatch
 *                                    INTO this fleet's shared workspace instead
 *                                    of creating sibling sandboxes. Set by the
 *                                    parent sandbox when launching this MCP
 *                                    server so worker diffs land on the caller's
 *                                    filesystem with no cross-sandbox boundary.
 *   TANGLE_FLEET_EXCLUDE_MACHINES    optional — comma-separated machine ids to
 *                                    skip during fleet-mode round-robin
 *                                    (typically the coordinator machine this
 *                                    MCP server is running on).
 *   MCP_MAX_CONCURRENT_SANDBOXES     default 4 — kernel maxConcurrency cap
 *   MCP_CODER_FANOUT_HARNESSES       comma-separated harness ids to use for variants > 1
 *   MCP_DISABLE_CODER                set to `1` to omit `delegate_code`
 *   MCP_DISABLE_RESEARCHER           set to `1` to omit `delegate_research` even when peer is present
 *   AGENT_RUNTIME_DELEGATION_STATE_FILE
 *                                    optional — absolute path of a JSON state
 *                                    file. When set, delegation records persist
 *                                    across MCP restarts (FileDelegationStore):
 *                                    status/history survive and idempotency keys
 *                                    dedupe across processes. Single-variant
 *                                    coder/researcher delegations additionally
 *                                    dispatch DETACHED (driveTurn ticks against a
 *                                    deterministic session id) on session-backed
 *                                    placements, so restored in-flight records
 *                                    resume against their still-running sandbox
 *                                    sessions; non-detached in-flight records
 *                                    settle as failed with a truthful
 *                                    driver-restart error.
 *   AGENT_RUNTIME_DELEGATION_DETACHED
 *                                    set to `0` to keep every delegation on the
 *                                    streaming path even when the state file is
 *                                    configured (disables detached dispatch +
 *                                    resume).
 *   AGENT_RUNTIME_DELEGATION_STATE_RECOVER
 *                                    set to `1` to archive a corrupt state file
 *                                    (`<file>.corrupt-<ts>`) and start empty
 *                                    instead of refusing to boot.
 *   AGENT_RUNTIME_DELEGATION_RETAIN_TERMINAL
 *                                    optional — positive integer cap on retained
 *                                    terminal records. Unset = keep forever.
 */

import type { SandboxInstance } from '@tangle-network/sandbox'
import { coderProfile } from '../profiles/coder'
import type { AgentRunSpec, LoopTraceEmitter, SandboxClient } from '../runtime'
import { runLoop } from '../runtime'
import { detectExecutor } from './bin-helpers'
import {
  coderTaskFromArgs,
  createDefaultCoderDelegate,
  type ResearcherDelegate,
  settleDetachedCoderTurn,
} from './delegates'
import { FileDelegationStore } from './delegation-store'
import { composeLoopTraceEmitters } from './delegation-trace'
import {
  createDriveTurnResumeDriver,
  type DetachedTurn,
  type DriveTurnCapableBox,
  detachedTurnEvents,
  formatDetachedSessionRef,
  parseDetachedSessionRef,
  runDetachedTurn,
} from './detached-turn'
import type { DelegationExecutor } from './executor'
import { createMcpServer } from './server'
import { type DelegationResumeDriver, DelegationTaskQueue } from './task-queue'
import {
  createPropagatingTraceEmitter,
  readTraceContextFromEnv,
  type TraceContext,
} from './trace-propagation'
import type { DelegateCodeArgs, DelegateResearchArgs, ResearchOutputShape } from './types'

async function main(): Promise<void> {
  const fanoutHarnesses = parseHarnesses(process.env.MCP_CODER_FANOUT_HARNESSES)
  const maxConcurrency = parseConcurrency(process.env.MCP_MAX_CONCURRENT_SANDBOXES)
  const wantCoder = !process.env.MCP_DISABLE_CODER
  const wantResearcher = !process.env.MCP_DISABLE_RESEARCHER
  const fleetId = parseFleetId(process.env.TANGLE_FLEET_ID)

  // Skip the sandbox client load entirely when no profile delegate needs it —
  // the feedback + status + history tools are queue-bound and require no
  // sandbox. Useful for tooling that mounts the MCP server purely for
  // self-introspection.
  const needsSandbox = wantCoder || wantResearcher
  let sandboxClient: SandboxClient | undefined
  let executor: DelegationExecutor | undefined
  if (needsSandbox) {
    const apiKey = process.env.TANGLE_API_KEY
    if (!apiKey && !process.env.AGENT_RUNTIME_MCP_ALLOW_NO_KEY) {
      process.stderr.write(
        'agent-runtime-mcp: TANGLE_API_KEY is required. Set AGENT_RUNTIME_MCP_ALLOW_NO_KEY=1 to run without it for diagnostics, or MCP_DISABLE_CODER=1 MCP_DISABLE_RESEARCHER=1 to run the queue-only subset.\n',
      )
      process.exit(2)
    }
    // Fleet mode against a diagnostic stub is meaningless — the stub can't
    // resolve a real fleet handle. Refuse rather than silently degrading,
    // otherwise a fleet-mounted MCP would behave differently than configured.
    if (fleetId && !apiKey) {
      process.stderr.write(
        'agent-runtime-mcp: TANGLE_FLEET_ID was set but TANGLE_API_KEY is missing; cannot resolve fleet handle. Provide an api key or unset TANGLE_FLEET_ID.\n',
      )
      process.exit(2)
    }
    sandboxClient = await loadSandboxClient(apiKey)
    executor = await detectExecutor({ sandboxClient })
    if (fleetId) {
      process.stderr.write(`agent-runtime-mcp: fleet-aware delegation: fleetId=${fleetId}\n`)
    }
    process.stderr.write(`agent-runtime-mcp: delegation placement → ${executor.describe()}\n`)
  }

  // Export delegated-loop topology spans to the OTLP / Tangle Intelligence sink
  // when OTEL_EXPORTER_OTLP_ENDPOINT is set (+ TRACE_ID / PARENT_SPAN_ID for
  // correlation with the caller's trace). A cheap no-op when the endpoint is
  // unset — the fleet forwards the env into this MCP's process to turn it on.
  // The same context is stamped onto every delegation record (traceId /
  // parentSpanId) so journal consumers join records into the caller's trace.
  const traceContext = readTraceContextFromEnv()
  const { emitter: traceEmitter, exporter: traceExporter } =
    createPropagatingTraceEmitter(traceContext)
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    process.stderr.write(
      `agent-runtime-mcp: exporting loop topology → ${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}\n`,
    )
  }

  const coderDelegate =
    wantCoder && executor
      ? createDefaultCoderDelegate({
          executor,
          fanoutHarnesses,
          maxConcurrency,
          traceEmitter,
        })
      : undefined

  const researcherSupport =
    wantResearcher && executor
      ? await loadResearcherSupport(executor, maxConcurrency, traceEmitter)
      : undefined

  // Detached dispatch + resume turn on together with the durable store, and
  // only for session-backed placements with real credentials: in-process
  // placement has no sandbox session to detach, and the diagnostic no-key stub
  // cannot resolve boxes. AGENT_RUNTIME_DELEGATION_DETACHED=0 keeps everything
  // on the streaming path.
  const detachedDispatch =
    Boolean(process.env.AGENT_RUNTIME_DELEGATION_STATE_FILE?.trim()) &&
    process.env.AGENT_RUNTIME_DELEGATION_DETACHED !== '0' &&
    Boolean(process.env.TANGLE_API_KEY) &&
    (executor?.placement === 'sibling' || executor?.placement === 'fleet')
  if (detachedDispatch) {
    process.stderr.write(
      'agent-runtime-mcp: detached dispatch enabled — single-variant delegations resume across restarts\n',
    )
  }
  const resumeDriver =
    detachedDispatch && sandboxClient
      ? buildResumeDriver({ sandboxClient, researcherResume: researcherSupport?.resume })
      : undefined

  const durableQueue = await buildDurableQueueFromEnv(resumeDriver, traceContext)
  const server = createMcpServer({
    coderDelegate,
    researcherDelegate: researcherSupport?.delegate,
    detachedDispatch,
    traceContext,
    ...(durableQueue ? { queue: durableQueue } : {}),
  })

  const shutdown = () => {
    server.stop()
    const pending: Promise<unknown>[] = []
    if (traceExporter) pending.push(traceExporter.shutdown())
    // Drain journal writes so the state file reflects the final record
    // states before the process exits. A persist failure already routed
    // through onPersistError; swallow the duplicate rejection here.
    if (durableQueue) pending.push(durableQueue.flush().catch(() => {}))
    if (pending.length === 0) {
      process.exit(0)
      return
    }
    void Promise.allSettled(pending).finally(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  await server.serve()
}

async function buildDurableQueueFromEnv(
  resumeDriver: DelegationResumeDriver | undefined,
  traceContext: TraceContext,
): Promise<DelegationTaskQueue | undefined> {
  const stateFile = process.env.AGENT_RUNTIME_DELEGATION_STATE_FILE?.trim()
  if (!stateFile) return undefined
  const store = new FileDelegationStore({
    filePath: stateFile,
    recoverCorrupt: process.env.AGENT_RUNTIME_DELEGATION_STATE_RECOVER === '1',
  })
  const maxTerminalRecords = parseRetention(process.env.AGENT_RUNTIME_DELEGATION_RETAIN_TERMINAL)
  // With a resume driver, restored in-flight records that carry a
  // detachedSessionRef re-attach to their still-running sandbox sessions;
  // without one (detached dispatch disabled / no credentials) they settle as
  // failed with a truthful driver-restart error.
  const queue = await DelegationTaskQueue.restore({
    store,
    traceContext,
    ...(resumeDriver ? { resumeDelegate: resumeDriver } : {}),
    ...(maxTerminalRecords !== undefined ? { maxTerminalRecords } : {}),
    onPersistError: (error) => {
      // Durable mode that can no longer write is a broken contract: crash
      // loud instead of degrading to memory-only behind the caller's back.
      process.stderr.write(`agent-runtime-mcp: ${error.message}\n`)
      process.exit(1)
    },
  })
  process.stderr.write(`agent-runtime-mcp: durable delegation state → ${stateFile}\n`)
  return queue
}

interface ResearcherResumeSupport {
  message(args: DelegateResearchArgs): string
  settle(
    turn: DetachedTurn,
    args: DelegateResearchArgs,
    signal: AbortSignal,
  ): Promise<ResearchOutputShape>
}

/**
 * Compose the `driveTurn`-backed resume driver over the real sandbox client.
 * Profile dispatch: coder records settle through the same parse + validate
 * gate the delegate applies; researcher records settle through the
 * agent-knowledge preset when the peer is installed. Profiles without resume
 * support (ui-auditor, researcher-without-peer) fail loud — the record settles
 * as failed with the reason instead of fabricating an output.
 */
function buildResumeDriver(args: {
  sandboxClient: SandboxClient
  researcherResume: ResearcherResumeSupport | undefined
}): DelegationResumeDriver {
  const client = args.sandboxClient as SandboxClient & {
    get?: (id: string) => Promise<SandboxInstance | null>
  }
  return createDriveTurnResumeDriver({
    async resolveSandbox(sandboxId) {
      if (typeof client.get !== 'function') {
        throw new Error(
          'agent-runtime-mcp: the sandbox client exposes no get(sandboxId); upgrade @tangle-network/sandbox to >= 0.6 to resume detached delegations',
        )
      }
      const box = await client.get(sandboxId)
      if (!box) {
        throw new Error(
          `agent-runtime-mcp: sandbox ${sandboxId} no longer exists — the detached run cannot be resumed`,
        )
      }
      return box as unknown as DriveTurnCapableBox
    },
    buildMessage(record) {
      if (record.profile === 'coder') {
        const task = coderTaskFromArgs(record.args as DelegateCodeArgs)
        return coderProfile({ task }).taskToPrompt(task)
      }
      if (record.profile === 'researcher' && args.researcherResume) {
        return args.researcherResume.message(record.args as DelegateResearchArgs)
      }
      throw new Error(
        `agent-runtime-mcp: no detached resume support for profile "${record.profile}"`,
      )
    },
    async settleOutput(turn, record, ctx) {
      if (record.profile === 'coder') {
        if (!record.detachedSessionRef) {
          throw new Error(
            `agent-runtime-mcp: record ${record.taskId} reached the resume settle without a detachedSessionRef`,
          )
        }
        return settleDetachedCoderTurn(turn, {
          task: coderTaskFromArgs(record.args as DelegateCodeArgs),
          sessionId: parseDetachedSessionRef(record.detachedSessionRef).sessionId,
          signal: ctx.signal,
        })
      }
      if (record.profile === 'researcher' && args.researcherResume) {
        return args.researcherResume.settle(turn, record.args as DelegateResearchArgs, ctx.signal)
      }
      throw new Error(
        `agent-runtime-mcp: no detached resume support for profile "${record.profile}"`,
      )
    },
  })
}

function parseRetention(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) {
    process.stderr.write(
      `agent-runtime-mcp: AGENT_RUNTIME_DELEGATION_RETAIN_TERMINAL must be a positive integer, got "${raw}"\n`,
    )
    process.exit(2)
  }
  return n
}

async function loadSandboxClient(apiKey: string | undefined): Promise<SandboxClient> {
  // Diagnostic mode: AGENT_RUNTIME_MCP_ALLOW_NO_KEY=1 enables tools/list + the
  // queue-bound tools (status / history / feedback) without sandbox creds.
  // Coder + researcher delegations require a real client; the stub fails loud
  // at create() so the agent observes the cause instead of silent success.
  if (!apiKey) {
    return {
      async create() {
        throw new Error(
          'agent-runtime-mcp: TANGLE_API_KEY is unset; coder/researcher delegations are disabled in diagnostic mode. Set TANGLE_API_KEY or use MCP_DISABLE_CODER=1 MCP_DISABLE_RESEARCHER=1 to remove the unsupported tools from the tool list.',
        )
      },
    } satisfies SandboxClient
  }
  // Dynamic import keeps the bin importable in environments that haven't
  // installed `@tangle-network/sandbox` yet (the runtime package lists it
  // as a peer dep, not a hard dep).
  const mod = await import('@tangle-network/sandbox').catch((err) => {
    process.stderr.write(
      `agent-runtime-mcp: failed to load @tangle-network/sandbox (${err.message}); install the peer dependency\n`,
    )
    process.exit(2)
  })
  const SandboxCtor = (mod as { Sandbox?: new (config: unknown) => SandboxClient }).Sandbox
  if (!SandboxCtor) {
    process.stderr.write(
      'agent-runtime-mcp: @tangle-network/sandbox does not export Sandbox; cannot construct client\n',
    )
    process.exit(2)
  }
  const baseUrl = process.env.SANDBOX_BASE_URL
  return new SandboxCtor({
    apiKey,
    ...(baseUrl ? { baseUrl } : {}),
  })
}

interface ResearcherProfilePreset {
  agentRunSpec: Parameters<typeof runLoop>[0]['agentRun'] extends infer T ? NonNullable<T> : never
  output: Parameters<typeof runLoop>[0]['output']
  validator: Parameters<typeof runLoop>[0]['validator']
}

interface ResearcherFanoutPreset {
  agentRuns: NonNullable<Parameters<typeof runLoop>[0]['agentRuns']>
  output: Parameters<typeof runLoop>[0]['output']
  validator: Parameters<typeof runLoop>[0]['validator']
  driver: Parameters<typeof runLoop>[0]['driver']
}

interface ResearcherSupport {
  delegate: ResearcherDelegate
  resume: ResearcherResumeSupport
}

async function loadResearcherSupport(
  executor: DelegationExecutor,
  maxConcurrency: number,
  traceEmitter?: LoopTraceEmitter,
): Promise<ResearcherSupport | undefined> {
  const sandboxClient = executor.client
  // Optional peer — when `@tangle-network/agent-knowledge` isn't installed,
  // we silently omit the researcher tool from the advertisement. The
  // dynamic-import path is resolved at runtime; TypeScript cannot see the
  // peer, so we type the module structurally rather than via its own
  // declaration file.
  const profilesSpecifier = '@tangle-network/agent-knowledge/profiles'
  const mod = await import(profilesSpecifier).catch(() => undefined)
  if (!mod) return undefined
  type SingleFactory = (opts: { task: unknown }) => ResearcherProfilePreset
  type FanoutFactory = (opts: { task: unknown }) => ResearcherFanoutPreset
  const fanoutFactory = (mod as { multiHarnessResearcherFanout?: FanoutFactory })
    .multiHarnessResearcherFanout
  const singleFactory = (mod as { researcherProfile?: SingleFactory }).researcherProfile
  if (!fanoutFactory || !singleFactory) return undefined

  const settleSingle = async (
    turn: DetachedTurn,
    args: DelegateResearchArgs,
    sessionId: string,
    signal: AbortSignal,
  ): Promise<ResearchOutputShape> => {
    const task = buildResearchTask(args)
    const preset = singleFactory({ task })
    if (!preset.validator) {
      throw new Error('agent-runtime-mcp: researcher preset exposes no validator; cannot settle')
    }
    const parsed = preset.output.parse(detachedTurnEvents(sessionId, turn))
    const verdict = await preset.validator.validate(parsed, { iteration: 0, signal })
    if ((verdict as { valid?: boolean }).valid !== true) {
      throw new Error('researcher delegate produced no winner')
    }
    return parsed as ResearchOutputShape
  }

  const delegate: ResearcherDelegate = async (args, ctx) => {
    const task = buildResearchTask(args)
    const variants = Math.max(1, Math.trunc(args.variants ?? 1))
    const loopEmitter = composeLoopTraceEmitters(traceEmitter, ctx.traceEmitter)
    ctx.report({ iteration: 0, phase: 'starting' })
    if (variants <= 1) {
      const preset = singleFactory({ task })
      // Detached dispatch — same contract as the coder delegate: one session
      // on one box, driveTurn ticks, resume key bound to the sandbox id.
      if (ctx.detachedSessionRef !== undefined && ctx.updateDetachedSessionRef) {
        const { sessionId } = parseDetachedSessionRef(ctx.detachedSessionRef)
        const rebind = ctx.updateDetachedSessionRef
        const spec = preset.agentRunSpec as AgentRunSpec<unknown>
        const turn = await runDetachedTurn({
          client: sandboxClient,
          spec,
          prompt: spec.taskToPrompt(task),
          sessionId,
          bindSandbox: (sandboxId) => rebind(formatDetachedSessionRef({ sandboxId, sessionId })),
          signal: ctx.signal,
          report: ctx.report,
          ...(loopEmitter ? { traceEmitter: loopEmitter } : {}),
          ...(executor.placement === 'fleet' ? { placement: 'fleet' as const } : {}),
        })
        const output = await settleSingle(turn, args, sessionId, ctx.signal)
        ctx.report({ iteration: 1, phase: 'completed' })
        return output
      }
      const result = await runLoop({
        driver: {
          name: 'mcp-researcher-single',
          async plan(t, history) {
            return history.length === 0 ? [t] : []
          },
          decide(history) {
            return history.length > 0 ? 'pick-winner' : 'fail'
          },
        },
        agentRun: preset.agentRunSpec,
        output: preset.output,
        validator: preset.validator,
        task,
        ctx: {
          sandboxClient,
          signal: ctx.signal,
          ...(loopEmitter ? { traceEmitter: loopEmitter } : {}),
        },
        maxIterations: 1,
        maxConcurrency,
      })
      const output = result.winner?.output
      if (!output) throw new Error('researcher delegate produced no winner')
      ctx.report({ iteration: 1, phase: 'completed' })
      return output as ResearchOutputShape
    }
    const fanout = fanoutFactory({ task })
    const result = await runLoop({
      driver: fanout.driver,
      agentRuns: fanout.agentRuns.slice(0, variants),
      output: fanout.output,
      validator: fanout.validator,
      task,
      ctx: {
        sandboxClient,
        signal: ctx.signal,
        ...(loopEmitter ? { traceEmitter: loopEmitter } : {}),
      },
      maxIterations: variants,
      maxConcurrency: Math.min(maxConcurrency, variants),
    })
    const output = result.winner?.output
    if (!output) throw new Error('researcher delegate fanout produced no winner')
    ctx.report({ iteration: result.iterations.length, phase: 'completed' })
    return output as ResearchOutputShape
  }

  return {
    delegate,
    resume: {
      message(args) {
        const task = buildResearchTask(args)
        const spec = singleFactory({ task }).agentRunSpec as AgentRunSpec<unknown>
        return spec.taskToPrompt(task)
      },
      async settle(turn, args, signal) {
        // The session id is only the synthesized event's id — the parser reads
        // data.result / data.text, never the id.
        return settleSingle(turn, args, 'resumed-detached-turn', signal)
      },
    },
  }
}

function buildResearchTask(args: DelegateResearchArgs): unknown {
  return {
    question: args.question,
    knowledgeNamespace: args.namespace,
    scope: args.scope,
    sources: args.sources,
    recencyWindow: args.config?.recencyWindow
      ? {
          since: args.config.recencyWindow.since
            ? new Date(args.config.recencyWindow.since)
            : undefined,
          until: args.config.recencyWindow.until
            ? new Date(args.config.recencyWindow.until)
            : undefined,
        }
      : undefined,
    maxItems: args.config?.maxItems,
    minConfidence: args.config?.minConfidence,
  }
}

function parseHarnesses(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined
  const list = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  return list.length > 0 ? list : undefined
}

function parseFleetId(raw: string | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function parseConcurrency(raw: string | undefined): number {
  if (!raw) return 4
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return 4
  return Math.min(Math.trunc(n), 32)
}

main().catch((err) => {
  process.stderr.write(`agent-runtime-mcp: ${err instanceof Error ? err.stack : String(err)}\n`)
  process.exit(1)
})
