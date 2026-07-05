# Log an agent's activity without leaking your users' data

An agent's event stream is full of things you can't put in your logs: tool arguments, tool results,
user inputs, file URIs, tenant metadata. This captures that stream for telemetry with **every
sensitive field redacted by default**. You get counts, timings, session id, and final status out of
the box — and you opt each sensitive field back in, one at a time, only where you truly need it (say,
an operator triaging a live incident).

## Why it matters

The default failure mode for agent telemetry is "just serialize the events" — which quietly ships
customer emails, secret tokens, and internal storage paths into your log pipeline. This flips the
default to **safe**: nothing sensitive is recorded unless you explicitly ask for it, so a new sink
(a log drain, a dashboard, an analytics table) is safe the moment you point it at the collector. In a
multi-tenant product that is the difference between a telemetry feature and a data breach.

## How it works

You feed each streamed event into `createRuntimeStreamEventCollector()`. It passes through the
harmless structural fields (event type, timestamps, session, status) and **strips** the sensitive
ones. To reveal a field you turn on its flag: `includeInputs`, `includeMetadata`,
`includeControlPayloads` (tool args and results), `includeEvidenceIds`. Anything you don't turn on
stays redacted.

One field is the exception: `task.intent`. It flows through telemetry by default, so treat it as a
**static label** — set it to a fixed operation name like `"Look up a customer record"`, never to
user input. Real user input belongs in `inputs`, which is redacted by default.

## Run — fully offline, no key, no network

```bash
pnpm tsx examples/sanitized-telemetry-streaming/sanitized-telemetry-streaming.ts
```

The example drains the *same* streaming task twice — once through a default collector, once through
one with the reveal flags on — so you can diff them. Watch the `tool_call` event.

Default (safe): only the tool name survives; the customer id and email are gone.

```json
{"type":"tool_call","task":{"intent":"Look up a customer record","inputs":"[redacted]","metadata":"[redacted]"},"toolName":"lookup_customer"}
```

Opt-in (`includeInputs` + `includeControlPayloads` on): the same event now carries the arguments —
this is the operator-triage view, and only the fields you enabled appear.

```json
{"type":"tool_call","task":{"intent":"Look up a customer record","inputs":{"customerId":"cust-42"},"metadata":{"tenantId":"tenant-7"}},"toolName":"lookup_customer","args":{"customerId":"cust-42","email":"redact-me@example.com"}}
```

`collector.summary()` gives you the safe rollup either way: event counts by type, session id, final
status, and the concatenated assistant text.

## Non-streaming agents

If you run a task without streaming (`runAgentTask` instead of `runAgentTaskStream`), use
`createRuntimeEventCollector()` — same redaction, same flags, passed as `onEvent:
collector.onEvent`. The streaming stream carries extra event shapes (text and tool deltas), which is
why it has its own collector; the safety story is identical.

## Files

| file | what it is |
|---|---|
| `sanitized-telemetry-streaming.ts` | a synthetic streaming backend plus the two drains (default vs opt-in) |
