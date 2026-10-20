import { HARNESS_TRANSCRIPT_SETTLE_TIMEOUT_MS } from '../harness-transcript'
import { workspaceCaptureWriter } from './retained-executor'
import { stopOwnerEvidenceRetry } from './retained-owner-evidence'
import { type OwnerState, owners } from './retained-owner-state'
import type { Scope } from './types'

/** Cut short the captures a checkpoint rotation is running; each keeps its checkpoint. */
export function preemptRotationCaptures(state: OwnerState): void {
  state.rotationCaptures?.abort(
    new Error("the turn's end-of-turn capture goes first; checkpoint kept"),
  )
}

export function ownerCaptureWriter(state: OwnerState): ReturnType<typeof workspaceCaptureWriter> {
  const { args } = state
  return workspaceCaptureWriter({
    journal: args.journal,
    rootId: args.rootId,
    nodeId: args.nodeId,
    nextSequence: () => state.nextSequence(),
    now: args.now,
  })
}

/**
 * Mark one drive of the owner in progress until the returned function is called. An abort settles
 * the node while the drive is still ending its turn: stopping the harness, copying its session and
 * handing its workspace capture over. A release that ran then would find no receipt for the turn
 * and keep the source alive, as on terraform-economics-20261005f, where the root's last attempt was
 * recorded two minutes after its environment's release.
 */
export function beginScopeRetainedOwnerDrive(scope: Scope<unknown>): () => void {
  const state = owners.get(scope)
  if (state === undefined) return () => {}
  let end!: () => void
  const drive = new Promise<void>((resolve) => {
    end = resolve
  })
  state.drive = drive
  return () => {
    end()
    if (state.drive === drive) delete state.drive
  }
}

/** Wait, bounded like a turn's own ending, for the owner's drive in progress to end. */
export async function ownerDriveEnded(state: OwnerState): Promise<void> {
  const drive = state.drive
  if (drive === undefined) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      drive,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, HARNESS_TRANSCRIPT_SETTLE_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Wait for the end-of-turn work the owner's last turn handed over: its workspace capture and the
 * evidence record of its receipt. A turn hands it over so that its node settles without it; the
 * owner's next turn and its environment's release wait for it here.
 */
export async function scopeRetainedOwnerTurnEnded(scope: Scope<unknown>): Promise<void> {
  const state = owners.get(scope)
  if (state === undefined) return
  for (;;) {
    const pending = state.turnEnd
    if (pending === undefined) return
    await pending
    if (state.turnEnd === pending) {
      delete state.turnEnd
      return
    }
  }
}

/** @internal Wait for everything this owner still has in flight: the drive ending its turn, the
 *  work that turn handed over, and a release. The run is settling, so its capture retries stop;
 *  a release retries once itself, and a resumed process starts them again. */
export async function scopeRetainedOwnerSettled(scope: Scope<unknown>): Promise<void> {
  const state = owners.get(scope)
  if (state === undefined) return
  await ownerDriveEnded(state)
  await scopeRetainedOwnerTurnEnded(scope)
  await state.releasing?.catch(() => undefined)
  await stopOwnerEvidenceRetry(state)
}
