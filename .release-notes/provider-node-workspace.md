type: patch
---
Provider executors can restore a supervised node from a checkpoint assigned to its Runtime identity: the optional `checkpointForNode` on `ProviderExecutorOptions` receives the node's Runtime-assigned identity and returns the workspace checkpoint it starts from, so siblings that share one AgentProfile can start from different inputs. The execution record and placement digest identify the selected checkpoint. A callback that disagrees with a configured workspace checkpoint, or one set beside a shared environment, is refused; configurations without it behave as before.
