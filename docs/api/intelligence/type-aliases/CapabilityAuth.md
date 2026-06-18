[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / CapabilityAuth

# Type Alias: CapabilityAuth

> **CapabilityAuth** = \{ `mode`: `"none"`; \} \| \{ `mode`: `"tangle-key"`; \} \| \{ `mode`: `"hub-connection"`; `providerId`: `string`; `scopes?`: `string`[]; \} \| \{ `mode`: `"secret-ref"`; `key`: `string`; \}

Defined in: [intelligence/capability.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/capability.ts#L80)

How a binding authenticates at resolve time. Declared as a REQUIREMENT in the
manifest; the live secret is resolved per-tenant by the resolver context,
never inlined here.
