type: patch
---
A Sandbox provisioning refusal for the profile (HTTP 422 with code `PROFILE_FILE_MOUNT_OUTSIDE_ROOTS` or `PROFILE_FILES_MATERIALIZE_FAILED`) settles the spawn as terminal and reads as refused-before-it-ran, at admission or after. Before, it was retried as a lost transport: queens21-h22-capture-root-1-20261019c retried a mount on a read-only root filesystem 154 times across 4 workers.
