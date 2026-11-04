type: patch
---
A failed coordination credential renewal no longer stops the run. It retries with the same token, paced by the platform's `Retry-After` or a backoff capped at 60 s, re-reading the secret's revision because Sandbox stores a value before it re-keys holders. The old bearer stays valid to its own expiry and the token a failed attempt stored stays valid for any holder that applied it; a bearer that outlives its lease while a renewal is open is refused instead of ending the run. A retained row that a resume cannot re-key yet stays for the next attempt.
