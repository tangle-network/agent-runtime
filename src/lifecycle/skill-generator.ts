/**
 * `skillGenerator` — the reference `CandidateGenerator` for the SKILL surface,
 * and the literal answer to "an empty profile has no skills, so what creates
 * one?".
 *
 * It is a two-step pipeline:
 *
 *   1. DISTILL — read the agent's traces/findings and WRITE a new skill document
 *      (a reusable how-to note: "check state before acting", "verify after every
 *      edit"). This is the CREATE step. It is the piece `skillOpt` cannot do —
 *      an optimizer refines an existing skill, it cannot conjure one from
 *      nothing. The production `distill` is `reflectiveGenerator`-style: an LLM
 *      reflection over the trace produces the first draft.
 *
 *   2. REFINE — take the distilled draft and improve its wording/structure. The
 *      production `refine` drives agent-eval's `skillOptProposer` (the uniform
 *      skill-surface proposer factory from `@tangle-network/agent-eval/campaign`,
 *      the same source as `gepaProposer` for the prompt surface). Refinement is
 *      optional: with no `refine`, the distilled draft IS the candidate.
 *
 * Both steps are INJECTED seams, not hardcoded engines — per the §1.5 law, the
 * generator AUTHORS a profile piece; it does not embed a specific LLM loop. That
 * keeps the closed loop deterministically testable (inject pure stubs) while
 * production wires the real distill + skillOpt. The generator emits a `skill`
 * artifact (an inline `SKILL.md` resource ref) the orchestrator measures + gates.
 */

import type { AgentProfileResourceRef } from '@tangle-network/agent-interface'
import type { CandidateGenerator, GenerateContext } from './generator'
import type { ArtifactInput } from './types'

/** A distilled skill draft: a name + the `SKILL.md` body. */
export interface SkillDraft {
  /** Skill name — becomes the inline resource ref name + the artifact name. */
  name: string
  /** The `SKILL.md` document body (markdown). */
  content: string
  /** Optional one-line description for review surfaces. */
  description?: string
}

/**
 * DISTILL — create new skill drafts from the agent's history. Returns zero or
 * more drafts (zero is valid: nothing worth distilling this round). The
 * production implementation reflects over `ctx.traces` / `ctx.findings` with an
 * LLM; a test injects a pure function.
 */
export type DistillSkills = (ctx: GenerateContext) => Promise<SkillDraft[]> | SkillDraft[]

/**
 * REFINE — improve ONE distilled draft (wording, structure, examples). The
 * production implementation drives `skillOptProposer`. Returns the refined draft;
 * when omitted from `skillGenerator`, the distilled draft is used as-is.
 */
export type RefineSkill = (draft: SkillDraft) => Promise<SkillDraft> | SkillDraft

export interface SkillGeneratorOptions {
  /** REQUIRED — the create step. Without it there is no skill to optimize. */
  distill: DistillSkills
  /** OPTIONAL — the optimize step. Omit to ship distilled drafts unrefined. */
  refine?: RefineSkill
}

/**
 * Build a `CandidateGenerator` for the skill surface that distills new skills
 * from history, then (optionally) refines them, and emits each as a `skill`
 * artifact carrying an inline `SKILL.md` resource ref.
 *
 * @example Production wiring (distill = LLM reflection, refine = skillOptProposer):
 *   skillGenerator({
 *     distill: reflectiveDistill,   // creates the draft from traces
 *     refine: skillOptRefine,       // optimizes the draft via skillOptProposer
 *   })
 */
export function skillGenerator(opts: SkillGeneratorOptions): CandidateGenerator<'skill'> {
  return {
    kind: 'skill',
    async generate(ctx): Promise<ArtifactInput<'skill'>[]> {
      const drafts = await opts.distill(ctx)
      const out: ArtifactInput<'skill'>[] = []
      for (const draft of drafts) {
        const refined = opts.refine ? await opts.refine(draft) : draft
        out.push(toSkillArtifact(refined))
      }
      return out
    },
  }
}

/** Turn a (refined) draft into a `skill` artifact with an inline resource ref. */
function toSkillArtifact(draft: SkillDraft): ArtifactInput<'skill'> {
  const resource: AgentProfileResourceRef = {
    kind: 'inline',
    name: draft.name,
    content: draft.content,
  }
  return {
    kind: 'skill',
    name: draft.name,
    description: draft.description,
    payload: { resource },
  }
}
