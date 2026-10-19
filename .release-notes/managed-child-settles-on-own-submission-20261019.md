type: patch
---
A managed child that no `resolveDeliverable` gave a check of its own settles on its own accepted `submit_result`, as a graph node does. It was held to the run's check, so its submission was refused until the run's own check passed: the child never settled and its waiting manager was only ever woken by the 15-minute heartbeat (test-retained-root-wake-20261018b).
