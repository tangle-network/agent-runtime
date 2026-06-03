/**
 * Self-checking test for runSteeringExperiment (bench has no vitest — it is a
 * tsx-script package, so this is an assertion script: `tsx src/steering-experiment.test.mts`,
 * non-zero exit on failure).
 *
 * Regressions it defends:
 *  - the compute control is ALWAYS executed, FIRST, and tagged isControl (the
 *    structural guarantee that replaced "remember to run random@k");
 *  - treatment order is preserved so `treatments[i]` pairs with input arm i;
 *  - a duplicate / control-colliding label fails loud BEFORE any arm runs
 *    (ambiguous corpus rows / lifts are unrepresentable).
 */
import assert from 'node:assert/strict'
import type { TopologyPlanner } from '@tangle-network/agent-runtime/loops'
import { type SteeringExperiment, runSteeringExperiment } from './steering-experiment.ts'

const noop: TopologyPlanner<string, string> = () => ({ kind: 'stop', rationale: 'noop' })

async function run(): Promise<void> {
  // (1) control runs first + tagged; treatments preserved in input order.
  const calls: string[] = []
  const exp: SteeringExperiment<string, string> = {
    control: { label: 'random@3', planner: noop },
    treatments: [
      { label: 'refineHand@3', planner: noop },
      { label: 'refineGepa@3', planner: noop },
    ],
  }
  const { control, treatments } = await runSteeringExperiment(exp, async (arm) => {
    calls.push(arm.label)
    return arm.label.toUpperCase()
  })
  assert.deepEqual(calls, ['random@3', 'refineHand@3', 'refineGepa@3'], 'control first, then treatments in order')
  assert.equal(control.isControl, true)
  assert.equal(control.result, 'RANDOM@3')
  assert.equal(treatments.length, 2)
  assert.equal(treatments[0]?.isControl, false)
  assert.equal(treatments[0]?.label, 'refineHand@3')
  assert.equal(treatments[1]?.label, 'refineGepa@3')

  // (2) control runs even with ZERO treatments — it is never optional.
  const only: string[] = []
  await runSteeringExperiment({ control: { label: 'random@3', planner: noop }, treatments: [] }, async (a) => {
    only.push(a.label)
    return 0
  })
  assert.deepEqual(only, ['random@3'], 'control runs with zero treatments')

  // (3) treatment colliding with the control label fails loud BEFORE any arm runs.
  let ran = false
  await assert.rejects(
    runSteeringExperiment(
      { control: { label: 'random@3', planner: noop }, treatments: [{ label: 'random@3', planner: noop }] },
      async () => {
        ran = true
        return 0
      },
    ),
    /duplicate arm label/,
  )
  assert.equal(ran, false, 'duplicate-label check throws before running any arm')

  // (4) duplicate among treatments also throws.
  await assert.rejects(
    runSteeringExperiment(
      {
        control: { label: 'c', planner: noop },
        treatments: [
          { label: 'x', planner: noop },
          { label: 'x', planner: noop },
        ],
      },
      async () => 0,
    ),
    /duplicate arm label/,
  )

  console.log('steering-experiment.test: all assertions passed')
}

run().catch((e) => {
  console.error('steering-experiment.test FAILED:', e instanceof Error ? e.message : e)
  process.exit(1)
})
