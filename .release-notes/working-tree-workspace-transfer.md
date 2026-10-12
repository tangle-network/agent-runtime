type: minor
---
Capture and restore tracked, dirty, deleted, staged, and unignored untracked repository files with `repositoryContents: 'working-tree'`. Bound and verify the complete staged index before restoration, preserve user Git exclusions, and leave concurrent destination files intact when restoration fails.
