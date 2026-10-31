type: patch
---
An accepted `submit_result` no longer cancels the manager's retained turn at once. The harness has `ACCEPTED_RESULT_GRACE_MS` to end the turn itself, so the turn's usage is reported and metered; a turn still running at the end of the grace is cancelled as before. Codex reports a turn's token usage only when the turn ends, and on Discovery run magnetar-rust-sandbox-20261031b every accepted Codex worker, cancelled about a second after its submission, metered `tokensKnown: false` after hours of work. A `stop` or a stop rule still cancels at once.
