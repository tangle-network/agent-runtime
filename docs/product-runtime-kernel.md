# Product Runtime Kernel

Status: complete. Implemented in `@tangle-network/agent-runtime@0.5.0`;
validated, documented, and hardened through `0.5.2`.

This document is the completion record for the production runtime kernel: what
it is for, what is done, how it was validated, what is intentionally outside the
public package, and how product repos should adopt it.

## Purpose

`agent-runtime` exists to make agent execution consistent across products and
eval harnesses. It should own the contract for:

- readiness gating before execution;
- session create/resume for long-running coding harnesses;
- backend-agnostic streaming;
- sanitized product/eval telemetry;
- durable evidence that can feed reports, failure classification, and
  optimization.

It should not be a decorative event logger around unrelated product code. If a
product route still calls a backend directly, hand-rolls SSE, and only emits
`start/end`, it is not getting the full value.

## Runtime Flow

```txt
TaskSpec
  -> knowledge readiness
  -> optional ask/acquire/refresh
  -> readiness decision
  -> session create/resume
  -> execution backend stream
  -> normalized RuntimeStreamEvent
  -> sanitized SSE / persisted session event history
  -> final task status
```

## Definition of Done

The kernel is complete when these are true:

- A product route can call one runtime entry point, `runAgentTaskStream`, rather
  than hand-rolling readiness + backend execution + SSE framing.
- A coding harness can continue an existing workspace by passing `sessionId` and
  `resume: true`.
- A backend can be swapped without changing product stream consumers.
- A failed backend emits structured failure events and gets a `stop()` callback
  when available.
- All UI/report telemetry has a safe sanitized representation by default.
- Eval and optimization systems can distinguish missing context/runtime failure
  from prompt/model reasoning failure.

All kernel-side criteria are satisfied in `0.5.2`. Durable storage and UI
rollout are product adoption tasks, not core package blockers.

Completion verdict: passed. There are no open kernel blockers in this document.

## Completed API Surface

### Execution

- `runAgentTaskStream(options)`
  - Applies readiness before backend execution.
  - Emits `task_start`, `readiness_start`, `readiness_end`.
  - Stops before backend execution when blocking gaps remain.
  - Creates or resumes a backend session.
  - Normalizes backend output into `RuntimeStreamEvent`.
  - Emits `backend_start`, `backend_end`, `task_end`, and `final`.
  - Records backend stream events into an optional `RuntimeSessionStore`.
  - Calls `backend.stop(session, reason)` on stream failure when a backend
    supplies the hook.

- `runAgentTask(options)`
  - Existing control-loop path for eval-oriented agents.
  - Still useful for deterministic eval/optimization harnesses that model
    observe/validate/decide/act directly.

### Stream Contract

- `RuntimeStreamEvent`
  - Readiness: `readiness_start`, `readiness_end`.
  - Context collection: `questions_start`, `questions_end`,
    `acquisition_start`, `acquisition_end`.
  - Session: `session_created`, `session_resumed`.
  - Backend lifecycle: `backend_start`, `backend_end`, `backend_error`.
  - Product stream: `text_delta`, `reasoning_delta`, `tool_call`,
    `tool_result`, `artifact`.
  - Completion: `task_end`, `final`.

### Sessions

- `RuntimeSession`
  - Stable `id`, backend kind, status, timestamps, optional `resumeToken`, and
    metadata.

- `RuntimeSessionStore`
  - Minimal persistence contract: `get`, `put`, `appendEvent`, `listEvents`.
  - Product repos should back this with D1/Postgres/Redis/etc. for real resume.

- `InMemoryRuntimeSessionStore`
  - Useful for tests, local demos, and short-lived worker processes.
  - Not durable enough for production resume by itself.

### Backend Abstraction

- `AgentExecutionBackend`
  - `start`, `resume`, `stream`, optional `stop`.
  - SDK-agnostic: the package owns the contract, callers own concrete clients
    and auth.

- `createIterableBackend`
  - Escape hatch for custom harnesses, browser agents, and test doubles.

- `createSandboxPromptBackend`
  - Wraps sandbox/sidecar clients that expose `streamPrompt`.
  - Supports caller-provided session IDs and resume via backend `resume`.
  - Maps common sandbox events to `text_delta`, `tool_call`, and `tool_result`.

