type: patch
---
Preserve provider-specific tool-call fields, including Gemini thought signatures, through buffered and streamed Router responses and both Runtime tool loops. Each parallel call keeps its own fields when replayed with its result; Runtime retains authority over the call ID and function. Opaque streamed extension values replace earlier values only at their top-level key.
