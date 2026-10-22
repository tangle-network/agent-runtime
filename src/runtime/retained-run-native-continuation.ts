import {
  type AgentExactRunControlRef,
  AgentExactRunControlRefSchema,
  type AgentNativeContextContinuationOptions,
  AgentNativeContextContinuationResultSchema,
  agentNativeContextContinuationResultMatchesRequest,
  NativeContextBoundaryProofSchema,
  type NativeContextContinuationRequest,
  NativeContextContinuationRequestSchema,
  nativeContextContinuationTurnDigest,
} from '@tangle-network/agent-interface'
import type { AgentEnvironmentCapabilities } from '@tangle-network/agent-interface/environment-provider'
import {
  assertBoundaryBinding,
  assertResultBinding,
  awaitAbortable,
  copyControlRef,
  exactContinuedControlRef,
  RetainedRunProviderContractError,
  sameControlCoordinates,
} from './retained-run-binding'
import type { RetainedRunControl } from './retained-run-control'
import type {
  NativeContextContinuationExecution,
  NativeContextContinuationInput,
  RetainedRunHandle,
} from './retained-run-types'

const semanticTurnOf = ({
  timeoutMs: _timeoutMs,
  signal: _signal,
  ...semanticTurn
}: NativeContextContinuationInput) => semanticTurn

const unsupportedAdmissionControl = (provider: string): Error =>
  new Error(`provider "${provider}" does not advertise early native continuation admission control`)

const missingContinuationAdmission = (): RetainedRunProviderContractError =>
  new RetainedRunProviderContractError(
    'provider accepted a native continuation without an admission reference',
    { code: 'RETAINED_NATIVE_CONTINUATION_ADMISSION_MISSING' },
  )

/** Early-admission bookkeeping for one native continuation: exactly one valid admission call. */
export class NativeContinuationAdmission {
  settled = false
  failure: unknown
  readonly promise: Promise<AgentExactRunControlRef>
  private called = false
  private admitted: AgentExactRunControlRef | undefined
  private resolve!: (controlRef: AgentExactRunControlRef) => void
  private reject!: (error: unknown) => void

