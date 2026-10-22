type: patch
---
Internal restructuring only: no exported name, signature or behaviour changes. The supervisor, scope, driver, worker, environment-provider, private CAS, candidate execution, improvement and coordination-tool factories that ran 300 to 900 lines each are split into named steps and state owners, so no function in `src/` now exceeds 300 lines. Every entry point's export list is unchanged.
