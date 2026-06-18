[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [profiles](../README.md) / BrowserHandle

# Interface: BrowserHandle

Defined in: [profiles/ui-auditor/in-process-client.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/in-process-client.ts#L72)

**`Experimental`**

## Methods

### newContext()

> **newContext**(`options?`): `Promise`\<[`BrowserContextHandle`](BrowserContextHandle.md)\>

Defined in: [profiles/ui-auditor/in-process-client.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/in-process-client.ts#L73)

**`Experimental`**

#### Parameters

##### options?

###### viewport?

\{ `width`: `number`; `height`: `number`; \}

###### viewport.width

`number`

###### viewport.height

`number`

#### Returns

`Promise`\<[`BrowserContextHandle`](BrowserContextHandle.md)\>

***

### close()

> **close**(): `Promise`\<`void`\>

Defined in: [profiles/ui-auditor/in-process-client.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/in-process-client.ts#L76)

**`Experimental`**

#### Returns

`Promise`\<`void`\>
