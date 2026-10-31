type: patch
---
Lifecycle fixes from Discovery run magnetar-rust-sandbox-20261031b (Runtime 3.0.5).

- `spawn_worker` is fenced like `submit_result`: a spawn still reading by-path resources out of the manager's sandbox when the fence elapses answers with a receipt instead of a transport 504, a retried identical spawn joins it, and the worker reaches the manager in its next wake. Five spawns on that run answered 504 while their workers started.
- An opted-in root whose turn spends the pool takes its continuation's budget pause again instead of the wait that holds a manager for its running workers; Publish v3.0.11 failed `tests/kernel/root-stop-pause.test.ts` on that path.
- A completed manager releases the retained executions of the workers its completion aborted together with its own environment, so their harnesses stop and their sandboxes are destroyed, or receipted as kept, when the manager finishes rather than at the run's settlement. Six aborted workers on that run kept their running sandboxes for the hours the run went on and the cell ran out of host capacity.
