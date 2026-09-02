/**
 * A callback option must SURVIVE the option capture.
 *
 * `captureSuperviseOptions` detaches its decision data with `detachedSnapshot`, which
 * structured-clones. A function cannot be structured-cloned, so a callback key the capture does not
 * lift out of the remainder makes `supervise()` throw before any compute — and the refusal names
 * the snapshot, not the option, so a caller reads it as a bad value rather than as a capability the
 * entry point cannot carry.
 *
 * `onUnmetContract` shipped that way in 0.186.0 and stayed broken through 0.188.0: the option-key
 * check accepted it, `supervisorAgent` forwarded it, the retry loop read it, and the capture
 * dropped it. Every run that passed the callback failed at construction, and the only working
 * configuration was `repromptOnUnmet` alone — which costs the caller its own unmet-item text.
 */

import { describe, expect, it } from 'vitest'
import { ValidationError } from '../../src/errors'
import type { OnUnmetContract } from '../../src/runtime/supervise/driver-retry'
import {
  captureSuperviseOptions,
  SUPERVISE_EXECUTABLE_OPTION_KEYS,
  type SuperviseOptions,
  supervise,
} from '../../src/runtime/supervise/supervise'
import type { SupervisorProfile } from '../../src/runtime/supervise/types'

const budget = { maxIterations: 4, maxTokens: 10_000 }

const rootProfile = (): SupervisorProfile =>
  ({ name: 'root', harness: 'cli-base', prompt: { systemPrompt: 'lead' } }) as SupervisorProfile

const baseOptions = (): SuperviseOptions => ({
  budget,
  makeWorkerAgent: () => ({ name: 'w', act: async () => 1 }),
})

describe('captureSuperviseOptions carries every callback option', () => {
  it('carries onUnmetContract by reference, so the re-prompt hook reaches the run', () => {
    const onUnmetContract: OnUnmetContract = (context) => ({
      steer: `re-enter: ${context.describe ?? 'unnamed'}`,
    })
    const captured = captureSuperviseOptions({
      ...baseOptions(),
      repromptOnUnmet: 3,
      onUnmetContract,
    })
    expect(captured.onUnmetContract).toBe(onUnmetContract)
    expect(captured.repromptOnUnmet).toBe(3)
  })

  it('constructs a run that declares the callback instead of refusing it', () => {
    // The exact shape the issue reports: the callback made `supervise()` throw
    // `supervise options: input must be structured-cloneable` before any compute.
    expect(() =>
      supervise(rootProfile(), 'task', {
        ...baseOptions(),
        deliverable: { check: () => true, describe: 'one measured result' },
        repromptOnUnmet: 2,
        onUnmetContract: () => 'stop',
      }),
    ).not.toThrow(/structured-cloneable/)
  })

  it('carries every listed callback option by reference, not just the one that broke', () => {
    // Driven off the list the compile-time test binds to `SuperviseOptions`, so a callback option
    // added later is exercised here the moment it is declared.
    expect(SUPERVISE_EXECUTABLE_OPTION_KEYS.length).toBeGreaterThan(10)
    for (const key of SUPERVISE_EXECUTABLE_OPTION_KEYS) {
      const probe = () => undefined
      const captured = captureSuperviseOptions({
        ...baseOptions(),
        [key]: probe,
      } as SuperviseOptions)
      expect(captured[key], `captureSuperviseOptions dropped ${key}`).toBe(probe)
    }
  })

  it('carries escalateQuestion, so a wired parent inbox is not dropped at intake', () => {
    // A new callback option is only real if the capture forwards it. `escalateQuestion` decides
    // whether `ask_parent` reports `queued-for-parent` or `no-parent`, so a dropped one silently
    // turns every escalation in the tree into "nobody is listening".
    const escalateQuestion = () => ({ delivered: true as const, to: 'the run operator' })
    const captured = captureSuperviseOptions({ ...baseOptions(), escalateQuestion })
    expect(captured.escalateQuestion, 'captureSuperviseOptions dropped escalateQuestion').toBe(
      escalateQuestion,
    )
    expect(SUPERVISE_EXECUTABLE_OPTION_KEYS).toContain('escalateQuestion')
  })

  it('names the option when a callback still reaches the snapshot', () => {
    // The guard that makes the next occurrence a five-second fix. A widened value is the only way
    // to reach it: the option-key check refuses an unknown name first, and every DECLARED callback
    // option is lifted out above.
    expect(() =>
      captureSuperviseOptions({
        ...baseOptions(),
        childSettleGraceMs: (() => 1) as never,
      }),
    ).toThrow(ValidationError)
    expect(() =>
      captureSuperviseOptions({
        ...baseOptions(),
        childSettleGraceMs: (() => 1) as never,
      }),
    ).toThrow(
      /option childSettleGraceMs carries a callback that the option capture does not forward/,
    )
  })
})
