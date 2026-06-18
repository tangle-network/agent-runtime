[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / d1ToSqlAdapter

# Function: d1ToSqlAdapter()

> **d1ToSqlAdapter**(`db`): [`SqlAdapter`](../interfaces/SqlAdapter.md)

Defined in: [conversation/journal-sql.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L60)

Adapt a Cloudflare D1 binding to the SqlAdapter shape. Lives here so D1
consumers don't have to write the wrapper themselves; the runtime never
imports `@cloudflare/workers-types` directly (peer-style typing).

## Parameters

### db

[`D1DatabaseLike`](../interfaces/D1DatabaseLike.md)

## Returns

[`SqlAdapter`](../interfaces/SqlAdapter.md)
