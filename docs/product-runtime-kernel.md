# Product Runtime Kernel

Status: implemented in `@tangle-network/agent-runtime@0.5.0`; validated and
documented in `0.5.1`.

This document tracks the production runtime kernel: what it is for, what is
complete, what is intentionally out of scope, and what product repos still need
to adopt.

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

- `createCliBridgeBackend`
  - Posts task/message/session info to an HTTP CLI bridge.
  - Passes `sessionId` and `resumeToken`.
  - Parses SSE/NDJSON-style streamed responses through the common stream
    parser.

- `createOpenAICompatibleBackend`
  - Wraps TCloud/OpenAI-compatible `/chat/completions` streaming APIs.
  - Normalizes streamed content deltas into `text_delta`.

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

Release verification:

- `pnpm test`
- `pnpm typecheck`
- `pnpm build`
- Published to npm as `@tangle-network/agent-runtime@0.5.0`.
- Documentation validation published in `@tangle-network/agent-runtime@0.5.1`.

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

## Downstream Adoption Checklist

For product routes:

- Replace direct sandbox/CLI/TCloud stream loops with `runAgentTaskStream`.
- Forward `runtimeStreamServerSentEvent(event)` to UI.
- Preserve legacy UI events only as compatibility shims.
- Store `RuntimeSession` and `RuntimeStreamEvent[]` in the product database.
- Pass `sessionId` and `resume: true` for continuation.
- Persist `final.status`, readiness decision, and backend kind in run records.

For coding harnesses:

- Use `createSandboxPromptBackend`, `createCliBridgeBackend`, or a custom
  `AgentExecutionBackend`.
- Require a stable `sessionId` for any long-running workspace.
- Surface `session_resumed` in telemetry so product/debug views can distinguish
  continuation from a fresh run.
- Treat missing session state as a recoverable backend/runtime failure, not a
  prompt failure.

For eval and optimization:

- Attach readiness decisions and stream session metadata to `RunRecord.raw`.
- Classify missing knowledge/runtime/session failures separately from prompt or
  reasoning failures.
- Do not optimize prompts when dominant failures are missing context, bad
  retrieval, missing credentials, or broken backend resume.

## Completed Downstream Proof

`agent-builder` has a product-path proof in PR #61:

- Bumps `@tangle-network/agent-runtime` to `^0.5.0`.
- Routes sandbox chat through `runAgentTaskStream`.
- Uses `createSandboxPromptBackend`.
- Emits sanitized runtime stream SSE.
- Adds runtime session IDs to the compatibility `done` event.

That validates the package against a real sandbox-backed product route, not only
unit tests.

## Remaining Work

This is downstream work, not missing kernel work:

- Add durable `RuntimeSessionStore` implementations in product repos.
- Convert CLI bridge routes/harnesses to `createCliBridgeBackend`.
- Convert simple TCloud chat routes to `createOpenAICompatibleBackend` where
  useful.
- Store runtime stream events in product trace/run-record tables.
- Add UI affordances for session resume/continuation and readiness blockers.
- Extend failure classifiers to consume `RuntimeStreamEvent` evidence directly.

The kernel is complete enough to adopt broadly. The next value comes from
removing bespoke product stream loops and using the same runtime contract
everywhere.
