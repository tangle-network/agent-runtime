type: patch
---
Declare the Sandbox SDK dependency as a caret floor (`^1.0.128`) in the workspace catalog, as every other first-party dependency is. The exact pin reached the packed `@tangle-network/agent-bench` manifest and release admission refused it (`publishes exact first-party version pins`), which failed the 3.0.9 and 3.0.10 publications before npm.
