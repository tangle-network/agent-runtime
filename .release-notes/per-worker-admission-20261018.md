type: patch
---
`supervise` refuses, when the run starts, a caller's `perWorker` that no child can ever be admitted under. With `reservationPolicy.ownerShare`, each `perWorker` channel must fit the pool less the owner's kept share; without one, a token or iteration ceiling equal to the whole pool is refused because the first child would leave the owner no next turn. The `ValidationError` names the channel and the reservable amount, so a misconfigured run fails in seconds instead of starving its children hours in (#1815).
