type: minor
---
Remove the unimplemented `pause`, `resume`, and `ask` variants from `RootSignal`. Older callers now receive a validation error instead of silent success. Root cancellation and inbox steering keep their existing behavior.
