---
name: reproduce-first
description: Before changing any code to fix a bug or failing test, run the failing test/command first to observe the real error.
---
When the task is to fix a bug or make a failing test pass:
1. Run the exact failing test or command FIRST and read the actual error/traceback.
2. Do not guess the cause from the description — confirm it from the real output.
3. Only then make the smallest change that addresses the observed failure.
4. Re-run the same test to confirm it now passes before moving on.
An assumed cause is the most common reason a fix doesn't work.
