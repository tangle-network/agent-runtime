[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / WatchTraceOptions

# Interface: WatchTraceOptions

Defined in: [runtime/supervise/detector-monitor.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/detector-monitor.ts#L22)

## Properties

### detectors?

> `readonly` `optional` **detectors?**: readonly `StreamingDetector`[]

Defined in: [runtime/supervise/detector-monitor.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/detector-monitor.ts#L24)

The detectors to run online. Defaults to a stuck-loop + error-streak panel.

***

### onSignal?

> `readonly` `optional` **onSignal?**: (`signal`, `span`) => `void` \| `Promise`\<`void`\>

Defined in: [runtime/supervise/detector-monitor.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/detector-monitor.ts#L26)

Fired for each signal a detector raises — the seam that raises a `finding` on the bus.

#### Parameters

##### signal

`DetectorSignal`

##### span

`ToolSpan`

#### Returns

`void` \| `Promise`\<`void`\>
