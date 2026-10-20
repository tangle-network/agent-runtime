type: patch
---
The private CAS runs its fsyncs on up to 16 threads of their own instead of libuv's four-thread pool, a tree capture stores 64 files at a time instead of 16, and a full offload pass lists 16 shards at a time (https://github.com/tangle-network/agent-runtime/pull/1913). On drew-gtr-pro's busy USB archive disk, a 9,448-file workspace capture stored 6.5 objects/s against 1.3 objects/s before. Every fsync, hash check and durable receipt is unchanged.
