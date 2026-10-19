type: patch
---
A private CAS offload pass after a process's first reads only the objects that process wrote without a durable receipt, instead of listing every object of the store and reading its receipt. The first pass of each process is still full, so objects an earlier process left without a receipt are uploaded, and a pass is full again whenever the host must evict over its local budget. On canary test-acceptance-canary-20261019q two full passes per capture took 60.1-63.2 s on each native copy.
