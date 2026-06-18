[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / turnId

# Function: turnId()

> **turnId**(`runId`, `index`, `speaker`): `string`

Defined in: [conversation/turn-id.ts:14](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/turn-id.ts#L14)

## Parameters

### runId

`string`

### index

`number`

### speaker

`string`

## Returns

`string`

## Stable

Deterministic turn identifier. Stable across retries of the same logical
turn so backends (and any caching gateway in between) can dedupe on it.
A retry triggered by a network blip or deadline timeout MUST produce the
same `turn_id`; only the underlying attempt count differs.

Shape: `${runId}.t${index}.${speakerSlug}` — readable in logs, sortable by
turn index, attributable to a speaker. Slugify keeps the speaker portion
URL-safe so it can ride in HTTP headers without escaping.
