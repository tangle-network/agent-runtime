---
name: build-with-agent-runtime
description: Choose maintained runtime APIs and compose execution, evaluation, and controlled improvement.
---

# Build with Agent Runtime

An excellent integration runs the product's agent through one maintained path in production and in its evaluation, and that evaluation shows it beating the best known result for the task at a cost the product records.

## Set the bar

Before choosing an entrypoint, [set the bar](https://github.com/drewstone/dotfiles/blob/main/claude/skills/be-ambitious/SKILL.md#set-the-bar): the best known result for the product's task class with its source (a public benchmark row, a rival product's measured number, a published method) beside our number, the product's task success, cost per accepted result and latency on its real path.
Target a number that beats it through a change of composition (one turn becoming a graph or supervision, an independent checker, measured improvement of prompts, skills, code or knowledge), not more effort on the current one, and name the outside check: Eval cases hidden from the work, run through the product's own agent definition and execution path.
The integration is finished when that check shows the target met on the real backend or the measured gap and its cause explain the miss; passing repository checks is necessary, not sufficient.

## Choose by the required outcome

Read the current [API decision table](https://github.com/tangle-network/agent-runtime/blob/main/docs/canonical-api.md) and [package exports](https://github.com/tangle-network/agent-runtime/blob/main/package.json), follow the chosen entrypoint to its implementation and nearest runnable example, and for an existing consumer confirm the installed package supports that contract.
Use the existing entrypoint for one turn, a bounded task, fixed composition, dynamic supervision or a measured improvement; product code imports it rather than copying the API catalog or wrapping it under a new name.

| Concern | Owner |
|---|---|
| Portable prompt, skills, tools, MCP, hooks, and model hints | AgentProfile from agent-interface |
| Execution, supervision, budgets, streaming, and candidate execution | Agent-runtime |
| Cases, grading, search, statistics, and comparison | Agent-eval |
| Retrieval, citations, freshness, memory stores, and knowledge promotion | Agent-knowledge |
| Users, permissions, funding, UI, persistence, and atomic writes | The product |

## Integrate the selected capability

Search for the existing product adapter and current package usage before adding infrastructure.
The consumer supplies its policy, storage, credential and execution-placement boundaries, and Runtime the rest.
Preserve explicit failures, cost and usage capture, cancellation, and recovery behavior.
When the target needs prompts, skills, code or knowledge to change through measured search, read [improvement and activation](references/improvement.md) before implementing that path.

## Prove the integration against the bar

Run real tasks through the selected backend and the outside check, and compare result, cost and latency with the bar; an in-process test proves only its own path, not a deployed sandbox path.
Test the changed contract's denial, failure, cancellation or recovery cases as applicable, and run the repository's required checks, public-import checks when exports change, and the consumer's affected flow.
Report the bar, before and after against it, retained product adapters, adopted exports, and unchecked boundaries.

## Then consider

- `build-with-agent-knowledge` when the remaining work concerns retrieval or memory integration.
- `evolve` when the target is a measured quantity to climb across runs.
- `critical-audit` when a changed public contract needs independent review.
- `verify` when the integration meets the target and release checks remain.
