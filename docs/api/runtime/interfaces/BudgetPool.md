[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / BudgetPool

# Interface: BudgetPool

Defined in: [runtime/supervise/budget.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L51)

## Methods

### reserve()

> **reserve**(`b`): \{ `ok`: `true`; `ticket`: [`ReservationTicket`](ReservationTicket.md); \} \| \{ `ok`: `false`; `reason`: `"budget-exhausted"`; \}

Defined in: [runtime/supervise/budget.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L57)

Atomically reserve a child's full ceiling from the free balance. Fails closed
({ ok: false }) when the pool can't cover tokens, usd, or iterations — the
caller inspects `ok` before `ticket`.

#### Parameters

##### b

[`Budget`](Budget.md)

#### Returns

\{ `ok`: `true`; `ticket`: [`ReservationTicket`](ReservationTicket.md); \} \| \{ `ok`: `false`; `reason`: `"budget-exhausted"`; \}

***

### reconcile()

> **reconcile**(`ticket`, `spent`): `void`

Defined in: [runtime/supervise/budget.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L65)

Release a reservation: commit the actual `spent`, refund the unspent remainder
to the free pool. Throws on an unknown or already-reconciled ticket (fail loud —
a double refund would silently break conservation).

#### Parameters

##### ticket

[`ReservationTicket`](ReservationTicket.md)

##### spent

[`Spend`](Spend.md)

#### Returns

`void`

***

### spendFrom()

> **spendFrom**(`events`): `Promise`\<[`Spend`](Spend.md)\>

Defined in: [runtime/supervise/budget.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L69)

Fold a normalized `UsageEvent` stream (or array) into a `Spend`. Tokens via
 `addTokenUsage`, usd on its own channel, iterations from `'iteration'` events.
 `ms` is left zero — wall-clock duration is the caller's to record, not the pool's.

#### Parameters

##### events

`AsyncIterable`\<[`UsageEvent`](../type-aliases/UsageEvent.md), `any`, `any`\> \| [`UsageEvent`](../type-aliases/UsageEvent.md)[]

#### Returns

`Promise`\<[`Spend`](Spend.md)\>

***

### readout()

> **readout**(): [`BudgetReadout`](../type-aliases/BudgetReadout.md)

Defined in: [runtime/supervise/budget.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L71)

The current readout, reflecting all outstanding reservations.

#### Returns

[`BudgetReadout`](../type-aliases/BudgetReadout.md)

***

### observe()

> **observe**(`spend`): `void`

Defined in: [runtime/supervise/budget.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L82)

Record OBSERVED spend that did NOT go through reserve/reconcile — the driver's OWN inference
(its chat turns), which is real compute but not a spawned child. A direct `free → committed`
debit, so `total ≡ free + reserved + committed` is preserved: equal-k counts the driver's
tokens and the in-loop budget guard (`readout().tokensLeft`) sees them. `free` may go negative
when a run overspends — that is honest (the readout then signals exhaustion). It never throws:
the spend already happened, so accounting records reality; the in-loop guard prevents MORE.
The DURABLE record is the journal's `metered` event (written by `Scope.meter`); this debit
only makes the live `readout()` reflect driver inference for the in-loop guard.

#### Parameters

##### spend

[`Spend`](Spend.md)

#### Returns

`void`

***

### assertNoOpenTickets()

> **assertNoOpenTickets**(): `void`

Defined in: [runtime/supervise/budget.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L86)

Fail loud if any reservation is still open — the conserved-pool leak detector. Called at the
 supervisor's join barrier: once every child has settled, no ticket may remain (a leaked
 reservation would silently break `total ≡ free + reserved + committed`).

#### Returns

`void`
