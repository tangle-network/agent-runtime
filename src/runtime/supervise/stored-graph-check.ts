import { mkdirSync, realpathSync } from 'node:fs'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import type { SandboxResources } from '@tangle-network/sandbox'
import { contentAddress } from '../../durable/content-address'
import {
  appendCommittedJsonLine,
  readCommittedJsonLines,
  withJsonlFileLock,
} from '../../durable/jsonl-file'
import { ValidationError } from '../../errors'
import type { MakeWorkerAgent } from '../../mcp/tools/coordination-contracts'
import { defaultRunCommand, runSettledCommand } from '../../mcp/worktree-harness'
import type { DeclaredCheckPlacement } from '../declared-check'
import { runIsolatedCheck } from '../isolated-checker'
import type { CompletionCheckContext } from './completion-gate'
import { runtimeCheckFactory } from './flow-brain'
import type { AgentGraph, RunGraphOptions } from './graph'
import { retainedExecutorContext } from './retained-executor'
import type { Agent, AgentSpec, ExecutorFactory, ExecutorResult } from './types'

/** An environment-owned check command, run outside the agent's conversation. */
export interface GraphCommandCheck {
  readonly command: string
  readonly timeoutMs?: number
}

/** A graph node that runs a command instead of an agent: no model, no seat. Locally it runs in the
 *  run's working directory; with `RunGraphOptions.checkPlacement` it runs in a fresh Sandbox box
 *  built from `environment`, through the box runner a declared check uses. */
export interface GraphCheckNode {
  readonly command: string
  /** Default 15 minutes. */
  readonly timeoutMs?: number
  /** The box image under `checkPlacement`; required there, unused locally. */
  readonly environment?: string
  /** Domains a box may reach. Absent or empty: egress is blocked. Unused locally. */
  readonly egress?: readonly string[]
  /** Environment variable names the command needs; a missing one fails the node. In a box they
   *  resolve only from the placement's `env`, the run owner's secrets. */
  readonly secrets?: readonly string[]
  /** The box's size under `checkPlacement`. */
  readonly resources?: SandboxResources
}

/** Where check nodes run in boxes: the run owner's own account. A check node is a step of the
 *  graph, not a judge, so `builderAccounts` is optional and never refuses the owner's account. */
export interface GraphCheckPlacement
  extends Omit<DeclaredCheckPlacement, 'builderAccounts' | 'env'> {
  readonly builderAccounts?: DeclaredCheckPlacement['builderAccounts']
  /** The owner's secrets, or a resolver called before each box run so short-lived tokens stay
   *  fresh. Absent: no secrets. */
  readonly env?:
    | Readonly<Record<string, string | undefined>>
    | ((request: {
        readonly node: string
        readonly secrets: readonly string[]
        readonly signal: AbortSignal
      }) => Promise<Readonly<Record<string, string | undefined>>>)
}

/** A check node's settled output. `json` is the last stdout line when it parses as an object. */
export interface GraphCheckOutput {
  readonly pass: boolean
  readonly exitCode: number | null
  /** The last 64 KiB of stdout followed by stderr. */
  readonly output: string
  readonly json?: Record<string, unknown>
}

export interface GraphFromStoredOptions {
  readonly trigger?: Readonly<Record<string, unknown>>
  readonly checks?: Readonly<Record<string, AgentGraph['deliverable']['check'] | GraphCommandCheck>>
}

interface CommandCheckReceipt {
  readonly version: 1
  readonly key: string
  readonly binding: string
  readonly checkDigest: string
  readonly nodeName: string
  readonly nodeId: string
  readonly attemptId: string
  readonly outputDigest: string
  readonly exitCode: number | null
  readonly output: string
  readonly outputTruncated: boolean
  readonly nativeValid: boolean
  readonly valid: boolean
  /** Check nodes only: the parsed last stdout line. */
  readonly json?: Record<string, unknown>
}

/** Driver-owned journal identity. Worker output never supplies any part of this authority. */
function receiptKey(receipt: Omit<CommandCheckReceipt, 'key'>): string {
  return contentAddress({
    binding: receipt.binding,
    checkDigest: receipt.checkDigest,
    nodeName: receipt.nodeName,
    nodeId: receipt.nodeId,
    attemptId: receipt.attemptId,
    outputDigest: receipt.outputDigest,
  })
}

