import { meanConfidenceInterval } from '@tangle-network/agent-eval'
import { type Sha256Digest, sha256DigestSchema } from '@tangle-network/agent-interface'
import { createIsolatedCheckCpuSession } from './isolated-check-cpu'
import {
  type IsolatedCheckCommandEvidence,
  type IsolatedCheckOptions,
  type IsolatedCheckResult,
  runIsolatedCheck,
} from './isolated-checker'
import { runAbortable } from './supervise/abortable'
import { armDeadlineTimer } from './supervise/deadline'

export type PairedCommandInput = Omit<
  IsolatedCheckOptions,
  'box' | 'cpuSession' | 'signal' | 'outputs'
> & {
  maxOutputBytes: number
}

export interface PairedCommandOptions {
  /** Fixed cases, in their registered order. Omit every candidate for identity-only precision work. */
  cases: readonly { id: string; baseline: PairedCommandInput; candidate?: PairedCommandInput }[]
  blocksPerCase: number
  minimumRatio: number
  confidence: number
  maximumIdentityLogHalfWidth: number
  wallLimitMs: number
  maxEvidenceBytes: number
  comparatorDigest: Sha256Digest
  /** Prespecified identity-only prefixes; candidate comparisons assess only the full count. */
  identityPrefixes?: readonly number[]
  /** Trusted source-bound domain comparator; it receives output bytes, never accounting authority. */
  sameOutput(
    caseId: string,
    baseline: Pick<IsolatedCheckCommandEvidence, 'stdoutBase64' | 'stderrBase64'>,
    candidate: Pick<IsolatedCheckCommandEvidence, 'stdoutBase64' | 'stderrBase64'>,
  ): boolean | Promise<boolean>
  /** Persist each complete raw call before another starts. A copied record grants no accounting authority.
   * Failed or interrupted retention leaves the measurement unknown; the consumer owns its existing journal.
   */
  retainCall(call: PairedCommandCall): Promise<void>
  signal?: AbortSignal
}

export interface PairedCommandCall {
  phase: 'identity' | 'candidate'
  caseId: string
  cycle: number
  abbaPosition: number
  role: 'baseline' | 'candidate'
  fullWallMs: number
  execution: IsolatedCheckResult
}

export interface PairedCommandMeasurement {
  verdict: 'qualified' | 'not-qualified' | 'unknown'
  diagnostic: string
  sessionId?: string
  design?: {
    blocksPerCase: number
    minimumRatio: number
    confidence: number
    maximumIdentityLogHalfWidth: number
    identityPrefixes: number[]
    comparatorDigest: Sha256Digest
    cases: {
      id: string
      baselineCommand: readonly string[]
      candidateCommand?: readonly string[]
    }[]
  }
  /** All ordered calls, including unsuccessful checks and incomplete cycles. No retries. */
  calls: PairedCommandCall[]
  retainedCalls: number
  cycles: { identityLogRatio: number | null; candidateLogRatio: number | null }[]
  summaries: {
    cycles: number
    identityInterval: ReturnType<typeof meanConfidenceInterval> | null
    candidateInterval: ReturnType<typeof meanConfidenceInterval> | null
    identityValid: boolean
    verdict: 'qualified' | 'not-qualified' | 'unknown'
  }[]
  cost: {
    knownWorkloadCpuUsec: number
    knownUsageCpuUsec: number
    cpuComplete: boolean
    wallMs: number
    evidenceBytes: number
  }
  cleanupDiagnostic?: string
  recoveryCgroupPath?: string
}

/** One sequential cgroup, identity AAAA then candidate ABBA for each fixed case/cycle.
 * CPU means user + system deltas, including post-membership launcher/namespace work.
 * Infer over complete cycle means, conditional on these cases; no cases are sampled or dropped.
 * Student-t bounds assume stationary independent normal cycle errors. Passing engineering
 * controls does not establish those assumptions, nominal coverage, or domain correctness.
 */
