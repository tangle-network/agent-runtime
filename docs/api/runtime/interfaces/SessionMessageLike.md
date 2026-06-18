[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / SessionMessageLike

# Interface: SessionMessageLike

Defined in: [runtime/supervise/trace-source.ts:265](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L265)

A harness session message carrying parts (the shape `box.messages()` returns). Structurally typed
 so this works with the real `@tangle-network/sandbox` box AND a test double, no SDK import.

## Properties

### parts?

> `readonly` `optional` **parts?**: readonly `unknown`[]

Defined in: [runtime/supervise/trace-source.ts:266](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L266)
