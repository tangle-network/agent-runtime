[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / InboxMessage

# Interface: InboxMessage

Defined in: [runtime/supervise/inbox.ts:18](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L18)

**`Experimental`**

The worker-side receive end of the down-leg: a per-worker inbox an executor exposes as
`Executor.deliver`. The driver's `steer_worker` / `answer_question` land here,
and the worker's agent loop drains them at two points (Drew's two delivery modes):

  - QUEUED (default): the message accumulates and is FLUSHED at the next step boundary — folded
    into the conversation before the next think. A worker is also forced to flush BEFORE it may
    settle, so it can never finish while a steer/answer it never read is still pending.
  - FORCEFUL (`interrupt: true`): trips `freshInterrupt()`'s signal so the loop can abort its
    in-flight turn immediately, then re-plan with the message folded in — breaking the worker out
    of a wrong path mid-task instead of waiting for it to finish the step.

`deliver` never throws — a malformed message is ignored, per the `Executor.deliver` contract.

## Properties

### kind

> `readonly` **kind**: `"steer"` \| `"answer"`

Defined in: [runtime/supervise/inbox.ts:19](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L19)

**`Experimental`**

***

### text

> `readonly` **text**: `string`

Defined in: [runtime/supervise/inbox.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L20)

**`Experimental`**

***

### interrupt

> `readonly` **interrupt**: `boolean`

Defined in: [runtime/supervise/inbox.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L22)

**`Experimental`**

Forceful messages abort the in-flight turn; queued ones wait for the boundary flush.

***

### questionId?

> `readonly` `optional` **questionId?**: `string`

Defined in: [runtime/supervise/inbox.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L24)

**`Experimental`**

Present for an `answer` — the question id it resolves.
