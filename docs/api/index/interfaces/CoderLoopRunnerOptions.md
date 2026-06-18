[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / CoderLoopRunnerOptions

# Interface: CoderLoopRunnerOptions

Defined in: [loop-runner.ts:128](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L128)

**`Experimental`**

Options for the default `code`/`review` runner.

## Properties

### sandboxClient

> **sandboxClient**: [`SandboxClient`](../../runtime/interfaces/SandboxClient.md)

Defined in: [loop-runner.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L129)

**`Experimental`**

***

### args

> **args**: [`DelegateCodeArgs`](../../mcp/interfaces/DelegateCodeArgs.md)

Defined in: [loop-runner.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L131)

**`Experimental`**

What to build — the delegate args (goal, repoRoot, variants, config, …).

***

### reviewer?

> `optional` **reviewer?**: [`CoderReviewer`](../../mcp/type-aliases/CoderReviewer.md)

Defined in: [loop-runner.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L133)

**`Experimental`**

Adversarial reviewer. Pass one to run `review` mode (an approval gate over the candidate).

***

### winnerSelection?

> `optional` **winnerSelection?**: [`DetachedWinnerSelection`](../../mcp/type-aliases/DetachedWinnerSelection.md)

Defined in: [loop-runner.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L135)

**`Experimental`**

Winner-selection strategy. Default `highest-score`.

***

### fanoutHarnesses?

> `optional` **fanoutHarnesses?**: `string`[]

Defined in: [loop-runner.ts:137](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L137)

**`Experimental`**

Harnesses for `variants > 1` fanout.
