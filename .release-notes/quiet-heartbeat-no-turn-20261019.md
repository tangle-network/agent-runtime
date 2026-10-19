type: minor
---
A manager's heartbeat wake no longer costs a model turn while every live worker is still making progress: Runtime re-arms the heartbeat and keeps waiting, and the next wake reports `quietHeartbeats`. A stalled worker (idle past `stallAfterMs`), no live worker, an event or the deadline still wakes the manager. magnetar-rust-20261018b spent 58 of its root's 79 turns, about 37% of root spend, on 15-minute heartbeats that changed nothing.
