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

/** Research (local opencode, model-knowledge) refine directive — hand-written. */
export const DEFAULT_RESEARCH_REFINE_DIRECTIVE =
  'Double-check it for a specific factual or reasoning error. If it is correct, restate the SAME answer unchanged. Change it ONLY if you identify a concrete, specific error — do not change a correct answer. End with the FINAL ANSWER line.'

/** Sandbox research (live web/market sources) refine directive — hand-written. */
export const DEFAULT_SANDBOX_REFINE_DIRECTIVE =
  'Double-check it: re-verify the figure against live sources and the requested units/precision/tolerance. If it is correct, restate the SAME final answer unchanged. Change it ONLY if you find a concrete error in the value or the source. End with the explicit final answer.'

/** SWE-bench refine steer (filesystem-carry): the round-2+ "verify in place"
 *  directive. The task framing + rules (edit source not tests, minimal) live in the
 *  swe-bench adapter's task.prompt; this is only the steer appended on later rounds. */
export const SWE_REFINE_DIRECTIVE =
  "You have an in-progress fix; your changes are already in the working tree. VERIFY it: re-read the issue above and run the repository's existing tests. If the patch correctly and completely resolves the issue, leave it UNCHANGED. Change it ONLY if you find a CONCRETE problem — a failing test, a missed requirement, or a clear bug. Do not churn a working patch."

/** GEPA-learned sandbox refine directive (bycd31l10, +7.1pp held-out vs the
 *  hand-written one on the GEPA run, n=8/noisy). Separates the verification note
 *  from the verbatim-preserved final answer, fixing the blank-reply failure mode. */
export const GEPA_LEARNED_DIRECTIVE =
  'Double-check it: re-verify the fact/value against a reliable, citable source. Provide a brief Verification note naming the source you used (link or title); this note is not part of the final answer. Confirm the requested units/precision/tolerance exactly. If the prior answer is correct, copy the SAME final answer text verbatim with identical formatting—do not add or remove words. Change it ONLY if you find a concrete error in the value or in the cited source; in that case, briefly describe the specific error in the Verification note and provide the corrected value with the requested units/precision/tolerance. If you cannot verify, state that in the Verification note, but do not alter or omit the final answer. Always place the final answer as the last line of your reply, containing only the answer text.'
