type: minor
---
Extend PlatformOidcClient with discovery-bound RFC 8628 device authorization and polling, cancellation, expiry and slow-down handling, plus RFC 8707 resource parameters. Preserve PlatformAuthClient for legacy resource-key consumers. Correct confidential-client Basic encoding and reject protocol redirects. Add a live installed-consumer proof for code/PKCE, refresh, revocation and rejection of both refresh-token generations after disconnect. The provider must advertise and enable its OAuth-integrated device grant before the new device methods can run.
