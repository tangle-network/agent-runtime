[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / CoordinationEvent

# Type Alias: CoordinationEvent

> **CoordinationEvent** = \{ `type`: `"question"`; `question`: [`QuestionRecord`](../interfaces/QuestionRecord.md); \} \| \{ `type`: `"settled"`; `worker`: [`SettledWorker`](../interfaces/SettledWorker.md); \} \| \{ `type`: `"finding"`; `finding`: `AnalystFindingEvent`; \} \| \{ `type`: `"steer"`; `down`: `DownMessageEvent`; \} \| \{ `type`: `"answer"`; `down`: `DownMessageEvent`; `questionId`: `string`; \}

Defined in: [mcp/tools/coordination.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L85)

Every message on the one typed pipe. UP (child→parent): question / settled / finding — queued for
 the driver to `pull`. DOWN (parent→child): steer / answer — record-only (history + subscribers),
 routed to the child inbox. New kinds are additive.
