type: minor
---
`RouterTransportConfig` (and the `router` / `router-tools` executor backends) take an optional `routing: { only?, allowFallbacks?, requireModel? }`. Runtime lowers it into every Router request as `providerOptions.gateway.{only, allowFallbacks}` and `require_model`, merged with any profile `extraBody.providerOptions`. Braid's Z.ai-only release proof (all-costs #10337) sent no routing and was served by fireworks/glm-5p3; it now passes `{ only: ['zai'], allowFallbacks: false, requireModel: true }`.
