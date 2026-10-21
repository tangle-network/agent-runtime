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
