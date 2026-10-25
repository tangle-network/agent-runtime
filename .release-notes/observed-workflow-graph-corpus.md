type: minor
---
Import canonical trace topology into the graph registry with trace-run links, explicit unknown/running outcomes, and an opt-in observational query policy. Consumers must handle absent completion timestamps and traversal counts on incomplete observations; native writes still require both. Observed designs cannot authorize executable replay.

Reuse verified immutable graph revisions when recording another run, avoiding redundant durable writes while holding the registry lock. Refuse a stored revision whose content no longer matches its address.
