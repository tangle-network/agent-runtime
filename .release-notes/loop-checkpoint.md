type: patch
---
A turn that reaches its deadline can continue instead of failing. `streamToolLoop`'s `capped` yield for `deadline` now carries `messages`: the conversation after the system prompt, with every tool call answered. Passing them back as `priorMessages`, with `userMessage` omitted (now optional), continues the same turn in a later process.
