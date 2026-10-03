type: minor
---
`createPrivateCasArtifactPort` accepts a durable store and a local byte budget. `createS3PrivateCasStore` copies each object to an S3-compatible bucket (R2 or S3) as it is written, keyed by run and digest, and the bucket refuses bytes that do not match the digest. Local copies are deleted oldest first only after their durable receipt exists, reads fall back to the bucket, and `port.offload()` uploads host-only objects before any eviction.
