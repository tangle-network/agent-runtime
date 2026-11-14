type: patch
---
Hold a driver to the quota reset a Sandbox turn reports. When the opencode adapter types an exhausted plan window (`provider_quota_exhausted` with `resetAt`, as Z.ai's GLM plan prints it), Sandbox's `AgentRunOutcome.resetAt` now reaches the retry: the driver waits once until the reset instead of re-entering every five minutes (34 attempts per node on a recorded 5-hour cap). A reset more than six hours away keeps the hourly probe.
