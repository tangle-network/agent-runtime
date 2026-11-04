type: major
---
Runtime owns worker admission, optional budget caps, run-state and journal readers, and live execution telemetry. Worker retry wrappers and client-side session capture are retired in favor of the existing retry policy and platform session store. The complete contract changes and migration exports are documented with this release.
