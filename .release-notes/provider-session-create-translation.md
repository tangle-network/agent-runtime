type: patch
---
Translate provider-backed session creation into neutral fields instead of sending an unsupported raw Sandbox request. Refuse unmapped physical controls unless the caller supplies the existing mapping callback.
