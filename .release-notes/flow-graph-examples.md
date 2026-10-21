type: patch
---
The `static-fanout-synthesize`, `isolated-writers-integrate` and `per-item-pipeline` examples are flow graphs. The first two start their parallel roles as entries and join them into one synthesis or integration node, with no root brain; `per-item-pipeline` runs find, verify and publish as a nested flow graph per item through a `maps` edge. The examples catalog fingerprints a maps item's nested graph as its own topology.
