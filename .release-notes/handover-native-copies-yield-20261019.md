type: patch
---
A turn's end no longer waits for native session copies before its workspace capture. The periodic copy in flight is cut short, as the live workspace copy already is, and the final session copy runs beside the workspace capture instead of before it. On canary test-acceptance-canary-20261019o (0.332.2), these copies put the capture start 59-66 s after the turn's result.
