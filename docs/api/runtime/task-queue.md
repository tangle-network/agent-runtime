[**@tangle-network/agent-runtime**](../README.md)

***

[@tangle-network/agent-runtime](../README.md) / runtime/task-queue

# runtime/task-queue

## Interfaces

### TaskQueueEntry

One identified task admitted by a caller-owned ready queue.

#### Type Parameters

##### T

`T`

#### Properties

##### id

> `readonly` **id**: `string`

##### value

> `readonly` **value**: `T`

***

### TaskQueueOptions

#### Type Parameters

##### T

`T`

##### R

`R`

#### Properties

##### concurrency

> `readonly` **concurrency**: `number`

##### take

> `readonly` **take**: (`activeIds`) => [`TaskQueueEntry`](#taskqueueentry)\<`T`\> \| `Promise`\<[`TaskQueueEntry`](#taskqueueentry)\<`T`\> \| `undefined`\> \| `undefined`

Return the next ready task, or undefined when none is currently admissible.
Called again after each yielded settlement; awaiting admission may persist a
checkpoint before execute starts. Active identities cannot be admitted twice.

###### Parameters

###### activeIds

`ReadonlySet`\<`string`\>

###### Returns

[`TaskQueueEntry`](#taskqueueentry)\<`T`\> \| `Promise`\<[`TaskQueueEntry`](#taskqueueentry)\<`T`\> \| `undefined`\> \| `undefined`

##### execute

> `readonly` **execute**: (`task`) => `Promise`\<`R`\>

###### Parameters

###### task

[`TaskQueueEntry`](#taskqueueentry)\<`T`\>

###### Returns

`Promise`\<`R`\>

## Type Aliases

### TaskQueueSettlement

> **TaskQueueSettlement**\<`T`, `R`\> = `object` & \{ `status`: `"fulfilled"`; `value`: `R`; \} \| \{ `status`: `"rejected"`; `reason`: `unknown`; \}

Native promise settlement, retaining the exact returned or thrown value.

#### Type Declaration

##### task

> `readonly` **task**: [`TaskQueueEntry`](#taskqueueentry)\<`T`\>

#### Type Parameters

##### T

`T`

##### R

`R`

## Functions

### runTaskQueue()

> **runTaskQueue**\<`T`, `R`\>(`options`): `AsyncGenerator`\<[`TaskQueueSettlement`](#taskqueuesettlement)\<`T`, `R`\>\>

Admit bounded work and yield settlements for the caller's policy to interpret.
Readiness, cancellation, retries, and persistence belong to that caller.
A throw or early iterator return stops admission and awaits every started task.
Settlements are delivered in completion order, before further admission.
Task failures are yielded, never normalized or substituted for caller failures.

#### Type Parameters

##### T

`T`

##### R

`R`

#### Parameters

##### options

[`TaskQueueOptions`](#taskqueueoptions)\<`T`, `R`\>

#### Returns

`AsyncGenerator`\<[`TaskQueueSettlement`](#taskqueuesettlement)\<`T`, `R`\>\>
