---
name: run-tests-after-edit
description: After each code change, run the relevant tests and read the result before declaring the step done.
---
After every change:
1. Run the narrowest test that covers what you changed (then the broader suite if time allows).
2. Read the output — a passing exit code is the only proof, not your expectation.
3. If it fails, treat the new error as the next problem to reproduce and fix; don't pile on more edits blind.
Never report a step finished on a change you have not actually run.
