/**
 * `promptGenerator` — the `CandidateGenerator` for the PROMPT surface.
 *
 * It is to the prompt surface what `skillGenerator` is to skills: the thin
 * per-surface adapter that turns the agent's history into fresh, unmeasured
 * prompt-instruction candidates the surface-agnostic `runLifecycle` loop then
 * measures, gates, and promotes. Each candidate is a `prompt` artifact carrying
 * one `{ instruction }` line that `applyArtifact` appends to
 * `profile.prompt.instructions`.
 *
 * Two candidate sources, run together each generation:
 *
 *   1. REFINE (incumbent-grounded) — drive agent-eval's `gepaProposer`, the
 *      reflective prompt-tier proposer. It reflects on the incumbent prompt +
 *      the trace findings and proposes TARGETED rewrites. This is the exploit
 *      arm: it polishes the framing the agent already has.
 *
 *   2. SEED (basin escape) — author N genuinely DIVERSE fresh instruction
 *      lines from the TASK SPEC, NOT from the incumbent. A reflective proposer
 *      only ever perturbs the current surface, so on its own it can polish a
 *      local minimum forever — it never tries a fundamentally different framing.
 *      The seed arm authors several rewrites that each take a DIFFERENT stance
 *      (imperative vs. checklist vs. failure-mode-first, …) so the search can
 *      JUMP basins instead of only descending the one it starts in. This is the
 *      explore arm, and it is the piece `gepaProposer` structurally cannot do.
 *
 * Both seams are INJECTED (per the §1.5 law: the generator AUTHORS profile
 * pieces, it does not embed a specific LLM loop). `refine` wraps `gepaProposer`;
 * `authorDiverseSeeds` wraps an LLM author. A test injects pure stubs for both,
 * keeping the closed loop deterministically testable; production wires the real
 * router-backed engines (see `productionPromptGenerator`).
 */

import { type AnalystFinding, callLlmJson, type LlmClientOptions } from '@tangle-network/agent-eval'
import {
  type GenerationRecord,
  gepaProposer,
  isProposedCandidate,
  type MutableSurface,
  type ProposeContext,
  type ProposedCandidate,
  type SurfaceProposer,
} from '@tangle-network/agent-eval/campaign'
import type { AgentProfile } from '@tangle-network/agent-interface'
import type { CandidateGenerator, GenerateContext } from './generator'
import type { ArtifactInput } from './types'

/** A proposed prompt instruction line plus the WHY behind it. The `rationale`
 *  rides into the artifact metadata so a promotion decision is auditable. */
export interface PromptDraft {
  /** The instruction line appended to `profile.prompt.instructions`. */
  instruction: string
  /** Short human label for review surfaces. */
  label: string
  /** Why this line was proposed — which failure / framing it targets. */
  rationale: string
}

/**
 * REFINE — incumbent-grounded rewrites. Given the lifecycle context, return
 * targeted edits OF the current prompt framing. The production implementation
 * drives `gepaProposer`; a test injects a pure function. Returns zero or more
 * drafts.
 */
export type RefinePrompt = (ctx: GenerateContext) => Promise<PromptDraft[]> | PromptDraft[]

/**
 * SEED — author N genuinely DIVERSE fresh instruction lines from the task spec,
 * NOT mutations of the incumbent. This is the local-minimum escape: each seed
 * MUST take a different framing so the population spans multiple basins. The
 * production implementation makes one LLM call at a non-trivial temperature; a
 * test injects a pure function. Returns up to `count` drafts.
 */
export type AuthorDiverseSeeds = (
  ctx: GenerateContext,
  count: number,
) => Promise<PromptDraft[]> | PromptDraft[]

export interface PromptGeneratorOptions {
  /** OPTIONAL — the exploit arm (incumbent-grounded rewrites via `gepaProposer`).
   *  Omit to run seeds-only. */
  refine?: RefinePrompt
  /** OPTIONAL — the explore arm (diverse fresh seeds). Omit to run refine-only. */
  authorDiverseSeeds?: AuthorDiverseSeeds
  /** How many diverse seeds the explore arm authors each generation. Default 3.
   *  Zero disables seeding even when `authorDiverseSeeds` is set. */
  diverseSeedCount?: number
}

/**
 * Build a `CandidateGenerator` for the prompt surface. Each generation it pools
 * the refine arm (incumbent rewrites) and the seed arm (diverse fresh framings),
 * de-duplicates by instruction text, and emits each as a `prompt` artifact.
 *
 * At least one of `refine` / `authorDiverseSeeds` MUST be provided — a generator
 * with neither has no way to produce a candidate and is a wiring bug, so it
 * throws at construction rather than silently returning `[]` every round.
 *
 * @example Production wiring (refine = gepaProposer, seed = LLM author):
 *   promptGenerator({
 *     refine: gepaRefine(llm, model),
 *     authorDiverseSeeds: routerSeedAuthor(llm, model),
 *   })
 */
