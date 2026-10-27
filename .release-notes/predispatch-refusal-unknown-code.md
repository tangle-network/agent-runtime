---
type: patch
---

A retained admission error whose machine code is not a named platform refusal, and that carries no HTTP status, is no longer settled as a platform `request-rejected` refusal. 2.1.0 matched any such error (for example a dispatch that could not bind to an environment the provider lost), so the run stopped instead of starting a new environment.
