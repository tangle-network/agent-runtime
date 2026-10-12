type: minor
---
`./workspace-store`: `withContentCodec(store, codec)` seals every entry's `content` at rest, on any adapter. Paths and index fields stay plaintext, and the tenant and path are bound into the ciphertext. `createAesGcmContentCodec` (AES-256-GCM, a key id inside each value so keys rotate) and `aesGcmContentCodecFromEnv` (`WORKSPACE_STORE_KEYS`, `WORKSPACE_STORE_KEY_ID`) ship the codec, and `sealWorkspaceBytes` and `openWorkspaceBytes` cover R2 bytes. With an `operationId`, a replayed put seals to the same bytes, so `operationId` replay holds under encryption.
