import { contentAddress } from '../../durable/content-address'
import type { HarnessTranscriptEvidence } from '../harness-transcript'
import { executorEvidenceWriter } from './retained-executor'
import { detachedSnapshot } from './snapshot'
import type { ExecutorNodeContext, ResultBlobStore, SpawnJournal } from './types'

/** Bind one capture to the input and output of the exact attempt that produced it. */
export async function recordHarnessTranscriptEvidence(args: {
  readonly node: ExecutorNodeContext
  readonly task: unknown
  readonly outRef?: string
  readonly harnessTranscript: HarnessTranscriptEvidence
  readonly journal: SpawnJournal
  readonly roots: readonly string[]
  readonly blobs: ResultBlobStore
  readonly now: () => number
}): Promise<void> {
  const task = detachedSnapshot(args.task, 'execution transcript input')
  const taskRef = contentAddress(task)
  await args.blobs.put(taskRef, task)
  const evidence = {
    kind: 'harness-transcript',
    schemaVersion: 1,
    node: args.node,
    taskRef,
    ...(args.outRef === undefined ? {} : { outRef: args.outRef }),
    harnessTranscript: args.harnessTranscript,
  }
  for (const rootId of new Set(args.roots)) {
    await executorEvidenceWriter({
      journal: args.journal,
      blobs: args.blobs,
      rootId,
      nodeId: args.node.nodeId,
      nextSequence: () => 0,
      now: args.now,
    })(evidence)
  }
}
