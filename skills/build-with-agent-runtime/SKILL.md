---
name: build-with-agent-runtime
description: Choose maintained runtime APIs and compose execution, evaluation, and controlled improvement.
---

# Build with Agent Runtime

Build on the maintained execution path while keeping product policy and storage in the consumer.
Read the current [API decision table](https://github.com/tangle-network/agent-runtime/blob/main/docs/canonical-api.md) and [package exports](https://github.com/tangle-network/agent-runtime/blob/main/package.json).
Follow the chosen entrypoint to its implementation and nearest runnable example.
For an existing consumer, confirm the actual installed package supports the chosen contract.

## Choose by the required outcome

Use the existing entrypoint for one turn, a bounded task, fixed composition, dynamic supervision, or a measured improvement.
Avoid copying the API catalog into product code or creating a wrapper that only renames it.

| Concern | Owner |
|---|---|
| Portable prompt, skills, tools, MCP, hooks, and model hints | AgentProfile from agent-interface |
| Execution, supervision, budgets, streaming, and candidate execution | Agent-runtime |
| Cases, grading, search, statistics, and comparison | Agent-eval |
| Retrieval, citations, freshness, memory stores, and knowledge promotion | Agent-knowledge |
| Users, permissions, funding, UI, persistence, and atomic writes | The product |

Keep measurement in Eval and product storage transactions in the consumer.
Use the same agent definition and execution path in the product and its evaluation.

## Integrate the selected capability

Search for the existing product adapter and current package usage before adding infrastructure.
Supply only the policy, storage, credential, and execution-placement boundaries the consumer needs.
Preserve explicit failures, cost and usage capture, cancellation, and recovery behavior.

When changing prompts, skills, code, or knowledge through measured search, read [improvement and activation](references/improvement.md) before implementing that path.
Ordinary execution work does not need an optimizer or activation workflow.

## Prove the integration

Run a real task through the selected backend and inspect its result and execution evidence.
Test the changed contract's denial, failure, cancellation, or recovery cases as applicable.
An in-process test proves only its own path; it does not prove a deployed sandbox path.
Run the repository's required checks, public-import checks when exports change, and the consumer's affected flow.
Report retained product adapters, adopted exports, observable results, and unchecked boundaries.

## Then consider

- `build-with-agent-knowledge` when the remaining work concerns retrieval or memory integration.
- `critical-audit` when a changed public contract needs independent review.
- `verify` when implementation is complete and release checks remain.
