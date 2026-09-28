type: minor
---
Export `isolatedCheckResultSchema` and `isolatedCheckBoxEvidenceSchema` from the public package root. Consumers can decode retained execution receipts without duplicating Runtime's result types. Validation preserves complete failure and cleanup evidence and checks Sandbox input-manifest digests; it does not certify task correctness or authorize execution.
