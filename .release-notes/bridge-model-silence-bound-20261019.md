type: patch
---
A bridge backend can set `modelSilenceMs`: a turn whose model sends nothing for that long, while no tool call is open, fails, its bridge run is cancelled, and the driver re-enters the run. A tool call the bridge reported and has not answered holds the clock, so a long tool is never cut. Off when absent.
