import { randomUUID } from 'node:crypto'
import type { ProposalFinding } from '@tangle-network/agent-eval'
import type {
  AnalystRegistry,
  AnalystRunInputs,
  AnalystRunResult,
  RegistryRunOpts,
} from '@tangle-network/agent-eval/analyst'
import {
  type ObservationAnalysis,
  ObservationError,
  type ObserveInput,
  renderReport,
} from './observe'

/** Adapt any Eval analyst registry, including recursive engines, to observation and harvesting. */
export function observationFromRegistry(
  registry: Pick<AnalystRegistry, 'run'>,
  options: {
    inputs:
      | AnalystRunInputs
      | ((input: ObserveInput) => AnalystRunInputs | Promise<AnalystRunInputs>)
    /** The caller identifies the evidence admitted for this investigation. */
    proposalOrigin: ProposalFinding['proposal_origin']
    runOptions?: RegistryRunOpts
    /** Retain the complete registry result, including unsuccessful analysts, in caller-owned storage. */
    record?: (result: AnalystRunResult, input: ObserveInput) => void | Promise<void>
  },
): ObservationAnalysis {
  if (!['production', 'search'].includes(options.proposalOrigin)) {
    throw new TypeError('registry observation requires an explicit production or search origin')
  }
  return async (input, context) => {
    const signals = [context.signal, options.runOptions?.signal].filter(
      (signal): signal is AbortSignal => signal !== undefined,
    )
    const result = await registry.run(
      input.runId ?? randomUUID(),
      typeof options.inputs === 'function' ? await options.inputs(input) : options.inputs,
      { ...options.runOptions, ...(signals.length ? { signal: AbortSignal.any(signals) } : {}) },
    )
    const usage = { input: 0, output: 0, known: true }
    for (const analyst of result.per_analyst) {
      const receipt = analyst.usage
      usage.input += receipt.tokens?.input ?? receipt.partialTokens?.input ?? 0
      usage.output += receipt.tokens?.output ?? receipt.partialTokens?.output ?? 0
      usage.known &&=
        receipt.tokens !== null &&
        receipt.tokens.tokensKnown !== false &&
        receipt.tokensEstimated !== true
    }
    try {
      await options.record?.(result, input)
      const incomplete = result.per_analyst.filter((analyst) => analyst.status !== 'ok')
      if (incomplete.length) {
        throw new Error(
          incomplete
            .map(
              (analyst) =>
                `${analyst.analyst_id}: ${analyst.error?.message ?? analyst.reason ?? analyst.status}`,
            )
            .join('; '),
        )
      }
      const findings = result.findings.map(
        (finding): ProposalFinding => ({
          ...finding,
          proposal_origin: options.proposalOrigin,
        }),
      )
      return { findings, report: renderReport(findings), usage }
    } catch (cause) {
      throw new ObservationError(cause instanceof Error ? cause.message : String(cause), usage, {
        cause,
      })
    }
  }
}
