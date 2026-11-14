type: major
---
Graph-consumer cohort: 16 public type changes since 9.0.16. Code that only calls these APIs mostly compiles unchanged; code that reads the widened results, switches on `kind`, wraps the overloaded function or constructs the changed objects must adapt as listed.

`@tangle-network/agent-runtime`:
- `ImproveSearchOptions` no longer omits `finalEvidence`: it now accepts `finalEvidence?: FinalEvidencePolicy` (Eval's shared final-evidence policy). Existing options compile; pass a policy to bind the final test split to the search identity.
- `ImproveSearchResult` adds `finalEvidence?: FinalEvidenceUse`, the final-data reservation and exposure, present when a policy was supplied. Nothing to change unless you pass a policy.
- `RunKnowledgeImprovementJobOptions.runSupervised` is now `SupervisedKnowledgeUpdateOptions['runSupervised']`: Runtime passes a fourth argument, `context?: { root, goal }`, the exact isolated update workspace. A custom runner should use that root instead of inferring it from the task text. `onMeasurement` measurements add `supervisedSpent.tokensKnown?: boolean`; absent means token completeness is unknown.

`@tangle-network/agent-runtime/durable`:
- `runEvidence(runDir)`: each `nodes[]` entry's `node`, `settled` and `tokens` were always present (possibly `undefined`); they are now optional and absent when unknown. Read them as optional; `'node' in entry` is false for an unlabelled node.

`@tangle-network/agent-runtime/intelligence`:
- `AgentProfileImprovementMethodOptions` was `ImproveMethodOptions` without `agent`, `executionRef`, `findings` and `surface`; it is now that or the same cut of `ImproveSearchOptions`, so `improvement` can name a native search method. Code that reads its fields must first check whether `method` is a native search (`kind: 'search'`, built with `searchMethod`).
- `ProposeAgentProfileImprovementResult.improvement` was `ImproveMethodResult`; it is now `ImproveMethodResult | ImproveSearchResult`. Narrow on `improvement.mode` (`'method'` or `'search'`) before reading method-only fields.
- `proposeAgentProfileImprovement` options add `modelBinding?` (a static binding or a function resolved once on the frozen baseline and candidate profiles) and `allowIncomplete?: false`. A second overload takes `RecordAgentProfileImprovementOptions` (`allowIncomplete: true`, whose `executor.measure` returns a recorded run receipt) and resolves to the result, `ProposeAgentProfileImprovementIncompleteResult` or `ProposeAgentProfileImprovementHeldResult`. Existing calls select the first overload; a wrapper or mock typed as `typeof proposeAgentProfileImprovement` must provide both.

`@tangle-network/agent-runtime/kernel`:
- `BoundHarnessSession` and `HarnessFileBinding` keep the same members but are now re-exported from `@tangle-network/harness-sessions` (a new `^1.0.13` dependency) instead of being declared by Runtime. Structural use is unchanged.
- `HarnessTranscriptBinding.kind` was `'bridge'`; it is now `'bridge' | 'provider'`, and the binding adds optional `controlRef` (required for provider captures) and `nativeSessionIds` (the ordered retry roots). An exhaustive switch on `kind` needs a `provider` arm.
- `ProviderWorkspaceCaptureProvenance`: `sessions[].nativeStore.entries[]` adds `contentOmitted?: 'harness-install' | 'harness-cache'`. Such an entry's bytes were deliberately not retained; do not count it as missing evidence.
- `readBoundHarnessSessions` input adds optional `nativeSessionIds`: several root sessions, at most 1,000, distinct, and including `nativeSessionId`. Its file and session types are the harness-sessions types above, and the family walk now runs in harness-sessions under Runtime's archive path policy.
- `captureBoundHarnessTranscript` takes the same new `nativeSessionIds` and the new binding, and throws `Native capture binding is incomplete` when `binding.nativeSessionIds` (default `[binding.nativeSessionId]`) differs from `nativeSessionIds` (default `[nativeSessionId]`). Pass the same root list in both.

`@tangle-network/agent-runtime/kernel` and `@tangle-network/agent-runtime/mcp`:
- `CoordinationEvent`: the `route` event's union is unchanged in source, but it is now the exported `RouteFlowEvent` (from `/kernel`), so the type is referenced by name. No code change; import `RouteFlowEvent` instead of re-deriving it.

`@tangle-network/agent-runtime/tui`:
- `SupervisorView.lastRoute` is still `Extract<RouteFlowEvent, { kind: 'stopped' | 'unrouted' }>` in source; it now references the exported `RouteFlowEvent`. No code change.
