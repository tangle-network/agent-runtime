type: minor
---
A `supervisePursuit` version chain stops before proposing when its last `stop.identicalFailures` versions (default 3) ended `driver-failed` with the same normalized error or were unscored by the judge, and `versions.identicalFailures` names the failure. The rule is part of the chain's process revision, so a chain opened under an earlier release is a different search and is refused on resume.
