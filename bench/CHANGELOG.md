# Changelog

## 0.8.3

- Consume Runtime 0.132.1, Eval 0.144.12, and Knowledge 7.2.1 as one compatible dependency set.

## 0.8.2

- Consume Runtime 0.131.7, Eval 0.144.10, and Knowledge 7.2.0.

## 0.8.1

- Consume Eval 0.144.8 and Knowledge 7.1.3 so Bench uses the same published dependency family as Runtime 0.131.6.

## 0.8.0

- Consume Runtime 0.131.0, Eval 0.144.6, Interface 0.46.1, Knowledge 7.1.2, and Sandbox 0.19.4 as one compatible dependency set.

## 0.7.2

- Consume Runtime 0.129.0, Eval 0.144.4, Interface 0.43.1, Knowledge 7.0.11, and Sandbox 0.19.1 so benchmark model calls use the exact-profile execution boundary and the released optimizer callback contract without loading duplicate agent contracts.

## 0.7.1

- Consume Runtime 0.126.0 with Eval 0.143.0 and Knowledge 7.0.8, so campaign cost remains observed, estimated, or explicitly uncaptured across the complete benchmark dependency tree.

## 0.7.0

- Consume Runtime 0.123.0 with Eval 0.142.2, Interface 0.43.0, Knowledge 7.0.7, and Sandbox 0.17.2 as one compatible dependency set.
- Release under a new minor because Interface and Sandbox are pre-1.0 dependencies moving across minor boundaries.

## 0.6.0

- Consume Runtime 0.121.0 with Sandbox 0.16.0 so a clean install no longer requires the superseded Sandbox 0.15 line.
- Release under a new minor because Sandbox is a pre-1.0 dependency moving across a minor boundary.

## 0.5.0

- Consume Runtime 0.120.0 with Eval 0.140.1, Interface 0.40.0, Knowledge 7.0.4, and Sandbox 0.15.2.
- Released under a new minor, not a patch, because Knowledge crosses a major (6.1.11 -> 7.0.4) and Runtime crosses eleven minors. A `^0.4.9` range admits only patches, so shipping this alignment as 0.4.10 would hand every such consumer a major dependency move without a range change.
- Resolve the supervisor tree from the `{kind:'event', root, event}` journal envelope, and take the optional `controlAdapter` on the DSPy RLM trace engine, both by way of Eval 0.140.1. Bench calls neither surface directly, so no adapter code changed.

## 0.4.9

- Consume Runtime 0.109.2 with Eval 0.135.2 and Knowledge 6.1.11 so benchmark runs use the corrected paired promotion decisions.

## 0.4.8

- Consume Runtime 0.109.0 through the canonical `./kernel` entrypoint.
- Align Bench with Eval 0.135.1, Interface 0.36.0, Knowledge 6.1.10, Materialize 0.9.2, and Sandbox 0.15.2.

## 0.4.7

- Consume Runtime 0.108.1 with Eval 0.134.2, Interface 0.36.0, Knowledge 6.1.8, Materialize 0.9.2, and Sandbox 0.15.2.
- Keep the HumanEval Docker test executable portable across supported Node versions.

## 0.4.6

- Require typed proposal findings with explicit search or production origin throughout the SWE improvement loop.
- Consume Runtime 0.108.0 with Eval 0.134.1, Interface 0.36.0, Knowledge 6.1.7, Materialize 0.9.2, and Sandbox 0.15.2.

## 0.4.5

- Allow the zero-model Pier proof to complete a cold separate-verifier image build before its task and overall execution deadlines.
- Consume Runtime 0.107.5 with Eval 0.133.3, Interface 0.36.0, Knowledge 6.1.5, and Sandbox 0.15.1.

## 0.4.4

- Consume Runtime 0.107.2 and Sandbox 0.15.0 with the current Eval, Interface, and Knowledge packages.
- Publish fake Pier terminal results atomically so the full test suite cannot observe partial JSON.

## 0.4.3

- Consume Runtime 0.107.1 with Eval 0.133.0, Interface 0.36.0, and Knowledge 6.1.2.

## 0.4.2

- Consume `@tangle-network/agent-runtime` 0.106.x with Eval 0.131.0, Interface 0.35.0, and Knowledge 6.1.0.
- Build the package before checking its exports so verification works from a clean checkout.

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
