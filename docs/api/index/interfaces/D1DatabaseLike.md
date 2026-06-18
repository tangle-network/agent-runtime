[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / D1DatabaseLike

# Interface: D1DatabaseLike

Defined in: [conversation/journal-sql.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L83)

Structural type matching the surface of `D1Database` we depend on, so the
SDK never imports `@cloudflare/workers-types`. Consumers pass their real
`D1Database` from `env.DB` and TS structural compatibility lines it up.

## Methods

### prepare()

> **prepare**(`sql`): [`D1StmtLike`](D1StmtLike.md)

Defined in: [conversation/journal-sql.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L84)

#### Parameters

##### sql

`string`

#### Returns

[`D1StmtLike`](D1StmtLike.md)
