type: minor
---
Stream regular-file workspace capture, artifact readback, and restore through the existing private CAS and its S3 offload store.
Large retained workspaces no longer require complete file or tar buffers in the controller.
Provider retention selects streaming verification when the artifact port supports it.
Legacy buffered capture and repository archive APIs keep their existing byte format.
