/**
 * @experimental
 *
 * THE HEADLINE — recursion going UP. The other examples personify a leaf-of-the-tree role
 * (analyst, coder). This one personifies the ROOT of the tree: the human-driver layer itself. A
 * root persona — "the operator orchestrating product development" — whose `act` (a generic
 * `fanout`/`pipeline` combinator) spawns PROJECT-LEVEL children, each of which is ITSELF a
 * combinator-driven sub-loop via the recursive `Agent` atom. No new mechanism: the keystone is
 * already self-similar, so the operator-orchestrating-products loop is the same shape as the
 * analyst-investigating-angles loop, one level up.
 *
 * Two seams this file proves, both already in the library:
 *  1. Cross-run state — `readOperatorMemory` projects accreted `Corpus` facts into the operator
 *     persona's profile via `renderCorpusToInstructions`, so each orchestration run starts from
 *     what prior runs LEARNED (the flywheel READ side), not a blank slate.
 *  2. Self-similar recursion — `buildPortfolioFlow` is `fanout` over projects; each project child's
 *     task frames a SUB-LOOP (its own shape + persona), so the project sub-driver is a first-class
 *     `Agent` the conserved pool + `maxDepth` already bound. The operator does not run the projects;
 *     it spawns them and synthesizes their deliverables, exactly as a leaf shape spawns its workers.
 *
 * Run-time wiring — identical to the leaf examples, just one altitude up:
 *
 *     const persona = await operatorPersona(corpus)
 *     runPersonified({ persona, shape: buildPortfolioFlow(task), task, budget, maxDepth })
 */

import type { AgentProfile } from '@tangle-network/sandbox'
import type { Settled } from '../../supervise/types'
import { fanout } from '../combinators'
import { renderCorpusToInstructions } from '../corpus'
import { definePersona } from '../persona'
import type { Outcome, Persona, ShapeContext } from '../types'
import type { CombinatorShape, Corpus, CorpusFilter } from '../wave-types'

/** What an orchestration run delivers: the per-project sub-loop deliverables the operator gathered
 *  plus the synthesized portfolio decision over them. */
export interface PortfolioDecision {
  readonly decision: unknown
  readonly projects: ReadonlyArray<{ readonly project: string; readonly deliverable: unknown }>
}

/** One project the operator drives — its name plus the sub-loop framing (which shape/persona the
 *  project child runs as). The operator threads `subLoop` verbatim into the child task; the
 *  resolved project sub-driver interprets it. */
export interface Project {
  readonly name: string
  /** Opaque sub-loop framing for the project child (e.g. which shape + persona it personifies).
   *  The operator never interprets it — the recursive `Agent` atom does, one level down. */
  readonly subLoop: unknown
}

/** An orchestration task — the portfolio of projects to drive concurrently. */
export interface PortfolioTask {
  readonly objective: string
  readonly projects: ReadonlyArray<Project>
}

/**
 * The ROOT persona: the operator orchestrating product development. Same `definePersona` builder
 * as a leaf persona — the only difference is altitude. `harness: null` runs the operator's own
 * planning/synthesis as a direct inference call; each spawned project child carries its OWN spec
 * (it may run sandboxed) one level down. Built async because the operator's instructions are
 * projected from the cross-run `Corpus` (the flywheel read).
 */
export async function operatorPersona(
  corpus: Corpus,
  filter: CorpusFilter = { area: 'product-development', minConfidence: 0.6 },
): Promise<Persona<PortfolioDecision>> {
  const profile = await readOperatorMemory(corpus, filter)
  return definePersona<PortfolioDecision>({
    name: 'Drew orchestrating product development',
    directive: 'Drive each product project to a shippable deliverable, then decide the portfolio.',
    context: {
      role: 'the operator orchestrating product development',
      notes: 'spawn one sub-loop per project; synthesize, never re-judge a project sub-driver',
    },
    root: { profile, harness: null },
    executors: { seams: { router: { endpoint: 'inline', key: 'inline' } } },
  })
}

/**
 * Project the operator's accreted cross-run facts into a fresh `AgentProfile` — the learning
 * flywheel READ side. Each prior run's durable lessons (what shipped, what stalled, which sub-loop
 * shape won) land in `prompt.instructions[]`, so the operator opens this run already knowing them.
 * Never mutates the base profile; `renderCorpusToInstructions` returns a fresh one.
 */
export async function readOperatorMemory(
  corpus: Corpus,
  filter: CorpusFilter,
): Promise<AgentProfile> {
  const base: AgentProfile = {
    name: 'Drew orchestrating product development',
    prompt: {
      instructions: ['Act as the operator orchestrating product development across projects.'],
    },
  }
  return renderCorpusToInstructions({ corpus, filter, profile: base })
}

/**
 * The orchestration flow: `fanout` over the portfolio's projects, with a single synthesis child
 * that folds the per-project sub-loop deliverables into one portfolio decision. The combinator is
 * the IDENTICAL generic `fanout` the research example used — the only difference is that each
 * `itemTask` here frames a PROJECT SUB-LOOP rather than a single research angle. That is the
 * recursion: a `fanout` whose children are themselves loops.
 */
export function buildPortfolioFlow(
  task: PortfolioTask,
): CombinatorShape<PortfolioTask, PortfolioDecision> {
  return fanout<PortfolioTask, Project, PortfolioDecision>(task.projects, {
    label: (project) => `project:${project.name}`,
    itemTask: (project, index, ctx) => projectSubLoopTask(ctx, task.objective, project, index),
    synthesize: {
      synthesisTask: (gathered, ctx) => ({
        phase: 'portfolio-decision',
        directive: ctx.persona.directive,
        role: ctx.persona.context.role,
        objective: task.objective,
        projects: gathered
          .filter(isDone)
          .map((s) => ({ project: s.handle.label, deliverable: s.out })),
      }),
      collect: (settled: Settled<Outcome<PortfolioDecision>>): Outcome<PortfolioDecision> => {
        if (settled.kind === 'down') {
          return { kind: 'blocked', blockers: [`portfolio-decision: ${settled.reason}`] }
        }
        return settled.out
      },
    },
  })
}

/**
 * One project child's task — the SUB-LOOP framing. Carries the operator's directive/role (CONTENT)
 * plus the project's own `subLoop` spec, which the recursive `Agent` atom one level down resolves
 * into its own shape + persona. The operator names the work; the project sub-driver runs it.
 */
function projectSubLoopTask(
  ctx: ShapeContext<PortfolioDecision>,
  objective: string,
  project: Project,
  index: number,
): Record<string, unknown> {
  return {
    phase: 'project-sub-loop',
    directive: ctx.persona.directive,
    role: ctx.persona.context.role,
    objective,
    project: project.name,
    subLoop: project.subLoop,
    index,
  }
}

function isDone(
  s: Settled<Outcome<PortfolioDecision>>,
): s is Extract<Settled<Outcome<PortfolioDecision>>, { kind: 'done' }> {
  return s.kind === 'done'
}
