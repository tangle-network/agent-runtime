type: patch
---
A driver whose attempts end in the same Sandbox `PartialFailureError` twice in a row with no progress stops with `repeated-failure` and the typed error as the cause, instead of re-entering the same half-provisioned box for the fifteen-minute outage window. Discovery run queens21-h22-capture-root-1-20261019c re-entered four such boxes 154 times in 37 minutes on `mkdir: cannot create directory '/work': Read-only file system`.
