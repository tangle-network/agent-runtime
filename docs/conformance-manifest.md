# The conformance manifest

Each release candidate carries one manifest beside its packed archive: `agent-runtime-conformance-manifest.json`.

> This document was extracted from the README — see [the README](../README.md) for the package overview.

### The conformance manifest

Each release candidate carries one manifest beside its packed archive: `agent-runtime-conformance-manifest.json`, uploaded with the `.tgz` by `publish.yml`.
The same artifact retains the raw `cohort-report.json` used to verify that manifest.
The release workflow validates the tag once, then checks the archive, official optimizers, and Bench concurrently against that commit.
Publication requires all three checks and verifies the uploaded archive digest before publishing.


`release/cohort.json` is the single source for the exact Interface, Eval, and Knowledge source releases used by CI and publication.
Update each version and full source commit together when the dependency cohort changes.
The packed-cohort check rejects an archive whose package version or source commit differs from this file.

The manifest names, for this exact archive, what its own conformance tests proved:

- the package name, version, source commit, and packed-archive sha256;
- the first-party cohort the archive was verified with, as `verify-packed-cohort.mjs --report` recorded it;
- the Sandbox peer range and the exact Sandbox versions a packed consumer was installed against;
- one entry per owner-named capability — retained run control, session replay, cancellation acknowledgement, native continuation, recursive observation, cleanup settlement, interaction response acknowledgement, and context transfer — with `supported`, `unsupported`, or `unproven`, the conformance scenario, the result digest, and every test file and case that produced it.

A capability whose declared cases do not all pass is `unproven`, never a pass. Two capabilities are `unproven` today and stay that way until behavioral evidence exists: **interaction response acknowledgement** (only a refusal path is covered — the acknowledged response and its replay are not) and **context transfer** (the retained Runtime path is covered, but no provider test drives a portable context between environments). A missing capability never fails an install; a consumer that needs one asks for it explicitly.

The capability-to-test map is the one hand-authored file, `conformance/capabilities.json`. Everything downstream of it is mechanical: the emitter runs the named tests, records what they reported, and content-addresses the record. Canonical JSON and hashing come from the published `@tangle-network/agent-eval` package, so the manifest has one canonical-JSON owner rather than a private one.

```bash
# emit (publish.yml does this after packing)
node scripts/emit-conformance-manifest.mjs \
  --tarball <archive.tgz> --cohort-report <cohort.json> --out <manifest.json>

# verify — recomputes every digest, reads no workspace source
node scripts/verify-conformance-manifest.mjs <manifest.json> \
  --tarball <archive.tgz> --cohort-report <cohort.json> --source-root .

# a consumer requiring specific capabilities fails closed on anything not supported
node scripts/verify-conformance-manifest.mjs <manifest.json> --require session-replay --require cleanup-settlement
```

Consumers map their own release-check names onto these capability keys locally. Runtime does not learn a product's check vocabulary. Where a key overlaps the `@tangle-network/agent-provider-testkit` conformance vocabulary, the scenario reuses that testkit name (`control-claim-accepted`, `reconnected-replay`, `stop-accepted`, `verified-native-continuation`, `cleanup-dependency-order`, `same-response`, `accepted-transfer-receipt`), so the two vocabularies stay one.

Changing the packed bytes, the cohort identity, a recorded scenario result, or the bytes of an evidence file invalidates verification; `scripts/conformance-manifest.test.mjs` proves each of those four mutations is rejected, and that identical inputs reproduce one digest.