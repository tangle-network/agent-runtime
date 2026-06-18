[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / defaultToolDetectors

# Function: defaultToolDetectors()

> **defaultToolDetectors**(): `StreamingDetector`[]

Defined in: [runtime/supervise/detector-monitor.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/detector-monitor.ts#L37)

The default online panel for a tool-call pipe: a worker repeating the same call, or hammering
 consecutive errors. (No-progress needs a domain progress-probe, so it is opt-in, not default.)

 Coverage note: `repeated-action` works for EVERY harness (it needs only tool name + args, which
 every adapter provides). `error-streak` needs per-call status — opencode carries it inline
 (`state.status`, VALIDATED live), but claude-code/codex tool-call parts do NOT (their errors live
 in separate result blocks not yet decoded), so error-streak is silent for those until result-block
 decoding is added + live-validated. It is in the panel because it is correct where status exists.

## Returns

`StreamingDetector`[]
