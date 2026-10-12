type: minor
---
`profile-registry`: named AgentProfiles with run receipts — the bottom layer of the designer's memory. Profiles content-addressed by the interface's canonical digest, revisions write-once, one JSONL record per run; `bestProfileFor(name)` answers "which prompt revision is winning?" by the graph registry's documented heuristic (delivered beats failed, then cheaper, then recent). A record must match the revision that ran, and a tampered revision file is refused — so "did the v2 prompt improve?" is answered by receipts, not argument.
