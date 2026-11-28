type: patch
---
A reopened or restarted run whose last turn was admitted for a kept environment, but never reached it, no longer replays that turn into a new environment once the kept one is lost or retired. Runtime closes the turn and starts a new one in a fresh environment restored from the newest checkpoint. Before, each attempt was refused with "retained run intent conflicts with replay material", and the run settled with no model work.
