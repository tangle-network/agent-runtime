[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / DoctorReport

# Interface: DoctorReport

Defined in: [intelligence/index.ts:254](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L254)

The `doctor()` readiness report — Mode-readiness without any network call.

## Properties

### project

> **project**: `string`

Defined in: [intelligence/index.ts:255](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L255)

***

### effort

> **effort**: [`EffortSettings`](EffortSettings.md)

Defined in: [intelligence/index.ts:256](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L256)

***

### exportConfigured

> **exportConfigured**: `boolean`

Defined in: [intelligence/index.ts:258](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L258)

True when an OTLP endpoint is configured (export will actually ship).

***

### modes

> **modes**: `object`

Defined in: [intelligence/index.ts:259](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L259)

#### observe

> **observe**: [`ModeReadiness`](ModeReadiness.md)

#### recommend

> **recommend**: [`ModeReadiness`](ModeReadiness.md)

#### pr

> **pr**: [`ModeReadiness`](ModeReadiness.md)
