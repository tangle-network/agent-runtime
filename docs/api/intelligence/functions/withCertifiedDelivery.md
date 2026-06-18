[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / withCertifiedDelivery

# Function: withCertifiedDelivery()

> **withCertifiedDelivery**\<`I`, `O`\>(`agent`, `config`): (`input`) => `Promise`\<`O`\> & `object`

Defined in: [intelligence/delivery.ts:216](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/delivery.ts#L216)

Wrap an agent so it (a) Observes each run via the shipped Observe client and
(b) RECEIVES the tenant's certified artifacts pulled from the deployed plane.
The certified profile is cached and refreshed at most every `refreshMs`; a
failed pull is fail-closed — the agent runs on its base surface and never
breaks because Intelligence is unreachable. When the plane promotes a new
gate-certified surface, the next refresh delivers it to the running agent.

## Type Parameters

### I

`I`

### O

`O`

## Parameters

### agent

[`DeliveredAgent`](../type-aliases/DeliveredAgent.md)\<`I`, `O`\>

### config

[`DeliveryConfig`](../interfaces/DeliveryConfig.md)

## Returns

(`input`) => `Promise`\<`O`\> & `object`
