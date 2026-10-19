type: minor
---
A manager whose bridge turn ends before the bridge acknowledges it now records `executor-failed-before-receipt`, and its `execution-bound` binding names the session Runtime started (`execution: { kind: 'session', id }`), instead of `root-agent-did-not-report` with no session. The unknown arm of `ExecutionBindingReceipt` gains an optional `execution`. magnetar-rust-20261018b:s2 ran 177 model calls in its bridge session and no record named it.
