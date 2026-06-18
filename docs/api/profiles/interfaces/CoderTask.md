[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [profiles](../README.md) / CoderTask

# Interface: CoderTask

Defined in: [profiles/coder.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/coder.ts#L20)

**`Experimental`**

The per-task inputs `coderTaskToPrompt` renders + the worktree gate enforces.

## Properties

### goal

> **goal**: `string`

Defined in: [profiles/coder.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/coder.ts#L22)

**`Experimental`**

What the agent must accomplish. Free-form prose.

***

### repoRoot

> **repoRoot**: `string`

Defined in: [profiles/coder.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/coder.ts#L24)

**`Experimental`**

Absolute path inside the sandbox where the repo lives.

***

### baseBranch?

> `optional` **baseBranch?**: `string`

Defined in: [profiles/coder.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/coder.ts#L26)

**`Experimental`**

Default `main`. The branch the agent diffs against.

***

### testCmd?

> `optional` **testCmd?**: `string`

Defined in: [profiles/coder.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/coder.ts#L28)

**`Experimental`**

Default `pnpm test --run`.

***

### typecheckCmd?

> `optional` **typecheckCmd?**: `string`

Defined in: [profiles/coder.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/coder.ts#L30)

**`Experimental`**

Default `pnpm typecheck`.

***

### contextFiles?

> `optional` **contextFiles?**: `string`[]

Defined in: [profiles/coder.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/coder.ts#L32)

**`Experimental`**

Files the agent may inspect for context. Surfaced verbatim in the prompt.

***

### forbiddenPaths?

> `optional` **forbiddenPaths?**: `string`[]

Defined in: [profiles/coder.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/coder.ts#L37)

**`Experimental`**

Paths the agent must not touch. The mechanical gate hard-fails on any match.
Use glob-free literal path prefixes for unambiguous enforcement.

***

### maxDiffLines?

> `optional` **maxDiffLines?**: `number`

Defined in: [profiles/coder.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/coder.ts#L39)

**`Experimental`**

Default 400. Hard cap; the gate hard-fails when exceeded.
