import { AgentEvalError, AgentEvalError as AgentEvalError$1, ConfigError, JudgeError, NotFoundError, ValidationError } from "@tangle-network/agent-eval";
//#region src/errors.ts
/**
*
* Error taxonomy for `@tangle-network/agent-runtime`.
*
* Public contract: every error this package throws as part of its consumer-
* facing API either extends `AgentEvalError` (re-exported here for ergonomic
* `instanceof` checks at the runtime boundary) or extends one of the
* runtime-specific subclasses below.
*
* Internal invariant guards (`throw new Error('this should never happen')`)
* remain plain `Error` — they are programmer-mistake assertions, not
* consumer-catchable contract failures.
*
* Subclassing strategy: where a runtime-specific failure maps cleanly to an
* agent-eval code (validation, config, not_found), we re-use the agent-eval
* subclass. Runtime-only failure modes (session resume against the wrong
* backend, backend transport errors) get fresh subclasses that still carry an
* `AgentEvalErrorCode` so cross-package handlers can pattern-match without
* importing the runtime.
*
* @stable
*/
/**
*
* Caller asked to resume a session against a backend whose `kind` does not
* match the session's recorded backend. This is a routing bug — the same
* session id was reused across two different backend implementations — and
* is not retryable without picking the right backend.
*
* @stable
*/
var SessionMismatchError = class extends AgentEvalError {
	sessionBackend;
	requestedBackend;
	constructor(sessionBackend, requestedBackend, options) {
		super("validation", `Cannot resume ${sessionBackend} session with ${requestedBackend} backend`, options);
		this.sessionBackend = sessionBackend;
		this.requestedBackend = requestedBackend;
	}
};
/**
*
* A backend transport call (HTTP, gRPC, sidecar IPC) failed with a non-success
* status. Distinct from `JudgeError` (which is structural / unrecoverable)
* because backend failures are sometimes retryable and consumers may want to
* branch on the upstream status code.
*
* @stable
*/
var BackendTransportError = class extends AgentEvalError {
	backend;
	status;
	/**
	* Router-owned proof that a rejected request never reached a provider.
	*
	* This is intentionally one-sided. An absent value, or any value this
	* package does not understand, remains unknown to Runtime.
	*/
	providerDispatch;
	/**
	* The upstream's own error class when it names one (the bridge's `parse_error`,
	* `not_configured`, a provider's `invalid_request_error`). A class the upstream never
	* retries is a decision about the request, so a retry policy may read it where no
	* status arrived.
	*/
	upstreamCode;
	/**
	* Truncated upstream response body (≤2 KiB) when available. Diagnostic
	* only — surfaces in `backend_error.error.body` and `final.error.body`
	* so operators can see "free_tier_limit", "invalid_api_key", etc. without
	* cracking the log line open.
	*/
	body;
	constructor(backend, message, options) {
		super("config", message, options);
		this.backend = backend;
		this.status = options?.status;
		this.upstreamCode = options?.upstreamCode;
		this.body = options?.body;
		this.providerDispatch = options?.providerDispatch;
	}
};
/**
*
* A runtime-run lifecycle method was called in an order the state machine does
* not allow: `persist()` before `complete()`, `complete()` twice, etc.
*
* @stable
*/
var RuntimeRunStateError = class extends AgentEvalError {
	constructor(message, options) {
		super("validation", message, options);
	}
};
/**
*
* The dynamic-loop planner returned an unusable topology move — the LLM emitted
* no parseable envelope, an unknown `kind`, or a structurally-invalid move
* (e.g. a fanout with zero tasks). This is a structural failure of the
* agent-authored topology, not a config mistake: the planner ran but its output
* cannot drive the kernel. Carries `validation` so cross-package handlers can
* pattern-match without importing the runtime. Fail loud — never substitute a
* default move, or the loop silently runs a topology nobody chose.
*
* @stable
*/
var PlannerError = class extends AgentEvalError {
	constructor(message, options) {
		super("validation", message, options);
	}
};
/**
* The analyst loop could not read or run over a round's trace — e.g. an empty round
* (no iterations to analyze) or a malformed trace projection. Fail loud: a silent empty
* store would mask a broken capture path and the driver would steer on nothing.
*/
var AnalystError = class extends AgentEvalError {
	constructor(message, options) {
		super("validation", message, options);
	}
};
/**
*
* The caller's `onAdmission` durability hook rejected, so a retained run's
* admission record is not durable. For a pre-create intent, no provider work
* has started. For a later record, provider state may already be live and the
* environment remains available for recovery. Carries `capture_integrity`
* because the required recovery record was not written.
*
* @stable
*/
var RetainedAdmissionError = class extends AgentEvalError {
	phase;
	/** The exact record the hook failed to persist, for direct recovery. */
	admission;
	constructor(admission, options) {
		const recovery = admission.phase === "intent" || admission.phase === "interactive_intent" ? "no provider work has started" : "the environment is kept for recovery";
		super("capture_integrity", `retained run admission (${admission.phase}) was not persisted; ${recovery}`, options);
		this.phase = admission.phase;
		this.admission = admission;
	}
};
/** The caller could not persist one detached-run recovery record. @stable */
var RetainedRunAdmissionError = class extends RetainedAdmissionError {};
/** The caller could not persist one exact interactive-process recovery record. @stable */
var RetainedInteractiveAdmissionError = class extends RetainedAdmissionError {};
/**
* A provider returned a valid interactive reference that does not bind to the
* exact start request, or returned data that could not be parsed as one.
*
* The requested start and any valid provider reference are detached snapshots.
* Malformed provider data is never copied into the error, so the error remains
* safe to persist while the environment remains available for orphan cleanup.
*
* @stable
*/
var RetainedInteractiveBindingError = class extends AgentEvalError {
	/** The exact native-process start request sent to the provider. */
	requested;
	/** The valid provider data, when the provider returned a parseable value. */
	returned;
	constructor(requested, returned, options) {
		super("backend_integrity", "provider returned interactive data that does not bind to the requested start; the environment is kept for diagnosis and cleanup", options);
		this.requested = Object.freeze(requested);
		this.returned = Object.freeze(returned);
	}
};
/**
*
* A retained dispatch answered with coordinates that do not bind to the
* identity the runtime requested, or failed exact verification. The
* environment-phase admission is already durable at this point, so its
* coordinates plus the provider reference carried here are the manual
* recovery path. The environment is intentionally kept. Carries
* `backend_integrity` because the provider violated its dispatch contract.
*
* @stable
*/
var RetainedRunDispatchBindingError = class extends AgentEvalError {
	/** The coordinates the runtime sent with the dispatch. */
	requested;
	/** The loose reference the provider actually returned, for triage. */
	returned;
	constructor(requested, returned, options) {
		super("backend_integrity", "retained dispatch did not bind to the requested identity; the durable environment admission and the returned reference on this error are the recovery path", options);
		this.requested = requested;
		this.returned = returned;
	}
};
//#endregion
export { JudgeError as a, RetainedInteractiveAdmissionError as c, RetainedRunDispatchBindingError as d, RuntimeRunStateError as f, ConfigError as i, RetainedInteractiveBindingError as l, ValidationError as m, AnalystError as n, NotFoundError as o, SessionMismatchError as p, BackendTransportError as r, PlannerError as s, AgentEvalError$1 as t, RetainedRunAdmissionError as u };

//# sourceMappingURL=errors-DodWX-cb.js.map