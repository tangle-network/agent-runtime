> **Track:** Reference | **Role:** process guardrail | **Status:** canonical

# Anti-Patterns

These are repo-level failure modes that have already cost time or produced
misleading confidence. If a proposal repeats one, stop and ask what proof would
make the work legitimate.

## Mechanism Without A Decisive Test

Build the smallest complete path that can exercise the claimed mechanism before scaling the implementation or experiment.
Use [architecture.md §9](./architecture.md#9-build-order-and-experiment-scope) to define the comparison and the conditions for rejecting it.
A single-run steering result does not decide whether learning across projects works.
Test necessary combinations together, then remove components to identify their contribution.

## Facade Before Substrate Join

A developer-friendly loop/protocol/API is not justified until a tiny executable
proof shows the real path it claims to simplify:

```txt
existing substrate primitive -> real worker -> real trace/state -> verifier/observer -> corrective action
```

If most of the API retypes `Scope`, MCP tools, journals, validators, or git,
delete it and document the missing join instead.

Current local proof:

```bash
pnpm exec tsx bench/src/cloud-loop.mts
```

Remaining external proof: the same shape with `openSandboxRun` workers and a
remote branch a sandbox can clone and push.

## Relocated Protocol Masquerading As Simplification

Deleting a facade is not enough if the same grammar reappears one layer lower.
Question, analyst, message, packet, trace, or coordination surfaces need the
same proof burden wherever they live: an executable run over live
`Scope`/MCP/journal/workspace paths, not mocks proving the grammar can talk to
itself.

## Re-Running Settled Measurements

Do not re-open a settled experiment because it is emotionally attractive. Read
`.evolve/current.json`, `memory/`, and the dated controlled-result notes before
launching a new run. A new experiment must name the changed axis and why the old
result no longer answers it.

## Confounded Causal Claims

Never claim a topology, prompt, planner, or steering strategy helped when the
treatment received more compute or better infrastructure than control.

Minimum report:

- same tasks
- same budget/equal k
- infra errors excluded and counted separately
- discordant pairs reported
- deterministic or execution-grounded oracle preferred
- threats to validity stated in the artifact

## Silent Success

Do not fake completion by returning defaults, empty arrays, best-effort outputs,
or swallowed errors. External-boundary calls return typed outcomes; inspect
`succeeded` before `value`. A verifier, package check, deployment, or benchmark
worked only after the artifact itself was checked.

## Overclaim

"Validates the concept" is not "validates the product." Route through the real
kernel before claiming product proof. Underpowered directional splits are not
wins. Mocked analyst/model seams are acceptable for local plumbing tests, but
the report must say what remains unproven.
