import { type AgentProfile, canonicalAgentProfileDigest } from '@tangle-network/agent-interface'
import { agentHarness } from '../harness-role'
import {
  HARNESS_TRANSCRIPT_SETTLE_TIMEOUT_MS,
  type HarnessTranscriptCapture,
  harnessTranscriptUnavailable,
} from '../harness-transcript'
import { runAbortable } from './abortable'
import type { BridgeSeam } from './bridge-config'
import { type ActiveBridgeRun, cancelBridgeRunToTerminal } from './bridge-transport'
import type { ExecutorNodeContext } from './types'

/** The existing executor transcript lifecycle; Scope alone persists the resulting capture. */
export function bridgeTranscript(
  seam: BridgeSeam,
  sessionId: string,
  profile: AgentProfile,
  runs: ReadonlyMap<string, ActiveBridgeRun>,
  node?: ExecutorNodeContext,
) {
  if (!seam.harnessTranscript) return { ports: {}, settle: <T>(source: AsyncIterable<T>) => source }
  let capture: HarnessTranscriptCapture = harnessTranscriptUnavailable('execution-never-started')
  let settled = Promise.resolve()
  const finish = async () => {
    if (!runs.size) {
      capture = harnessTranscriptUnavailable('execution-never-started')
      return
    }
    const signal = AbortSignal.timeout(HARNESS_TRANSCRIPT_SETTLE_TIMEOUT_MS)
    try {
      const work = async () => {
        const admitted = [...runs.values()].map((run) => {
          if (!run.requestDigest)
            throw new Error(`Bridge run ${run.id} has no authenticated request digest`)
          return { runId: run.id, requestDigest: run.requestDigest }
        })
        const terminal = await Promise.all(
          [...runs.values()].map((run) =>
            cancelBridgeRunToTerminal(seam, run, HARNESS_TRANSCRIPT_SETTLE_TIMEOUT_MS, signal),
          ),
        )
        if (!terminal.every(Boolean))
          throw new Error('Bridge native capture has no terminal proof for every admitted run')
        return seam.harnessTranscript!({
          sessionId,
          harness: agentHarness(profile.harness)!,
          profileDigest: canonicalAgentProfileDigest(profile),
          ...(seam.cwd === undefined ? {} : { cwd: seam.cwd }),
          ...(node === undefined ? {} : { node }),
          runs: admitted,
          signal,
        })
      }
      capture = await runAbortable(work, signal, 'Bridge native capture stopped')
    } catch (error) {
      capture = {
        status: 'unavailable',
        reason: 'capture-failed',
        skipped: [
          {
            path: sessionId,
            reason: error instanceof Error ? error.message : 'Bridge native capture failed',
          },
        ],
      }
    }
  }
  return {
    ports: {
      harnessTranscript: () => capture,
      harnessTranscriptSettled: () => settled,
    },
    async *settle<T>(source: AsyncIterable<T>): AsyncIterable<T> {
      const prior = settled
      let done!: () => void
      settled = new Promise<void>((resolve) => {
        done = resolve
      })
      await prior
      capture = harnessTranscriptUnavailable('capture-did-not-run')
      try {
        yield* source
      } finally {
        void finish().then(done)
      }
    },
  }
}
