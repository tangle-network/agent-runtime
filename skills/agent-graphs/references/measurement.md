# Measuring changes to graph-authoring guidance

The [case files](../cases) and [generation records](../generations) preserve previous experiments.
Read their recorded limitations before reuse; historical scores do not describe the current skill or API.
The generation records include an invalidated result and its reasons.

Use the current Runtime improvement API and a complete Eval method.
For the shared search and activation constraints, read [improvement and activation](../../build-with-agent-runtime/references/improvement.md).
Deliver the exact candidate skill resource to the authoring agent and retain its identity in the run evidence.

Check authored graph behavior through the actual graph implementation.
A case should distinguish the required relationship and reject a plausible wrong graph, not reward preferred words or unnecessary graph complexity.
Keep cases used to revise the skill separate from final decision cases.
If a reference is conditionally required by the skill, make it reachable in the measured resource package and inspect whether it was read.

Use real execution evidence when claiming improvement on a real backend.
Offline graph execution tests structure only; it cannot establish agent quality, deployed reliability, or paid execution cost.
Keep invalidated results as evidence without promoting their conclusions.
