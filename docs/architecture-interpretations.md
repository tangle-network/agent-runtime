# Architecture — Five Interpretations and the Coherence Verdict

This document tests the design in [architecture.md](./architecture.md) through five lenses.
The [learning audit](./research/learning-system-audit-2026-09-05.md) records the inspected revisions, reproduced defects, repairs, and capability limits.

## 1. The learning objective

The system should improve specialists, domain learning processes, working evaluations, and the methods that construct those processes.
A specialist can succeed within its intended domain without generalizing elsewhere.
The transferable knowledge can be the process that constructs and trains a successful specialist.

These claims require different comparisons.
Better task execution, repeated domain learning, better evaluation, and transfer of a learning process are separate outcomes.
One result cannot establish or reject all four.

## 2. Common execution and evidence

Runtime executes exact profiles, code candidates, and authored strategies.
Eval runs searches and measurements.
Knowledge preserves source-backed state and supplies retrieval and research operations.
The package boundaries express useful responsibilities.

The common unit should identify the candidate, its retained state, the objective, execution conditions, observations, and resources.
Search methods can share those facts while retaining different selection rules, archives, and exploration policies.
A complete method should not be reranked by a second optimizer that changes its decision.

An existing execution callback can run a domain learning episode and return the specialists it produced.
That callback still must execute those specialists, retain their exact state, and account for all inner work.
The ability to represent the callback does not establish that a complete learning process has been demonstrated.

## 3. Five interpretations

| Lens | Object being improved | Comparison that tests it | Weak assumption to challenge |
| --- | --- | --- | --- |
| Search during task execution | How an agent explores, continues, and selects task solutions | Compare execution policies on the same tasks and actual resources | More attempts, better checking, or extra information can explain an apparent policy gain |
| Experimental design | Which problems, sources, or experiments the learner selects | Compare subsequent domain outcomes under alternative acquisition policies | Score variance or an expressed knowledge gap need not identify useful practice |
| Program synthesis | The executable agent or learning algorithm | Execute exact candidate programs and compare their checked outputs | A syntactically valid program need not activate the mechanism it claims |
| Domain learning and meta-learning | The procedure that produces specialists and improves evaluations | Compare repeated learning episodes; test process transfer separately when claimed | The resulting specialist need not generalize outside its intended domain |
| Evaluation engineering | Tests, task generators, judge instructions, and outcome collection | Compare detection of independently established success and failure, then downstream learning | Agreement with a judge or easier tests can improve a score without improving domain outcomes |

Runtime's strategy programs already permit arbitrary sequencing and branching through ordinary code.
Complete profile and code candidates permit changes beyond prompt wording.
The analysis must inspect how those candidates execute before treating the search space as a fixed menu of actions.

## 4. Does it cohere?

The division of responsibilities is coherent.
The reproduced defects concern inconsistent candidate identity, measurement completeness, cost accounting, and disconnected feedback.
Those defects justify changes to the existing paths.
They do not justify merging the packages or imposing one search algorithm.

The broader learning claim remains empirical.
Stored recommendations, generated cases, calibration statistics, and optimization methods are useful ingredients.
A complete domain learning episode must show how those ingredients change later decisions and produce better domain outcomes.
A candidate learning method must be judged by what it produces, including unsuccessful episodes and their costs.

Preserve informative failures, candidate diversity, and joint interventions.
An exploratory step can be useful before it produces a deployable improvement.
A null component result cannot reject a mechanism that requires multiple components to interact.

## 5. Gate A — a diagnostic for within-run steering

Compare a driver that consumes traces and findings with a declared alternative on the same tasks and actual resources.
Use the same deployable method to select each result.
Record the information, intermediate checks, termination conditions, and costs available to each policy.
Establish that feedback actually changes a decision before interpreting the comparison.

This tests steering within a task under the specified conditions.
It does not decide whether a domain learner improves specialists, evaluations, or future experimental decisions across runs.
Use [architecture.md §9](./architecture.md#9-build-order-and-experiment-scope) for the comparison and rejection conditions.

## 6. Domain learning and evaluation engineering

A domain learner can choose sources, generate practice, change specialists, improve working evaluations, and retain useful results.
Structural source checks can inform that process, but citation counts and lexical overlap do not establish scientific truth or useful learning.
Judge calibration statistics analyze supplied observations; callers must execute the judge and apply any proposed change.

Working evaluations can guide learning and can themselves change.
Independent final assessment must remain outside the adaptive decisions whose improvement it tests.
A changed evaluation can be better when it exposes failures and lowers the current specialist's score.
Its value depends on detection quality and subsequent domain outcomes.

For the across-run comparison described in [learning-flywheel.md](./learning-flywheel.md), use repeated domain episodes with retained state and explicit objectives.
Compare actual learning and execution resources over the declared horizon.
Check retained abilities as well as newly solved tasks.
Only a claim about process transfer requires a corresponding comparison in new domains.

## 7. Evidence anchors

- `src/improvement/improve.ts`: profile and code improvement entry points.
- `src/improvement/method-execution.ts`: exact profiles executed through complete optimization methods.
- `src/runtime/strategy.ts` and `src/runtime/strategy-author.ts`: executable strategies and their authoring contract.
- `src/runtime/strategy-evolution.ts`: strategy search, retained candidates, and checkpoint identity.
- `src/runtime/observe.ts` and `src/runtime/personify/corpus.ts`: trace-derived recommendations and persistent records.
- `src/mcp/tools/coordination.ts`: agent-driven observation, delegation, and steering.
- `src/candidate-execution/`: execution of exact candidate combinations.
- `src/intelligence/improvement-cycle.ts`: measured proposals and adoption preparation.
- [Learning audit](./research/learning-system-audit-2026-09-05.md): cross-package source references, regression evidence, and research comparison.

The [earlier interpretation](https://github.com/tangle-network/agent-runtime/blob/a16d8a3b91481b140cb552e373d5bde98b34af05/docs/architecture-interpretations.md) records the original critique and its subsequent corrections.
Its experiment conclusions apply to their recorded tasks, versions, information, and resource conditions.
The current audit did not rerun those experiments.
Consult their original records in `.evolve/current.json` and `memory/` before using them to reject or repeat a mechanism.
