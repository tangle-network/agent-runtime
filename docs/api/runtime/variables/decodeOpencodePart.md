[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / decodeOpencodePart

# Variable: decodeOpencodePart

> `const` **decodeOpencodePart**: [`ToolPartDecoder`](../type-aliases/ToolPartDecoder.md)

Defined in: [runtime/supervise/trace-source.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L72)

opencode parts ARE agent-interface's canonical `ToolPart` (`{ type:'tool', tool, callID?,
 state: ToolState }`) — the shape every adc sdk-provider normalizes its harness output into. We
 decode against that published type (single source of truth) rather than a re-derived shape; the
 `ToolState` union drives the status mapping, so a status that adc adds/renames is a compile error
 here, not a silent miss. The same call streams pending→running→terminal; only a terminal state
 (`completed` / `error` / `failed`) is a finished call.
