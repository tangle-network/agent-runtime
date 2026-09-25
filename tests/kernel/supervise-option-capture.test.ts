/**
 * A callback option must SURVIVE the option capture.
 *
 * `captureSuperviseOptions` detaches its decision data with `detachedSnapshot`, which
 * structured-clones. A function cannot be structured-cloned, so a callback key the capture does not
 * lift out of the remainder makes `supervise()` throw before any compute — and the refusal names
 * the snapshot, not the option, so a caller reads it as a bad value rather than as a capability the
 * entry point cannot carry.
 *
 * The retired `onUnmetContract` shipped that way in 0.186.0 and stayed broken through 0.188.0:
 * the option-key check accepted it, `supervisorAgent` forwarded it, the retry loop read it, and the
 * capture dropped it. Every run that passed the callback failed at construction. The continuation
 * policy carries two callbacks inside a data object, so both halves are proven here.
 */

import { describe, expect, it } from 'vitest'
import { ValidationError } from '../../src/errors'
import {
  captureSuperviseOptions,
  SUPERVISE_EXECUTABLE_OPTION_KEYS,
  type SuperviseOptions,
  supervise,
} from '../../src/runtime/supervise/supervise'
import type { SupervisorProfile } from '../../src/runtime/supervise/types'
import { testContinuation } from '../helpers/continuation'

const budget = { maxIterations: 4, maxTokens: 10_000 }

const rootProfile = (): SupervisorProfile =>
  ({ name: 'root', harness: 'cli-base', prompt: { systemPrompt: 'lead' } }) as SupervisorProfile

const baseOptions = (): SuperviseOptions => ({
  budget,
  makeWorkerAgent: () => ({ name: 'w', act: async () => 1 }),
})

describe('captureSuperviseOptions carries every callback option', () => {
  it("carries the continuation's panel and append by reference and snapshots its data", () => {
    const runPanel = async () => ({ findings: [], usd: 0 })
    const append = async () => undefined
    const policy = {
      ...testContinuation({ panel: 'on', panelUsd: { perContinuation: 0.5, perRun: 5 } }),
      runPanel,
      append,
    }
    const captured = captureSuperviseOptions({ ...baseOptions(), continuation: policy })
    policy.maxBarren = 9
    expect(captured.continuation?.runPanel).toBe(runPanel)
    expect(captured.continuation?.append).toBe(append)
    expect(captured.continuation?.maxBarren).toBe(2)
    expect(Object.isFrozen(captured.continuation)).toBe(true)
  })

  it('constructs a run that declares the continuation callbacks instead of refusing them', () => {
    expect(() =>
      supervise(rootProfile(), 'task', {
        ...baseOptions(),
        deliverable: { check: () => true, describe: 'one measured result' },
        continuation: testContinuation({ append: async () => undefined }),
      }),
    ).not.toThrow(/structured-cloneable/)
  })

  it('captures a state check without reading it as mutable decision data', () => {
    const checkState = () => false
    const deliverable = { check: () => false, describe: 'checked evidence', checkState }
    const captured = captureSuperviseOptions({ ...baseOptions(), deliverable })
    deliverable.checkState = () => true
    expect(captured.deliverable).toMatchObject({ checkState })
    expect(Object.isFrozen(captured.deliverable)).toBe(true)
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

  it('carries every callable field of the analysts registry, register included', () => {
    // The SAME defect one level down. `analysts` is an OBJECT option, so the capture rebuilds it
    // field by field and the callback test above cannot see inside it. `register` is optional, so
    // omitting it from that rebuild is not a type error — it silently unmounts `define_analyst` on
    // every manager in the tree while `analystsFromRegistry(..., { authoring })` still looks wired.
    const run = async () => []
    const register = (definition: { id: string; description: string; area: string }) => ({
      id: definition.id,
      description: definition.description,
      area: definition.area,
    })
    const captured = captureSuperviseOptions({
      ...baseOptions(),
      analysts: { kinds: [{ id: 'k', description: 'd', area: 'a' }], run, register },
    })
    const analysts = captured.analysts as { run: unknown; register: unknown }
    expect(analysts.run, 'captureSuperviseOptions dropped analysts.run').toBe(run)
    expect(analysts.register, 'captureSuperviseOptions dropped analysts.register').toBe(register)

    // A registry with no `register` stays without one: the verb is opt-in.
    const fixed = captureSuperviseOptions({
      ...baseOptions(),
      analysts: { kinds: [{ id: 'k', description: 'd', area: 'a' }], run },
    })
    expect((fixed.analysts as { register?: unknown }).register).toBeUndefined()
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