export function promptGenerator(opts: PromptGeneratorOptions): CandidateGenerator<'prompt'> {
  if (!opts.refine && !opts.authorDiverseSeeds) {
    throw new TypeError(
      'promptGenerator: at least one of `refine` or `authorDiverseSeeds` is required — a generator with neither can never produce a candidate',
    )
  }
  const seedCount = opts.diverseSeedCount ?? 3

  return {
    kind: 'prompt',
    async generate(ctx): Promise<ArtifactInput<'prompt'>[]> {
      const drafts: PromptDraft[] = []
      // Explore first: the diverse seeds anchor the population in multiple
      // basins before the incumbent-grounded refinements pile onto one.
      if (opts.authorDiverseSeeds && seedCount > 0) {
        drafts.push(...(await opts.authorDiverseSeeds(ctx, seedCount)))
      }
      if (opts.refine) {
        drafts.push(...(await opts.refine(ctx)))
      }
      return dedupeByInstruction(drafts).map(toPromptArtifact)
    },
  }
}

/** Drop drafts whose instruction text (trimmed) duplicates an earlier one — the
 *  refine arm and a seed can independently land on the same line. First wins. */
function dedupeByInstruction(drafts: PromptDraft[]): PromptDraft[] {
  const seen = new Set<string>()
  const out: PromptDraft[] = []
  for (const draft of drafts) {
    const key = draft.instruction.trim()
    if (key.length === 0 || seen.has(key)) continue
    seen.add(key)
    out.push(draft)
  }
  return out
}

/** Turn a prompt draft into a `prompt` artifact; the rationale rides in
 *  metadata so the promotion decision stays auditable. */
function toPromptArtifact(draft: PromptDraft): ArtifactInput<'prompt'> {
  return {
    kind: 'prompt',
    name: draft.label,
    description: draft.rationale,
    payload: { instruction: draft.instruction },
    metadata: { rationale: draft.rationale },
  }
}

// ---------------------------------------------------------------------------
// Production wiring — the real router-backed seams. Kept here (not in the test)
// so consumers wire the prompt surface in one call; the seams above stay pure
// so the closed loop is deterministically testable.
// ---------------------------------------------------------------------------

/** Default reflection/authoring model — a model the Tangle router serves.
 *  Callers should pass their own `model`; this is the zero-config fallback. */
const defaultPromptModel = 'deepseek-v4-flash'

export interface ProductionPromptGeneratorOptions {
  /** Router transport (baseUrl/apiKey) for both the refine and seed arms. */
  llm: LlmClientOptions
  /** Model that performs reflection + seed authoring. Default `deepseek-v4-flash`. */
  model?: string
  /** Population size handed to `gepaProposer`'s `propose`. Default 3. */
  refinePopulation?: number
  /** Diverse-seed count. Default 3. */
  diverseSeedCount?: number
  /** Seed-authoring temperature — high on purpose so the seeds spread across
   *  framings rather than collapsing onto one. Default 1.0. */
  seedTemperature?: number
}

/**
 * Production `promptGenerator`: refine via `gepaProposer`, seed via a
 * router-backed diverse author. The one call a consumer makes to grow prompt
 * artifacts with the real engines.
 */
export function productionPromptGenerator(
  opts: ProductionPromptGeneratorOptions,
): CandidateGenerator<'prompt'> {
  const model = opts.model ?? defaultPromptModel
  return promptGenerator({
    refine: gepaRefine(opts.llm, model, opts.refinePopulation ?? 3),
    authorDiverseSeeds: routerSeedAuthor(opts.llm, model, opts.seedTemperature ?? 1.0),
    diverseSeedCount: opts.diverseSeedCount ?? 3,
  })
}

/**
 * Wrap `gepaProposer` as a `RefinePrompt`. The proposer reflects on the
 * incumbent prompt (`ctx.baseline.prompt.systemPrompt`) and the trace findings
 * to propose `population` targeted rewrites. We feed it the generation-0
 * `ProposeContext` (no scored history yet inside one lifecycle round), so it
 * reflects on the current surface against its mutation primitives — exactly the
 * "polish the framing you already have" arm.
 */
export function gepaRefine(llm: LlmClientOptions, model: string, population: number): RefinePrompt {
  const proposer: SurfaceProposer<AnalystFinding> = gepaProposer({
    llm,
    model,
    target: 'agent system prompt',
  }) as SurfaceProposer<AnalystFinding>

  return async (ctx) => {
    const baseline = baselinePromptSurface(ctx.baseline)
    const proposeCtx: ProposeContext<AnalystFinding> = {
      currentSurface: baseline,
      history: [] as GenerationRecord[],
      findings: [...ctx.findings],
      populationSize: population,
      generation: 0,
      signal: ctx.signal ?? new AbortController().signal,
    }
    const proposed = await proposer.propose(proposeCtx)
    return proposed.flatMap((p) => promptDraftFromProposal(p, baseline))
  }
}

