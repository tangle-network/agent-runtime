[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / D1StmtLike

# Interface: D1StmtLike

Defined in: [conversation/journal-sql.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L86)

## Methods

### bind()

> **bind**(...`params`): `D1StmtLike`

Defined in: [conversation/journal-sql.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L87)

#### Parameters

##### params

...`unknown`[]

#### Returns

`D1StmtLike`

***

### run()

> **run**(): `Promise`\<`unknown`\>

Defined in: [conversation/journal-sql.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L88)

#### Returns

`Promise`\<`unknown`\>

***

### all()

> **all**\<`TRow`\>(): `Promise`\<\{ `results?`: `TRow`[]; \}\>

Defined in: [conversation/journal-sql.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L89)

#### Type Parameters

##### TRow

`TRow` = `unknown`

#### Returns

`Promise`\<\{ `results?`: `TRow`[]; \}\>
