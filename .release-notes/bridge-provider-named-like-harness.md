type: patch
---
A bridge profile whose provider shares its harness's name keeps the provider on the wire: `harness: opencode` with `provider: opencode` (opencode's keyless free tier, such as `glm-5.3-flash-free`) now sends `opencode/opencode/<model>`, so opencode receives `opencode/<model>` instead of the bare model it could not resolve.