function isReceipt(value: unknown): value is CommandCheckReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  if (
    row.version !== 1 ||
    ![
      'key',
      'binding',
      'checkDigest',
      'nodeName',
      'nodeId',
      'attemptId',
      'outputDigest',
      'output',
    ].every((key) => typeof row[key] === 'string') ||
    !row.nodeName ||
    !row.nodeId ||
    !row.attemptId ||
    !(row.exitCode === null || Number.isSafeInteger(row.exitCode)) ||
    typeof row.outputTruncated !== 'boolean' ||
    typeof row.nativeValid !== 'boolean' ||
    typeof row.valid !== 'boolean'
  )
    return false
  const receipt = value as CommandCheckReceipt
  return (
    receipt.key === receiptKey(receipt) &&
    receipt.valid === (receipt.exitCode === 0 && receipt.nativeValid)
  )
}

async function appendReceipt(
  file: string,
  workspace: string | undefined,
  receipt: Omit<CommandCheckReceipt, 'key'>,
): Promise<void> {
  await withJsonlFileLock(file, async (canonicalPath) => {
    if (workspace !== undefined && within(workspace, canonicalPath))
      throw new ValidationError(
        'runGraph: command receipt journal resolves inside worker workspace',
      )
    await appendCommittedJsonLine(canonicalPath, { ...receipt, key: receiptKey(receipt) })
  })
}

function within(directory: string, path: string): boolean {
  const offset = relative(directory, path)
  return offset === '' || (!isAbsolute(offset) && offset !== '..' && !offset.startsWith('../'))
}

/** The run's working directory (a loopback Bridge cwd or local CLI workspace) and its driver-owned
 *  run directory, which must lie outside it. */
function localCheckDirectories(options: RunGraphOptions): { cwd: string; runDir: string } {
  const cwd = backendWorkspace(options)
  if (!cwd)
    throw new ValidationError(
      'runGraph: command checks require a loopback Bridge or local CLI workspace; provider node binding is unsupported',
    )
  return { cwd, runDir: driverRunDir(options, cwd) }
}

function backendWorkspace(options: RunGraphOptions): string | undefined {
  const backend = options.backend
  if (!backend) return undefined
  const workspace =
    backend.backend === 'bridge'
      ? backend.cwd
      : backend.backend === 'cli-in-place'
        ? backend.workspacePath
        : undefined
  return !workspace ||
    (backend.backend === 'bridge' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(new URL(backend.bridgeUrl).hostname))
    ? undefined
    : realpathSync(workspace)
}

function driverRunDir(options: RunGraphOptions, workspace: string | undefined): string {
  if (!options.runDir)
    throw new ValidationError(
      'runGraph: command checks require a driver-owned runDir outside the workspace',
    )
  mkdirSync(options.runDir, { recursive: true })
  const runDir = realpathSync(options.runDir)
  if (workspace !== undefined && within(workspace, runDir))
    throw new ValidationError('runGraph: command check runDir must be outside the worker workspace')
  return runDir
}

/** Lower a named check onto the local workspace, with evidence in the driver's durable state.
 * The run directory has the same trust boundary as RunContext journals: keep it outside the
 * worker workspace and do not mount it into the worker. A remote Bridge cannot run a host check.
 * Provider validators are refused because their context does not identify the admitted node.
 */
