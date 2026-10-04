type: patch
---
A provider turn that its deadline or an explicit cancellation ends now stops its retained harness, and waits within the 30 s stop bound for the provider to report it stopped, before the failure capture and the final native copy read its session. Those captures previously read a session the harness was still writing, so they were stored partial, and the harness kept running until teardown.
