[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / TrajectoryAnalysis

# Interface: TrajectoryAnalysis

Defined in: [runtime/supervise/trajectory-recorder.ts:15](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trajectory-recorder.ts#L15)

## Properties

### trajectory

> `readonly` **trajectory**: `Trajectory`

Defined in: [runtime/supervise/trajectory-recorder.ts:18](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trajectory-recorder.ts#L18)

Structured run summary (tool-call count, step order). Steps carry a single timestamp, so per-span
 duration is 0; loop/waste detection keys on call PATTERNS + cross-span windows, not durations.

***

### stuckLoop

> `readonly` **stuckLoop**: `StuckLoopReport`

Defined in: [runtime/supervise/trajectory-recorder.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trajectory-recorder.ts#L21)

Full-run repeated-call view (total occurrences + window) — catches a loop the online consecutive
 detector interleaves past.

***

### toolWaste

> `readonly` **toolWaste**: `ToolWasteReport`

Defined in: [runtime/supervise/trajectory-recorder.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trajectory-recorder.ts#L23)

Wasted-vs-total tool-call ratio for the run.
