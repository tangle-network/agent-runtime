---
name: read-before-edit
description: Read the target file and the code that calls it before editing, so a change doesn't break callers.
---
Before editing a function or module:
1. Read the full file you're about to change, not just the lines near the edit.
2. Find and read its callers (grep for the symbol) to learn the contract you must preserve.
3. Match the surrounding style and signatures; keep the change consistent with how the code already works.
Editing blind to callers is how a local fix becomes a regression elsewhere.
