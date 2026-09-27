import { i as notifyRuntimeHookEvent, r as notifyRuntimeDecisionPoint } from "./runtime-hooks-tXpAarhW.js";
//#region src/tool-loop.ts
/** Runaway-backstop: stops an infinite tool loop where cost is unmetered. Set
*  far above any legitimate workflow — this is a watchdog, not a policy cap.
*  Legitimate per-call budgets come from `maxCostUsd` + `costOf`. */
const RUNAWAY_BACKSTOP_TURNS = 200;
const DEFAULT_DECISION_CONTEXT_CHARS = 12e3;
const FAILURE_RECOVERY_ACTIONS = [
	"retry",
	"verify",
	"continue",
	"stop"
];
/** Consecutive identical calls (same tool + canonical-JSON args) that trigger
*  stuck-loop detection. The window resets on any different call. */
const STUCK_LOOP_THRESHOLD = 3;
/** A tool-call id is required to key a `role: 'tool'` result back to its call.
*  When the model omitted one, derive a stable id from the tool name so the
*  assistant `tool_calls` entry and its `tool` result still match. */
function toolCallId(call) {
	return call.toolCallId ?? `call_${call.toolName}`;
}
/** The assistant turn that emitted `pending`, in OpenAI shape: text content
*  (null when the turn was tool-only) plus its `tool_calls` array. */
function assistantToolCallMessage(turnText, pending) {
	return {
		role: "assistant",
		content: turnText.trim() || null,
		tool_calls: pending.map((call) => ({
			id: toolCallId(call),
			type: "function",
			function: {
				name: call.toolName,
				arguments: JSON.stringify(call.args)
			}
		}))
	};
}
/** One `role: 'tool'` result message keyed to its call by `tool_call_id`. */
function toolResultMessage(call, content) {
	return {
		role: "tool",
		tool_call_id: toolCallId(call),
		content
	};
}
function defaultRender(label, outcome) {
	if (outcome.ok) return `- ${label} → ok: ${JSON.stringify(outcome.result)}`;
	return `- ${label} → failed (${outcome.code}): ${outcome.message}`;
}
/** Run the bounded tool loop and return the final text + every executed tool
*  outcome. Awaitable — callers needing to stream events to a UI use
*  {@link streamToolLoop}. */
async function runToolLoop(opts) {
	const backstop = opts.maxToolTurns ?? RUNAWAY_BACKSTOP_TURNS;
	const render = opts.renderResult ?? defaultRender;
	const labelFor = opts.labelFor ?? ((c) => c.toolName);
	const runId = opts.runId ?? `agent-run-${randomSuffix()}`;
	const messages = [
		{
			role: "system",
			content: opts.systemPrompt
		},
		...opts.priorMessages ?? [],
		{
			role: "user",
			content: opts.userMessage
		}
	];
	const observer = createToolLoopObserver(opts.hooks, runId, opts.scenarioId);
	const toolResults = [];
	let finalText = "";
	let turns = 0;
	let accumulatedCostUsd = 0;
	let lastCallHash = null;
	let consecutiveCount = 0;
	observer.loopBefore(backstop, messages.length);
	for (let toolTurn = 0;; toolTurn++) {
		turns++;
		if (opts.deadlineMs !== void 0 && Date.now() >= opts.deadlineMs) {
			observer.loopAfter({
				turns,
				toolResults: toolResults.length,
				stopReason: "deadline"
			});
			return {
				finalText,
				toolResults,
				turns,
				stopReason: "deadline",
				cappedOut: true
			};
		}
		let turnText = "";
		const pending = [];
		const turnEventId = observer.turnBefore(toolTurn, messages.length);
		for await (const ev of opts.streamTurn([...messages])) if (ev.type === "text") {
			turnText += ev.text;
			finalText += ev.text;
		} else if (ev.type === "tool_call" && opts.isExecutableTool(ev.call.toolName)) pending.push(ev.call);
		if (pending.length === 0) {
			observer.turnAfter(toolTurn, turnEventId, {
				pendingToolCalls: 0,
				finalTextChars: finalText.length
			});
			break;
		}
		if (toolTurn >= backstop) {
			observer.turnAfter(toolTurn, turnEventId, {
				pendingToolCalls: pending.length,
				stopReason: "backstop"
			});
			observer.loopAfter({
				turns,
				toolResults: toolResults.length,
				stopReason: "backstop"
			});
			return {
				finalText,
				toolResults,
				turns,
				stopReason: "backstop",
				cappedOut: true
			};
		}
		messages.push(assistantToolCallMessage(turnText, pending));
		const outcomes = [];
		for (const [callIndex, call] of pending.entries()) {
			const callHash = canonicalCallHash(call);
			if (callHash === lastCallHash) consecutiveCount++;
			else {
				lastCallHash = callHash;
				consecutiveCount = 1;
			}
			if (consecutiveCount >= STUCK_LOOP_THRESHOLD) {
				observer.turnAfter(toolTurn, turnEventId, {
					pendingToolCalls: pending.length,
					stopReason: "stuck-loop"
				});
				observer.loopAfter({
					turns,
					toolResults: toolResults.length,
					stopReason: "stuck-loop"
				});
				return {
					finalText,
					toolResults,
					turns,
					stopReason: "stuck-loop",
					cappedOut: true
				};
			}
			const callEventId = observer.toolCallBefore(toolTurn, turnEventId, callIndex, call);
			let outcome;
			try {
				outcome = await opts.executeToolCall(call);
			} catch (err) {
				outcome = {
					ok: false,
					code: "executor_error",
					message: err instanceof Error ? err.message : String(err)
				};
			}
			if (opts.maxCostUsd !== void 0 && opts.costOf !== void 0) {
				accumulatedCostUsd += opts.costOf(call, outcome);
				if (accumulatedCostUsd >= opts.maxCostUsd) {
					const label = labelFor(call);
					toolResults.push({
						call,
						label,
						outcome
					});
					messages.push(toolResultMessage(call, render(label, outcome)));
					observer.toolCallAfter(toolTurn, callEventId, call, outcome);
					observer.turnAfter(toolTurn, turnEventId, {
						pendingToolCalls: pending.length,
						stopReason: "budget"
					});
					observer.loopAfter({
						turns,
						toolResults: toolResults.length,
						stopReason: "budget"
					});
					return {
						finalText,
						toolResults,
						turns,
						stopReason: "budget",
						cappedOut: true
					};
				}
			}
			const label = labelFor(call);
			const rendered = render(label, outcome);
			toolResults.push({
				call,
				label,
				outcome
			});
			outcomes.push({
				call,
				label,
				outcome,
				rendered
			});
			messages.push(toolResultMessage(call, rendered));
			observer.toolCallAfter(toolTurn, callEventId, call, outcome);
		}
		observer.failureRecovery({
			toolTurn,
			messages,
			turnText,
			outcomes
		});
		observer.turnAfter(toolTurn, turnEventId, {
			pendingToolCalls: pending.length,
			toolResults: outcomes.map((item) => ({
				toolName: item.call.toolName,
				toolCallId: item.call.toolCallId,
				ok: item.outcome.ok
			})),
			failedToolCalls: outcomes.filter((item) => !item.outcome.ok).length
		});
	}
	observer.loopAfter({
		turns,
		toolResults: toolResults.length,
		stopReason: "completed"
	});
	return {
		finalText,
		toolResults,
		turns,
		stopReason: "completed",
		cappedOut: false
	};
}
/** Streaming bounded tool loop: yields each raw turn event (the caller maps +
*  telemetries + re-emits it) and each executed `tool_result`; emits one
*  `capped` if it stops for any non-completed reason with calls still pending. */
async function* streamToolLoop(opts) {
	const backstop = opts.maxToolTurns ?? RUNAWAY_BACKSTOP_TURNS;
	const render = opts.renderResult ?? defaultRender;
	const labelFor = opts.labelFor ?? ((c) => c.toolName);
	const runId = opts.runId ?? `agent-run-${randomSuffix()}`;
	const messages = [
		{
			role: "system",
			content: opts.systemPrompt
		},
		...opts.priorMessages ?? [],
		{
			role: "user",
			content: opts.userMessage
		}
	];
	const observer = createToolLoopObserver(opts.hooks, runId, opts.scenarioId);
	let accumulatedCostUsd = 0;
	let lastCallHash = null;
	let consecutiveCount = 0;
	observer.loopBefore(backstop, messages.length);
	for (let toolTurn = 0;; toolTurn++) {
		if (opts.deadlineMs !== void 0 && Date.now() >= opts.deadlineMs) {
			observer.loopAfter({
				turns: toolTurn + 1,
				stopReason: "deadline"
			});
			yield {
				kind: "capped",
				pending: 0,
				stopReason: "deadline"
			};
			return;
		}
		let turnText = "";
		const pending = [];
		const turnEventId = observer.turnBefore(toolTurn, messages.length);
		for await (const event of opts.streamTurn([...messages])) {
			yield {
				kind: "event",
				event
			};
			turnText += opts.extractText(event);
			const call = opts.extractToolCall(event);
			if (call && opts.isExecutableTool(call.toolName)) pending.push(call);
		}
		if (pending.length === 0) {
			observer.turnAfter(toolTurn, turnEventId, { pendingToolCalls: 0 });
			observer.loopAfter({
				turns: toolTurn + 1,
				stopReason: "completed"
			});
			return;
		}
		if (toolTurn >= backstop) {
			observer.turnAfter(toolTurn, turnEventId, {
				pendingToolCalls: pending.length,
				stopReason: "backstop"
			});
			observer.loopAfter({
				turns: toolTurn + 1,
				stopReason: "backstop"
			});
			yield {
				kind: "capped",
				pending: pending.length,
				stopReason: "backstop"
			};
			return;
		}
		messages.push(assistantToolCallMessage(turnText, pending));
		const outcomes = [];
		for (const [callIndex, call] of pending.entries()) {
			const callHash = canonicalCallHash(call);
			if (callHash === lastCallHash) consecutiveCount++;
			else {
				lastCallHash = callHash;
				consecutiveCount = 1;
			}
			if (consecutiveCount >= STUCK_LOOP_THRESHOLD) {
				observer.turnAfter(toolTurn, turnEventId, {
					pendingToolCalls: pending.length,
					stopReason: "stuck-loop"
				});
				observer.loopAfter({
					turns: toolTurn + 1,
					stopReason: "stuck-loop"
				});
				yield {
					kind: "capped",
					pending: pending.length,
					stopReason: "stuck-loop"
				};
				return;
			}
			const callEventId = observer.toolCallBefore(toolTurn, turnEventId, callIndex, call);
			let outcome;
			try {
				outcome = await opts.executeToolCall(call);
			} catch (err) {
				outcome = {
					ok: false,
					code: "executor_error",
					message: err instanceof Error ? err.message : String(err)
				};
			}
			if (opts.maxCostUsd !== void 0 && opts.costOf !== void 0) {
				accumulatedCostUsd += opts.costOf(call, outcome);
				if (accumulatedCostUsd >= opts.maxCostUsd) {
					const label = labelFor(call);
					yield {
						kind: "tool_result",
						toolName: call.toolName,
						toolCallId: call.toolCallId,
						label,
						outcome
					};
					messages.push(toolResultMessage(call, render(label, outcome)));
					observer.toolCallAfter(toolTurn, callEventId, call, outcome);
					observer.turnAfter(toolTurn, turnEventId, {
						pendingToolCalls: pending.length,
						stopReason: "budget"
					});
					observer.loopAfter({
						turns: toolTurn + 1,
						stopReason: "budget"
					});
					yield {
						kind: "capped",
						pending: pending.length,
						stopReason: "budget"
					};
					return;
				}
			}
			const label = labelFor(call);
			yield {
				kind: "tool_result",
				toolName: call.toolName,
				toolCallId: call.toolCallId,
				label,
				outcome
			};
			const rendered = render(label, outcome);
			outcomes.push({
				call,
				label,
				outcome,
				rendered
			});
			messages.push(toolResultMessage(call, rendered));
			observer.toolCallAfter(toolTurn, callEventId, call, outcome);
		}
		observer.failureRecovery({
			toolTurn,
			messages,
			turnText,
			outcomes
		});
		observer.turnAfter(toolTurn, turnEventId, {
			pendingToolCalls: pending.length,
			toolResults: outcomes.map((item) => ({
				toolName: item.call.toolName,
				toolCallId: item.call.toolCallId,
				ok: item.outcome.ok
			})),
			failedToolCalls: outcomes.filter((item) => !item.outcome.ok).length
		});
	}
}
function createToolLoopObserver(hooks, runId, scenarioId) {
	const loopEventId = `${runId}:agent.run`;
	return {
		loopBefore: (maxToolTurns, messageCount) => {
			notifyToolLoopEvent({
				hooks,
				runId,
				scenarioId,
				target: "agent.run",
				phase: "before",
				id: `${loopEventId}:before`,
				payload: {
					maxToolTurns,
					messageCount
				}
			});
		},
		loopAfter: (payload) => {
			notifyToolLoopEvent({
				hooks,
				runId,
				scenarioId,
				target: "agent.run",
				phase: "after",
				id: `${loopEventId}:after`,
				payload
			});
		},
		turnBefore: (toolTurn, messageCount) => {
			const turnEventId = `${loopEventId}:${toolTurn}`;
			notifyToolLoopEvent({
				hooks,
				runId,
				scenarioId,
				target: "agent.turn",
				phase: "before",
				id: turnEventId,
				stepIndex: toolTurn,
				parentId: loopEventId,
				payload: { messageCount }
			});
			return turnEventId;
		},
		turnAfter: (toolTurn, turnEventId, payload) => {
			notifyToolLoopEvent({
				hooks,
				runId,
				scenarioId,
				target: "agent.turn",
				phase: "after",
				id: `${turnEventId}:after`,
				stepIndex: toolTurn,
				parentId: turnEventId,
				payload
			});
		},
		toolCallBefore: (toolTurn, turnEventId, callIndex, call) => {
			const callEventId = `${turnEventId}:tool-call:${callIndex}`;
			notifyToolLoopEvent({
				hooks,
				runId,
				scenarioId,
				target: "agent.tool_call",
				phase: "before",
				id: callEventId,
				stepIndex: toolTurn,
				parentId: turnEventId,
				payload: toolCallPayload(call)
			});
			return callEventId;
		},
		toolCallAfter: (toolTurn, callEventId, call, outcome) => {
			notifyToolLoopEvent({
				hooks,
				runId,
				scenarioId,
				target: "agent.tool_call",
				phase: "after",
				id: `${callEventId}:after`,
				stepIndex: toolTurn,
				parentId: callEventId,
				payload: {
					...toolCallPayload(call),
					outcome: outcomePayload(outcome)
				}
			});
		},
		failureRecovery: (options) => {
			notifyToolFailureRecovery({
				hooks,
				runId,
				scenarioId,
				stepIndex: options.toolTurn,
				messages: options.messages,
				turnText: options.turnText,
				outcomes: options.outcomes
			});
		}
	};
}
function notifyToolLoopEvent(options) {
	notifyRuntimeHookEvent(options.hooks, {
		id: options.id ?? `${options.runId}:${options.target}:${options.phase}`,
		runId: options.runId,
		scenarioId: options.scenarioId,
		target: options.target,
		phase: options.phase,
		timestamp: Date.now(),
		stepIndex: options.stepIndex,
		parentId: options.parentId,
		payload: options.payload,
		metadata: {
			producer: "tool-loop",
			...options.metadata
		}
	});
}
function notifyToolFailureRecovery(options) {
	const failed = options.outcomes.filter((item) => !item.outcome.ok);
	if (failed.length === 0) return;
	const evidence = [];
	for (const item of failed) {
		const id = item.call.toolCallId ?? `${options.stepIndex}:${item.label}`;
		evidence.push({
			source: "tool_call",
			id,
			detail: `${item.call.toolName} ${stringifySafe(item.call.args, 2e3)}`,
			metadata: {
				toolName: item.call.toolName,
				label: item.label
			}
		});
		evidence.push({
			source: "tool_result",
			id: `${id}:result`,
			detail: item.rendered,
			metadata: failureMetadata(item.outcome)
		});
	}
	notifyRuntimeDecisionPoint(options.hooks, {
		id: `${options.runId}:agent.turn:${options.stepIndex}:failure-recovery`,
		runId: options.runId,
		scenarioId: options.scenarioId,
		stepIndex: options.stepIndex,
		kind: "retry",
		candidateActions: [...FAILURE_RECOVERY_ACTIONS],
		context: renderDecisionContext(options.messages, options.turnText, options.outcomes),
		evidence,
		metadata: {
			target: "failure-recovery",
			source: "agent.turn",
			failedToolCount: failed.length,
			toolNames: failed.map((item) => item.call.toolName)
		}
	});
}
function toolCallPayload(call) {
	return {
		toolName: call.toolName,
		toolCallId: call.toolCallId,
		argsPreview: stringifySafe(call.args, 2e3)
	};
}
function outcomePayload(outcome) {
	if (!outcome.ok) return {
		ok: false,
		code: outcome.code,
		message: trimText(outcome.message, 2e3),
		status: outcome.status
	};
	return {
		ok: true,
		resultPreview: stringifySafe(outcome.result, 2e3)
	};
}
function failureMetadata(outcome) {
	if (outcome.ok) return void 0;
	return {
		code: outcome.code,
		message: outcome.message,
		status: outcome.status
	};
}
function renderDecisionContext(messages, turnText, outcomes) {
	const recent = messages.slice(-6).map((message) => `[${message.role}]\n${message.content ?? ""}`);
	const assistant = turnText.trim() ? [`[assistant]\n${turnText}`] : [];
	const toolResults = [`[tool results]\n${outcomes.map((item) => item.rendered).join("\n")}`];
	return trimText([
		...recent,
		...assistant,
		...toolResults
	].join("\n\n"), DEFAULT_DECISION_CONTEXT_CHARS);
}
/** Canonical identifier for a tool call used by stuck-loop detection.
*  Keys are sorted so `{b:1,a:2}` and `{a:2,b:1}` produce the same hash. */
function canonicalCallHash(call) {
	const sortedArgs = Object.fromEntries(Object.entries(call.args).sort(([a], [b]) => a.localeCompare(b)));
	return `${call.toolName}:${JSON.stringify(sortedArgs)}`;
}
function stringifySafe(value, max) {
	let text;
	try {
		text = JSON.stringify(value) ?? String(value);
	} catch {
		text = String(value);
	}
	return trimText(text, max);
}
function trimText(text, max) {
	if (text.length <= max) return text;
	return `${text.slice(0, max)}…`;
}
function randomSuffix(len = 8) {
	return Math.random().toString(36).slice(2, 2 + len);
}
//#endregion
export { runToolLoop, streamToolLoop };

//# sourceMappingURL=tool-loop.js.map