- `createOpenAICompatibleBackend`
  - Wraps TCloud/OpenAI-compatible `/chat/completions` streaming APIs.
  - Normalizes streamed content deltas into `text_delta`.
  - Also covers [cli-bridge](https://github.com/drewstone/cli-bridge) and any
    other OpenAI-compatible HTTP gateway — point `baseUrl` at the bridge's
    `/v1` and use a `<harness>/<model>` string as `model`.

### Sanitization and SSE

- `sanitizeRuntimeStreamEvent(event, options)`
  - Redacts task inputs, user answers, control payloads, metadata, artifact
    URIs, and evidence IDs by default.
  - Reveals payloads only through explicit diagnostic options.

- `runtimeStreamServerSentEvent(event, options)`
  - Encodes any sanitized runtime stream event as SSE.
  - Prevents every product route from hand-rolling inconsistent framing.

- Existing helpers remain:
  - `sanitizeAgentRuntimeEvent`
  - `createRuntimeEventCollector`
  - `readinessServerSentEvent`
  - `encodeServerSentEvent`

## Validation Matrix

Implemented test coverage in `tests/runtime.test.ts`:

- Ready task runs through the existing control lifecycle.
- Missing blocking knowledge stops before action.
- Knowledge question/acquisition hooks refresh readiness before control.
- Sanitized runtime telemetry redacts secrets by default.
- Readiness decisions return stable `ready`, `blocked`, and `caveat` states.
- SSE encoding strips unsafe control-field newlines.
- Readiness SSE payloads use sanitized reports.
- `runAgentTaskStream` blocks backend execution when readiness is missing.
- Streaming backend creates a session, persists events, and resumes by
  `sessionId`.
- Sanitized tool-call stream events hide payloads by default and reveal them
  only with `includeControlPayloads`.
- Sandbox prompt events map to text/tool runtime stream events.
- OpenAI-compatible streaming chat completions parse token deltas and produce a
  final completed event.
- Knowledge question preflight emits exactly one `questions_end`.
- CLI bridge streams parse NDJSON events and include session/message payloads in
  bridge requests.
- Backend stream failure calls `backend.stop`, emits `backend_error`, and
  returns a failed `final` event with partial text preserved.

Release verification:

- `pnpm test`
- `pnpm typecheck`
- `pnpm build`
- Published to npm as `@tangle-network/agent-runtime@0.5.0`.
- Documentation validation published in `@tangle-network/agent-runtime@0.5.1`.
- Hardening validation published in `@tangle-network/agent-runtime@0.5.2`.

## Completion Scorecard

| Area | Status | Evidence |
| --- | --- | --- |
| Readiness gate | Complete | `runAgentTaskStream` blocks before backend execution when readiness is blocked. |
| Stream contract | Complete | `RuntimeStreamEvent` covers readiness, session, backend, text, reasoning, tool, artifact, error, task end, final. |
| Session resume contract | Complete | `RuntimeSession`, `RuntimeSessionStore`, `session_created`, `session_resumed`, `resumeToken`. |
| Backend abstraction | Complete | `AgentExecutionBackend` with `start`, `resume`, `stream`, optional `stop`. |
| Sandbox adapter | Complete | `createSandboxPromptBackend`; product proof in `agent-builder` PR #61. |
| TCloud/OpenAI-compatible adapter | Complete | `createOpenAICompatibleBackend`; tested with streamed chat completions. Also serves cli-bridge (OpenAI-compatible) and any HTTP gateway. |
| SSE framing | Complete | `runtimeStreamServerSentEvent`, newline-safe SSE encoder. |
| Sanitization | Complete | Default redaction for task inputs, answers, payloads, metadata, URIs, evidence IDs. |
| Failure handling | Complete | Backend exceptions produce `backend_error`, failed `task_end`, failed `final`, and call `stop` when supplied. |
| Durable persistence | Contract complete, product-owned | `RuntimeSessionStore` interface exists; product repos must provide D1/Postgres/Redis implementations. |
| UI rollout | Product-owned | Runtime emits stable events; product UIs decide rendering. |

## Completion Boundaries

The package is done when the reusable contract is complete. The package is not
responsible for product-specific state, credentials, databases, or UX. Those are
adoption responsibilities.

### Complete in `agent-runtime`

- Public task and stream contracts.
- Readiness-gated streamed execution.
- Session create/resume contract.
- Backend abstraction and adapter factories.
- Safe stream sanitization.
- SSE encoding.
- Failure normalization and backend stop hook.
- Unit tests for the contract and shipped adapters.
- NPM package publication.

### Not Part of the Public Kernel

- Product database migrations.
- Product-specific session persistence.
- Product-specific auth, secrets, billing, and rate limits.
- UI components for resume/readiness.
- Domain-specific knowledge requirements and tool policies.
- Concrete private SDK client construction.

These are not deferred kernel tasks. They are downstream integration tasks.

## Critique

The runtime kernel is now materially useful, but it is not magic. The most
important limitations are deliberate:

- It does not construct TCloud, sandbox, or CLI bridge clients. Product repos
  own credentials and client lifecycle.
- It does not persist sessions durably unless a product supplies a durable
  `RuntimeSessionStore`.
- It does not enforce all budgets/approvals/tool policies by itself yet. Those
  still live in product adapters or `agent-eval` control loops.
- It does not guarantee backend resume works if the underlying backend cannot
  resume. It passes stable session IDs/resume tokens and records history; the
  backend must honor them.
- It does not replace domain-specific wrappers. Tax/legal/GTM/creative still
  need their own requirements, tools, prompts, and report semantics.

These constraints are correct for a public package. The core should define the
contract and provide high-quality adapters, not absorb private product code.

The main remaining architectural risk is misuse: product teams can still bypass
the kernel and directly call sandbox/TCloud/CLI streams. Reviews should treat
new hand-rolled readiness + stream loops as a smell unless the route has a
specific reason to avoid runtime normalization.

## Downstream Adoption Checklist

For product routes:

- Replace direct sandbox/CLI/TCloud stream loops with `runAgentTaskStream`.
- Forward `runtimeStreamServerSentEvent(event)` to UI.
- Preserve legacy UI events only as compatibility shims.
- Store `RuntimeSession` and `RuntimeStreamEvent[]` in the product database.
- Pass `sessionId` and `resume: true` for continuation.
- Persist `final.status`, readiness decision, and backend kind in run records.
- Assert in tests that blocked readiness does not call the backend.

For coding harnesses:

- Use `createSandboxPromptBackend`, `createOpenAICompatibleBackend` (also
  covers cli-bridge and other OpenAI-compatible HTTP gateways), or a custom
  `AgentExecutionBackend`.
- Require a stable `sessionId` for any long-running workspace.
- Surface `session_resumed` in telemetry so product/debug views can distinguish
  continuation from a fresh run.
- Treat missing session state as a recoverable backend/runtime failure, not a
  prompt failure.
- Implement `stop(session, reason)` for expensive or long-lived backends.

For eval and optimization:

- Attach readiness decisions and stream session metadata to `RunRecord.raw`.
- Classify missing knowledge/runtime/session failures separately from prompt or
  reasoning failures.
- Do not optimize prompts when dominant failures are missing context, bad
  retrieval, missing credentials, or broken backend resume.
- Add report slices by `backend`, `session_resumed`, `backend_error`, and
  `readiness_end.decision.status`.

## Completed Downstream Proof

`agent-builder` has a product-path proof in PR #61:

- Bumps `@tangle-network/agent-runtime` to `^0.5.0`.
- Routes sandbox chat through `runAgentTaskStream`.
- Uses `createSandboxPromptBackend`.
- Emits sanitized runtime stream SSE.
- Adds runtime session IDs to the compatibility `done` event.

That validates the package against a real sandbox-backed product route, not only
unit tests.

## Review Notes

Validation found and fixed two issues before marking this complete:

- The control-loop preflight path needed explicit coverage that
  `questions_end` is emitted exactly once.
- The CLI bridge parser claim needed hardening. `0.5.2` tested NDJSON bridge
  streams instead of only SSE-style `data:` frames. `0.6.0` then removed the
  bespoke `createCliBridgeBackend` entirely after confirming cli-bridge is
  purely OpenAI-compatible at `/v1/chat/completions`; consumers now use
  `createOpenAICompatibleBackend`.

The doc now matches shipped behavior.

## Downstream Rollout Plan

This is downstream adoption work, not missing kernel work:

1. Add durable `RuntimeSessionStore` implementations in product repos.
2. Convert CLI bridge routes/harnesses to `createOpenAICompatibleBackend`
   pointed at the bridge's `/v1` URL (cli-bridge is OpenAI-compatible).
3. Convert simple TCloud chat routes to `createOpenAICompatibleBackend` where
   useful.
4. Store runtime stream events in product trace/run-record tables.
5. Add UI affordances for session resume/continuation and readiness blockers.
6. Extend failure classifiers to consume `RuntimeStreamEvent` evidence directly.

The kernel is complete and ready for broad adoption. The next value comes from
removing bespoke product stream loops and using the same runtime contract across
product routes, coding harnesses, CLI bridge runs, evals, and optimization
reports.
