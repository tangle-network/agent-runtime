type: patch
---

No API change. Carries #2217 (retained reuse proves ownership from the environment record's metadata and never walks a provider inventory). 2.3.6 was tagged but never published: its publish verify failed because Runtime's own durable test provider returned environment records without the metadata a real provider returns.
