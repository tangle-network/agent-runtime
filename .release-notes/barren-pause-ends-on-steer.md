type: patch
---
A root steer now ends an opted-in root's barren pause (`driverRetry.pauseRootStops`), as it already ended the root's stop pauses. The steered turn is told how long it actually waited. Before this, an operator's note to a root in its 60-minute barren pause waited out the full hour.
