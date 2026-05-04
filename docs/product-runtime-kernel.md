# Product Runtime Kernel Track

This package should be useful in production because it owns the agent execution
contract, not because it logs decorative lifecycle events.

## Goal

Provide a small, stable kernel that product routes, eval harnesses, and coding
agent harnesses can all call:

```txt
Task
  -> knowledge readiness
  -> optional ask/acquire
  -> session create/resume
  -> backend stream
  -> policy/eval-visible events
  -> persisted resumable evidence
```

## Non-Goals

- Do not make `agent-runtime` depend directly on private app code.
- Do not force one model SDK, sandbox SDK, or CLI bridge implementation.
- Do not hide domain tools, prompts, credentials, or UI policy in this package.
- Do not replace token/tool streaming. Normalize it.

## Runtime Kernel Requirements

- `RuntimeStreamEvent` is the canonical product/eval stream shape.
- `AgentExecutionBackend` wraps TCloud, CLI bridge, sandbox SDK, browser drivers,
  local harnesses, or custom agent loops.
- `RuntimeSessionStore` persists session handles and event history so coding
  harnesses can resume instead of starting over.
- `runAgentTaskStream` applies readiness before backend execution, then streams
  normalized backend events.
- Sanitizers redact task inputs, credentials, answers, payloads, and evidence by
  default.
- SSE helpers encode any runtime stream event without apps hand-rolling framing.

## Backend Shape

Backends should be thin adapters over real clients:

- TCloud/simple chat: message in, text deltas/final out.
- CLI bridge: session id/resume token in, terminal/tool/text events out.
- Sandbox SDK: existing sandbox id/session id in, `streamPrompt` events out.

The package owns the contract; callers own the concrete clients and auth.

## Acceptance

- A product route can call `runAgentTaskStream()` and forward SSE.
- A sandbox or CLI bridge run can resume by passing `sessionId`.
- Stream events distinguish readiness, session, text, tool, artifact, error, and
  final states.
- Domain repos can keep their wrappers while using the same backend/session
  primitives.
