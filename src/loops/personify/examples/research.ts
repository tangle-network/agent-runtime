/**
 * @experimental
 *
 * GENERALITY PROOF — a research flow is `fanout` under a research persona. No "research-sweep"
 * library shape exists: the SHAPE (`fanout` over angles, one synthesis child) is content-free;
 * the DOMAIN (who investigates, what posture, what counts as a citation) lives entirely on the
 * `Persona` + the per-item task projection here. Swap `researchPersona` for any other persona and
 * the SAME `fanout` call investigates a different domain with zero combinator edits — that is the
 * thing this file proves.
 */

import type { Settled } from '../../supervise/types'
import { fanout } from '../combinators'
import { definePersona } from '../persona'
import type { Outcome, Persona, ShapeContext } from '../types'
import type { CombinatorShape } from '../wave-types'

/** What a research flow delivers: the synthesized finding plus the angles that back it. */
export interface ResearchFinding {
  readonly finding: unknown
  readonly citations: ReadonlyArray<{ readonly angle: string; readonly claim: unknown }>
}

/** A research task — the question to investigate, decomposed into angles by the caller. */
export interface ResearchTask {
  readonly question: string
  readonly angles: ReadonlyArray<string>
}

/**
 * The DOMAIN, expressed as a persona — role, directive, harness, seams. The combinator never
 * reads these semantically; the persona's resolved leaf executor turns each item task into a
 * research prompt. `harness: null` selects the router/inline leaf (a direct inference call); a
 * sandbox-backed research run passes a `BackendType` instead, with no change to the shape below.
 */
export const researchPersona: Persona<ResearchFinding> = definePersona<ResearchFinding>({
  name: 'equity-research-analyst',
  directive: 'Investigate each angle independently, then synthesize one cited answer.',
  context: { role: 'equity research analyst', notes: 'cite every claim back to its angle' },
  root: {
    profile: {
      name: 'equity-research-analyst',
      prompt: {
        instructions: ['Act as an equity research analyst. Ground every claim in evidence.'],
      },
    },
    harness: null,
  },
  executors: { seams: { router: { endpoint: 'inline', key: 'inline' } } },
})

/**
 * The research flow: `fanout` over the question's angles, each spawned as one child, with a single
 * synthesis child that folds the gathered angle results into one cited finding. The DOMAIN is the
 * persona's; the SHAPE is generic `fanout`. The shape is persona-AGNOSTIC — `buildResearchFlow`
 * takes no persona; the persona is supplied at run time:
 *
 *     runPersonified({ persona: researchPersona, shape: buildResearchFlow(task), task, budget })
 *
 * Pass any other `Persona` to that same call and the identical `fanout` investigates a different
 * domain — zero combinator edits. That is the generality this file proves.
 */
export function buildResearchFlow(
  task: ResearchTask,
): CombinatorShape<ResearchTask, ResearchFinding> {
  return fanout<ResearchTask, string, ResearchFinding>(task.angles, {
    label: (angle) => `angle:${angle}`,
    itemTask: (angle, index, ctx) => angleTask(ctx, task.question, angle, index),
    synthesize: {
      synthesisTask: (gathered, ctx) => ({
        phase: 'synthesize',
        directive: ctx.persona.directive,
        role: ctx.persona.context.role,
        question: task.question,
        gathered: gathered.filter(isDone).map((s) => ({ label: s.handle.label, out: s.out })),
      }),
      // selector≠judge: synthesis is a SEPARATE child; its `done` output is the cited finding.
      collect: (settled: Settled<Outcome<ResearchFinding>>): Outcome<ResearchFinding> => {
        if (settled.kind === 'down') {
          return { kind: 'blocked', blockers: [`synthesize: ${settled.reason}`] }
        }
        return settled.out
      },
    },
  })
}

/** One angle's task — persona content (directive + role) threaded in, plus the angle discriminator.
 *  The angle framing lives in the persona's profile/prompt, never in the combinator. */
function angleTask(
  ctx: ShapeContext<ResearchFinding>,
  question: string,
  angle: string,
  index: number,
): Record<string, unknown> {
  return {
    phase: 'angle',
    directive: ctx.persona.directive,
    role: ctx.persona.context.role,
    question,
    angle,
    index,
  }
}

function isDone(
  s: Settled<Outcome<ResearchFinding>>,
): s is Extract<Settled<Outcome<ResearchFinding>>, { kind: 'done' }> {
  return s.kind === 'done'
}
