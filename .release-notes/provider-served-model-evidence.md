type: patch
---
Provider-backed workers (`createExecutor({ backend: 'provider' })`, Tangle Sandbox) now record the platform's `effectiveBackend` model as the turn's provider evidence, so a metered turn journals `providerModel.status: "known"` with the served model id instead of `provider-model-missing`; a served model other than the declared one journals `provider-model-conflict`.
