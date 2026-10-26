import { mkdirSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { contentAddress } from '../../durable/content-address'
import {
  appendCommittedJsonLine,
  readCommittedJsonLines,
  withJsonlFileLock,
} from '../../durable/jsonl-file'
import { ValidationError } from '../../errors'
import { defaultRunCommand } from '../../mcp/worktree-harness'
import type { CompletionCheckContext } from './completion-gate'
import type { AgentGraph, RunGraphOptions } from './graph'

/** An environment-owned check command, run outside the agent's conversation. */
export interface GraphCommandCheck {
  readonly command: string
  readonly timeoutMs?: number
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

function within(directory: string, path: string): boolean {
  const offset = relative(directory, path)
  return offset === '' || (!isAbsolute(offset) && offset !== '..' && !offset.startsWith('../'))
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
  const backend = options.backend
  if (options.makeLeafAgent || !backend)
    throw new ValidationError('runGraph: command checks require an explicit execution backend')
  const workspace =
    backend.backend === 'bridge'
      ? backend.cwd
      : backend.backend === 'cli-in-place'
        ? backend.workspacePath
        : undefined
  if (
    !workspace ||
    (backend.backend === 'bridge' &&
      !['localhost', '127.0.0.1', '[::1]'].includes(new URL(backend.bridgeUrl).hostname))
  )
    throw new ValidationError(
      'runGraph: command checks require a loopback Bridge or local CLI workspace; provider node binding is unsupported',
    )
  if (!options.runDir)
    throw new ValidationError(
      'runGraph: command checks require a driver-owned runDir outside the workspace',
    )
  const cwd = realpathSync(workspace)
  mkdirSync(options.runDir, { recursive: true })
  const runDir = realpathSync(options.runDir)
  if (within(cwd, runDir))
    throw new ValidationError('runGraph: command check runDir must be outside the worker workspace')
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
    await withJsonlFileLock(file, async (canonicalPath) => {
      if (within(cwd, canonicalPath))
        throw new ValidationError(
          'runGraph: command receipt journal resolves inside worker workspace',
        )
      await appendCommittedJsonLine(canonicalPath, { ...receipt, key: receiptKey(receipt) })
    })
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
