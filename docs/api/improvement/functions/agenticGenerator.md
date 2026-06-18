[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [improvement](../README.md) / agenticGenerator

# Function: agenticGenerator()

> **agenticGenerator**(`opts?`): [`CandidateGenerator`](../interfaces/CandidateGenerator.md)

Defined in: [improvement/agentic-generator.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L71)

`@tangle-network/agent-runtime` improvement — the CODE-surface driver for
agent-eval's improvement loop.

The ONE entry point for optimization is agent-eval's `selfImprove`
(`@tangle-network/agent-eval/contract`) — text/config surfaces, held-out gated,
with `analyzeGeneration` for analyst-fed reflection and `analyzeRuns` /
`fromOtelSpans` / `partitionRunsByAuthoringModel` for production intake +
cohorting. This module supplies only the one genuinely runtime-specific piece:
a CODE-surface `ImprovementDriver` you pass to `selfImprove` as `driver`, which
mutates a git worktree via a pluggable `CandidateGenerator`:
  - `reflectiveGenerator` — cheap, no sandbox, applies pre-drafted patches
  - `agenticGenerator`     — full coding harness in the worktree, multi-shot

## Parameters

### opts?

[`AgenticGeneratorOptions`](../interfaces/AgenticGeneratorOptions.md) = `{}`

## Returns

[`CandidateGenerator`](../interfaces/CandidateGenerator.md)
