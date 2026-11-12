type: patch
---
`spawn_worker` refuses a child profile granting a coordination tool the child would not be served (a name outside the coordination verbs and the run's `resolveSupervisorTools` declared `servesToolNames` vocabulary), naming it and the served list, before the spawn is journaled or a sandbox exists; the same key then admits the corrected profile. A resolver that declares no vocabulary is unpredictable at spawn time, so the child's own serve-time check decides as before.
