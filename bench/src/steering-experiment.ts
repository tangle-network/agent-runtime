/**
 * Structural enforcement of the flywheel doc's compute-control discipline
 * (docs/learning-flywheel.md, "Confounds before causal claims").
 *
 * "Always run the random@k compute control; isolate steering as refine@k −
 * random@k" was prose, so the control was something an experimenter had to
 * REMEMBER. A steering benchmark that forgot it (or A/B'd only steered arms)
 * would report a lift confounded with extra compute and call it "steering".
 *
 * This makes the control un-forgettable: a steering experiment is a set of
 * treatment arms measured against a SINGLE compute-matched control, and the
 * control is a REQUIRED field. You cannot construct the experiment without it,
 * and runSteeringExperiment always executes it. Omitting the control is a
 * compile error, not a missing best practice.
 */

import type { TopologyPlanner } from '@tangle-network/agent-runtime/loops'

/** One arm of a steering experiment: a labeled planner the kernel will drive. */
export interface SteeringArm<Task, Output> {
  /** Stable condition label — becomes the corpus `condition` and the lift name
   *  (e.g. `random@3`, `refineHand@3`). */
  label: string
  planner: TopologyPlanner<Task, Output>
}

/** Treatment arms measured against ONE compute-matched control. The control is
 *  required: a steering delta cannot be reported without the arm that separates
 *  "more compute" from "better steering". */
export interface SteeringExperiment<Task, Output> {
  /** The compute-matched control (random@k / no-steer): same budget as each
   *  treatment, no steering signal. REQUIRED. */
  control: SteeringArm<Task, Output>
  /** Steered arms; each one's lift over `control` is its steering effect. */
  treatments: SteeringArm<Task, Output>[]
}

/** Per-arm outcome, tagged so downstream pairing (treatment − control) is
 *  unambiguous and the control is never mistaken for a treatment. */
export interface ArmOutcome<R> {
  label: string
  isControl: boolean
  result: R
}

/**
 * Run every arm of a steering experiment for ONE instance — control FIRST and
 * ALWAYS. `runArm` executes a single arm (one runLoop + corpus append + verdict)
 * and returns whatever per-arm result the caller tracks. The control is never
 * skipped: the only way to call this is to supply it. Returns arms in a stable
 * order so `treatments[i]` corresponds to `experiment.treatments[i]`. Fails loud
 * on a duplicate or control-colliding label (ambiguous corpus rows / lifts).
 */
export async function runSteeringExperiment<Task, Output, R>(
  experiment: SteeringExperiment<Task, Output>,
  runArm: (arm: SteeringArm<Task, Output>) => Promise<R>,
): Promise<{ control: ArmOutcome<R>; treatments: ArmOutcome<R>[] }> {
  const seen = new Set<string>([experiment.control.label])
  for (const t of experiment.treatments) {
    if (seen.has(t.label)) {
      throw new Error(
        `runSteeringExperiment: duplicate arm label ${JSON.stringify(t.label)} — the control and every treatment must be uniquely labeled so corpus rows and lifts are unambiguous.`,
      )
    }
    seen.add(t.label)
  }
  const control: ArmOutcome<R> = {
    label: experiment.control.label,
    isControl: true,
    result: await runArm(experiment.control),
  }
  const treatments: ArmOutcome<R>[] = []
  for (const t of experiment.treatments) {
    treatments.push({ label: t.label, isControl: false, result: await runArm(t) })
  }
  return { control, treatments }
}
