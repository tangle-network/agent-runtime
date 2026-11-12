type: patch
---
Refuse reserved `.agent-home` paths in candidate workspace snapshots and archive restoration, including tracked and force-added Git files that bypass ignore rules. Unselected ignored native homes remain excluded. This does not redact existing Git history or caller-configured homes with other names.
