type: patch
---
A retained execution whose exact result settles before the provider's terminal frame now waits the 100 ms tail window from the later of the last frame and the result. The native run's own time before its finish frame no longer uses up the window, so a terminal frame that arrives one provider read after the result is read instead of failing the run with "retained provider stream remained open after its exact result".
