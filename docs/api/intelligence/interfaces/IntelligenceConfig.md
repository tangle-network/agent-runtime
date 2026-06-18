[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / IntelligenceConfig

# Interface: IntelligenceConfig

Defined in: [intelligence/index.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L122)

Client configuration. `project` + `apiKey` are the Observe minimum; the
 rest tune effort, endpoint, redaction, and (for `doctor()` readiness)
 declare the surfaces/checks/repo a later PR mode would need.

## Extended by

- [`DeliveryConfig`](DeliveryConfig.md)

## Properties

### project

> **project**: `string`

Defined in: [intelligence/index.ts:124](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L124)

Stable project id — the tenant dimension every trace is tagged with.

***

### apiKey?

> `optional` **apiKey?**: `string`

Defined in: [intelligence/index.ts:126](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L126)

Bearer key for the Intelligence ingest. Reads `TANGLE_API_KEY` when omitted.

***

### effort?

> `optional` **effort?**: [`EffortTier`](../type-aliases/EffortTier.md) \| \{ `tier`: [`EffortTier`](../type-aliases/EffortTier.md); `overrides?`: `Partial`\<[`EffortSettings`](EffortSettings.md)\>; \}

Defined in: [intelligence/index.ts:128](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L128)

Effort tier (default `'standard'`) plus optional per-field overrides.

***

### endpoint?

> `optional` **endpoint?**: `string`

Defined in: [intelligence/index.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L135)

OTLP ingest base. The underlying exporter appends `/v1/traces`, so point
this at the OTLP route (e.g. `https://intelligence.tangle.tools/v1/otlp`).
Reads `INTELLIGENCE_OTLP_ENDPOINT` then `OTEL_EXPORTER_OTLP_ENDPOINT` when
omitted; absent all three, export is a no-op (best-effort by construction).

***

### redact?

> `optional` **redact?**: `false` \| [`Redactor`](../type-aliases/Redactor.md)

Defined in: [intelligence/index.ts:141](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L141)

Redaction hook run over every exported input/output. A function replaces
the default scrubber; `false` opts out entirely (raw fidelity, caller has
sanitized upstream); omitted ⇒ the built-in `defaultRedactor`.

***

### surfaces?

> `optional` **surfaces?**: `string`[]

Defined in: [intelligence/index.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L143)

Mutable surfaces a later PR mode would edit. Recorded for `doctor()` only.

***

### checks?

> `optional` **checks?**: `string`[]

Defined in: [intelligence/index.ts:145](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L145)

Verification checks a later PR mode would gate on. Recorded for `doctor()` only.

***

### repo?

> `optional` **repo?**: [`RepoConfig`](RepoConfig.md)

Defined in: [intelligence/index.ts:147](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L147)

Repo access a later PR mode would need. Recorded for `doctor()` only.
