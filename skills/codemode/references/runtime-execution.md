# Runtime code execution boundary

Read [code-mode implementation and types](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/code-mode.ts) and its [contract tests](https://github.com/tangle-network/agent-runtime/blob/main/tests/kernel/code-mode.test.ts).
Use `codeModeSupervisorTools(runner)` with an explicit `CodeModeRunner`; there is no default runner.
For untrusted model output, supply a real isolated execution environment.
The in-process runner and source lint are not security boundaries.

The generated API follows the live coordination grant.
Code can spawn or steer through Runtime-provided bindings such as `api.spawn_worker`; these retain authorization, shared budgets, and journal records.
Direct coordination requests over HTTP or a second scheduler bypass that contract.

Lifecycle decisions remain model tools: `submit_result`, `stop`, and `ask_parent` are outside the generated code API.
Keep judgment in the model and mechanics in the program.
Before broad use, exercise one allowed call, one denied call, a failed operation, and cancellation through the selected runner.
