# Changelog

## 0.3.3

- Consume `@tangle-network/agent-runtime@0.94.9` so large candidate task-outcome and isolated-memory archives are validated before persistence, then recorded as artifact references instead of oversized embedded payloads.

## 0.3.2

- Run large Pier workspace identity checks from a hash-verified evaluator file, avoiding Linux command-size limits while preserving exact path, type, mode, length, hardlink, and content checks.
