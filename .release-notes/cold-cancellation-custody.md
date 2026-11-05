type: patch
---
A pending file-backed cancellation uses an available matching provider control to release prior resources without starting a turn. Partial workspace captures stay retained and report unconfirmed cleanup; complete captures require an actual teardown receipt before cancellation acknowledges clean settlement. Retained observation also keeps reading after slow consumer persistence, so a ready interaction is not mistaken for provider silence.