export async function measurePairedCommands(
  options: PairedCommandOptions,
): Promise<PairedCommandMeasurement> {
  const began = performance.now()
  const result: PairedCommandMeasurement = {
    verdict: 'unknown',
    diagnostic: 'Measurement incomplete',
    calls: [],
    retainedCalls: 0,
    cycles: [],
    summaries: [],
    cost: {
      knownWorkloadCpuUsec: 0,
      knownUsageCpuUsec: 0,
      cpuComplete: true,
      wallMs: 0,
      evidenceBytes: 0,
    },
  }
  let session: Awaited<ReturnType<typeof createIsolatedCheckCpuSession>> | undefined
  let clearTimer: (() => void) | undefined
  const controller = new AbortController()
  let candidateInvalid = false
  try {
    const positiveInteger = (n: number) => Number.isSafeInteger(n) && n > 0
    const candidatePresent = options.cases.some((c) => c.candidate !== undefined)
    const prefixes = options.identityPrefixes ?? [options.blocksPerCase]
    if (
      typeof options.retainCall !== 'function' ||
      typeof options.sameOutput !== 'function' ||
      !options.cases.length ||
      new Set(options.cases.map((c) => c.id)).size !== options.cases.length ||
      options.cases.some(
        (c) => !c.id || c.id.length > 200 || candidatePresent !== (c.candidate !== undefined),
      ) ||
      !positiveInteger(options.blocksPerCase) ||
      !positiveInteger(options.wallLimitMs) ||
      !positiveInteger(options.maxEvidenceBytes) ||
      !Number.isFinite(options.minimumRatio) ||
      options.minimumRatio <= 1 ||
      !Number.isFinite(options.confidence) ||
      options.confidence <= 0.5 ||
      options.confidence >= 1 ||
      !Number.isFinite(options.maximumIdentityLogHalfWidth) ||
      options.maximumIdentityLogHalfWidth <= 0 ||
      !prefixes.length ||
      new Set(prefixes).size !== prefixes.length ||
      prefixes.some((n) => !positiveInteger(n) || n < 2 || n > options.blocksPerCase) ||
      (candidatePresent && (prefixes.length !== 1 || prefixes[0] !== options.blocksPerCase)) ||
      options.cases.some((c) =>
        [c.baseline, ...(c.candidate ? [c.candidate] : [])].some(
          (check) =>
            !positiveInteger(check.maxOutputBytes) ||
            !Number.isSafeInteger(check.maxOutputBytes * 32 + 131072),
        ),
      )
    )
      throw new Error('Invalid fixed paired-command design or resource bounds')
    sha256DigestSchema.parse(options.comparatorDigest)
    result.design = {
      blocksPerCase: options.blocksPerCase,
      minimumRatio: options.minimumRatio,
      confidence: options.confidence,
      maximumIdentityLogHalfWidth: options.maximumIdentityLogHalfWidth,
      identityPrefixes: [...prefixes],
      comparatorDigest: options.comparatorDigest,
      cases: options.cases.map((c) => ({
        id: c.id,
        baselineCommand: [...c.baseline.command],
        ...(c.candidate ? { candidateCommand: [...c.candidate.command] } : {}),
      })),
    }
    clearTimer = armDeadlineTimer(options.wallLimitMs, () => controller.abort(), true)
    const signal = options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal
    session = await createIsolatedCheckCpuSession()
    if (!session.succeeded) {
      result.recoveryCgroupPath = session.recoveryCgroupPath
      throw new Error(session.diagnostic)
    }
    const cpuSession = session.value
    result.sessionId = cpuSession.id
    const inputIdentities = new Map<string, Sha256Digest>()
    const cpu = (check: IsolatedCheckResult) => {
      const evidence = check.command?.cpu
      if (
        !evidence?.available ||
        evidence.sessionId !== cpuSession.id ||
        evidence.cgroupPath !== cpuSession.cgroupPath
      )
        throw new Error('Exclusive CPU evidence unavailable')
      const delta =
        evidence.after.userUsec -
        evidence.before.userUsec +
        evidence.after.systemUsec -
        evidence.before.systemUsec
      if (!Number.isSafeInteger(delta) || delta <= 0)
        throw new Error('Nonpositive or invalid workload CPU delta')
      return delta
    }
    for (let cycle = 0; cycle < options.blocksPerCase; cycle++) {
      const row = {
        identityLogRatio: null as number | null,
        candidateLogRatio: null as number | null,
      }
      result.cycles.push(row)
      const identityRatios: number[] = []
      const candidateRatios: number[] = []
      for (const c of options.cases) {
        for (const phase of candidatePresent
          ? (['identity', 'candidate'] as const)
          : (['identity'] as const)) {
          const checks: IsolatedCheckResult[] = []
          for (let position = 0; position < 4; position++) {
            if (signal.aborted) throw new Error('Paired-command deadline or cancellation')
            const isCandidate = phase === 'candidate' && (position === 1 || position === 2)
            const check = isCandidate ? c.candidate! : c.baseline
            // Reserve bounded JSON expansion before executing; never truncate a passing record.
            if (
              result.cost.evidenceBytes + 32 * check.maxOutputBytes + 131072 >
              options.maxEvidenceBytes
            )
              throw new Error('Insufficient evidence capacity for another complete command')
            const started = performance.now()
            const execution = await runIsolatedCheck({
              ...check,
              cpuSession,
              signal,
              timeoutMs: Math.min(
                check.timeoutMs ?? options.wallLimitMs,
                Math.max(1, Math.floor(options.wallLimitMs - (started - began))),
              ),
            })
            const call: PairedCommandCall = {
              phase,
              caseId: c.id,
              cycle,
              abbaPosition: position,
              role: position === 0 || position === 3 ? 'baseline' : 'candidate',
              fullWallMs: performance.now() - started,
              execution,
            }
            result.calls.push(call)
            result.cost.evidenceBytes += Buffer.byteLength(JSON.stringify(call))
            const evidence = execution.command?.cpu
            if (evidence?.available) {
              result.cost.knownWorkloadCpuUsec +=
                evidence.after.userUsec -
                evidence.before.userUsec +
                evidence.after.systemUsec -
                evidence.before.systemUsec
              result.cost.knownUsageCpuUsec += evidence.after.usageUsec - evidence.before.usageUsec
            } else result.cost.cpuComplete = false
            // Attempt the final record even when command cancellation already fired. Bound
            // asynchronous retention, and observe its losing promise through the existing helper.
            const retaining = new AbortController()
            const clearRetention = armDeadlineTimer(
              signal.aborted
                ? 1
                : Math.max(1, Math.floor(options.wallLimitMs - (performance.now() - began))),
              () => retaining.abort(),
              true,
            )
            try {
              await runAbortable(
                () => options.retainCall(structuredClone(call)),
                retaining.signal,
                'Raw call retention deadline',
              )
              result.retainedCalls++
            } finally {
              clearRetention()
            }
            const inputKey = JSON.stringify([c.id, isCandidate])
            const inputDigest = execution.command?.inputDigest
            if (inputDigest && !inputIdentities.has(inputKey))
              inputIdentities.set(inputKey, inputDigest)
            if (!inputDigest || inputIdentities.get(inputKey) !== inputDigest)
              throw new Error('Copied input identity unavailable or changed within a fixed case')
            if (result.cost.evidenceBytes > options.maxEvidenceBytes)
              throw new Error('Evidence capacity exceeded; preserve complete recovery records')
            checks.push(execution)
          }
          const infrastructureFailure = checks.some(
            (check, position) =>
              !check.succeeded &&
              (phase === 'identity' ||
                position === 0 ||
                position === 3 ||
                check.reason !== 'failed'),
          )
          if (infrastructureFailure || checks.some((check) => !check.command?.outputComplete))
            throw new Error('Incomplete baseline, identity, infrastructure or output evidence')
          const validOutputs =
            checks.every((check) => check.succeeded) &&
            (await runAbortable(
              async () => options.sameOutput(c.id, output(checks[0]!), output(checks[1]!)),
              signal,
              'Comparator cancelled',
            )) &&
            (await runAbortable(
              async () => options.sameOutput(c.id, output(checks[3]!), output(checks[2]!)),
              signal,
              'Comparator cancelled',
            ))
          if (phase === 'identity' && !validOutputs) throw new Error('Identity outputs disagree')
          if (!validOutputs) candidateInvalid = true
          const values = checks.map(cpu)
          const logRatio =
            (Math.log(values[0]!) +
              Math.log(values[3]!) -
              Math.log(values[1]!) -
              Math.log(values[2]!)) /
            2
          const ratios = phase === 'identity' ? identityRatios : candidateRatios
          ratios.push(logRatio)
        }
      }
      row.identityLogRatio = identityRatios.reduce((a, b) => a + b, 0) / options.cases.length
      if (candidatePresent)
        row.candidateLogRatio = candidateRatios.reduce((a, b) => a + b, 0) / options.cases.length
    }
    for (const count of prefixes) {
      const rows = result.cycles.slice(0, count)
      const identity = meanConfidenceInterval(
        rows.map((row) => row.identityLogRatio!),
        options.confidence,
      )
      const candidate = candidatePresent
        ? meanConfidenceInterval(
            rows.map((row) => row.candidateLogRatio!),
            2 * options.confidence - 1,
          )
        : null
      const identityValid =
        usable(identity) &&
        identity.low! <= 0 &&
        identity.high! >= 0 &&
        (identity.high! - identity.low!) / 2 <= options.maximumIdentityLogHalfWidth
      const verdict: PairedCommandMeasurement['verdict'] =
        !identityValid || !candidatePresent
          ? 'unknown'
          : candidateInvalid
            ? 'not-qualified'
            : !usable(candidate!)
              ? 'unknown'
              : candidate!.low! > Math.log(options.minimumRatio)
                ? 'qualified'
                : 'not-qualified'
      result.summaries.push({
        cycles: count,
        identityInterval: identity,
        candidateInterval: candidate,
        identityValid,
        verdict,
      })
    }
    result.verdict = result.summaries.at(-1)!.verdict
    result.diagnostic = !candidatePresent
      ? 'Identity-only precision measurement'
      : result.verdict === 'unknown'
        ? 'Identity precision or candidate interval unavailable'
        : candidateInvalid
          ? 'Candidate execution or output comparison failed'
          : 'Fixed-count CPU comparison complete'
  } catch (error) {
    result.verdict = 'unknown'
    result.diagnostic = String(error)
  } finally {
    clearTimer?.()
    if (session?.succeeded) {
      try {
        await session.value.close()
      } catch (error) {
        result.verdict = 'unknown'
        result.cleanupDiagnostic = String(error)
        result.recoveryCgroupPath = session.value.cgroupPath
      }
    }
    result.cost.wallMs = performance.now() - began
  }
  return result
}

function output(
  check: IsolatedCheckResult,
): Pick<IsolatedCheckCommandEvidence, 'stdoutBase64' | 'stderrBase64'> {
  return { stdoutBase64: check.command!.stdoutBase64, stderrBase64: check.command!.stderrBase64 }
}

function usable(interval: ReturnType<typeof meanConfidenceInterval>): boolean {
  return (
    interval.n >= 2 &&
    interval.stdev !== null &&
    interval.stdev > 0 &&
    interval.low !== null &&
    interval.high !== null &&
    Number.isFinite(interval.low) &&
    Number.isFinite(interval.high)
  )
}
