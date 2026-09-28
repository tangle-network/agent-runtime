# Isolated-check receipts

Import `isolatedCheckResultSchema` and `isolatedCheckBoxEvidenceSchema` from `@tangle-network/agent-runtime`. They decode the existing isolated-check execution contract; they do not execute a check or judge task correctness.

```ts
import { isolatedCheckResultSchema } from '@tangle-network/agent-runtime'
import { createRetainedDispatch } from '@tangle-network/agent-eval/campaign'

const checks = createRetainedDispatch({
  runDir,
  scope: approvedExecutionIdentity,
  limits: { development: developmentAllowance, audit: auditAllowance },
  parse: isolatedCheckResultSchema.parse,
})
```

Retain the complete receipt. Successful stdout/stderr, explicit execution failures, cancellation, limits, cleanup failures and Sandbox input evidence have different meanings. Unknown execution is not an acceptable task outcome.

The schema rejects unknown fields, malformed result discriminators and box evidence whose input digest does not match its manifest. It preserves primary failure and cleanup diagnostics together. Runtime's existing execution interfaces remain the compatibility contract; schema outputs are checked against them in both directions. The isolation executor and Sandbox account checks are unchanged.

Validation establishes shape and internal digest consistency, not provenance. A caller must still bind actual check account, task scope, executable/environment identity, permissions and retained Run history. An arbitrary JSON object with a correct digest is not an independently witnessed check.

Consumers should import these decoders rather than copying a partial `succeeded`/`reason` shape, casting parsed JSON, or importing runtime contracts into lower-level Eval. Eval remains execution-independent and accepts a decoder callback.

The maintained protocol checks run through the public package entrypoint. Full package/type/build checks remain required for a release. No new provider call is needed to validate the receipt contract.
