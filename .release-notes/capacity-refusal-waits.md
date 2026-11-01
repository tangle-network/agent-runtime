type: patch
---
A Sandbox create refused for capacity now pauses and retries within the run's deadline, budget and cancellation instead of ending the driver at its first attempt: the typed `CAPACITY_EXHAUSTED`, `HOST_PRESSURE` and `PROVISIONING_PAUSED` codes at any status, and the 409 `No <sku> host can hold …, and none would be bought: its room is held` that Sandbox sends without a capacity code. A shape over every host's ceiling stays a terminal refusal. Source: Discovery run magnetar-rust-sandbox-20261101a, nodes :s1:s1, :s1:s3, :s5 and :s6:s1.
