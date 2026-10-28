type: patch
---

A retained run that reuses an environment proves ownership only from the metadata on the provider's own `get` or `create` record. It no longer falls back to a metadata-filtered `list`. With Tangle Sandbox that list filters client-side and walked the caller's whole inventory before admission: about 55 pages and 77 s on a 68.5k-sandbox account, and a 400 past 2,000 sandboxes. An environment record without metadata is now refused at once ("... without metadata, so it cannot prove retained environment ownership").
