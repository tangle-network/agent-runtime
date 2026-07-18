# Changelog

## 0.3.4

- Publish the current benchmark suite against `@tangle-network/agent-runtime@0.96.2` and align its evaluation dependency with runtime and knowledge at `@tangle-network/agent-eval@0.122.8`.

## 0.3.3

- Consume `@tangle-network/agent-runtime@0.94.9` so large candidate task-outcome and isolated-memory archives are validated before persistence, then recorded as artifact references instead of oversized embedded payloads.

## 0.3.2

- Run large Pier workspace identity checks from a hash-verified evaluator file, avoiding Linux command-size limits while preserving exact path, type, mode, length, hardlink, and content checks.