  constructor(
    private readonly control: RetainedRunControl,
    private readonly source: AgentExactRunControlRef,
  ) {
    this.promise = new Promise<AgentExactRunControlRef>((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
    // Callers may only observe the terminal result. Keep an internal observer
    // on admission so a provider failure cannot become an unhandled rejection.
    void this.promise.catch(() => undefined)
  }

  admittedControlRef(): AgentExactRunControlRef | undefined {
    return this.admitted === undefined ? undefined : copyControlRef(this.admitted)
  }

  fail(error: unknown): void {
    this.failure ??= error
    if (this.settled) return
    this.settled = true
    this.reject(error)
  }

  readonly onAdmission = (candidate: AgentExactRunControlRef): void => {
    if (this.called) {
      const error = new RetainedRunProviderContractError(
        'provider called native continuation admission more than once',
        { code: 'RETAINED_NATIVE_CONTINUATION_ADMISSION_DUPLICATE' },
      )
      this.fail(error)
      throw error
    }
    this.called = true
    try {
      const parsed = AgentExactRunControlRefSchema.parse(candidate)
      const nextControlRef = exactContinuedControlRef(parsed, this.source)
      this.control.assertContinuationIsCurrent(this.source, nextControlRef)
      this.admitted = this.control.adopt(nextControlRef)
      if (!this.settled) {
        this.settled = true
        this.resolve(copyControlRef(this.admitted))
      }
    } catch (error) {
      const contractError =
        error instanceof RetainedRunProviderContractError
          ? error
          : new RetainedRunProviderContractError(
              error instanceof Error
                ? error.message
                : 'provider returned an invalid native continuation admission reference',
              { code: 'RETAINED_NATIVE_CONTINUATION_ADMISSION_INVALID', cause: error },
            )
      this.fail(contractError)
      throw contractError
    }
  }
}

function assertNativeSupport(
  control: RetainedRunControl,
  capabilities: AgentEnvironmentCapabilities,
  early: boolean,
): void {
  const native = capabilities.nativeContinuation
  const provider = control.current.provider
  if (
    native?.atomicBoundary !== true ||
    native.requestIdempotency !== true ||
    !control.session.continueNative
  ) {
    throw new Error(`provider "${provider}" does not support retry-safe native continuation`)
  }
  if (early && native.admissionControl !== true) throw unsupportedAdmissionControl(provider)
}

async function callProviderContinuation(
  control: RetainedRunControl,
  exactRequest: NativeContextContinuationRequest,
  turn: NativeContextContinuationInput,
  admission: NativeContinuationAdmission | undefined,
): Promise<NativeContextContinuationExecution> {
  const { timeoutMs, signal } = turn
  const semanticTurn = semanticTurnOf(turn)
  try {
    return AgentNativeContextContinuationResultSchema.parse(
      await awaitAbortable(
        Promise.resolve().then(() => {
          const providerOptions: AgentNativeContextContinuationOptions = {
            turn: semanticTurn,
            ...(timeoutMs === undefined ? {} : { timeoutMs }),
            ...(signal === undefined ? {} : { signal }),
            ...(admission === undefined ? {} : { onAdmission: admission.onAdmission }),
          }
          return control.session.continueNative!(exactRequest, providerOptions)
        }),
        signal,
      ),
    )
  } catch (error) {
    try {
      control.sync()
    } catch (syncError) {
      throw new AggregateError(
        [error, syncError],
        'native continuation failed and its current control reference could not be read',
      )
    }
    throw error
  }
}

/** Bind an accepted outcome to the admitted run, then make its reference current. */
function bindAcceptedOutcome(
  control: RetainedRunControl,
  exactRequest: NativeContextContinuationRequest,
  outcome: NativeContextContinuationExecution,
  admission: NativeContinuationAdmission | undefined,
  continuationSource: AgentExactRunControlRef,
): NativeContextContinuationExecution {
  if (
    admission !== undefined &&
    !admission.settled &&
    outcome.acknowledgement.status === 'accepted'
  ) {
    throw missingContinuationAdmission()
  }
  if (!('result' in outcome) || !('controlRef' in outcome)) {
    throw new Error('provider omitted the successful native continuation result')
  }
  if (!agentNativeContextContinuationResultMatchesRequest(exactRequest, outcome)) {
    throw new Error('provider returned a native continuation result for another request')
  }
  const nextControlRef = exactContinuedControlRef(outcome.controlRef, continuationSource)
  assertResultBinding(nextControlRef, outcome.result)
  control.assertContinuationIsCurrent(continuationSource, nextControlRef)
  if (admission !== undefined && !admission.settled) {
    if (outcome.acknowledgement.status !== 'replayed') throw missingContinuationAdmission()
    // A replay may already have been admitted before this process started and
    // can therefore return only its durable terminal record.
    admission.onAdmission(nextControlRef)
  }
  const admittedControlRef = admission?.admittedControlRef()
  if (admission !== undefined && admittedControlRef === undefined) {
    throw missingContinuationAdmission()
  }
  if (
    admittedControlRef !== undefined &&
    !sameControlCoordinates(nextControlRef, admittedControlRef)
  ) {
    throw new RetainedRunProviderContractError(
      'provider changed the native continuation run after admission',
      { code: 'RETAINED_NATIVE_CONTINUATION_RESULT_CHANGED' },
    )
  }
  return structuredClone({ ...outcome, controlRef: copyControlRef(control.adopt(nextControlRef)) })
}

export async function executeNativeContinuation(
  control: RetainedRunControl,
  capabilities: AgentEnvironmentCapabilities,
  request: NativeContextContinuationRequest,
  turn: NativeContextContinuationInput,
  admission?: NativeContinuationAdmission,
  expectedSource?: AgentExactRunControlRef,
): Promise<NativeContextContinuationExecution> {
  control.sync()
  const exactRequest = NativeContextContinuationRequestSchema.parse(request)
  const continuationSource = expectedSource ?? control.current
  if (!sameControlCoordinates(control.current, continuationSource)) {
    throw new Error('native continuation retained-run control changed before admission')
  }
  if (!sameControlCoordinates(exactRequest.run, continuationSource)) {
    throw new Error('native continuation request targets another retained run')
  }
  if (nativeContextContinuationTurnDigest(semanticTurnOf(turn)) !== exactRequest.turnDigest) {
    throw new Error('native continuation request targets another user turn')
  }
  assertNativeSupport(control, capabilities, admission !== undefined)
  const outcome = await callProviderContinuation(control, exactRequest, turn, admission)
  const admissionFailure = admission?.failure
  if (admissionFailure !== undefined) throw admissionFailure
  control.sync()
  if (
    outcome.acknowledgement.operationId !== exactRequest.operationId ||
    outcome.acknowledgement.requestDigest !== exactRequest.requestDigest
  ) {
    throw new Error('provider returned a native continuation result for another request')
  }
  if (outcome.acknowledgement.actualBoundary !== undefined) {
    assertBoundaryBinding(
      exactRequest.run,
      NativeContextBoundaryProofSchema.parse(outcome.acknowledgement.actualBoundary),
    )
  }
  if (
    outcome.acknowledgement.status !== 'accepted' &&
    outcome.acknowledgement.status !== 'replayed'
  ) {
    return structuredClone(outcome)
  }
  return bindAcceptedOutcome(control, exactRequest, outcome, admission, continuationSource)
}

/** Start a continuation whose admission reference is observable before its result. */
export function beginNativeContinuation(
  control: RetainedRunControl,
  capabilities: AgentEnvironmentCapabilities,
  request: NativeContextContinuationRequest,
  turn: NativeContextContinuationInput,
): ReturnType<RetainedRunHandle['beginNativeContinuation']> {
  control.sync()
  if (capabilities.nativeContinuation?.admissionControl !== true) {
    throw unsupportedAdmissionControl(control.current.provider)
  }
  const continuationSource = control.current
  const admission = new NativeContinuationAdmission(control, continuationSource)
  const result = executeNativeContinuation(
    control,
    capabilities,
    request,
    turn,
    admission,
    continuationSource,
  )
  void result.then(
    (outcome) => {
      if (admission.settled) return
      const accepted =
        outcome.acknowledgement.status === 'accepted' ||
        outcome.acknowledgement.status === 'replayed'
      admission.fail(
        new RetainedRunProviderContractError(
          accepted
            ? 'provider accepted a native continuation without an admission reference'
            : 'native continuation ended without durable admission',
          {
            code: accepted
              ? 'RETAINED_NATIVE_CONTINUATION_ADMISSION_MISSING'
              : 'RETAINED_NATIVE_CONTINUATION_NOT_ADMITTED',
          },
        ),
      )
    },
    (error) => {
      admission.fail(error)
    },
  )
  return { admission: admission.promise, result }
}
