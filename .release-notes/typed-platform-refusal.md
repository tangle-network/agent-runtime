type: minor
---
A dispatch the platform refuses before forwarding it (`HUB_CREDENTIAL_REFRESH_FAILED` at HTTP 503) now settles as `request-rejected` owned by `platform`, nothing to reconcile, instead of a lost transport. `RuntimeFailureCause` gains optional `providerStatus` and `retryAfterMs`, read from the provider's typed error beside `providerCode`. Any other 5xx stays `transport`; nothing is retried automatically.
