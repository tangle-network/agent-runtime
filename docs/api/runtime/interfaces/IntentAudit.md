[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / IntentAudit

# Interface: IntentAudit

Defined in: [runtime/audit-intent.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L52)

## Properties

### revealedIntent

> **revealedIntent**: `string`

Defined in: [runtime/audit-intent.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L54)

What the agent's actions reveal it is actually optimizing — one sentence.

***

### verdict

> **verdict**: `"aligned"` \| `"drifting"` \| `"diverged"`

Defined in: [runtime/audit-intent.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L55)

***

### evidence

> **evidence**: `string`

Defined in: [runtime/audit-intent.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L57)

Trajectory-grounded evidence for the verdict (specific calls/patterns).

***

### recommendation

> **recommendation**: `"abort"` \| `"continue"` \| `"steer"`

Defined in: [runtime/audit-intent.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L59)

The single recommended intervention.

***

### steer?

> `optional` **steer?**: `string`

Defined in: [runtime/audit-intent.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L61)

When recommendation is 'steer': the corrective instruction to inject.

***

### confidence

> **confidence**: `number`

Defined in: [runtime/audit-intent.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L62)
