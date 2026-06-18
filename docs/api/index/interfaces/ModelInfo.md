[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / ModelInfo

# Interface: ModelInfo

Defined in: [model-resolution.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L21)

A model entry as returned by the Tangle Router `/v1/models` endpoint.
Intentionally minimal — only the fields resolution + validation read.

## Properties

### id

> **id**: `string`

Defined in: [model-resolution.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L22)

***

### name?

> `optional` **name?**: `string`

Defined in: [model-resolution.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L23)

***

### description?

> `optional` **description?**: `string`

Defined in: [model-resolution.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L24)

***

### provider?

> `optional` **provider?**: `string`

Defined in: [model-resolution.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L26)

Provider slug, when the router exposes it (`provider` or `_provider`).

***

### \_provider?

> `optional` **\_provider?**: `string`

Defined in: [model-resolution.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L27)

***

### architecture?

> `optional` **architecture?**: `object`

Defined in: [model-resolution.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L28)

#### modality?

> `optional` **modality?**: `string`

#### input\_modalities?

> `optional` **input\_modalities?**: `string`[]

#### output\_modalities?

> `optional` **output\_modalities?**: `string`[]
