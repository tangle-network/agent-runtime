type: patch
---
A manager whose seat chain is exhausted no longer keeps its retained sandbox running while it waits for a seat. Before the pause, Runtime checkpoints the workspace and destroys the box. The drive after the pause starts a new environment restored from that checkpoint. A box without a verified checkpoint newer than its last turn, or whose capture is incomplete, is kept as before. On Discovery run magnetar-rust-sandbox-20261031b, the resume found every seat of four managers exhausted until 11-04 and paused them, and their 8 vCPU / 16 GiB boxes kept running.
