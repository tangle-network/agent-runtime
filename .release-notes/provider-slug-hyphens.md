type: patch
---
Served-model identity checks treat provider slugs that differ only by hyphens (`z-ai` and `zai`, `x-ai` and `xai`) as one provider, so a Router route that reports OpenRouter's `z-ai/glm-5.3` satisfies a profile declaring `zai/glm-5.3`. Every other provider substitution is still refused.
