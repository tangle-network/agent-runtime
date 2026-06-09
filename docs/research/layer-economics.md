> **Track:** Architecture (research) · **Role:** layer stress-test · **Status:** canon-mandated, practice-absent — the largest internal inconsistency

# Layer: economics, multi-objective, and the portfolio question

**The claim under test:** "best" is a vector — correct · fast · secure · cheap — and the
optimization target is the Pareto frontier, not a pre-collapsed score.

## The inconsistency this layer names

The canon mandates this (architecture §0.5.2 "Success is multi-objective; we do not
collapse it to one number until forced"; §0.5.3 each objective carries its own deployable
checker). **Every gate this program has run is single-objective** (verifier score), with
cost merely *reported*. The Pareto machinery exists (`paretoFrontier`,
`paretoFrontierWithCrowding` in agent-eval; the GEPA harness already selects on
[lift, cost]). This is practice lagging canon, not a design dispute — and it changes
conclusions: a strategy that ties on score but halves cost **wins** under the canon's
definition and is invisible under ours.

## What's free to wire (harvest, not research)

- **correct** — already the verifier. **cheap** — already measured (`Spend.usd`,
  tokens; the conserved pool meters it). **fast** — already measured (`Spend.ms`).
  Three of four objectives are *already in every RunRecord*; the work is reporting the
  vector + Pareto verdicts instead of the scalar. ~Days, not weeks.
- **secure** — the one objective needing a real checker (domain-dependent: policy
  violations in EOPS, dangerous tool calls, secret leakage). Defer until a domain
  supplies one; don't fake it with an LLM judge (eval-substrate: deterministic or
  execution-grounded only).

## The two big unmeasured effects in this layer

1. **The cost-quality frontier across models.** The router serves 500+ models; the
   gates have used 2–3. The product question is *lift-per-dollar*, and the data so far
   hints the frontier is strange: deepseek-v4-flash resolves 6% of EOPS (too weak to
   steer), v4-pro carries the +16.4pp at a fraction of gpt-4.1's price. A model-sweep on
   the existing gate (same harness, 4–5 models, report (score, $/task)) maps it for the
   cost of one rerun.
2. **Tool/harness augmentation dominates.** The largest single effect this program has
   ever measured is not steering, not selection, not prompts — it is **giving cheap
   models a search tool**: you.com lifted *all five* models to ~90% on SimpleQA (+70pp
   for cheap models, p≈.03), erasing the model-quality gap. The honest implication: for
   many task classes, **harness augmentation ≥ model choice ≥ strategy ≫ prompt** in
   effect size. The portfolio should weight accordingly — an "augmentation sweep" (which
   tool grants close which domain's gap) is plausibly worth more than every remaining
   steering experiment combined.

## Stress test

- *"Multi-objective is premature until score itself is solid."* Backwards under the
  canon: collapsing to score is what made the deepseek-flash runs look uninformative
  (6% resolve) when the right reading was "off the frontier, wrong model for the
  domain." The vector is *cheaper* to be right with, not more expensive.
- *"Pareto verdicts confuse operators."* The scalarization exists (`scalarScore`,
  weighted) for when a single winner is forced; the discipline is collapse-last.
- *"Routing is a product, not an experiment."* It's both — but the *measurement* (the
  frontier map) is precisely the eval-substrate's sellable exhaust (eval-substrate: "which
  (harness × model × provider × strategy) is actually best for task-class X").

## Concrete next steps

1. Wire the (correct, usd, ms) vector + `paretoFrontier` verdict into `runBenchmark`'s
   report (additive; the data is already in the records).
2. Model-frontier sweep on the canonical EOPS gate: {v4-flash, v4-pro, glm-5, gpt-4.1}
   × {sample, refine} → the first published lift-per-dollar table.
3. Augmentation sweep design: per domain, the tool grant that closes the cheap-model
   gap (search for retrieval domains; what is the EOPS analog — schema docs? read-tool
   hints?).
