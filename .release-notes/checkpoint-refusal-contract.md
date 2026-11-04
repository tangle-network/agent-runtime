type: major
---
Adds `workspace-checkpoint-refused` to the exported `SpawnEvent` union so checkpoint failures retain the provider's refusal. Consumers with exhaustive journal-event switches must handle this event before upgrading.
