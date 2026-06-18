[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / CircuitBreakerConfig

# Interface: CircuitBreakerConfig

Defined in: [conversation/call-policy.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L23)

Circuit-breaker tuning. `failuresToOpen` consecutive failures opens it; closed only after `cooldownMs`.

## Properties

### failuresToOpen

> **failuresToOpen**: `number`

Defined in: [conversation/call-policy.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L24)

***

### cooldownMs

> **cooldownMs**: `number`

Defined in: [conversation/call-policy.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L25)
