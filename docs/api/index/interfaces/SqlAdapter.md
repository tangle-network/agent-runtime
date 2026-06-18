[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / SqlAdapter

# Interface: SqlAdapter

Defined in: [conversation/journal-sql.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L48)

Minimal SQL driver shape. Implementations forward to whichever client the
deployment already uses; agent-runtime takes no opinion on which.

Parameter placeholders MUST be `?` (positional). All adapters listed in the
file header accept this convention.

## Methods

### exec()

> **exec**(`sql`, `params?`): `Promise`\<\{ `rowsAffected`: `number`; \}\>

Defined in: [conversation/journal-sql.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L50)

Execute a write statement (INSERT/UPDATE/DELETE/DDL).

#### Parameters

##### sql

`string`

##### params?

readonly `unknown`[]

#### Returns

`Promise`\<\{ `rowsAffected`: `number`; \}\>

***

### query()

> **query**\<`TRow`\>(`sql`, `params?`): `Promise`\<`TRow`[]\>

Defined in: [conversation/journal-sql.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L52)

Execute a read statement (SELECT). Returns rows as plain objects.

#### Type Parameters

##### TRow

`TRow` = `Record`\<`string`, `unknown`\>

#### Parameters

##### sql

`string`

##### params?

readonly `unknown`[]

#### Returns

`Promise`\<`TRow`[]\>
