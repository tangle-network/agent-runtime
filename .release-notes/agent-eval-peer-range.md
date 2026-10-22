type: patch
---
The agent-eval peer range widens to ">=0.215.0 <0.218.0", and Runtime builds and tests against agent-eval 0.217.1. 0.340.0 declared ">=0.215.0 <0.216.0", so no consumer on agent-eval 0.216 or 0.217 (discovery-lab pins 0.216.0) could adopt the barren-pause release.