/**
 * A router-backed `AuthorDiverseSeeds`: one structured LLM call that authors
 * `count` instruction lines, each REQUIRED to take a distinct framing. The
 * prompt is grounded in the task spec (the incumbent system prompt as the spec
 * of WHAT the agent must do) plus the trace findings (what it gets wrong) — but
 * the model is told to author FRESH lines, not edits, so the output spans
 * basins the incumbent's neighborhood never reaches.
 */
export function routerSeedAuthor(
  llm: LlmClientOptions,
  model: string,
  temperature: number,
): AuthorDiverseSeeds {
  return async (ctx, count) => {
    const spec = baselinePromptSurface(ctx.baseline)
    const findingLines = ctx.findings
      .map(
        (f) =>
          `- [${f.area}] ${f.claim}${f.recommended_action ? ` → ${f.recommended_action}` : ''}`,
      )
      .join('\n')
    const system =
      'You author standing instructions for an autonomous agent. Given the agent task ' +
      'spec and its observed mistakes, write DIVERSE candidate instruction lines. CRITICAL: ' +
      'the candidates must NOT be paraphrases of each other or of the existing spec — each must ' +
      'take a GENUINELY DIFFERENT framing (e.g. one imperative directive, one as a pre-flight ' +
      'checklist, one written failure-mode-first, one as a principle, …). Different framings let ' +
      'a search escape a local optimum instead of polishing one. Return JSON only.'
    const user =
      `Agent task spec (what it must do):\n${spec || '(no explicit spec — infer from the domain)'}\n\n` +
      `Domain: ${ctx.domain}\n\n` +
      `Observed mistakes from traces:\n${findingLines || '(none captured this round)'}\n\n` +
      `Author exactly ${count} instruction-line candidates, each a single standing instruction, ` +
      'each with a distinct framing.'

    const { value } = await callLlmJson<{ candidates?: PromptDraftWire[] }>(
      {
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature,
        jsonSchema: {
          name: 'diverse_prompt_seeds',
          schema: {
            type: 'object',
            properties: {
              candidates: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    instruction: { type: 'string' },
                    framing: { type: 'string' },
                    rationale: { type: 'string' },
                  },
                  required: ['instruction', 'framing'],
                },
              },
            },
            required: ['candidates'],
          },
        },
      },
      llm,
    )

    const wire = value.candidates ?? []
    return wire.slice(0, count).map((c, i) => ({
      instruction: c.instruction,
      label: c.framing?.trim() ? `seed:${c.framing.trim()}` : `seed-${i + 1}`,
      rationale:
        c.rationale?.trim() ||
        `diverse seed (${c.framing?.trim() || 'fresh framing'}) authored from the task spec to escape a local minimum`,
    }))
  }
}

/** Wire shape of one authored seed from the router. */
interface PromptDraftWire {
  instruction: string
  framing?: string
  rationale?: string
}

/** The prompt surface `gepaProposer` mutates is the system prompt string. */
function baselinePromptSurface(profile: AgentProfile): string {
  return profile.prompt?.systemPrompt ?? ''
}

/** Turn a `gepaProposer` proposal into a `PromptDraft`. The proposer returns a
 *  full rewritten surface; we keep the delta against the baseline as the
 *  appended instruction (an artifact is ONE additive line, not a whole-surface
 *  swap), falling back to the whole surface when it is a pure addition. */
function promptDraftFromProposal(
  proposal: MutableSurface | ProposedCandidate,
  baseline: string,
): PromptDraft[] {
  if (isProposedCandidate(proposal)) {
    const surface = proposal.surface
    if (typeof surface !== 'string') return []
    const instruction = surfaceDelta(baseline, surface)
    if (!instruction) return []
    return [
      {
        instruction,
        label: proposal.label?.trim() || 'refine',
        rationale: proposal.rationale?.trim() || 'incumbent-grounded rewrite (gepaProposer)',
      },
    ]
  }
  if (typeof proposal !== 'string') return []
  const instruction = surfaceDelta(baseline, proposal)
  if (!instruction) return []
  return [{ instruction, label: 'refine', rationale: 'incumbent-grounded rewrite (gepaProposer)' }]
}

/** The line(s) a proposed surface ADDS over the baseline — the additive
 *  instruction an artifact represents. When the proposal is a wholesale rewrite
 *  (no shared prefix), the whole rewrite is the instruction. */
function surfaceDelta(baseline: string, proposed: string): string {
  const trimmed = proposed.trim()
  const base = baseline.trim()
  if (trimmed === base) return ''
  if (base && trimmed.startsWith(base)) {
    return trimmed.slice(base.length).trim()
  }
  return trimmed
}
