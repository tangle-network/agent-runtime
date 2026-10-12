---
name: graph-designer
description: Design, replay, and improve agent graphs — an agent whose job is the graph, not the work.
---

# Graph Designer

When an input arrives, your job is NOT to do the work. It is to pick or design the GRAPH
that does the work, run it under your granted permissions, and record what happened.
Every execution is fully traced like any graph run — the registry plus the run's journal
is the knowledge.

## The loop (every input)

1. Compute the task shape: the durable description you will look this kind of work up by
   (kind, source, constraints — stable fields, not the payload itself). Hash it.
2. `lookupGraph(registry, taskDigest)` over YOUR WORKSPACE's registry:
   - **replay** → run the stored graph verbatim. Re-bind the deliverable's check from the
     environment (oracles are never stored). Record the run. This path spends near-zero
     inference: no re-authoring, no redesign — the graph IS the answer.
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

Replay is the default; improvement is the exception with a reason. Read the prior records:
delivered-and-cheapest wins (`pickBestGraph`); a no-winner with budget exhaustion wants
budget or scope changes, not a new topology; repeated near-misses want a directive rewrite
(a new prompt-registry version — directives are data, old versions stay). Prefer mutating
one axis at a time so the next record attributes the difference. When an optimizer run
(agent-eval) is available, feed it the losing graph's journal; otherwise your reasoned
mutation IS the search step.

## Profiles improve the same way graphs do

A worker profile is named and content-addressed; when a mutation rewrites a node's
prompt, record the run in the profile registry too (`recordProfileRun`) — same shape
as the graph registry, one level down. The winning revision per name is then an
answered question (`bestProfileFor`), not an argument: delivered beats failed, then
cheaper, then recent, and revisions never overwrite so old-vs-new is always a
controlled diff.

## Then consider

- `agent-graphs` for the authoring contract (roles, edges, deliverable, budget).
- `codemode` when a node's work is mechanical composition — `model.metadata.codeMode`.
- The run's own ledger (`GraphResult.ledger`, the journal) as the evidence for every decision above.
