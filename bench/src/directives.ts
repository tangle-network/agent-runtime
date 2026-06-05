/**
 * The steer surface (docs/architecture.md §4–§5): the refine directives a driver
 * injects on rounds 2+. They live HERE, not in the worker files — a worker is a
 * SUBSTRATE that runs a prompt; the directive is the DRIVER's steer, and the thing
 * GEPA optimizes. Centralizing them makes the optimization surface explicit and
 * stops workers from owning steer text.
 *
 * Honest caveat (architecture.md §11, rung-0): these hand-written / early-GEPA
 * directives are the *intrinsic verify-and-revise* family, which LOSES to
 * compute-matched random@k on FinSearchComp. They are kept as the optimization
 * SURFACE and the baseline the real trace-fed driver must beat — NOT as a
 * recommended default. The end state is a driver that supplies the steer from the
 * trace+analysis; until run.ts is unified onto that path, workers take a directive
 * as an optional param defaulting to the relevant constant below.
 */

/**
 * APPROACH-diversity strategy lenses — a DIFFERENT family from the verify-and-revise
 * directives above. The caveat names why verify-and-revise loses: k identical-directive
 * shots cluster on the SAME reasoning path, so they share a failure mode and a random
 * pick among them gains nothing. These lenses make the k shots take DIFFERENT reasoning
 * paths, so a deployable self-consistency selector can pick the consensus across
 * genuinely independent attempts. That is the gate hypothesis runProgram's `parallel`
 * is built to deploy: diverse@k (parallel of distinct lenses) vs random@k (blind
 * sample of identical) at EQUAL k. Each lens is a PREFIX to the task; it changes HOW
 * the model reasons, never the answer the judge scores. GEPA optimizes the shared base
 * (`improve-prompt`); these lenses layer on top via `composeStrategies`.
 */
const DIVERSE_STRATEGY_LENSES: ReadonlyArray<string> = [
  'Answer directly and decisively from what you already know. State the single best answer without hedging.',
  'Decompose the question into the sub-facts it depends on. Establish each sub-fact explicitly, then compose them into the answer.',
  'Reason from first principles. Ignore the most obvious or popular guess; derive the answer from underlying facts and relationships.',
  'Name the most plausible WRONG answer and the trap that makes it tempting. Rule it out, then commit to the answer that survives.',
]

/** Compose the k diverse strategies for a run: each = an approach lens layered on the
 *  (optionally GEPA-learned) shared base. Returns exactly `k` distinct strategy prefixes
 *  (lenses cycle if k exceeds the lens count, but each carries its index so prompts differ). */
export function composeStrategies(base: string, k: number): string[] {
  const lenses = DIVERSE_STRATEGY_LENSES
  return Array.from({ length: k }, (_, i) => {
    const lens = lenses[i % lenses.length] as string
    const tag = i < lenses.length ? '' : ` (variant ${Math.floor(i / lenses.length) + 1})`
    return `${lens}${tag}\n\n${base}`
  })
}

/** Research (local opencode, model-knowledge) refine directive — hand-written. */
export const DEFAULT_RESEARCH_REFINE_DIRECTIVE =
  'Double-check it for a specific factual or reasoning error. If it is correct, restate the SAME answer unchanged. Change it ONLY if you identify a concrete, specific error — do not change a correct answer. End with the FINAL ANSWER line.'

/** Sandbox research (live web/market sources) refine directive — hand-written. */
export const DEFAULT_SANDBOX_REFINE_DIRECTIVE =
  'Double-check it: re-verify the figure against live sources and the requested units/precision/tolerance. If it is correct, restate the SAME final answer unchanged. Change it ONLY if you find a concrete error in the value or the source. End with the explicit final answer.'

/** GEPA-learned sandbox refine directive (bycd31l10, +7.1pp held-out vs the
 *  hand-written one on the GEPA run, n=8/noisy). Separates the verification note
 *  from the verbatim-preserved final answer, fixing the blank-reply failure mode. */
export const GEPA_LEARNED_DIRECTIVE =
  'Double-check it: re-verify the fact/value against a reliable, citable source. Provide a brief Verification note naming the source you used (link or title); this note is not part of the final answer. Confirm the requested units/precision/tolerance exactly. If the prior answer is correct, copy the SAME final answer text verbatim with identical formatting—do not add or remove words. Change it ONLY if you find a concrete error in the value or in the cited source; in that case, briefly describe the specific error in the Verification note and provide the corrected value with the requested units/precision/tolerance. If you cannot verify, state that in the Verification note, but do not alter or omit the final answer. Always place the final answer as the last line of your reply, containing only the answer text.'

/** OpenSCAD authoring directive (CAD design) — the GEPA-optimizable system prompt.
 *  Minimal on purpose: states the contract (compile, source-only) but not HOW to
 *  satisfy the geometric spec, leaving headroom for the optimizer. */
export const DEFAULT_CAD_DIRECTIVE =
  'You are an expert OpenSCAD engineer. Output ONLY valid OpenSCAD source — no prose, no markdown fences. The model MUST compile with `openscad -o out.stl model.scad`. Match the brief as closely as you can.'

/** OpenSCAD authoring directive for the SANDBOX path (solveCadRefine) — a terser
 *  variant of DEFAULT_CAD_DIRECTIVE (no "match the brief" tail). Kept distinct
 *  rather than unified to preserve that path's exact prompt. */
export const DEFAULT_CAD_SANDBOX_DIRECTIVE =
  'You are an expert OpenSCAD engineer. Output ONLY valid OpenSCAD source — no prose, no markdown fences. The model must compile with `openscad -o out.stl model.scad`.'

/** Blender bpy authoring directive (BlenderLLM/CADBench) — the GEPA-optimizable
 *  system prompt. States the contract (runs headless, builds mesh(es) at origin,
 *  no cameras/lights) but not how to satisfy the criteria. */
export const DEFAULT_BLENDER_DIRECTIVE =
  'You are an expert Blender Python (bpy) modeller. Output ONLY a complete bpy script — no prose, no markdown fences. The script must run under `blender --background --python` and build the described object as one or more mesh objects at the world origin. Do NOT add cameras, lights, or render calls; the harness adds those. Match the description.'

/** build123d authoring directive (CADGenBench) — the GEPA-optimizable system
 *  prompt. States the contract (build123d → output.step, valid watertight solid,
 *  exact dimensions) but not how to satisfy it. */
export const DEFAULT_BUILD123D_DIRECTIVE =
  'You are an expert CAD engineer. Write a build123d (Python, OpenCascade BREP) script that builds the described part and saves it with `export_step(part, "output.step")`. Output ONLY the Python script — no prose, no markdown fences. The script must run, produce a single VALID watertight solid, and match the described geometry as precisely as possible (exact stated dimensions).'
