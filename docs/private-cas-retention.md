> **Track:** Reference | **Role:** storage lifecycle | **Status:** canonical

# Private CAS retention

`createS3PrivateCasStore` owns objects and named pointers below the configured
prefix and an exact namespace. `inspectNamespace({namespace})` reads every
ListObjectsV2 page and returns current keys, ETags, payload lengths and a stable
inventory digest. It refuses malformed, incomplete or cross-namespace answers.

The consumer owns eligibility: disposition, terminal state, holds, references,
customer ownership and an exclusive writer fence. Fence every writer before
inspection and keep the fence through deletion. A complete list is not an
atomic snapshot while writers are active.

`retireNamespace({inventory})` accepts the reviewed inventory from the same
store. It refuses new or altered objects before deleting anything, verifies
each object's ETag and length immediately before deletion, confirms its absence,
and finally lists the namespace again. A partial failure is resumable with the
same inventory; missing reviewed objects do not expand the scope. The receipt
reports confirmed removals and the current remaining count and payload bytes.

This API concerns current objects. A versioned bucket may retain older versions,
so current-object absence alone is not a claim about reclaimed physical storage
or billed savings. Namespace inventory and deletion do not retire platform
sandbox volumes or recovery snapshots. Consumers retain their deciding result
and minimal disposal receipt outside a namespace they intend to remove.

The real object-store integration is enabled by `PRIVATE_CAS_MINIO_IMAGE`, naming
an installed MinIO fixture image. It creates an isolated container, bucket and
TLS certificate, verifies paginated inspection and physical current-object
absence, preserves the adjacent namespace, and removes its container afterward.
Runs without that fixture skip this integration and are not storage proof.
