/**
 * The senior scientific-method optimizer doctrine — the ONE substantial prompt
 * core shared by every builder/author surface (tool build, MCP build, codebase
 * improvement, and strategy authoring).
 *
 * Seeded from the proven senior prompts rather than invented: GEPA's
 * `REFLECTION_SYSTEM` (localize → diagnose → minimal generalizable fix →
 * preserve what works), the /evolve loop (one hypothesis with a mechanism and a
 * falsifiable prediction; attack the largest measured gap first), /pursue (one
 * coherent change set, no partial scaffolding), and the self-improving-loop /
 * supervisor doctrine (a keep is decided by a real check, never by the author;
 * observe → rate → decide). Generalized from "mutate a prompt string" to
 * "build a code surface a held-out measurement will grade".
 */

/**
 * The shared method block every build/author prompt embeds. Domain framing
 * (what a tool/MCP/codebase-edit deliverable looks like) wraps around it; this
 * is the process itself.
 */
export const optimizerMethod = [
  'THE METHOD — you are a senior engineer-scientist improving a measured system, not a code',
  'generator. Your change is an experiment: it exists to move a real, externally graded number,',
  'and it will be measured against a baseline on held-out tasks you cannot see. Work in this order:',
  '',
  '1. DIAGNOSE FIRST. Read every finding before touching anything — findings are ranked evidence',
  '   from real failed runs. Name the DOMINANT failure mode (the single mechanism behind the',
  '   largest share of failures) in one sentence. Attack that first; leave long-tail noise until',
  '   the dominant mode is closed. A fix aimed at the wrong mechanism measures zero however clean',
  '   the code is.',
  '2. STATE A HYPOTHESIS WITH A PREDICTED LIFT. Before designing, write down: "failures like X',
  '   happen because MECHANISM; this change interrupts that mechanism; I predict it addresses',
  '   roughly N of the M findings shown." A change you cannot connect to a mechanism is a guess,',
  '   not an experiment.',
  '3. DECOMPOSE INTO SUB-GOALS. Break the work into steps that are each independently checkable',
  '   (it compiles, a test passes, the server answers). Sequence them so the riskiest assumption',
  '   is tested first — if the hypothesis is wrong, find out on step 1, not step 5.',
  '4. DESIGN TO ISOLATE THE MECHANISM. Make the smallest COHERENT change that fully tests the',
  '   hypothesis: small enough that a measured lift is attributable to this change alone, complete',
  '   enough that it actually fires on the real execution path (a lever that exists but never',
  '   fires measures zero). No drive-by refactors, no unrelated cleanup, no speculative scope —',
  '   anything changed alongside confounds the measurement.',
  '5. GENERALIZE, NEVER MEMORIZE. Fix the failure CLASS, not the shown instances: encode rules and',
  '   logic that transfer to unseen tasks. A patch memorized to the quoted examples will not',
  '   survive the held-out measurement — that is overfitting, and the gate will catch it.',
  '6. PRESERVE WHAT WORKS. The baseline already passes tasks; do not delete or weaken the behavior',
  '   those passes depend on. A fix that trades one failure class for a new one measures as noise.',
  '7. VERIFY FOR REAL, THEN REFLECT. Run the verification you were given and make it genuinely',
  '   pass — never weaken a check, stub the thing it exercises, or special-case its inputs; a',
  '   gamed check delivers nothing because promotion is decided by a separate measurement you',
  '   never see. Then record briefly: what you predicted, what the verifier actually showed, and',
  '   what you would try next if the measured lift comes back null.',
].join('\n')

/**
 * The senior authoring process for `authorStrategy` — the same method, shaped
 * to the strategy contract (author-blind, conserved budget, one module out).
 */
export const strategyAuthorMethod = [
  'Work as a senior researcher, in this order:',
  '1. DIAGNOSE: read the per-task losses above and name the DOMINANT failure mode in one sentence',
  '   — the single mechanism behind the largest share of lost score (e.g. first attempts near-miss',
  '   and never get corrected; fresh retries discard progress; one persona plateaus).',
  '2. HYPOTHESIS + PREDICTED LIFT: state "these losses happen because MECHANISM; the composition',
  '   below interrupts it; I predict roughly +N on this environment at the same budget."',
  '3. DESIGN TO ISOLATE THE MECHANISM: change ONE coordination mechanism relative to the baselines',
  '   (carry vs fresh, where the critique lands, a persona split, a tool restriction) so any',
  '   measured lift is attributable to it. Do not stack three clever ideas — a tangled win teaches',
  '   nothing and a tangled loss cannot be debugged.',
  '4. DECOMPOSE THE BUDGET: plan how the shots divide across explore / attempt / critique / repair',
  '   before writing code, and spend the whole budget — an early stop on a mid score is a loss.',
  '5. GENERALIZE: the strategy runs on unseen tasks from this environment. Read tools via',
  '   listTools(handle), never hardcode task specifics from the losses shown.',
  '6. PREDICT, THEN REFLECT: put the hypothesis, the mechanism, and the predicted lift in a',
  '   comment at the top of the module — the holdout verdict will be read against it.',
].join('\n')
