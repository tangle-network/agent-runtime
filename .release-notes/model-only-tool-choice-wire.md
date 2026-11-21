type: patch
---
`AgentProfile.model.metadata.toolChoice: "none"` now runs without enabled tools and reaches both the buffered and streamed Router completion wires as `tool_choice: "none"` from `profileChatClient` and `profileOptimizerModelCall`, with no `tools` array; profiles without the declaration keep the identical request. `auto` and `required` without tools are still refused, a request may restate (never change) the declared choice, and a profile-declared choice on a backend that cannot carry it is refused by name instead of silently dropped.
