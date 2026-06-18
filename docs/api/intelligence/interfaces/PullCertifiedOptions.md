[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / PullCertifiedOptions

# Interface: PullCertifiedOptions

Defined in: [intelligence/delivery.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L67)

## Properties

### target

> **target**: `string`

Defined in: [intelligence/delivery.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L69)

The agent target certified artifacts are promoted under.

***

### apiKey?

> `optional` **apiKey?**: `string`

Defined in: [intelligence/delivery.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L71)

Bearer key. Defaults to `process.env.TANGLE_API_KEY`.

***

### baseUrl?

> `optional` **baseUrl?**: `string`

Defined in: [intelligence/delivery.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L74)

Plane base URL. Defaults to `process.env.TANGLE_INTELLIGENCE_URL` then
 `https://intelligence.tangle.tools`.

***

### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

Defined in: [intelligence/delivery.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L76)

fetch impl (tests / non-global-fetch runtimes). Defaults to global fetch.

#### Parameters

##### input

`string` \| `URL` \| `Request`

##### init?

`RequestInit`

#### Returns

`Promise`\<`Response`\>

***

### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [intelligence/delivery.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L80)

Abort the pull after this many ms so a hung plane never blocks the caller.
 Default 10000. The timeout surfaces as a normal fail-closed `succeeded:
 false` (the agent runs on its base surface).
