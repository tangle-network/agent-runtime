type: patch
---
The kernel entry exports `profileBridgeWireModel`, the `harness/provider/model` string Runtime sends to cli-bridge for a profile, so a caller that talks to cli-bridge itself sends the same model, including for a provider named like its harness (`opencode/opencode/glm-5.3-flash-free`).
