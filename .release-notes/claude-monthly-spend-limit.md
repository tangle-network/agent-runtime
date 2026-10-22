type: patch
---
`subscriptionUsageLimitSignal` reads Claude Code's "You've hit your monthly spend limit" refusal as `subscription-usage-limit`, so a seat chain moves to the next account when one account's extra-usage credits are capped instead of failing the stage. A bare HTTP 429 still is not a plan limit.
