type: patch
---
Runtime 3.0.26 was tagged but not published: its release tests ran against Sandbox SDK 1.0.194, whose `SandboxError` model (1.0.191+) builds refusals differently, and three nested-owner refusal tests failed. Runtime's development Sandbox is now 1.0.190, the last release with the earlier error model whose types carry the Agent Interface 5.10.16 harnesses. This release carries 3.0.26's change: a seat stage's `credentialSource` is that stage's credential intent.
