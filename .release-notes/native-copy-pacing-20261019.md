type: patch
---
Running native-session copies are paced to the retention port's capture slots: each mirror waits at least its last copy's duration times the port's running mirrors divided by `maxConcurrentCaptures`, and a session that received no provider event since its stored copy is not copied again. queens21-h22-swarm16-20261018b copied 9 sessions every 2 minutes through 4 slots at a median 134 s, which kept every slot busy and dropped copies past the 30-minute bound.
