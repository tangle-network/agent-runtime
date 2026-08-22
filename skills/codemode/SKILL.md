---
name: codemode
description: Batch mechanical tool work as one program so loops and intermediates stay out of context.
---

# Codemode

Use this policy when a task needs three or more mechanical tool or command calls whose intermediate results need no judgment.
One call per model turn spends a round trip per step and pushes every intermediate value through the context window.
Write one program instead: the loop, the branch, and the intermediates stay in the program, and only the decision-relevant summary returns.

This is the pattern the ecosystem calls code mode (Cloudflare's Code Mode, Anthropic's code execution with MCP, the CodeAct paper).
In a coding harness you already have the whole capability: a shell, a filesystem, and the tools this profile grants.

## Run The Work

1. List the calls the task needs and mark which results require your judgment.
2. Put every judgment-free stretch into one script; keep each judgment point in your own turn.
3. Hold intermediates in variables or files inside the workspace, never in your reply.
4. Make the script print only the decision-relevant summary: counts, failures, the final value.
5. Prefer one script that fans out over N items to N separate tool calls with identical shape.
6. Stop batching the moment a result changes what you would do next; read it, decide, then batch again.

## Boundaries That Are Not Yours To Move

Spawning, steering, and settling agents go through your coordination tools, never through a script.
A script that reaches those verbs over HTTP bypasses the budget pool and the journal, so the run's spend and record lie.
An operation that costs money must run where the runtime meters it; do not wrap metered work in a script that hides the spend.
The lint on authored code refuses imports, `process`, and network access; it is a lint, not a sandbox, so treat generated code you did not review as untrusted.

## Router-Brained Agents

A raw chat model has no shell, so this policy does not apply to it directly.
Give such a node a code action space with the graph engine's `codemode` kind: an `operations` table projects the API the model sees, a host `codeRunner` executes, and each operation's spend reaches the settlement.
A supervisor that only needs one small computation can carry an `extraTools` entry instead of a codemode node.

## Common Mistakes

- Batching a step whose output should have changed your plan, then discovering it three steps later.
- Printing a whole dataset into the reply instead of writing it to a file and printing the summary.
- Re-running an expensive script to re-read a value the first run already produced; write results to files.
- Moving supervision into a script because the coordination verbs are reachable over local HTTP.

## Then consider

- `supervise` when the batched work is really delegation to workers with their own judgment.
- `agent-graphs` when the shape of the work is a fixed topology rather than one agent's loop.
- `loop-writer` when no shipped composition API can express the control policy you need.
