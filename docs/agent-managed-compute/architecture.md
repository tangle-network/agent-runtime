# Converged Architecture

## One-Sentence Model

An agent runs under one durable logical run, starts children through one budgeted `Scope`, and places each child on an external compute provider through the existing `Executor` and `AgentEnvironmentProvider` contracts.

## Ownership

| Package | Owns | Does not own |
|---|---|---|
| `agent-interface` | `AgentProfile`, environment provider contracts, portable event and session identifiers | Scheduling policy, provider implementation, benchmark logic |
| `agent-runtime` | Agent tree, run state, budgets, interaction policies, recovery, coordination tools | Machine placement, model hosting, domain knowledge policy |
| Provider packages | Environments, sessions, process lifecycle, placement, reconnect, provider usage | Agent planning and result acceptance |
| `agent-eval` | Run records, metrics, comparisons, held-out promotion decisions | Agent execution and compute allocation |
| `agent-bench` | Reusable workloads and benchmark suites | Runtime internals |
| `agent-knowledge` | Knowledge sources, indexes, memory, retrieval, claims, and knowledge improvement | Agent execution and distributed compute |

The dependency direction remains:

```text
agent-interface
  -> agent-eval
  -> agent-knowledge
  -> agent-runtime

agent-bench consumes the published packages.
provider packages implement agent-interface contracts.
```

`agent-knowledge` remains usable without `agent-runtime`.

`agent-runtime` may compose knowledge operations into an agent run.

## The Durable Core

The existing types remain the center:

| Primitive | Meaning |
|---|---|
| `AgentProfile` | What an agent knows, can use, and is instructed to do |
| `Agent` | Code that acts inside a `Scope` |
| `Scope` | Spawn, wait, steer, inspect, meter, and cancel children |
| `Supervisor` | Owns one logical run and its shared limits |
| `Executor` | Runs one child invocation |
| `AgentEnvironmentProvider` | Creates and reconnects to physical execution environments |
| `SpawnJournal` | Durable ordered decisions and spend for the logical run |
| `ResultBlobStore` | Immutable outputs addressed by content hash |

The implementation should evolve these primitives rather than introduce a second coordinator.

## Logical And Physical State

The runtime owns logical state:

- run identity and status,
- parent and child relationships,
- command identity,
- budget reservation and actual spend,
- accepted outputs,
- questions and steering actions,
- provider environment and session references,
- recovery position.

The provider owns physical state:

- machine and container placement,
- process health,
- session continuation,
- event replay from a provider cursor,
- checkpoint and fork support,
- physical cancellation,
- resource usage reported by the provider.

The runtime must store a provider reference before considering dispatch committed.

The provider must accept an idempotency key derived from the logical invocation.

## One Active Coordinator Per Run

Many workers may run in parallel.

Only one coordinator may commit decisions for a given run at a time.

The coordinator service scales horizontally across runs.

Different replicas own different runs, and ownership moves when a replica fails.

Within one run, decision commits are serialized while worker execution remains distributed.

A durable ownership claim includes a monotonically increasing generation number.

Every append and command carries that generation.

When ownership expires, the next coordinator acquires a higher generation and older coordinators can no longer commit.

Provider-mutating commands also carry the generation and a per-invocation command sequence.

A provider adapter must reject stale generations itself or send commands through a session broker that does.

This prevents two restarted processes from steering or accepting the same work concurrently.

Use a transactional database, Redis, Durable Objects, or another store with conditional writes.

Do not implement distributed consensus in this package.

## Interaction Policies

The same run can support different policies without creating different execution systems.

| Policy | Behavior | Current entry point |
|---|---|---|
| Dynamic driver | A model decides which child to start, steer, replace, or stop | `supervise` and coordination MCP |
| Alternating actors | Two actors take turns over shared state | `runConversation` |
| Round robin | N actors take turns in a fixed schedule | `runConversation` |
| Refine until accepted | One or more workers improve an artifact across rounds | `runAgentic` |
| Fixed fanout or pipeline | A declared interaction shape runs over a `Supervisor` | `runPersonified` |
| Sandbox batch | A driver plans a batch of isolated sandbox attempts | `runAgentRounds` |

The target public API is:

```ts
runAgent(profile, task, options)

runInteraction({
  actors,
  policy,
  task,
  budget,
  store,
})

improve(profile, {
  method,
  trainScenarios,
  selectionScenarios,
  testScenarios,
  judges,
  agent,
})
```

`runAgent` is the common path for one root profile that may dynamically delegate.

`runInteraction` is the explicit multi-actor path.

`runConversation` becomes an alternating or round-robin policy preset.

`runAgentic` and `runPersonified` become policy helpers or compatibility wrappers.

`runAgentRounds` becomes an internal sandbox batch implementation.

The cleanup must preserve behavior before removing old exports.

## MCP Roles

There are two valid agent-facing tool sets.

### Coordination tools

Coordination tools act inside one live run:

- `spawn_worker`
- `observe_agent`
- `steer_agent`
- `await_event`
- `ask_parent`
- `answer_question`
- `stop`

These tools map directly to durable run commands and `Scope` operations.

They do not own state.

### One-shot delegation

The generic `delegate` tool asks a supervisor to solve one intent and returns the accepted output and spend.

It is a convenience operation over `runAgent`.

Its status and history endpoints should read the same run store rather than maintain a separate task state machine.

## Multi-Round Two-Agent Atom

The minimum complete interaction is a driver and one worker:

1. The driver starts the worker with a profile, task, budget, and stable invocation id.
2. The provider returns an environment and session reference.
3. The runtime records that reference.
4. The worker emits progress and usage with stable event ids.
5. The driver sends a correction using a stable command id.
6. The worker continues the same session when the provider supports continuation.
7. An independent check accepts or rejects the output.
8. The runtime records one terminal result and reconciles spend.
9. A coordinator restart at any step reconnects without starting duplicate work.

Every larger agent tree is recursive composition of this atom.

## Workspaces

Parallel agents must not write blindly into one mutable checkout.

The default coding model is:

1. create an isolated worktree or provider workspace per invocation,
2. produce an immutable patch or commit,
3. run deterministic checks in that workspace,
4. accept the result only after the checks pass,
5. integrate through one designated owner,
6. record conflicts as explicit work, not silent overwrites.

A shared writable filesystem is an opt-in provider capability for workloads that require it.

## Knowledge

Knowledge is a work product and an agent capability, not coordinator state.

A run may:

- research from zero knowledge,
- ingest new sources,
- maintain an LLM wiki,
- update a retrieval index,
- write memory from traces,
- evaluate retrieval and answer quality,
- improve a knowledge base across repeated runs.

The profile decides which knowledge tools and policies the agent receives.

`agent-knowledge` supplies the pure operations and storage adapters.

`agent-runtime` supplies the dynamic agents, compute, recovery, and budgets that call those operations.

## PrimeIntellect

PrimeIntellect integration packages runtime tasks, scoring, and traces for training and evaluation.

It is not automatically a live compute provider.

If Prime exposes the environment lifecycle required by `AgentEnvironmentProvider`, a separate provider adapter may implement it.

The training and evaluation adapter should not be confused with runtime placement.
