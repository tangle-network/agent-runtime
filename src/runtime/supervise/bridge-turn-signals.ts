import type { ResolvedBridgeSeam } from './bridge-config'
import type { BridgeStreamChunk } from './bridge-protocol'
import { armDeadlineTimer } from './deadline'

/**
 * Why one cli-bridge turn's request is aborted: external teardown or abort, a forceful interrupt
 * steer, the turn's own deadline, or model silence. Each turn owns one, and `cleanup` detaches it.
 */
export class BridgeTurnSignals {
  readonly controller = new AbortController()
  /** The turn ran out its own deadline. */
  timedOut = false
  /** The model sent nothing for `modelSilenceMs` with no tool call open. */
  silent = false
  private openToolCalls = 0
  private silenceTimer: ReturnType<typeof setTimeout> | undefined
  private readonly clearTimer: (() => void) | undefined

  constructor(
    private readonly external: AbortSignal,
    /** A forceful interrupt steer for this turn. */
    readonly interrupt: AbortSignal,
    private readonly seam: Pick<ResolvedBridgeSeam, 'timeoutMs' | 'modelSilenceMs'>,
  ) {
    if (external.aborted) this.controller.abort()
    else external.addEventListener('abort', this.abortTurn)
    interrupt.addEventListener('abort', this.abortTurn, { once: true })
    this.clearTimer =
      seam.timeoutMs !== undefined
        ? armDeadlineTimer(
            seam.timeoutMs,
            () => {
              this.timedOut = true
              this.abortTurn()
            },
            true,
          )
        : undefined
    this.listenForModel()
  }

  readonly abortTurn = (): void => this.controller.abort()

  // Model silence: no stream event while no tool call is open. A call the bridge reported and
  // has not answered holds the clock, so a long tool is never cut.
  private listenForModel(): void {
    if (this.silenceTimer !== undefined) clearTimeout(this.silenceTimer)
    this.silenceTimer = undefined
    if (this.seam.modelSilenceMs === undefined || this.openToolCalls > 0) return
    this.silenceTimer = setTimeout(() => {
      this.silent = true
      this.abortTurn()
    }, this.seam.modelSilenceMs)
    this.silenceTimer.unref?.()
  }

  /** A stream event arrived: track the tool calls it opened and closed, and restart the clock. */
  noteChunk(chunk: BridgeStreamChunk): void {
    this.openToolCalls = Math.max(
      0,
      this.openToolCalls + (chunk.toolCalls?.length ?? 0) - (chunk.toolResults?.length ?? 0),
    )
    this.listenForModel()
  }

  cleanup(): void {
    this.external.removeEventListener('abort', this.abortTurn)
    this.interrupt.removeEventListener('abort', this.abortTurn)
    this.clearTimer?.()
    if (this.silenceTimer !== undefined) clearTimeout(this.silenceTimer)
  }
}
