type: patch
---
A native-harness stop at release now has one deadline that covers reconnecting to the provider, so an unanswered provider can no longer hold up settlement. When the provider accepts a stop asynchronously (`cancel_requested`), Runtime waits within that deadline until the run's status shows it ended, and records the stop as unconfirmed if it does not.
