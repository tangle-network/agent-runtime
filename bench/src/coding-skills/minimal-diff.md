---
name: minimal-diff
description: Make the smallest change that satisfies the task; do not touch unrelated code.
---
Keep the diff minimal:
1. Change only what the task requires; leave unrelated code, formatting, and files alone.
2. Do not refactor, rename, or "clean up" beyond the ask — each extra change is a chance to break a check.
3. Prefer the local, surgical fix over a broad rewrite.
The grader is watching the whole repo state; unrequested changes are pure downside.
