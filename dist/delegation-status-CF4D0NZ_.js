import { o as NotFoundError } from "./errors-DodWX-cb.js";
//#region src/mcp/feedback-store.ts
/** In-memory `FeedbackStore` — suitable for single-process use and tests. @stable */
var InMemoryFeedbackStore = class {
	events = [];
	async put(event) {
		this.events.push({ ...event });
	}
	async list(filter = {}) {
		let out = this.events;
		if (filter.namespace !== void 0) out = out.filter((event) => event.namespace === filter.namespace);
		if (filter.refersToRef !== void 0) out = out.filter((event) => event.refersTo.ref === filter.refersToRef);
		return out.map((event) => ({ ...event }));
	}
};
/**
* Project a `FeedbackEvent` down to the snapshot shape carried on
* `delegation_history` entries.
*
* @stable
*/
function eventToSnapshot(event) {
	const snap = {
		id: event.id,
		score: event.rating.score,
		by: event.by,
		notes: event.rating.notes,
		capturedAt: event.capturedAt
	};
	if (event.rating.label) snap.label = event.rating.label;
	return snap;
}
//#endregion
//#region src/mcp/tools/delegate-feedback.ts
/** MCP tool name for the `delegate_feedback` feedback-recording tool. @stable */
const DELEGATE_FEEDBACK_TOOL_NAME = "delegate_feedback";
/** Human-readable description of the `delegate_feedback` MCP tool, injected into the tool manifest. @stable */
const DELEGATE_FEEDBACK_DESCRIPTION = [
	"Record feedback on a delegation, artifact, or outcome. Synchronous — the",
	"event is durably stored when this call returns.",
	"",
	"Use when: you (the agent), the user, or a downstream judge has formed an",
	"opinion about a piece of work and want it persisted for calibration,",
	"pricing, or future routing. Every call is a new event — multiple ratings",
	"on the same target are expected and never deduped.",
	"",
	"`refersTo.kind`:",
	"  - \"delegation\": ref is a taskId returned by delegate_ui_audit",
	"  - \"artifact\":   ref is a URI/path/git-sha — anything you can dereference",
	"  - \"outcome\":    ref is a free-form description of a downstream result",
	"",
	"`by`:",
	"  - \"agent\":            the agent itself rated the work",
	"  - \"user\":             the human user rated it",
	"  - \"downstream-judge\": an automated evaluator emitted the rating",
	"",
	"When ref names a known taskId, the rating is also attached to the",
	"delegation record so delegation_history surfaces it inline."
].join("\n");
/** JSON Schema for `delegate_feedback` tool arguments (`refersTo`, `rating`, `by`, optional fields). @stable */
const DELEGATE_FEEDBACK_INPUT_SCHEMA = {
	type: "object",
	properties: {
		refersTo: {
			type: "object",
			properties: {
				kind: {
					type: "string",
					enum: [
						"delegation",
						"artifact",
						"outcome"
					]
				},
				ref: { type: "string" }
			},
			required: ["kind", "ref"],
			additionalProperties: false
		},
		rating: {
			type: "object",
			properties: {
				score: {
					type: "number",
					minimum: 0,
					maximum: 1
				},
				label: {
					type: "string",
					enum: [
						"good",
						"bad",
						"neutral",
						"mixed"
					]
				},
				notes: { type: "string" }
			},
			required: ["score", "notes"],
			additionalProperties: false
		},
		by: {
			type: "string",
			enum: [
				"agent",
				"user",
				"downstream-judge"
			]
		},
		capturedAt: { type: "string" },
		namespace: { type: "string" }
	},
	required: [
		"refersTo",
		"rating",
		"by"
	],
	additionalProperties: false
};
/** Parse and validate raw MCP tool input into typed `DelegateFeedbackArgs`; throws `TypeError` on bad input. @stable */
function validateDelegateFeedbackArgs(raw) {
	if (raw === null || typeof raw !== "object") throw new TypeError("delegate_feedback: arguments must be an object");
	const value = raw;
	const refersTo = validateRefersTo(value.refersTo);
	const rating = validateRating(value.rating);
	const by = value.by;
	if (by !== "agent" && by !== "user" && by !== "downstream-judge") throw new TypeError("delegate_feedback: `by` must be one of \"agent\" | \"user\" | \"downstream-judge\"");
	const args = {
		refersTo,
		rating,
		by
	};
	if (value.capturedAt !== void 0) {
		if (typeof value.capturedAt !== "string" || Number.isNaN(Date.parse(value.capturedAt))) throw new TypeError("delegate_feedback: `capturedAt` must be an ISO datetime");
		args.capturedAt = value.capturedAt;
	}
	if (typeof value.namespace === "string") args.namespace = value.namespace;
	return args;
}
function validateRefersTo(raw) {
	if (raw === null || typeof raw !== "object") throw new TypeError("delegate_feedback: `refersTo` must be an object");
	const value = raw;
	const kind = value.kind;
	if (kind !== "delegation" && kind !== "artifact" && kind !== "outcome") throw new TypeError("delegate_feedback: `refersTo.kind` must be one of \"delegation\" | \"artifact\" | \"outcome\"");
	const ref = value.ref;
	if (typeof ref !== "string" || ref.trim().length === 0) throw new TypeError("delegate_feedback: `refersTo.ref` must be a non-empty string");
	return {
		kind,
		ref: ref.trim()
	};
}
function validateRating(raw) {
	if (raw === null || typeof raw !== "object") throw new TypeError("delegate_feedback: `rating` must be an object");
	const value = raw;
	const score = Number(value.score);
	if (!Number.isFinite(score) || score < 0 || score > 1) throw new RangeError("delegate_feedback: `rating.score` must be a number in [0, 1]");
	const notes = value.notes;
	if (typeof notes !== "string") throw new TypeError("delegate_feedback: `rating.notes` must be a string");
	const rating = {
		score,
		notes
	};
	const label = value.label;
	if (label !== void 0) {
		if (label !== "good" && label !== "bad" && label !== "neutral" && label !== "mixed") throw new TypeError("delegate_feedback: `rating.label` must be one of \"good\" | \"bad\" | \"neutral\" | \"mixed\"");
		rating.label = label;
	}
	return rating;
}
/** Build the MCP tool handler that persists feedback events and attaches them to delegation records. @stable */
function createDelegateFeedbackHandler(options) {
	const generateId = options.generateId ?? randomFeedbackId;
	const now = options.now ?? (() => (/* @__PURE__ */ new Date()).toISOString());
	return async (raw) => {
		const args = validateDelegateFeedbackArgs(raw);
		const id = generateId();
		const event = {
			id,
			refersTo: args.refersTo,
			rating: args.rating,
			by: args.by,
			capturedAt: args.capturedAt ?? now(),
			namespace: args.namespace
		};
		await options.store.put(event);
		if (args.refersTo.kind === "delegation") options.queue.attachFeedback(args.refersTo.ref, eventToSnapshot(event));
		return {
			recorded: true,
			id
		};
	};
}
function randomFeedbackId() {
	return `fbk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
//#endregion
//#region src/mcp/types.ts
/**
* Every delegation profile a queued record can carry. One owner: the tool schemas and validators
* that filter on a profile read this list, so a profile added here cannot be one a tool refuses.
* @experimental
*/
const delegationProfiles = [
	"coder",
	"researcher",
	"ui-auditor"
];
//#endregion
//#region src/mcp/tools/delegation-history.ts
/** MCP tool name for the `delegation_history` read-past-delegations tool. @stable */
const DELEGATION_HISTORY_TOOL_NAME = "delegation_history";
/** Human-readable description of the `delegation_history` MCP tool, injected into the tool manifest. @stable */
const DELEGATION_HISTORY_DESCRIPTION = [
	"Read past delegations newest-first. Each entry carries the original",
	"arguments, current status, cost, and any feedback attached via",
	"delegate_feedback.",
	"",
	"Use when: you want to introspect prior decisions — \"have I asked this",
	"question before?",
	"did the last patch land?",
	"what's the historical",
	"success rate of coder delegations on this repo?\". Feed the results back",
	"into your own routing and calibration.",
	"",
	"Each entry carries `hasTrace` — when true, the full loop-trace span tree",
	"is retrievable via delegation_status { taskId, includeTrace: true }.",
	"",
	`Filters: \`namespace\` (multi-tenant scope), \`profile\` (${delegationProfiles.map((profile) => `"${profile}"`).join(" | ")}),`,
	"`since` (ISO date — only delegations started at-or-after). `limit` defaults",
	"to 50, capped at 500."
].join("\n");
/** JSON Schema for `delegation_history` tool arguments (optional `namespace`, `profile`, `since`, `limit`). @stable */
const DELEGATION_HISTORY_INPUT_SCHEMA = {
	type: "object",
	properties: {
		namespace: { type: "string" },
		profile: {
			type: "string",
			enum: delegationProfiles
		},
		since: {
			type: "string",
			description: "ISO datetime — earliest startedAt to include."
		},
		limit: {
			type: "integer",
			minimum: 1,
			maximum: 500
		}
	},
	additionalProperties: false
};
/** Parse and validate raw MCP tool input into typed `DelegationHistoryArgs`; throws `TypeError` on bad input. @stable */
function validateDelegationHistoryArgs(raw) {
	if (raw === void 0 || raw === null) return {};
	if (typeof raw !== "object") throw new TypeError("delegation_history: arguments must be an object");
	const value = raw;
	const out = {};
	if (value.namespace !== void 0) {
		if (typeof value.namespace !== "string") throw new TypeError("delegation_history: `namespace` must be a string");
		out.namespace = value.namespace;
	}
	if (value.profile !== void 0) {
		if (!delegationProfiles.includes(value.profile)) throw new TypeError(`delegation_history: \`profile\` must be one of ${delegationProfiles.join(", ")}`);
		out.profile = value.profile;
	}
	if (value.since !== void 0) {
		if (typeof value.since !== "string" || Number.isNaN(Date.parse(value.since))) throw new TypeError("delegation_history: `since` must be an ISO datetime");
		out.since = value.since;
	}
	if (value.limit !== void 0) {
		const n = Number(value.limit);
		if (!Number.isFinite(n) || n < 1 || n > 500) throw new RangeError("delegation_history: `limit` must be an integer in [1, 500]");
		out.limit = Math.trunc(n);
	}
	return out;
}
/** Build the MCP tool handler that reads filtered past delegations from a `DelegationTaskQueue`. @stable */
function createDelegationHistoryHandler(options) {
	return async (raw) => {
		const args = validateDelegationHistoryArgs(raw);
		return { delegations: options.queue.history(args) };
	};
}
//#endregion
//#region src/mcp/tools/delegation-status.ts
/**
*
* `delegation_status` MCP tool — synchronous poll. Returns the current
* state machine + optional progress + final result (when terminal).
*
* @stable
*/
/** MCP tool name for the `delegation_status` synchronous-poll tool. @stable */
const DELEGATION_STATUS_TOOL_NAME = "delegation_status";
/** Human-readable description of the `delegation_status` MCP tool, injected into the tool manifest. @stable */
const DELEGATION_STATUS_DESCRIPTION = [
	"Poll the status of an async delegation. Returns the current state",
	"(pending | running | completed | failed | cancelled), optional progress,",
	"and the final result when status === \"completed\".",
	"",
	"Use when: you previously kicked off an async delegation (delegate_ui_audit)",
	"and need to know whether the work is done. The agent's right rhythm is to",
	"call this every minute or two while waiting; do not busy-poll.",
	"",
	"For a completed delegate_ui_audit run, `result.output` is the array of UI",
	"findings — one self-contained Markdown finding per issue, each with an",
	"embedded screenshot and a suggested fix.",
	"",
	"Pass includeTrace: true to also receive the journaled loop-trace span",
	"tree (loop → round → iteration, with placement/cost/verdict metadata).",
	"Default false — keep routine polls light.",
	"",
	"Throws NotFoundError when taskId is unknown — never silently returns",
	"`pending` for a typo."
].join("\n");
/** JSON Schema for `delegation_status` tool arguments (`taskId` + optional `includeTrace`). @stable */
const DELEGATION_STATUS_INPUT_SCHEMA = {
	type: "object",
	properties: {
		taskId: {
			type: "string",
			description: "Returned by delegate_ui_audit."
		},
		includeTrace: {
			type: "boolean",
			description: "Also return the journaled loop-trace span tree for this delegation. Default false."
		}
	},
	required: ["taskId"],
	additionalProperties: false
};
/** Parse and validate raw MCP tool input into typed `DelegationStatusArgs`; throws `TypeError` on bad input. @stable */
function validateDelegationStatusArgs(raw) {
	if (raw === null || typeof raw !== "object") throw new TypeError("delegation_status: arguments must be an object");
	const value = raw;
	const taskId = value.taskId;
	if (typeof taskId !== "string" || taskId.trim().length === 0) throw new TypeError("delegation_status: `taskId` must be a non-empty string");
	const out = { taskId: taskId.trim() };
	if (value.includeTrace !== void 0) {
		if (typeof value.includeTrace !== "boolean") throw new TypeError("delegation_status: `includeTrace` must be a boolean");
		out.includeTrace = value.includeTrace;
	}
	return out;
}
/** Build the MCP tool handler that polls a `DelegationTaskQueue` for task status. @stable */
function createDelegationStatusHandler(options) {
	return async (raw) => {
		const args = validateDelegationStatusArgs(raw);
		const status = options.queue.status(args.taskId, args.includeTrace !== void 0 ? { includeTrace: args.includeTrace } : void 0);
		if (!status) throw new NotFoundError(`delegation_status: unknown taskId "${args.taskId}"`);
		return status;
	};
}
//#endregion
export { InMemoryFeedbackStore as _, validateDelegationStatusArgs as a, DELEGATION_HISTORY_TOOL_NAME as c, delegationProfiles as d, DELEGATE_FEEDBACK_DESCRIPTION as f, validateDelegateFeedbackArgs as g, createDelegateFeedbackHandler as h, createDelegationStatusHandler as i, createDelegationHistoryHandler as l, DELEGATE_FEEDBACK_TOOL_NAME as m, DELEGATION_STATUS_INPUT_SCHEMA as n, DELEGATION_HISTORY_DESCRIPTION as o, DELEGATE_FEEDBACK_INPUT_SCHEMA as p, DELEGATION_STATUS_TOOL_NAME as r, DELEGATION_HISTORY_INPUT_SCHEMA as s, DELEGATION_STATUS_DESCRIPTION as t, validateDelegationHistoryArgs as u, eventToSnapshot as v };

//# sourceMappingURL=delegation-status-CF4D0NZ_.js.map