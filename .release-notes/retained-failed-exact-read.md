type: patch
---
A retained execution whose exact-result read fails (for example a Sandbox result replay that times out after 30 s) keeps observing its open stream and reads the result again, instead of failing at once with "retained provider stream remained open after its exact result".
