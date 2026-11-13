import {
  type AgentRetainedFilePublication,
  AgentRetainedFilePublicationSchema,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import { contentAddress } from '../../durable/content-address'
import { sameControlCoordinates } from '../retained-run-binding'
import { CheckUnavailableError } from '../supervise/completion-gate'
import { detachedFrozen } from '../supervise/snapshot'
import type { ExecutorNodeContext } from '../supervise/types'
import type { StreamProviderExecutorArgs } from './provider-invocation'

/** The existing result writer content-addresses this entire value as the original outRef.
 * submissionRef identifies the submitted metadata, not a worker's first-DONE result. */
export interface RetainedFileOutput {
  readonly kind: 'retained-file-output'
  readonly version: 1
  readonly invocationId: string
  readonly node: ExecutorNodeContext
  readonly submissionRef: string
  readonly submission: unknown
  readonly policyDigest: string
  readonly publication: AgentRetainedFilePublication
}

/** One invocation's first file transaction. Nothing consults a later node admission or retries
 * a lost stop acknowledgment. The existing evidence and result writers own its persistence. */
export class ProviderFileOutput {
  private pending: Promise<unknown> | undefined
  private output: RetainedFileOutput | undefined
  private committed = false

  constructor(private readonly args: StreamProviderExecutorArgs) {}

  get accepted(): RetainedFileOutput | undefined {
    return this.output
  }

  get requiresPreservation(): boolean {
    return this.pending !== undefined && !this.committed
  }

  resultCommitted(): void {
    if (this.output) {
      this.committed = true
      this.args.scope.state.fileOutputRequired = false
    }
  }

  async settled(): Promise<void> {
    // The caller that requested delivery gets the failure; lifecycle callers only await custody.
    await this.pending?.catch(() => undefined)
  }

  withSubmission(
    candidate: unknown,
    accept: (prepared: unknown, onAccepted: () => void) => Promise<unknown>,
  ): Promise<unknown> {
    if (this.pending) {
      return Promise.reject(
        new CheckUnavailableError('file output already reserved by the original submission'),
      )
    }
    const { args } = this
    // Snapshot the actual admitted handle and metadata synchronously at intake, before any await.
    const handle = args.scope.state.retained
    const environment = args.scope.state.environment
    const submission = detachedFrozen(candidate)
    const policy = args.options.outputFile
    const work = async () => {
      if (
        !handle ||
        !environment ||
        !args.node ||
        !policy ||
        !handle.retainFileOutput ||
        !args.retention?.onEvidence
      ) {
        throw new CheckUnavailableError(
          'file output has no exact retained source or durable evidence writer',
        )
      }
      const controlRef = detachedFrozen(handle.controlRef)
      // Preserve the original reservation even when the physical stop loses its reply or the
      // coordinator restarts before it can write the positive association.
      await args.retention.onEvidence({
        kind: 'retained-file-output-pending',
        invocationId: args.executionId,
        node: args.node,
        controlRef,
        policy,
        submissionRef: contentAddress(submission),
        submission,
      })
      const receipt = await handle.retainFileOutput({ controlRef, policy }, { signal: args.signal })
      if (receipt.status !== 'published') {
        throw new CheckUnavailableError(`file output unavailable: ${receipt.reason}`)
      }
      const publication = AgentRetainedFilePublicationSchema.parse(receipt.publication)
      if (
        !sameControlCoordinates(publication.controlRef, controlRef) ||
        !sameControlCoordinates(handle.controlRef, controlRef) ||
        args.scope.state.retained !== handle ||
        args.scope.state.environment !== environment ||
        canonicalCandidateDigest(publication.policy) !== canonicalCandidateDigest(policy)
      ) {
        throw new CheckUnavailableError(
          'file publication does not belong to the original invocation and policy',
        )
      }
      const output: RetainedFileOutput = detachedFrozen({
        kind: 'retained-file-output',
        version: 1,
        invocationId: args.executionId,
        node: args.node,
        submissionRef: contentAddress(submission),
        submission,
        policyDigest: canonicalCandidateDigest(policy),
        publication,
      })
      // Physical capture is candidate evidence. Only the original submission writer's durable
      // passing commit grants result authority; a refused check or lost capture ACK cannot.
      await args.retention.onEvidence(output)
      args.scope.state.harnessStopped = true
      return accept(output, () => {
        this.output = output
      })
    }
    this.pending = work().catch((error: unknown) => {
      if (error instanceof CheckUnavailableError) throw error
      throw new CheckUnavailableError(
        'the original file transaction could not be verified or committed',
      )
    })
    const custody = this.pending.then(
      () => undefined,
      () => undefined,
    )
    args.retention?.onEndOfTurnWork?.(custody)
    return this.pending
  }
}