export function bindGraphCommand(
  graph: AgentGraph,
  options: RunGraphOptions,
): { graph: AgentGraph; options: RunGraphOptions } {
  const { command: definition, ...deliverable } = graph.deliverable
  if (!definition) return { graph, options }
  const { command, timeoutMs = 60_000 } = definition
  if (!command.trim() || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    throw new ValidationError(
      'graphFromStored: command check needs a command and positive timeoutMs',
    )
  if (options.makeLeafAgent || graph.nodes.some((node) => node.check))
    throw new ValidationError('runGraph: command checks need a backend and no check nodes')
  const { cwd, runDir } = localCheckDirectories(options)
  const file = join(runDir, 'command-checks.jsonl')
  const checkDigest = contentAddress({ command, timeoutMs, cwd })
  const binding = contentAddress({
    graph: { ...graph, deliverable: { ...deliverable, check: undefined } },
    runId: options.runId ?? options.runContext?.runId,
    checkDigest,
  })
  const nodeNames = new Set(graph.nodes.map((node) => node.id))

  // The map is supplied by Runtime's flow finalizer. It contains terminal graph node IDs and
  // outputs, never receipt metadata. Every match must come from this run's driver journal.
  const checkFinal = async (out: unknown): Promise<boolean> => {
    if (!out || typeof out !== 'object' || Array.isArray(out)) return false
    const entries = Object.entries(out)
    if (entries.length === 0 || entries.some(([name]) => !nodeNames.has(name))) return false
    return withJsonlFileLock(file, async (canonicalPath) => {
      if (within(cwd, canonicalPath)) return false
      const latest = new Map<string, CommandCheckReceipt>()
      for await (const raw of readCommittedJsonLines<unknown>(canonicalPath, {
        allowMissing: true,
      })) {
        if (!isReceipt(raw)) return false
        if (raw.binding !== binding || raw.checkDigest !== checkDigest) continue
        latest.set(contentAddress([raw.nodeName, raw.outputDigest]), raw)
      }
      return entries.every(
        ([name, output]) =>
          latest.get(contentAddress([name, contentAddress(output)]))?.valid === true,
      )
    })
  }

  const checkLeaf = async (out: unknown, context: CompletionCheckContext): Promise<boolean> => {
    const node = context.node
    const nodeName = context.profile.name
    if (!node || !node.nodeId || !node.attemptId || !nodeName || !nodeNames.has(nodeName))
      return false
    // Always execute for a fresh leaf. A prior success, even for identical output, never skips
    // this check. gateFactoryOnDeliverable deduplicates only one invocation's exact artifact.
    const outputDigest = contentAddress(out)
    let result: { exitCode: number | null; output: string }
    try {
      result = await defaultRunCommand({ command, cwd, timeoutMs, signal: context.signal })
    } catch (error) {
      // An unavailable check invalidates an earlier identical output too; it cannot inherit
      // a prior success just because the current command did not reach a normal exit.
      result = { exitCode: null, output: error instanceof Error ? error.message : String(error) }
    }
    const bytes = Buffer.from(result.output)
    const limit = 64 * 1024
    const receipt: Omit<CommandCheckReceipt, 'key'> = {
      version: 1,
      binding,
      checkDigest,
      nodeName,
      nodeId: node.nodeId,
      attemptId: node.attemptId,
      outputDigest,
      exitCode: result.exitCode,
      output: bytes.subarray(0, limit).toString('utf8'),
      outputTruncated: bytes.length > limit,
      nativeValid: context.originalVerdict?.valid !== false,
      valid: result.exitCode === 0 && context.originalVerdict?.valid !== false,
    }
    await appendReceipt(file, cwd, receipt)
    return receipt.valid
  }
  return {
    graph: {
      ...graph,
      deliverable: {
        ...deliverable,
        check: (out, context) =>
          context === undefined ? checkFinal(out) : checkLeaf(out, context),
      },
    },
    options,
  }
}

/** The leaves of a flow's check nodes, for `supervise()`'s leaf path. */
export interface GraphCheckNodes {
  readonly names: ReadonlyArray<string>
  readonly leaf: MakeWorkerAgent
}

const CHECK_OUTPUT_LIMIT = 64 * 1024
const CHECK_TIMEOUT_MS = 15 * 60_000
const safeNodeFile = /^(?!\.\.?$)[A-Za-z0-9._-]+$/

function tail(text: string): { output: string; truncated: boolean } {
  const bytes = Buffer.from(text)
  return bytes.length <= CHECK_OUTPUT_LIMIT
    ? { output: text, truncated: false }
    : {
        output: bytes.subarray(bytes.length - CHECK_OUTPUT_LIMIT).toString('utf8'),
        truncated: true,
      }
}

function lastJsonObject(stdout: string): Record<string, unknown> | undefined {
  const line = stdout.trimEnd().split('\n').at(-1)?.trim()
  if (!line?.startsWith('{')) return undefined
  try {
    const value: unknown = JSON.parse(line)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

/** Each settled result a routes spawn carries: its source and its evidence, by node id. */
function evidenceOf(task: unknown): Array<[string, unknown]> {
  if (!task || typeof task !== 'object') return []
  const { from, evidence } = task as { from?: unknown; evidence?: unknown }
  const entries = new Map<string, unknown>()
  if (from && typeof from === 'object' && 'node' in from && 'result' in from)
    entries.set(String((from as { node: unknown }).node), (from as { result: unknown }).result)
  if (evidence && typeof evidence === 'object' && !Array.isArray(evidence))
    for (const [id, result] of Object.entries(evidence)) entries.set(id, result)
  return [...entries]
}

async function writeEvidence(directory: string, task: unknown): Promise<void> {
  await mkdir(directory, { recursive: true })
  for (const [id, result] of evidenceOf(task)) {
    if (!safeNodeFile.test(id)) throw new ValidationError(`runGraph: evidence node id ${id}`)
    await writeFile(join(directory, `${id}.json`), `${JSON.stringify(result)}\n`)
  }
}

async function readSecrets(
  names: readonly string[] | undefined,
  environment: Readonly<Record<string, string | undefined>>,
  node: string,
): Promise<Record<string, string>> {
  const secrets: Record<string, string> = {}
  for (const name of names ?? []) {
    const value = environment[name]
    if (!value) throw new ValidationError(`runGraph: check node ${node} needs secret ${name}`)
    secrets[name] = value
  }
  return secrets
}

/** Run one check node's command locally, in the run's working directory. */
async function runLocalCheck(
  check: GraphCheckNode,
  node: string,
  cwd: string,
  evidence: string,
  signal: AbortSignal,
  secrets: Record<string, string>,
): Promise<{ exitCode: number | null; stdout: string; output: string }> {
  const timeoutMs = check.timeoutMs ?? CHECK_TIMEOUT_MS
  const result = await runSettledCommand({
    command: '/bin/sh',
    args: ['-c', check.command],
    cwd,
    timeoutMs,
    signal,
    env: { ...secrets, GRAPH_EVIDENCE: evidence },
  })
  const timedOut = result.timedOut ? `\n[check timed out after ${timeoutMs} ms]` : ''
  return {
    exitCode: result.timedOut ? null : result.exitCode,
    stdout: result.stdout,
    output: result.stdout + result.stderr + timedOut,
  }
}

/** Run one check node's command in a fresh box on the check account, as a declared check does. */
async function runBoxCheck(
  check: GraphCheckNode,
  node: string,
  placement: GraphCheckPlacement,
  evidence: string,
  signal: AbortSignal,
  secrets: Record<string, string>,
): Promise<{ exitCode: number | null; stdout: string; output: string }> {
  const workspaceRoot = await mkdtemp(join(evidence, '..', 'box-'))
  try {
    const tree = join(workspaceRoot, 'tree')
    await mkdir(tree)
    await cp(evidence, join(tree, '_evidence'), { recursive: true })
    const result = await runIsolatedCheck({
      workspaceRoot,
      tree,
      command: [
        '/bin/sh',
        '-c',
        `GRAPH_EVIDENCE="$PWD/_evidence"; export GRAPH_EVIDENCE; ${check.command}`,
      ],
      timeoutMs: check.timeoutMs ?? CHECK_TIMEOUT_MS,
      maxOutputBytes: 16 * CHECK_OUTPUT_LIMIT,
      env: secrets,
      signal,
      box: {
        client: placement.client,
        // Not consulted for an owner step; carried only because judges require it.
        builderAccounts: placement.builderAccounts ?? ['run-owner'],
        ownerStep: true,
        environment: check.environment as string,
        ...(check.egress === undefined ? {} : { egress: check.egress }),
        ...(check.resources === undefined ? {} : { resources: check.resources }),
      },
    })
    if (result.succeeded)
      return {
        exitCode: 0,
        stdout: result.value.stdout,
        output: result.value.stdout + result.value.stderr,
      }
    const stdout = result.stdout ?? ''
    const output = stdout + (result.stderr ?? '')
    if (result.reason === 'failed' && typeof result.exitCode === 'number')
      return { exitCode: result.exitCode, stdout, output }
    if (result.reason === 'timeout')
      return { exitCode: null, stdout, output: `${output}\n[check timed out]` }
    throw new Error(
      redact(`runGraph: check node ${node} box ${result.reason}: ${result.diagnostic}`, secrets),
    )
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
}

/** Every resolved secret value becomes `[redacted:NAME]` before output leaves the check. */
function redact(text: string, secrets: Record<string, string>): string {
  return Object.entries(secrets)
    .sort(([, a], [, b]) => b.length - a.length)
    .reduce((out, [name, value]) => out.replaceAll(value, `[redacted:${name}]`), text)
}

function checkOutput(receipt: Omit<CommandCheckReceipt, 'key'>): GraphCheckOutput {
  return {
    pass: receipt.valid,
    exitCode: receipt.exitCode,
    output: receipt.output,
    ...(receipt.json === undefined ? {} : { json: receipt.json }),
  }
}

/** The receipt a run context's journal holds for this binding, as executor evidence. */
async function replayContextReceipt(
  context: NonNullable<RunGraphOptions['runContext']>,
  runId: string,
  binding: string,
  checkDigest: string,
): Promise<GraphCheckOutput | undefined> {
  for (const event of (await context.journal.loadTree(runId)) ?? []) {
    if (event.kind !== 'execution-evidence') continue
    const row = ((await context.blobs.get(event.outRef)) as { graphCheckReceipt?: unknown })
      ?.graphCheckReceipt
    if (isReceipt(row) && row.binding === binding && row.checkDigest === checkDigest)
      return checkOutput(row)
  }
  return undefined
}

/** A node attempt's journaled settle, so a resumed run never runs a settled command again. */
async function replayCheckReceipt(
  file: string,
  binding: string,
  checkDigest: string,
): Promise<GraphCheckOutput | undefined> {
  return withJsonlFileLock(file, async (canonicalPath) => {
    for await (const row of readCommittedJsonLines<unknown>(canonicalPath, {
      allowMissing: true,
    })) {
      if (isReceipt(row) && row.binding === binding && row.checkDigest === checkDigest)
        return checkOutput(row)
    }
    return undefined
  })
}

/**
 * Bind a flow graph's check nodes. Each spawn of a check node runs its command once and settles
 * `{ pass, exitCode, output, json }` as a usable result, so routes branch on `/pass`. The receipt
 * rides the run's `command-checks.jsonl` beside the command deliverable's, and a node attempt that
 * already holds a receipt replays it instead of running the command again.
 */
export function bindGraphCheckNodes(
  graph: AgentGraph,
  options: RunGraphOptions,
): GraphCheckNodes | undefined {
  const checks = new Map(
    graph.nodes.flatMap((node) => (node.check === undefined ? [] : [[node.id, node.check]])),
  )
  if (checks.size === 0) return undefined
  if (graph.entry === undefined)
    throw new ValidationError('runGraph: check nodes run only in a flow graph (one with entry)')
  for (const node of graph.nodes)
    if (!safeNodeFile.test(node.id))
      throw new ValidationError(
        `runGraph: node id ${JSON.stringify(node.id)} cannot name an evidence file; use letters, digits, '.', '_' and '-'`,
      )
  for (const edge of graph.edges)
    if (edge.kind === 'maps' && [edge.to, edge.join].some((id) => id && checks.has(id)))
      throw new ValidationError('runGraph: a check node runs from entry or routes, not a maps edge')
  const placement = options.checkPlacement
  for (const [id, check] of checks) {
    const timeoutMs = check.timeoutMs ?? CHECK_TIMEOUT_MS
    if (!check.command.trim() || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
      throw new ValidationError(`runGraph: check node ${id} needs a command and positive timeoutMs`)
    if (placement && !check.environment?.trim())
      throw new ValidationError(`runGraph: check node ${id} needs environment for box placement`)
  }
  const local = placement === undefined ? localCheckDirectories(options) : undefined
  const workspace = local?.cwd ?? backendWorkspace(options)
  // A box placement with a run context and no runDir (a hosted SQL run) keeps its receipts in
  // that context's journal, so whichever worker resumes the run replays them.
  const context = local || options.runDir ? undefined : options.runContext
  const runDir = context ? undefined : (local?.runDir ?? driverRunDir(options, workspace))
  const file = runDir === undefined ? undefined : join(runDir, 'command-checks.jsonl')
  const runId = options.runId ?? options.runContext?.runId
  const leaf: MakeWorkerAgent = (profile, spawn) => {
    const id = profile.name as string
    const check = checks.get(id)
    if (check === undefined) throw new ValidationError(`runGraph: ${id} is not a check node`)
    const checkDigest = contentAddress({
      ...check,
      timeoutMs: check.timeoutMs ?? CHECK_TIMEOUT_MS,
      at: local?.cwd ?? 'box',
    })
    // The spawn's assignment is stable across a resume, so a settled traversal replays its receipt.
    const binding = contentAddress({ runId, node: id, checkDigest, at: spawn?.assignmentId })
    const executorFactory: ExecutorFactory<unknown> = (_spec, context_) => {
      let artifact: ExecutorResult<unknown> | undefined
      const settle = (out: GraphCheckOutput, ms: number): ExecutorResult<unknown> => {
        artifact = {
          out,
          outRef: contentAddress(out),
          verdict: { valid: true, score: out.pass ? 1 : 0 },
          spent: {
            iterations: 1,
            tokens: { input: 0, output: 0 },
            tokensKnown: true,
            usd: 0,
            usdKnown: true,
            ms,
          },
        }
        return artifact
      }
      const execute = async (task: unknown, signal: AbortSignal) => {
        const node = context_.node
        if (!node?.nodeId || !node.attemptId || !spawn)
          throw new ValidationError(`runGraph: check node ${id} ran outside a supervised node`)
        const attempt = { binding, checkDigest, nodeId: node.nodeId, attemptId: node.attemptId }
        const prior = file
          ? await replayCheckReceipt(file, binding, checkDigest)
          : await replayContextReceipt(context!, runId!, binding, checkDigest)
        if (prior) return settle(prior, 0)
        const started = Date.now()
        const staged = runDir ? undefined : await mkdtemp(join(tmpdir(), 'graph-check-'))
        const evidence = join(
          runDir ?? (staged as string),
          'graph-evidence',
          contentAddress(attempt).slice('sha256:'.length, 'sha256:'.length + 24),
        )
        const box = placement as GraphCheckPlacement
        const secrets = await readSecrets(
          check.secrets,
          local
            ? process.env
            : typeof box.env === 'function'
              ? await box.env({ node: id, secrets: check.secrets ?? [], signal })
              : (box.env ?? {}),
          id,
        )
        let ran: Awaited<ReturnType<typeof runLocalCheck>>
        try {
          await writeEvidence(evidence, task)
          ran = local
            ? await runLocalCheck(check, id, local.cwd, evidence, signal, secrets)
            : await runBoxCheck(
                check,
                id,
                placement as GraphCheckPlacement,
                evidence,
                signal,
                secrets,
              )
        } finally {
          if (staged) await rm(staged, { recursive: true, force: true })
        }
        const { output, truncated } = tail(redact(ran.output, secrets))
        const json = lastJsonObject(redact(ran.stdout, secrets))
        const receipt: Omit<CommandCheckReceipt, 'key'> = {
          version: 1,
          ...attempt,
          nodeName: id,
          outputDigest: contentAddress(task),
          exitCode: ran.exitCode,
          output,
          outputTruncated: truncated,
          nativeValid: true,
          valid: ran.exitCode === 0,
          ...(json === undefined ? {} : { json }),
        }
        // Without an evidence channel the settle itself is still journaled and replayed.
        if (file) await appendReceipt(file, workspace, receipt)
        else
          await retainedExecutorContext(context_)?.onEvidence?.({
            graphCheckReceipt: { ...receipt, key: receiptKey(receipt) },
          })
        return settle(checkOutput(receipt), Date.now() - started)
      }
      return {
        runtime: 'graph-check',
        execute,
        // A recovered check replays its receipt, or runs the idempotent command again.
        recover: execute,
        async teardown() {
          return { destroyed: true }
        },
        resultArtifact() {
          if (!artifact) throw new ValidationError(`runGraph: check node ${id} has not settled`)
          return artifact
        },
      }
    }
    const spec: AgentSpec = {
      profile,
      harness: null,
      executorFactory: runtimeCheckFactory(executorFactory),
    }
    return { name: id, act: async () => '', executorSpec: spec } as Agent<unknown, unknown> & {
      executorSpec: AgentSpec
    }
  }
  return { names: [...checks.keys()], leaf }
}
