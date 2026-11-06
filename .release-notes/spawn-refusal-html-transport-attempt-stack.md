type: patch
---
- `scope.spawn` refuses a not-yet-executable profile with every missing field named in one rejection (`harness`, `model.default`, `model.provider`) instead of one field per call, and the `spawn_worker` tool description states the required execution fields (#1329).
- A retained-run read that receives a gateway HTML error page (a Cloudflare 502) is classified as a transport failure carrying the HTTP status and a bounded excerpt, not a provider contract violation (#1203).
- Driver-attempt records carry the deepest cause's redacted, frame-bounded stack, so a failure the messages alone cannot place still names its throw site (#2347).
- An unconfirmed checkpoint cleanup journals and settles with its reason — the provider's acknowledgement status or the delete's error text (#1594).
