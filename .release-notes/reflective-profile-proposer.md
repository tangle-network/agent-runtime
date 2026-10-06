type: minor
---
`reflectiveProfileProposer({ model, chat, pricing, frame, evidence? })` is the maintained `SurfaceProposer` for a profile's prompt, instructions, skill or named text components in `searchMethod`: one priced call per proposal under `optimizerMethod`, reading the parents, their train cells and the caller's train-only evidence, with a declared maximum so a failed call counts at that bound.
