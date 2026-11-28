type: patch
---
A turn whose fresh environment was created and then deleted before Runtime admitted it no longer ends its run. When Sandbox refuses the turn's create key with 409 `CREATION_RESULT_UNAVAILABLE` ("The keyed create's recorded project is unavailable; use a new key"), Runtime records the turn as abandoned and stopped, with nothing dispatched, and starts a new turn under a new key. Before, the refusal was classified terminal and the run settled failed with no model work, as when the Tangle provider deleted a box whose profile files failed to load.
