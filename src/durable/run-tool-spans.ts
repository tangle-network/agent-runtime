import { join } from 'node:path'
import type { ToolSpan } from '@tangle-network/agent-eval'
import { ValidationError } from '../errors'
import { readRootStream } from '../runtime/supervise/root-stream'
import { runToolSpans } from '../runtime/supervise/run-traces'
import { FileObserverJournal } from './observer-journal'
import { projectPursuit } from './observer-projection'
import { FileResultBlobStore } from './spawn-journal/result-blob-store'
import { discoverDurableSupervisionRun } from './supervision-discovery'

/**
 * Every tool span a finished `supervise({ runDir })` run recorded, read from its directory alone:
 * the root's `root-stream.jsonl` as one trace named by the root node id, and each settled node's
 * persisted trace (the observer projection's `trace`) from `<runDir>/blobs`, re-keyed to the node
 * id. The same builder feeds the continuation panel's trace store.
 *
 * A node whose trace blob is missing throws `ValidationError`; a node with no captured trace adds
 * nothing.
 */
export async function durableRunToolSpans(runDir: string): Promise<readonly ToolSpan[]> {
  const run = await discoverDurableSupervisionRun(runDir)
  if (run.roots.length > 1) {
    throw new ValidationError(
      `${run.runDir} holds ${run.roots.length} supervision roots; a run directory has one`,
    )
  }
  const rootId = run.roots[0]
  const journal = run.observer && (await FileObserverJournal.open(run.observer.path))
  const nodes = journal === undefined ? [] : projectPursuit(await journal.read()).nodes
  const workers = nodes.flatMap((node) =>
    node.trace === undefined || node.id === rootId ? [] : [{ id: node.id, trace: node.trace }],
  )
  return Object.freeze(
    await runToolSpans({
      ...(rootId === undefined
        ? {}
        : { root: { id: rootId, read: () => readRootStream(run.runDir) } }),
      workers,
      blobs: new FileResultBlobStore(join(run.runDir, 'blobs')),
    }),
  )
}
