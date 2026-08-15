/**
 * retained-run — hold a claim ticket to a job the provider runs.
 *
 * `runAgentRounds` holds your closures, so the run dies with your process. A
 * retained run lives in the provider. You keep only a plain-data control
 * reference, and any process that holds it can replay, resume, or cancel.
 *
 * The two functions below are the copyable shape: start and persist the ticket,
 * then rebuild control from the persisted ticket in a fresh process.
 *
 * This file is compile-checked by `pnpm typecheck:examples`. It does not run
 * offline: `startRetainedRun` refuses a provider that cannot promise exact run
 * identity, event and result identity, idempotent cancellation, detach, and
 * replay, and no provider in this repo advertises them. Supply your own
 * provider to run it.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import {
  type RetainedRunAdmission,
  type RetainedRunDispatchedAdmission,
  reconnectRetainedRun,
  recoverRetainedRun,
  startRetainedRun,
} from '@tangle-network/agent-runtime/kernel'

/** Your durable store for admission records. One row per record is enough. */
interface AdmissionJournal {
  write(admission: RetainedRunAdmission): Promise<void>
  readDispatched(turnId: string): Promise<RetainedRunDispatchedAdmission | undefined>
}

/**
 * Process A. Start the job and stream it while this process lives.
 *
 * `onAdmission` is awaited twice: after the environment exists, and again after
 * the dispatch is verified. The start promise resolves only after the second
 * record is durable, so a crash can never lose a live run.
 */
export async function startAndStream(
  provider: AgentEnvironmentProvider,
  journal: AdmissionJournal,
  profile: AgentProfile,
): Promise<void> {
  const run = await startRetainedRun({
    provider,
    environment: { idempotencyKey: 'workspace-42', profile },
    turn: { turnId: 'turn-7', prompt: 'Finish the migration and run its tests.' },
    identity: { sessionId: 'thread-42', executionId: 'execution-7' },
    onAdmission: async (admission) => {
      await journal.write(admission)
    },
  })

  // Every event carries its cursor and sequence. Persist them before you show
  // the event to a user, so a replay resumes strictly after what the user saw.
  for await (const envelope of run.events()) {
    console.log(`${envelope.sequence}: ${envelope.event.type}`)
  }
}

/**
 * Process B. Rebuild control from the persisted ticket.
 *
 * `reconnectRetainedRun` rejects any mismatch of provider, environment,
 * session, execution, run, or request digest, so a wrong ticket fails loud
 * instead of controlling somebody else's job.
 */
export async function reattach(
  provider: AgentEnvironmentProvider,
  journal: AdmissionJournal,
): Promise<string> {
  const dispatched = await journal.readDispatched('turn-7')
  if (!dispatched) throw new Error('no dispatched admission record for turn-7')

  const handle = await reconnectRetainedRun({ provider, controlRef: dispatched.controlRef })
  if (!handle) throw new Error('the provider no longer retains this environment')

  const snapshot = await handle.status({ waitMs: 30_000 })
  console.log(`status: ${snapshot.status ?? 'unknown'} — effect: ${snapshot.effect}`)

  const result = await handle.result()
  return result.text
}

/**
 * Process B, after a crash that landed only the environment record.
 *
 * Never destroy the environment on `unverifiable`. Keep it, retry the reconnect
 * when a dispatched record appears, or inspect it with the provider's tools.
 */
export async function recoverFromEnvironmentRecord(
  provider: AgentEnvironmentProvider,
  environmentId: string,
): Promise<void> {
  const recovery = await recoverRetainedRun({
    provider,
    environmentId,
    sessionId: 'thread-42',
    executionId: 'execution-7',
  })
  if (recovery.outcome === 'recovered') console.log(await recovery.handle.result())
  if (recovery.outcome === 'not_found') console.log('the environment is gone; nothing to clean up')
  if (recovery.outcome === 'unverifiable') console.log('keep the environment and retry later')
}

if (process.argv[1]?.endsWith('retained-run.ts')) {
  console.log(
    'Compile-checked template. Pass your own AgentEnvironmentProvider to startAndStream / reattach.',
  )
}
