[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / ReservationTicket

# Interface: ReservationTicket

Defined in: [runtime/supervise/budget.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L29)

Opaque, single-use reservation handle returned by `reserve` and consumed by
 `reconcile`. Carries the reserved ceilings so reconciliation needs no lookup.

## Properties

### id

> `readonly` **id**: `number`

Defined in: [runtime/supervise/budget.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L30)

***

### reserved

> `readonly` **reserved**: `object`

Defined in: [runtime/supervise/budget.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L31)

#### tokens

> `readonly` **tokens**: `number`

#### usd

> `readonly` **usd**: `number`

#### iterations

> `readonly` **iterations**: `number`
