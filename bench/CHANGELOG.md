# Changelog

## 0.4.1

- Read Runtime 0.105 candidate plans from their signed run cell, benchmark records, and profile activation.
- Allow only the fixed public executable path signed by the Runtime plan.
- Restore the real Pier failure/success proof against the current receipt layout.

## 0.4.0

- Add the resumable SWE improvement loop backed by the official GEPA engine.
- Isolate every concurrent candidate in its own Git worktree and authorize the exact candidate before execution.
- Include the complete Runtime, Bench, and installed SWE judge implementations in resume identity.
- Consume `@tangle-network/agent-runtime` 0.105.x, `@tangle-network/agent-eval` 0.126.6, and `@tangle-network/agent-knowledge` 5.0.1.

## 0.3.8

- Resolve package-owned fixtures and scripts from both source and compiled installs, and prove ToolLLM fixture loading from the packed package.

## 0.3.7

- Declare the public executable search path for Pier candidate entrypoints so the exact process contract can replay them against `@tangle-network/agent-runtime@0.102.0`.
- Align the portable agent contract with `@tangle-network/agent-interface@0.32.0`.
- Add the trace-driven SWE supervisor improvement loop with measured candidate worktrees and official Docker judging.
- Settle cancelled worker trees, isolate each cell's state, serialize judges with a kernel lock, and reject unfinished processes before patch extraction or scoring.

## 0.3.6

- Ship compiled ESM and declarations so Node can import the installed package without a TypeScript runtime.
- Check root, registry, and benchmark subpath imports with plain Node in addition to TypeScript 5, TypeScript 6, and Python package checks.
- Build explicitly before verification and publication so disabled lifecycle scripts cannot produce a package without compiled output.

## 0.3.5

- Build the workspace runtime before source type checks so the published-package verification command works from a clean checkout; the packed consumer still installs `@tangle-network/agent-runtime@0.97.0` from npm.

## 0.3.4

- Publish the current benchmark suite against `@tangle-network/agent-runtime@0.97.0` and align its evaluation dependency with runtime and knowledge at `@tangle-network/agent-eval@0.122.8`.

## 0.3.3

- Consume `@tangle-network/agent-runtime@0.94.9` so large candidate task-outcome and isolated-memory archives are validated before persistence, then recorded as artifact references instead of oversized embedded payloads.

## 0.3.2

- Run large Pier workspace identity checks from a hash-verified evaluator file, avoiding Linux command-size limits while preserving exact path, type, mode, length, hardlink, and content checks.
