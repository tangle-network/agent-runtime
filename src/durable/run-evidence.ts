import { join } from 'node:path'
import { stripVTControlCharacters as strip } from 'node:util'
import { defaultRedactor } from '../redact'
import { readRootStream } from '../runtime/supervise/root-stream'
import {
  ASSISTANT_REASONING_SPAN,
  ASSISTANT_TEXT_SPAN,
  rootStreamToolSpans,
} from '../runtime/supervise/run-traces'
import { FileObserverJournal } from './observer-journal'
import { projectPursuit } from './observer-projection'
import { FileResultBlobStore } from './spawn-journal/result-blob-store'
import { discoverDurableSupervisionRun } from './supervision-discovery'

/** Caps in characters, except `toolCalls`; `totalChars` is measured on `JSON.stringify`. */
export interface RunEvidenceBounds {
  readonly settledChars?: number // 600
  readonly toolCalls?: number // 3
  readonly toolCallChars?: number // 150
  readonly messageChars?: number // 800
  readonly totalChars?: number // 10,000
}

/** Per node: `node` is its label, `message` its last assistant text after its final tool call.
 *  `truncated` is true when any text was cut or any node dropped to meet a cap. */
export type RunEvidence = Awaited<ReturnType<typeof runEvidence>>

/** Redacted and ANSI-free before any cap, so neither can push a text past its bound. */
const json = (value: unknown) =>
  JSON.stringify(defaultRedactor(value ?? null), (_, item) =>
    typeof item === 'string' ? strip(item) : item,
  )

/**
 * What each node of a run did, from the directory `superviseGraphPursuit` wrote: outcome and tokens
 * from the observer journal, settled output from `blobs/`, tool calls and the final message from
 * `streams/`. Over `totalChars` every cap halves, then the earliest nodes drop; size never throws.
 */
export async function runEvidence(runDir: string, bounds: RunEvidenceBounds = {}) {
  const run = await discoverDurableSupervisionRun(runDir)
  const journal = run.observer && (await FileObserverJournal.open(run.observer.path))
  const projected = journal === undefined ? [] : projectPursuit(await journal.read()).nodes
  const blobs = new FileResultBlobStore(join(run.runDir, 'blobs'))
  const full = await Promise.all(
    projected
      .filter((node) => !run.roots.includes(node.id))
      .map(async (node) => {
        const records = (await readRootStream(run.runDir, { nodeId: node.id })) ?? []
        const spans = rootStreamToolSpans(records, node.id).filter(
          (span) => span.name !== ASSISTANT_REASONING_SPAN,
        )
        const final = spans.at(-1)?.name === ASSISTANT_TEXT_SPAN ? spans.at(-1)?.result : undefined
        const out = node.outRef === undefined ? undefined : await blobs.get(node.outRef)
        return {
          id: node.id,
          node: node.label,
          outcome: node.failure ? `${node.status}: ${node.failure.code}` : node.status,
          settled: out === undefined ? undefined : json(out),
          calls: spans.flatMap((span) =>
            span.name === ASSISTANT_TEXT_SPAN
              ? []
              : [{ name: strip(span.name), args: json(span.args) }],
          ),
          message: final === undefined ? '' : (JSON.parse(json(final)) as string),
          tokens: node.spent?.tokens,
        }
      }),
  )
  let truncated = false
  const clip = <T extends string | undefined>(value: T, max: number): T => {
    const limit = Math.max(1, Math.floor(max))
    if (value === undefined || value.length <= limit) return value
    truncated = true
    return `${value.slice(0, limit - 1)}…` as T
  }
  const shape = (scale: number) =>
    full.map(({ calls, settled, message, ...node }) => ({
      ...node,
      settled: clip(settled, (bounds.settledChars ?? 600) * scale),
      toolCalls: calls.slice(-(bounds.toolCalls ?? 3)).map(({ name, args }) => ({
        name,
        args: clip(args, (bounds.toolCallChars ?? 150) * scale),
      })),
      message: clip(message, (bounds.messageChars ?? 800) * scale),
    }))
  const fits = (nodes: ReturnType<typeof shape>) =>
    JSON.stringify({ nodes, truncated: false }).length <= (bounds.totalChars ?? 10_000)
  let nodes = shape(1)
  for (let scale = 0.5; !fits(nodes) && scale >= 1 / 64; scale /= 2) nodes = shape(scale)
  while (nodes.length > 0 && !fits(nodes)) [truncated, nodes] = [true, nodes.slice(1)]
  return { nodes, truncated }
}
