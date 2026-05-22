# Model resolution

Demonstrates the four chat-model primitives every product chat handler
needs and was hand-rolling per repo:

- `resolveRouterBaseUrl(env)` — normalised router base URL.
- `resolveChatModel(candidates, fallback)` — first-non-blank precedence;
  caller owns the order (`request → workspace → env`, etc.).
- `validateChatModelId(modelId, { allowlist?, loadModels? })` — rejects
  malformed ids and ids absent from both the allowlist and the live
  catalog. **Fail-closed**: a failed catalog fetch rejects.
- `withConfiguredModels(catalog, extraIds)` — inject env-pinned ids
  into the picker without duplicating catalog entries.

Runs offline (the example injects `loadModels` instead of calling
`getModels` against a real router).

```bash
pnpm tsx examples/model-resolution/model-resolution.ts
```
