type: patch
---
A `continuity: resume` route now resumes on the provider backend, the path a local CLI graph run takes. The resumed worker gets a new environment and continues the earlier worker's harness conversation, which cli-bridge keys by session id. `loadGraphFile` refuses a resume edge whose target can run on a harness that opens a new conversation every turn, so the CLI refuses it at load and at `--dry-run` instead of partway through a run.
