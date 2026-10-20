type: patch
---
Runtime admits `@tangle-network/sandbox` 0.63.3 (`>=0.63.3 <0.63.4`) beside the existing windows and develops against it. Sandbox 0.63 lets `CreateSandboxOptions.secrets` carry host-scoped `SecretBinding` objects; `providerAsSandboxClient` without `mapCreateOptions` passes secret names and refuses a binding, which a neutral environment input cannot express.
