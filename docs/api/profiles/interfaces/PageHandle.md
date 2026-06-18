[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [profiles](../README.md) / PageHandle

# Interface: PageHandle

Defined in: [profiles/ui-auditor/in-process-client.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/in-process-client.ts#L86)

**`Experimental`**

## Methods

### setViewportSize()

> **setViewportSize**(`size`): `Promise`\<`void`\>

Defined in: [profiles/ui-auditor/in-process-client.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/in-process-client.ts#L87)

**`Experimental`**

#### Parameters

##### size

###### width

`number`

###### height

`number`

#### Returns

`Promise`\<`void`\>

***

### goto()

> **goto**(`url`, `options?`): `Promise`\<`unknown`\>

Defined in: [profiles/ui-auditor/in-process-client.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/in-process-client.ts#L88)

**`Experimental`**

#### Parameters

##### url

`string`

##### options?

###### waitUntil?

`string`

###### timeout?

`number`

#### Returns

`Promise`\<`unknown`\>

***

### waitForSelector()

> **waitForSelector**(`selector`, `options?`): `Promise`\<`unknown`\>

Defined in: [profiles/ui-auditor/in-process-client.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/in-process-client.ts#L89)

**`Experimental`**

#### Parameters

##### selector

`string`

##### options?

###### timeout?

`number`

#### Returns

`Promise`\<`unknown`\>

***

### waitForTimeout()

> **waitForTimeout**(`ms`): `Promise`\<`void`\>

Defined in: [profiles/ui-auditor/in-process-client.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/in-process-client.ts#L90)

**`Experimental`**

#### Parameters

##### ms

`number`

#### Returns

`Promise`\<`void`\>

***

### screenshot()

> **screenshot**(`options`): `Promise`\<`void`\>

Defined in: [profiles/ui-auditor/in-process-client.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/in-process-client.ts#L91)

**`Experimental`**

#### Parameters

##### options

###### path

`string`

###### fullPage?

`boolean`

#### Returns

`Promise`\<`void`\>

***

### locator()

> **locator**(`selector`): `object`

Defined in: [profiles/ui-auditor/in-process-client.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/profiles/ui-auditor/in-process-client.ts#L92)

**`Experimental`**

#### Parameters

##### selector

`string`

#### Returns

`object`

##### first()

> **first**(): `object`

###### Returns

`object`

###### screenshot()

> **screenshot**(`options`): `Promise`\<`void`\>

###### Parameters

###### options

###### path

`string`

###### Returns

`Promise`\<`void`\>
