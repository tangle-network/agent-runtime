type: patch
---
A retained dispatch that Sandbox did not admit stops the driver after one attempt, as a refusal before admission (`pendingCause: 'request-rejected'`, classification `terminal`). Sandbox reports this with `dispatched: false` and another execution id, and agent-provider-tangle 3.6.11 throws it as `TangleDispatchNotAdmittedError` (`code: 'DISPATCH_NOT_ADMITTED'`). Before, it was named "requires reconciliation before replacement" and retried until `pending-unresolved`.
