type: minor
---

Add reference-only workspace capture and restoration through the existing canonical archive and artifact owners. Capture persists and verifies artifacts before returning references. Restore authorizes streaming reads, verifies canonical manifest and archive bytes, enforces bounds, and refuses pre-existing destinations before materialization. SDK owners retain source provenance and accepted workspace identity; providers retain allocation ownership and readiness. This local composition does not qualify a deployed provider restore or claim atomic directory no-replace.
