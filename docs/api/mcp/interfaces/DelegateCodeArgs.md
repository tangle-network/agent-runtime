[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DelegateCodeArgs

# Interface: DelegateCodeArgs

Defined in: [mcp/types.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L42)

**`Experimental`**

## Properties

### goal

> **goal**: `string`

Defined in: [mcp/types.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L44)

**`Experimental`**

Natural-language description of what the coder must accomplish.

***

### repoRoot

> **repoRoot**: `string`

Defined in: [mcp/types.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L46)

**`Experimental`**

Absolute path inside the sandbox where the repo lives.

***

### contextHint?

> `optional` **contextHint?**: `string`

Defined in: [mcp/types.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L48)

**`Experimental`**

Optional free-form context the agent surfaces in the prompt prelude.

***

### variants?

> `optional` **variants?**: `number`

Defined in: [mcp/types.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L54)

**`Experimental`**

When > 1, dispatches `multiHarnessCoderFanout` across N harnesses
(claude-code, codex, opencode-glm) and picks the highest-scoring
passing patch. Default 1.

***

### config?

> `optional` **config?**: [`DelegateCodeConfig`](DelegateCodeConfig.md)

Defined in: [mcp/types.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L56)

**`Experimental`**

Validator + prompt overrides the agent knows for this repo.

***

### namespace?

> `optional` **namespace?**: `string`

Defined in: [mcp/types.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L58)

**`Experimental`**

Multi-tenant scope (customer-id, workspace-id).
