/**
 * @experimental
 *
 * GENERALITY PROOF — a build flow is `pipeline` (+ a `fanout` stage + a `verify` gate) under a
 * coder persona. No "code-build-test" library shape exists: the SHAPE is `pipeline([plan, build,
 * gate])`; the DOMAIN (who builds, what "done" means, the test rubric) lives on the `Persona`.
 * The SAME `pipeline`/`verify` calls drive any sequential-with-gate domain — swap the persona and
 * the structure builds something else, with zero combinator edits.
 *
 * Two compositions are shown side by side to make the point that the library carries only shape:
 *  - `buildCodeFlow` — `pipeline([plan, implement, integrate])`, the three-phase build.
 *  - `buildVerifiedCodeFlow` — `verify({ implement, verifier })`, the implement→gate pair.
 * Both are persona-AGNOSTIC (they take no persona); the persona is supplied at run time:
 *
 *     runPersonified({ persona: coderPersona, shape: buildCodeFlow(), task, budget })
 *
 * Pass any other `Persona` to that call and the identical `pipeline`/`verify` builds a different
 * domain — zero combinator edits.
 */

import type { DefaultVerdict, Settled } from '../../supervise/types'
import { pipeline, verify } from '../combinators'
import { definePersona } from '../persona'
import type { Outcome, Persona } from '../types'
import type { CombinatorShape, PipelineStage } from '../wave-types'

/** What a build flow delivers: the integrated artifact plus the gate score that cleared it. */
export interface BuildArtifact {
  readonly artifact: unknown
  readonly gateScore: number
}

/** A build task — the goal to implement. The persona frames HOW and WHO; the task is the WHAT. */
export interface BuildTask {
  readonly goal: string
}

/**
 * The DOMAIN as a persona. `harness: null` runs the leaf as a direct inference call; a sandboxed
 * build passes a `BackendType` so the coder runs in a box — the pipeline below does not change.
 */
export const coderPersona: Persona<BuildArtifact> = definePersona<BuildArtifact>({
  name: 'senior-staff-engineer',
  directive: 'Plan the build, implement it, then ship only what passes the test gate.',
  context: { role: 'senior staff engineer', notes: 'no half-done; a failing gate is a blocker' },
  root: {
    profile: {
      name: 'senior-staff-engineer',
      prompt: { instructions: ['Act as a senior staff engineer. Ship only gate-passing work.'] },
    },
    harness: null,
  },
  executors: { seams: { router: { endpoint: 'inline', key: 'inline' } } },
})

/**
 * `pipeline([plan, implement, integrate])` — each stage feeds the next its deliverable, and the
 * first stage that ends `blocked` short-circuits (blockers propagate, never coerced past failure).
 * The stage labels + the feed/collect projections are the only per-domain wiring; the sequencing
 * is generic.
 */
export function buildCodeFlow(): CombinatorShape<BuildTask, BuildArtifact> {
  const stages: Array<PipelineStage<BuildTask, unknown, unknown>> = [
    stage('plan', (prior) => ({ phase: 'plan', goal: (prior as BuildTask).goal })),
    stage('implement', (prior) => ({ phase: 'implement', plan: prior })),
    stage('integrate', (prior) => ({ phase: 'integrate', built: prior })),
  ]
  return pipeline<BuildTask, BuildArtifact>(stages)
}

/**
 * `verify({ implement, verifier })` — the implement→gate pair: a SEPARATE verifier child grades
 * the candidate, and only a `valid` verdict ships (selector≠judge — the implementer never grades
 * itself). The same `coderPersona` drives it; the verify rubric lives in the persona's profile.
 */
export function buildVerifiedCodeFlow(): CombinatorShape<BuildTask, BuildArtifact> {
  return verify<BuildTask, unknown, BuildArtifact>({
    implement: (task, ctx) => ({
      phase: 'implement',
      directive: ctx.persona.directive,
      role: ctx.persona.context.role,
      goal: (task as BuildTask).goal,
    }),
    verifier: (candidate, ctx) => ({
      phase: 'verify',
      directive: ctx.persona.directive,
      role: ctx.persona.context.role,
      candidate: candidate.kind === 'done' ? candidate.out : undefined,
    }),
    collect: (
      candidate: Settled<Outcome<unknown>>,
      verdict: DefaultVerdict,
    ): Outcome<BuildArtifact> => {
      if (candidate.kind === 'down') {
        return { kind: 'blocked', blockers: [`implement: ${candidate.reason}`] }
      }
      return { kind: 'done', deliverable: { artifact: candidate.out, gateScore: verdict.score } }
    },
  })
}

/** Build one pipeline stage: a label + a feed projection. `collect` reads the stage's settled
 *  child into the next stage's input, blocking loud on a down child (no coercion past failure). */
function stage(
  label: string,
  feed: (prior: unknown) => unknown,
): PipelineStage<BuildTask, unknown, unknown> {
  return {
    label,
    feed: (prior) => feed(prior),
    collect: (settled: Settled<Outcome<unknown>>): Outcome<unknown> => {
      if (settled.kind === 'down') {
        return { kind: 'blocked', blockers: [`${label}: ${settled.reason}`] }
      }
      return settled.out
    },
  }
}
