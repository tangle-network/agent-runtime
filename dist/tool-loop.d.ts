import { l as RuntimeHooks } from "./runtime-hooks-Bj6wJHlH.js";
//#region src/tool-loop.d.ts
interface ToolLoopCall {
  toolCallId?: string;
  toolName: string;
  args: Record<string, unknown>;
}
/** Outcome of one tool dispatch — structurally compatible with a hub/integration
 *  tool-outcome union, so callers can fold either through the loop. */
type ToolCallOutcome = {
  ok: true;
  result: unknown;
} | {
  ok: false;
  code: string;
  message: string;
  status?: number;
};
/** One OpenAI-shaped tool-call entry carried on an assistant message. */
interface ToolLoopAssistantToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}
/**
 * A message in the running conversation the loop sends to `streamTurn`.
 *
 * The base `{ role, content }` covers `system` / `user` / plain `assistant`
 * turns. Two optional fields carry the OpenAI function-calling contract so a
 * strict model (Claude, and any OpenAI-compatible provider that validates tool
 * history) reads its own tool use back instead of re-issuing the same call:
 *
 *   - an assistant turn that emitted tool calls carries `tool_calls`, and its
 *     `content` is `null` when the turn was tool-only;
 *   - each tool result is its own `{ role: 'tool', tool_call_id, content }`
 *     message keyed to the call that produced it.
 *
 * Widening is additive: a `streamTurn` that reads only `role` + `content` still
 * works; one that forwards the whole message to an OpenAI-compatible endpoint
 * now sends correct tool history.
 */
type ToolLoopMessage = {
  role: string;
  content: string | null;
  tool_calls?: ToolLoopAssistantToolCall[];
  tool_call_id?: string;
};
type ToolLoopEvent = {
  type: 'text';
  text: string;
} | {
  type: 'tool_call';
  call: ToolLoopCall;
} | {
  type: 'other';
  event: unknown;
};
/** Why the loop stopped. `completed` = model finished naturally; `stuck-loop` =
 *  ≥3 consecutive identical tool calls (same tool + args); `backstop` = hit the
 *  runaway-backstop cap (200 by default); `deadline` = wall-clock deadlineMs
 *  exceeded; `budget` = maxCostUsd exhausted. Non-`completed` stops are infra /
 *  resource outcomes — eval scoring must distinguish them from capability failure. */
type ToolLoopStopReason = 'completed' | 'stuck-loop' | 'backstop' | 'deadline' | 'budget';
interface ToolLoopResult {
  finalText: string;
  toolResults: Array<{
    call: ToolLoopCall;
    label: string;
    outcome: ToolCallOutcome;
  }>;
  turns: number;
  stopReason: ToolLoopStopReason;
  /** @deprecated Use `stopReason !== 'completed'` instead. */
  cappedOut: boolean;
}
interface RunToolLoopOptions {
  systemPrompt: string;
  userMessage: string;
  priorMessages?: ToolLoopMessage[];
  streamTurn: (messages: ToolLoopMessage[]) => AsyncIterable<ToolLoopEvent>;
  executeToolCall: (call: ToolLoopCall) => Promise<ToolCallOutcome>;
  isExecutableTool: (toolName: string) => boolean;
  /** Runaway-backstop cap. Default 200 — set far above any legitimate workflow.
   *  For per-workflow limits, use `maxCostUsd` or `deadlineMs` instead. */
  maxToolTurns?: number;
  /** Wall-clock deadline in ms since epoch (Date.now()-based). When exceeded the
   *  loop stops with stopReason `deadline`. */
  deadlineMs?: number;
  /** Maximum total cost in USD. Requires `costOf` to meter each tool call. */
  maxCostUsd?: number;
  /** Return the USD cost of one outcome. Required for `maxCostUsd` to work. */
  costOf?: (call: ToolLoopCall, outcome: ToolCallOutcome) => number;
  renderResult?: (label: string, outcome: ToolCallOutcome) => string;
  labelFor?: (call: ToolLoopCall) => string;
  runId?: string;
  scenarioId?: string;
  hooks?: RuntimeHooks;
}
/** Run the bounded tool loop and return the final text + every executed tool
 *  outcome. Awaitable — callers needing to stream events to a UI use
 *  {@link streamToolLoop}. */
declare function runToolLoop(opts: RunToolLoopOptions): Promise<ToolLoopResult>;
type StreamToolLoopYield<Raw> = {
  kind: 'event';
  event: Raw;
} | {
  kind: 'tool_result';
  toolName: string;
  toolCallId?: string;
  label: string;
  outcome: ToolCallOutcome;
} | {
  kind: 'capped';
  pending: number;
  stopReason: Exclude<ToolLoopStopReason, 'completed'>;
};
interface StreamToolLoopOptions<Raw> {
  systemPrompt: string;
  userMessage: string;
  priorMessages?: ToolLoopMessage[];
  streamTurn: (messages: ToolLoopMessage[]) => AsyncIterable<Raw>;
  extractText: (event: Raw) => string;
  extractToolCall: (event: Raw) => ToolLoopCall | null;
  isExecutableTool: (toolName: string) => boolean;
  executeToolCall: (call: ToolLoopCall) => Promise<ToolCallOutcome>;
  /** Runaway-backstop cap. Default 200 — set far above any legitimate workflow. */
  maxToolTurns?: number;
  /** Wall-clock deadline in ms since epoch (Date.now()-based). */
  deadlineMs?: number;
  /** Maximum total cost in USD. Requires `costOf` to meter each tool call. */
  maxCostUsd?: number;
  /** Return the USD cost of one outcome. Required for `maxCostUsd` to work. */
  costOf?: (call: ToolLoopCall, outcome: ToolCallOutcome) => number;
  renderResult?: (label: string, outcome: ToolCallOutcome) => string;
  labelFor?: (call: ToolLoopCall) => string;
  runId?: string;
  scenarioId?: string;
  hooks?: RuntimeHooks;
}
/** Streaming bounded tool loop: yields each raw turn event (the caller maps +
 *  telemetries + re-emits it) and each executed `tool_result`; emits one
 *  `capped` if it stops for any non-completed reason with calls still pending. */
declare function streamToolLoop<Raw>(opts: StreamToolLoopOptions<Raw>): AsyncGenerator<StreamToolLoopYield<Raw>, void, unknown>;
//#endregion
export { RunToolLoopOptions, StreamToolLoopOptions, StreamToolLoopYield, ToolCallOutcome, ToolLoopAssistantToolCall, ToolLoopCall, ToolLoopEvent, ToolLoopMessage, ToolLoopResult, ToolLoopStopReason, runToolLoop, streamToolLoop };
//# sourceMappingURL=tool-loop.d.ts.map