type: minor
---
A registry analyst lens that throws, or whose trace cannot be read, now publishes `{ analystRunFailed }` like a failed agent analyst instead of escaping the settlement drain; later lenses and agent routes on that settlement still run. `AnalystRegistry.run` receives an optional `AnalystRunContext` whose `charge(spend)` meters lens spend into the run's conserved pool as Runtime-owned accounting, and `analystsFromRegistry` charges each eval analyst run's measured usage, failed runs included.

Retained provider streams now resume from the last replay position when the provider's stream ends before the execution's terminal frame and the provider still reports the exact execution running, both in retained executors and in `RetainedRunHandle.events()`. A tournament judge whose stream ended during a quiet stretch was recorded as `terminal-event-lost` while it was still working.

Final and `backend_error` stream events, and coordination `settled` events for down workers, carry `failure: { code, owner, cause, providerCode? }`: a stable code and owner read from the failure's structure and redacted, bounded cause text. `runtimeFailureCause(error, signal?)` and `settlementFailureCause(down)` classify a thrown failure or a down settlement the same way. Existing `reason`, `error` and `message` fields are unchanged.
