# Measuring changes to graph-authoring guidance

The [case files](../cases) and [generation records](../generations) preserve previous experiments.
Read their recorded limitations before reuse; historical scores do not describe the current skill or API.
The generation records include an invalidated result and its reasons.

Use the current Runtime improvement API and a complete Eval method.
For the shared search and activation constraints, read [improvement and activation](../../build-with-agent-runtime/references/improvement.md).
Optimize the graph-authoring skill through `improve(profile, { surface: 'skills', skills: { resourceName: 'agent-graphs' }, ... })`
with `officialSkillOpt(...)` when SkillOpt is the selected method. It uses the official upstream trainer through Eval's Python bridge.
Keep the designer's other skills, profile, execution backend, task budget and scoring contract fixed.
Deliver the exact candidate skill resource to the authoring agent through the normal profile materializer and retain its identity in the run evidence.
Keep referenced authoring instructions reachable and versioned with the execution identity; changing those instructions changes the measured agent too.

Check authored graph behavior through the actual graph implementation.
A case should distinguish the required relationship and reject a plausible wrong graph, not reward preferred words or unnecessary graph complexity.
Load the authored file with `loadGraphFile`, bind the environment-owned acceptance check, and execute that graph with `runGraph`.
Retain refused graphs, failed runs, terminal artifacts and edge evidence. A runnable graph can still fail the task.
Keep development cases, candidate-selection cases and final decision cases separate.
Pass the three partitions to `improve`; do not expose final cases or their results to SkillOpt, the authoring workspace, or a later adaptive search.
Only the current task reaches its measured author; do not mount the campaign's other cases, expected outputs or results beside it.
Calibrate the check with successful and plausible failing executions before spending on optimization.
Use a new independent final assessment after learning from a previous final result.

Use real execution evidence when claiming improvement on a real backend.
Offline graph execution tests structure only; it cannot establish agent quality, deployed reliability, or paid execution cost.
Account for optimizer calls, graph authoring, every graph node, rejected attempts and judging through the existing cost receipts.
Retain unknown usage and costs as unknown. A small or incomplete comparison can return a useful candidate while remaining a hold.
Keep the selected candidate detached until the existing review and activation path authorizes its exact revision.
Registry lookup selects from observed runs; it does not replace this independent comparison or make an activation decision.
Keep invalidated results as evidence without promoting their conclusions.
