---
name: graph-designer
description: Choose, design, replay, and improve agent workflows from task outcomes and execution evidence.
---

# Graph Designer

Choose the smallest adequate execution for the user's task. Direct execution can be the
baseline or the whole solution when coordination adds no value. Use dynamic supervision
when the useful roles must be discovered; use a graph when its explicit dependencies,
branches, checks or replayable structure help. Respect the role you were commissioned to
perform: a request for a graph file calls for that file, while a request for a finished task
does not require inventing a graph. Run only within granted authority and retain what happened.

Apply `be-ambitious` to sharpen the methods and outside check while keeping the user's goal and acceptance fixed.
Apply `agent-graphs` for the executable graph contract; keep these capabilities as separate profile skill resources.
For a file consumer, deliver one canonical YAML or JSON graph, qualify it through the existing dry-run path, and use that same file for the authorized real run.
Runtime owns loading and content addressing; Bridge owns native execution and seat inventory.
One Sandbox hosts the graph's Bridge sessions, including parallel nodes; placement belongs to the caller rather than the topology.
Read the current API and CLI help for supported behavior; explicitly retain an unsupported requirement instead of claiming a future vertex or expression works.

Production designs: search [Factory’s design catalog](https://github.com/tangle-network/factory/blob/main/README.md) before authoring; record a delivered Factory run through `recordGraphRun` like any graph.

## The loop (when a graph is useful)

1. Compute the task shape: the durable description you will look this kind of work up by
   (kind, source, constraints — stable fields, not the payload itself). Hash it.
2. `lookupGraph(registry, taskDigest)` over YOUR WORKSPACE's registry:
   - **replay** → run the stored graph verbatim. Re-bind the deliverable's check from the
     environment: functions stay environment-owned, while supported data check definitions remain part of the stored graph. Record the run.
     Replay avoids design inference; the graph's own agent execution still consumes its admitted resources.
   - **author** (with the stated reason) → design per the `agent-graphs` skill, run it,
     record it. If a prior graph failed to deliver for this shape, mutate deliberately
     (budget, directives as new prompt-registry versions, model mix, an added analyst),
     never blindly: name what the prior record says went wrong.
3. Record EVERY run: `recordGraphRun` with the terminal accounting. The registry is the
   compounding asset — a run you don't record is knowledge you burn.

## Where the registry lives

The registry is files in your workspace (`graph-registry/records.jsonl` + content-addressed
graphs). In a sandbox, snapshots carry it: a rerun over the same sandbox finds every graph
ever run. Do not store the deliverable's check function — the environment re-binds it.

## Improving, honestly

Use a known delivered graph when its task and execution conditions still fit.
Treat `pickBestGraph` as an observational lookup: delivered first, then cheaper, then recent.
Read the failure and accounting evidence before choosing a change; exhaustion alone does not
identify whether scope, allocation, instructions or topology caused the failure.
Retain each deliberate mutation as a new graph revision with its reason and predecessor.
Change one axis when that isolates the question, or test necessary combinations together.
A reasoned mutation is an exploratory candidate; a later independent comparison establishes benefit.

To improve graph-authoring guidance, use Runtime's existing `improve` API with the exact
inline skill and a complete Eval method such as `officialSkillOpt`; follow
[the measurement contract](../agent-graphs/references/measurement.md).
Select `skills.resourceName: 'graph-designer'` to improve this design procedure, or
`'agent-graphs'` to improve the executable authoring guidance; keep the other skill fixed.
The measured output is a graph executed on its task, with its actual outcome and resource use.
Optimizing a graph's authoring skill, changing a particular graph, and improving the procedure
that chooses experiments are separate interventions with separate evidence requirements.
Keep final assessment independent at the level whose improvement is claimed.

Retain useful cases with the run's identity, measured outcome and limitations in the consuming
lab's research records. A descriptive registry ranking is not a promotion decision.

## Profiles improve the same way graphs do

A worker profile is named and content-addressed; when a mutation rewrites a node's
prompt, record the run in the profile registry too (`recordProfileRun`).
`bestProfileFor` retrieves an observed delivered revision using the same cost and recency
heuristic. Immutable versions preserve the exact diff; they do not make different runs a
controlled experiment. Use the measured improvement and explicit activation paths when
claiming a better default. A new revision affects a later execution that selects it;
it does not replace a running graph's admitted profiles.

## Then consider

- `agent-graphs` for the authoring contract (roles, edges, deliverable, budget).
- `codemode` when a node's work is mechanical composition — `model.metadata.codeMode`.
- The run's own ledger (`GraphResult.ledger`, the journal) as the evidence for every decision above.
