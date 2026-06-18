[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / DeliveryConfig

# Interface: DeliveryConfig

Defined in: [intelligence/delivery.ts:194](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L194)

Delivery config = the Observe config plus the pull target + refresh cadence.

## Extends

- [`IntelligenceConfig`](IntelligenceConfig.md)

## Properties

### target?

> `optional` **target?**: `string`

Defined in: [intelligence/delivery.ts:196](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L196)

Pull target. Defaults to `project`.

***

### baseUrl?

> `optional` **baseUrl?**: `string`

Defined in: [intelligence/delivery.ts:199](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L199)

Plane base URL for the pull (NOT the OTLP `endpoint`). Defaults to
 `TANGLE_INTELLIGENCE_URL` then `https://intelligence.tangle.tools`.

***

### refreshMs?

> `optional` **refreshMs?**: `number`

Defined in: [intelligence/delivery.ts:201](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L201)

Min interval between certified-profile pulls. Default 5m.

***

### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [intelligence/delivery.ts:203](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L203)

Per-pull timeout in ms (fail-closed on a hung plane). Default 10000.

***

### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

Defined in: [intelligence/delivery.ts:205](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L205)

fetch impl for the pull (tests). Defaults to global fetch.

#### Parameters

##### input

`string` \| `URL` \| `Request`

##### init?

`RequestInit`

#### Returns

`Promise`\<`Response`\>

***

### project

> **project**: `string`

Defined in: [intelligence/index.ts:124](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L124)

Stable project id — the tenant dimension every trace is tagged with.

#### Inherited from

[`IntelligenceConfig`](IntelligenceConfig.md).[`project`](IntelligenceConfig.md#project)

***

### apiKey?

> `optional` **apiKey?**: `string`

Defined in: [intelligence/index.ts:126](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L126)

Bearer key for the Intelligence ingest. Reads `TANGLE_API_KEY` when omitted.

#### Inherited from

[`IntelligenceConfig`](IntelligenceConfig.md).[`apiKey`](IntelligenceConfig.md#apikey)

***

### effort?

> `optional` **effort?**: [`EffortTier`](../type-aliases/EffortTier.md) \| \{ `tier`: [`EffortTier`](../type-aliases/EffortTier.md); `overrides?`: `Partial`\<[`EffortSettings`](EffortSettings.md)\>; \}

Defined in: [intelligence/index.ts:128](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L128)

Effort tier (default `'standard'`) plus optional per-field overrides.

#### Inherited from

[`IntelligenceConfig`](IntelligenceConfig.md).[`effort`](IntelligenceConfig.md#effort)

***

### endpoint?

> `optional` **endpoint?**: `string`

Defined in: [intelligence/index.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L135)

OTLP ingest base. The underlying exporter appends `/v1/traces`, so point
this at the OTLP route (e.g. `https://intelligence.tangle.tools/v1/otlp`).
Reads `INTELLIGENCE_OTLP_ENDPOINT` then `OTEL_EXPORTER_OTLP_ENDPOINT` when
omitted; absent all three, export is a no-op (best-effort by construction).

#### Inherited from

[`IntelligenceConfig`](IntelligenceConfig.md).[`endpoint`](IntelligenceConfig.md#endpoint)

***

### redact?

> `optional` **redact?**: `false` \| [`Redactor`](../type-aliases/Redactor.md)

Defined in: [intelligence/index.ts:141](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L141)

Redaction hook run over every exported input/output. A function replaces
the default scrubber; `false` opts out entirely (raw fidelity, caller has
sanitized upstream); omitted ⇒ the built-in `defaultRedactor`.

#### Inherited from

[`IntelligenceConfig`](IntelligenceConfig.md).[`redact`](IntelligenceConfig.md#redact)

***

### surfaces?

> `optional` **surfaces?**: `string`[]

Defined in: [intelligence/index.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L143)

Mutable surfaces a later PR mode would edit. Recorded for `doctor()` only.

#### Inherited from

[`IntelligenceConfig`](IntelligenceConfig.md).[`surfaces`](IntelligenceConfig.md#surfaces)

***

### checks?

> `optional` **checks?**: `string`[]

Defined in: [intelligence/index.ts:145](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L145)

Verification checks a later PR mode would gate on. Recorded for `doctor()` only.

#### Inherited from

[`IntelligenceConfig`](IntelligenceConfig.md).[`checks`](IntelligenceConfig.md#checks)

***

### repo?

> `optional` **repo?**: [`RepoConfig`](RepoConfig.md)

Defined in: [intelligence/index.ts:147](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L147)

Repo access a later PR mode would need. Recorded for `doctor()` only.

#### Inherited from

[`IntelligenceConfig`](IntelligenceConfig.md).[`repo`](IntelligenceConfig.md#repo)
