[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [improvement](../README.md) / commandVerifier

# Function: commandVerifier()

> **commandVerifier**(`command`, `args?`, `timeoutMs?`): [`Verifier`](../type-aliases/Verifier.md)

Defined in: [improvement/agentic-generator.ts:159](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L159)

A `Verifier` that runs a command in the worktree: exit 0 ⇒ ok, any other
 exit ⇒ failed with stdout+stderr as feedback. The common case — verify by
 `tsc --noEmit`, `pnpm build`, or a test command. A timeout is treated as a
 FAILED candidate (a change that hangs the build is a bad change); a missing
 binary or spawn fault throws (a setup bug, not a failed candidate — no
 silent fallback).

## Parameters

### command

`string`

### args?

`string`[] = `[]`

### timeoutMs?

`number` = `300_000`

## Returns

[`Verifier`](../type-aliases/Verifier.md)
