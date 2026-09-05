# Continual Domain Learning and Meta-Learning

This document describes the learning objective, not a claim that the complete process has been demonstrated.
[Architecture.md](./architecture.md) defines execution responsibilities and experiment scope.
The [learning audit](./research/learning-system-audit-2026-09-05.md) distinguishes implemented behavior, reproduced defects, and unmeasured capability.

A specialist, its domain learning process, and the method that constructs that process are all useful objects of improvement.
A specialist can remain specific to its domain.
The reusable knowledge can be how to build and run a successful learning process elsewhere.

| Object | What changes | Evidence of improvement |
| --- | --- | --- |
| Specialist | Its profile, code, tools, knowledge, memory use, or execution policy | Better results on fresh work within its intended domain |
| Domain learner | Problem selection, diagnosis, candidate construction, working evaluations, and retention decisions | Better specialists or domain outcomes across repeated learning episodes |
| Meta-learner | How domain learning processes are constructed and improved | Better learning processes on the domains and objectives covered by the claim |

Transfer of the specialist and transfer of its learning process are different claims.
Useful repeated learning within one domain requires neither.
Working evaluations can improve at each level, subject to independent assessment of their quality.

## The flywheel

A domain learner consumes an objective, execution tools, current specialists, prior experience, and resources.
It produces evaluated specialist candidates, working evaluations, experiment records, and updated learning state.
Its decisions include what to investigate, what to change, how to measure it, and what to retain.

The process becomes continuous when retained evidence changes a later decision or candidate.
Writing a record alone does not establish learning.
An outer evaluation must execute the produced specialist and its exact retained state.
Scoring the learner's explanation of that specialist tests a different outcome.

Retained information is useful when its use improves later work.
Record what was retrieved, how it was used, and the subsequent result.
A useful change can require memory and planning changes together.
Preserve informative failures and alternative candidates even when they do not qualify for immediate adoption.

## The lifting generalization: recursive self-improvement

One description of a learning loop is `L = (π, τ, J, D, O)`:

| Term | Meaning |
| --- | --- |
| `π` | The executable object being improved |
| `τ` | Its behavior and execution record |
| `J` | Independent assessment for the current improvement claim |
| `D` | Retained experience and candidate lineage |
| `O` | The procedure that uses experience to propose and select changed objects |

The procedure `O` can itself become the object `π` of another experiment.
Its result is then judged through the specialists or learning processes it produces.
Working evaluations can be part of that changeable procedure.
An independent assessment remains outside the adaptive decisions it tests.

This recursion describes a possible composition, not evidence of recursive improvement.
Three obligations remain at every level:

1. Execute the exact candidate and retain its state and outcome records.
2. Include all inner work, incomplete episodes, and unmeasured costs in the outer account.
3. Assess the claimed outcome independently of the search decisions that selected the candidate.

A fixed final score can still be an inadequate proxy for the domain objective.
Validate its coverage and failure detection; independence alone does not establish validity.
Storage can remain domain-specific while experiments share identity and evidence contracts.
A single physical store or one search algorithm is not required.

## Evaluation engineering is part of learning

A learner can generate cases, construct judging instructions, create executable checks, and change its practice distribution.
Those working evaluations can guide its next intervention.
An improved evaluation can expose more failures and lower the current specialist's score.
Its value depends on detection quality and subsequent domain learning, not an easier score for the current specialist.

Use independent outcomes, controlled defects, new failure cases, and external assessment to test evaluation changes.
Calibration statistics analyze observations supplied by a caller.
They do not execute judges, collect domain outcomes, or train a specialist by themselves.
Disagreement and score variance can identify questions to investigate without proving which practice will improve the agent.

Cases used to construct evaluations or choose learning policies become development evidence for those decisions.
Keep final assessment separate at the level whose improvement is claimed.
Fresh tasks within a domain can assess a specialist or domain learner.
A claim about process transfer requires an appropriate comparison in new domains.

## Across-run evidence

The across-run comparison, also called Gate B, tests learning over a declared sequence or horizon.
Compare active learning with an appropriate frozen or reference process under the same objectives and recorded resource conditions.
Evaluate repeated episodes from explicit initial states.
Useful exploration need not improve every intermediate version.

Gate A tests the narrower question of steering within one task.
Passing that test is not a prerequisite for every form of domain learning.
Use [architecture.md §9](./architecture.md#9-build-order-and-experiment-scope) to choose the comparison and conditions for rejecting the tested mechanism.

| Dimension | Observation |
| --- | --- |
| Domain outcome | Checked task results, failures, and uncertainty |
| Resources | Learning, execution, evaluation development, retrieval, checking, and retained-state costs |
| Retention | Earlier abilities after updates |
| Learning decisions | Prior evidence that changed an experiment, candidate, or procedure |
| Evaluation quality | Independently checked detection, ranking, coverage, and downstream learning |
| Transfer, when claimed | Reconstruction of useful learning in unfamiliar domains |
| Adoption | The exact version measured and the exact version used later |

Compare combinations when the claimed benefit depends on interacting components.
Remove components to identify their contributions after proving the complete mechanism executes.
A null result needs adequate measurement sensitivity and observed mechanism activation before it can reject the tested explanation.

## Candidate input must name its source

Every finding used to generate a candidate is a `ProposalFinding`.
`proposal_origin: 'production'` means the finding came from observed production behavior.
`proposal_origin: 'search'` means it came from development work during candidate search.
Runtime validates caller-supplied findings and never guesses their origin.
Runtime labels only the production analysis it runs itself.
Final evaluation results have no allowed proposal origin and never feed candidate generation.

`derived_from_judge` remains descriptive metadata.
Search-time judge feedback is valid when it is explicitly marked `proposal_origin: 'search'`.
The final judge result remains isolated from search.
A separate final-test partition is required because source labels alone cannot prevent overfitting.

## Where the pieces live

| Concern | Existing implementation | Composition boundary |
| --- | --- | --- |
| Agent-driven work | `Scope`, `Supervisor`, and `createCoordinationTools` | A supplied profile owns working decisions and recursive authority |
| Profile and code improvement | Runtime `improve()` and Eval complete methods or native proposer search | The caller supplies domain execution and objectives |
| Executable strategy search | `defineStrategy`, `authorStrategy`, and `runStrategyEvolution` | Programs and their archive remain explicit; this is not a complete domain learner by itself |
| Observation and retention | `observe`, `Corpus`, and Knowledge state and retrieval | The caller must connect retained evidence to later decisions and measured outcomes |
| Evaluation engineering | Eval judges, scenario search, calibration, and known-failure checks | Executing a utility does not establish the quality of the resulting evaluation or learning process |
| Exact measurement and adoption | Runtime candidate experiments, proposals, and activation | Search output must remain bound to the exact version measured and adopted |

The [learning audit](./research/learning-system-audit-2026-09-05.md) gives precise source references and the missing connections.
Use those existing components before adding an orchestration facade.

## Historical evidence

The [earlier version](https://github.com/tangle-network/agent-runtime/blob/a16d8a3b91481b140cb552e373d5bde98b34af05/docs/learning-flywheel.md) records earlier steering, prompt-search, and context-reuse results.
The [optimization portfolio](./research/optimization-space.md) and [accretion experiment](./research/leapfrog-program.md) provide additional experiment context.
Read dated records and subsequent corrections before repeating or rejecting a mechanism.

Those comparisons apply to their recorded tasks, versions, information, and resources.
A null prompt search does not eliminate all prompt changes.
A negative context treatment does not eliminate all memory policies.
A within-task result does not decide whether specialists, evaluations, or learning procedures improve across repeated domain work.
