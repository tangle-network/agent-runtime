type: patch
---
A profile that declares a Claude family alias (`opus`, `sonnet`, `haiku`) accepts the concrete model of that family that the bridge serves, such as `claude-opus-5-5`; any other provider or family substitution still fails the turn.
