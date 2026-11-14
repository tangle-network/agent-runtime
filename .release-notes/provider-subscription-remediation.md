type: patch
---
A provider's subscription refusal keeps the producer's structured remedy (`cause`, `fix`, `harness`, `provider`) on the settled child's `failure.remediation`, as Runtime's own Bridge transport already did; the remedy is never read from message text.
