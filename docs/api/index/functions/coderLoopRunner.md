[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / coderLoopRunner

# Function: coderLoopRunner()

> **coderLoopRunner**(`options`): [`DelegatedLoopRunner`](../type-aliases/DelegatedLoopRunner.md)\<`CoderOutput`\>

Defined in: [loop-runner.ts:144](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L144)

**`Experimental`**

Build a `code`/`review`-mode runner over the sandbox-session coder delegate. Pass a
`reviewer` to run `review` mode — an approval gate over the validated candidate.

## Parameters

### options

[`CoderLoopRunnerOptions`](../interfaces/CoderLoopRunnerOptions.md)

## Returns

[`DelegatedLoopRunner`](../type-aliases/DelegatedLoopRunner.md)\<`CoderOutput`\>
