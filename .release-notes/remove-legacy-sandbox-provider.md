type: minor
---
Remove `sandboxClientAsProvider`, `SandboxClientProviderOptions`, and `DEFAULT_SANDBOX_IDLE_TIMEOUT_SECONDS`.
Construct `createTangleProvider` from `@tangle-network/agent-provider-tangle` and pass that provider to Runtime.
`provisionSupervisor` now requires `connection.provider` instead of constructing a provider from a client, endpoint, or API key.
Shared-box workers implement the environment contract directly and keep profiles with explicit credential intent on their dedicated provider.
