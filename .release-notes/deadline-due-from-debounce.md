type: patch
---
A wake whose debounce was capped at the deadline warning is now always the deadline wake, even when the timer fires before the wall clock reaches the warning on a loaded host, so the manager is no longer woken a second time at once for the warning.
