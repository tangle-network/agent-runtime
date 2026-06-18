[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / Deliverable

# Type Alias: Deliverable\<Out\>

> **Deliverable**\<`Out`\> = \{ `kind`: `"events"`; `fromEvents`: (`events`) => `Out`; \} \| \{ `kind`: `"artifact"`; `path`: `string`; `fromArtifact`: (`raw`, `events`) => `Out`; \}

Defined in: [runtime/sandbox-run.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L50)

**`Experimental`**

How a typed deliverable `Out` is materialized from a finished turn.
- `events`   — pure parse over the event array (identical to `OutputAdapter`).
- `artifact` — read a file off the box AFTER the turn drains, then map it (+ the
               events). For diffs/codebases/documents that don't fit the chat
               stream. `path` relative ⇒ workspace root; absolute ⇒ container FS.

## Type Parameters

### Out

`Out`
