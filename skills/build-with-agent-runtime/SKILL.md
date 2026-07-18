---
name: build-with-agent-runtime
description: Use before adding an agent loop, benchmark, optimizer, trace wrapper, or candidate activation path. Find and compose the existing Runtime, Eval, Knowledge, and Interface primitives.
---

# Build with agent-runtime

Use this skill before writing product-local agent infrastructure.
The goal is one portable agent definition, one execution path, one measurement system, and one reviewed activation path.

## Read first

1. Read `docs/canonical-api.md` for the current decision table.
2. Check exports in `src/index.ts`, `src/runtime/index.ts`, `src/improvement/index.ts`, `src/intelligence/index.ts`, and `src/knowledge/index.ts`.
3. Read the nearest runnable example.
4. Treat source as authoritative when docs disagree, then correct the stale doc in the same change.

## Ownership

| Concern | Owner |
|---|---|
| Portable prompt, skills, tools, MCP, hooks, subagents, model hints | `AgentProfile` from `@tangle-network/agent-interface` |
| Agent execution, supervision, budgets, streaming, candidate execution | `@tangle-network/agent-runtime` |
| Tasks, graders, search, paired statistics, cost and latency comparison | `@tangle-network/agent-eval` |
| Sources, retrieval, citations, freshness, memory adapters, knowledge promotion | `@tangle-network/agent-knowledge` |
| Product records, permissions, funding, UI, and atomic storage writes | The consuming product |

Do not move shared measurement into Runtime or product code.
Do not move product storage transactions into a provider-neutral package.

## Choose the entry point

| Need | Use |
|---|---|
| One product chat turn | `handleChatTurn(...)` |
| One normalized streamed agent turn | `streamAgentTurn(...)` and `collectAgentTurn(...)` |
| One task or multi-turn loop | `runAgentTask(...)`, `runAgentTaskStream(...)`, or `runLoop(...)` |
| Supervisor and workers | `supervise(...)` or `superviseSurface(...)` |
| Parallel work with a shared budget | `fanout(...)` |
| Fixed composition | `pipeline(...)`, `panel(...)`, or `verify(...)` |
| Product benchmark | `defineLeaderboard(...)` |
| Profile matrix | `expandProfileAxes(...)` and `runProfileMatrix(...)` from agent-eval |
| Search one agent surface | `improve(...)` |
| Analyze traces through a measured proposal | `proposeAgentImprovement(...)` |
| Review and authorize an exact proposal | `reviewAgentImprovementProposal(...)` and `createAgentImprovementActivation(...)` |
| Apply or restore an approved candidate | `executeAgentImprovementActivation(...)` with a product transaction |
| Build a knowledge candidate | `runKnowledgeImprovementJob(...)` |
| Apply a knowledge candidate | `createKnowledgeImprovementActivationExecutor(...)` through the same activation path |
| Observe and pull approved changes on a live agent | `withIntelligence(...)` |

## Improvement flow

`improve(profile, findings, options)` searches one surface and returns a detached winner.
It never changes a profile, document, repository, memory store, or knowledge base.

Supported profile surfaces are prompt, one named inline skill, tools, MCP, hooks, subagents, whole profile, and curated memory in `profile.resources.instructions`.
Code uses isolated worktrees and returns a sealed patch candidate.
Knowledge uses `runKnowledgeImprovementJob(...)` and returns paired snapshots.

Use `proposeAgentImprovement(...)` for a production proposal.
It performs these steps in order:

1. Analyze completed traces.
2. Search for a candidate on development tasks.
3. Freeze the baseline and winner into one exact experiment.
4. Reject the experiment if its candidate differs from the search winner.
5. Run baseline and candidate on the same held-back tasks.
6. Produce findings, confidence intervals, quality, cost, latency, and a decision.

After a person or tenant policy approves the proposal, call `createAgentImprovementActivation(...)` with target identities, funding owner, authority, intent, and expiry.
Runtime derives the expected current digests from the measured experiment.
Call `executeAgentImprovementActivation(...)` with one product-owned transaction that compares current state, writes every target atomically, and stores the result under the activation digest.
Pass a read-only reconciliation function so retries can distinguish committed, uncommitted, and uncertain outcomes.

Never apply a change from analyst confidence alone.
Never measure one candidate and apply another.
Never let search code write live state.
Never treat a lost response as a failed write without reconciling it.

## Surface rules

- Prompt changes `profile.prompt` only.
- Skill optimization selects one inline skill by `skills.resourceName`; profile resources must fail closed.
- Curated memory changes `profile.resources.instructions`; retrieval stores and memory databases belong in the knowledge flow.
- Tools, MCP, hooks, subagents, and whole-profile changes require an explicit proposer because Runtime cannot invent domain capabilities safely.
- Code candidates must come from the Runtime worktree path so patch identity and cleanup stay intact.
- Workflow and policy files are code surfaces; parameter sweeps come from agent-eval.
- Knowledge candidates remain detached until the shared activation path applies or restores their frozen snapshots.

## Product integration

The product supplies only the pieces that vary by deployment:

- How traces and current profiles are loaded.
- How exact candidate execution is placed on compute.
- How proposal, review, activation, and result records are persisted.
- How a target is changed atomically.
- Who may approve, reject, request changes, fund, apply, or restore.
- How those records and actions appear in the UI or API.

The product must not recreate candidate hashing, paired comparison, confidence intervals, review binding, expiry, retry identity, or result validation.

## Do not duplicate

- Do not write a provider-specific profile wrapper; extend `AgentProfile` and its materializer.
- Do not write a second optimizer loop; compose Eval proposers through `improve(...)`.
- Do not write a second candidate catalog; persist the immutable proposal records.
- Do not let an analyst or adapter commit, push, open a pull request, or edit a live store.
- Do not hand-roll SSE parsing, usage totals, profile matrices, bootstrap statistics, sandbox acquisition, or worktree cleanup.
- Do not add a product-local approval format for knowledge, code, or profile changes.

## Finish

- The same agent definition runs in product and measurement paths.
- The held-back tasks were not visible during search.
- Candidate identity is checked before execution and again before activation.
- Quality, cost, latency, sample count, and uncertainty are retained.
- Rejection and request-changes are first-class outcomes.
- Activation is authorized, expiring, idempotent, and reconcilable.
- No customer write, message, trigger, or billing occurs in read-only proof mode.
- Public examples, package exports, generated API docs, type checks, tests, build, and package verification pass.

## Then consider

- Use `critical-audit` when the change introduces or alters a public contract.
- Use `verify` before publishing or adopting the package in a product.
