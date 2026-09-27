//#region src/runtime-hooks.ts
/** Identity helper that types a {@link RuntimeHooks} literal so the fields are inferred. */
function defineRuntimeHooks(hooks) {
	return hooks;
}
/**
* Attach a stable pursuit identity to the entire observer stream without changing
* agent code or teaching individual runtimes about pursuits. Because recursive Scope
* execution already inherits one RuntimeHooks instance, this wrapper automatically
* covers descendants, nested drivers, and resumed execution that reuses the wrapper.
*
* Existing matching pursuit ids are preserved. A conflicting id fails closed: silently
* rewriting attribution would make the meta-observer untrustworthy.
*/
function withPursuitContext(pursuitId, hooks) {
	const stableId = pursuitId.trim();
	if (stableId.length === 0) throw new TypeError("withPursuitContext: pursuitId must be non-empty");
	const assertAndStamp = (value) => {
		if (value.pursuitId !== void 0 && value.pursuitId !== stableId) throw new Error(`withPursuitContext: observer identity conflict (${value.pursuitId} !== ${stableId})`);
		if (value.pursuitId === stableId) return value;
		return {
			...value,
			pursuitId: stableId
		};
	};
	return {
		onEvent: hooks.onEvent ? (event, context) => hooks.onEvent?.(assertAndStamp(event), context) : void 0,
		onDecisionPoint: hooks.onDecisionPoint ? (point, context) => hooks.onDecisionPoint?.(assertAndStamp(point), context) : void 0,
		onHookError: hooks.onHookError
	};
}
/**
* Merge several {@link RuntimeHooks} into one. Falsy entries are dropped (so you can
* pass `flag && hooks`), and every observer's `onEvent`/`onDecisionPoint` fires for each
* event. Use this to attach N observers to a loop instead of a second event bus.
*/
function composeRuntimeHooks(...entries) {
	const hooks = entries.filter((entry) => !!entry);
	return {
		onEvent: hooks.some((hook) => hook.onEvent) ? (event, context) => {
			const pending = [];
			for (const hook of hooks) {
				const result = hook.onEvent?.(event, context);
				if (isThenable(result)) pending.push(Promise.resolve(result));
			}
			if (pending.length > 0) return Promise.all(pending).then(() => void 0);
		} : void 0,
		onDecisionPoint: hooks.some((hook) => hook.onDecisionPoint) ? (point, context) => {
			const pending = [];
			for (const hook of hooks) {
				const result = hook.onDecisionPoint?.(point, context);
				if (isThenable(result)) pending.push(Promise.resolve(result));
			}
			if (pending.length > 0) return Promise.all(pending).then(() => void 0);
		} : void 0,
		onHookError: hooks.some((hook) => hook.onHookError) ? (error, context) => {
			const pending = [];
			for (const hook of hooks) {
				const result = hook.onHookError?.(error, context);
				if (isThenable(result)) pending.push(Promise.resolve(result));
			}
			if (pending.length > 0) return Promise.all(pending).then(() => void 0);
		} : void 0
	};
}
/** Fire `hooks.onEvent`, swallowing sync throws and surfacing async failures to `onError`. */
function notifyRuntimeHookEvent(hooks, event, context = {}) {
	const onEvent = hooks?.onEvent;
	if (!onEvent) return;
	try {
		const result = onEvent(event, context);
		if (isThenable(result)) result.catch((error) => {
			notifyRuntimeHookError(hooks, toError(error), {
				hook: "onEvent",
				eventId: event.id,
				target: event.target,
				phase: event.phase
			});
		});
	} catch (error) {
		notifyRuntimeHookError(hooks, toError(error), {
			hook: "onEvent",
			eventId: event.id,
			target: event.target,
			phase: event.phase
		});
	}
}
/** Fire `hooks.onDecisionPoint`, swallowing sync throws and surfacing async failures to `onError`. */
function notifyRuntimeDecisionPoint(hooks, point, context = {}) {
	const onDecisionPoint = hooks?.onDecisionPoint;
	if (!onDecisionPoint) return;
	try {
		const result = onDecisionPoint(point, context);
		if (isThenable(result)) result.catch((error) => {
			notifyRuntimeHookError(hooks, toError(error), {
				hook: "onDecisionPoint",
				decisionId: point.id,
				decisionKind: point.kind
			});
		});
	} catch (error) {
		notifyRuntimeHookError(hooks, toError(error), {
			hook: "onDecisionPoint",
			decisionId: point.id,
			decisionKind: point.kind
		});
	}
}
function notifyRuntimeHookError(hooks, error, context) {
	try {
		const result = hooks?.onHookError?.(error, context);
		if (isThenable(result)) result.catch(() => void 0);
	} catch {}
}
function isThenable(value) {
	return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
}
function toError(error) {
	return error instanceof Error ? error : new Error(String(error));
}
//#endregion
export { withPursuitContext as a, notifyRuntimeHookEvent as i, defineRuntimeHooks as n, notifyRuntimeDecisionPoint as r, composeRuntimeHooks as t };

//# sourceMappingURL=runtime-hooks-tXpAarhW.js.map