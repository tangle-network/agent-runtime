# MCP event subscriptions (3.0.33)

`createMcpServer({ eventSource })` serves four `events_*` tools over the native
observer journal (runtime hook events + decision points):

- `events_subscribe` is idempotent by caller key: a reconnect resumes the same
  subscription and cursor, an expired tombstone survives until replaced so a
  same-key resubscribe resumes the unacknowledged cursor (never the watermark),
  and an active consumer's expiry slides.
- `events_fetch` delivers at-least-once pages after the cursor; every page
  verifies journal chain linkage and refuses unverifiable history.
- `events_ack` advances the cursor forward-only and refuses sequences beyond
  the journal high-watermark (which would permanently skip later records).
- `events_unsubscribe` is idempotent.

The `agent-runtime-mcp` bin serves them read-only over one pursuit's durable
journal with `MCP_ENABLE_EVENTS=1` + `AGENT_RUNTIME_EVENTS_JOURNAL=<file>`;
an absent file is a valid empty journal. No scheduler, trigger or second event
authority is introduced: recurrence stays with its native owners, and
cross-pursuit aggregation belongs to the host platform.

End-to-end coverage: tool lifecycle tests plus a spawned-bin stdio test over a
real `FileObserverJournal` (subscribe, page, redeliver, ack, resume-by-key,
empty-journal boot).
