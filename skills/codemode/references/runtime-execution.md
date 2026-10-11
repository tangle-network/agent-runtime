# Runtime code mode

Use `runCodeMode` from `@tangle-network/agent-runtime/kernel` for an authored Runtime script.
Pass the already-authorized tool descriptors and their original execution handlers. Scripts
call `tools.name(args)`, compose calls with normal JavaScript, and return a small result.
`tool_search` generates input and output declarations when using `createCodeModeTools`.

For a model-driven Runtime agent, select `codeMode: true` (or explicit execution limits)
on the existing `createExecutor({ backend: 'router-tools', ... })` configuration. Keep
`AgentProfile.tools` as the actual capability grant. Runtime presents `tool_search` and
`codemode`; nested calls still go through the original `executeToolCall`, with a cancellation
signal, parent call ID and nested call ID. The original tool-step observer records them.
The existing internal brain loop and local MCP client accept the same presentation option.
This does not require the Pi coding harness.

The implementation uses the standalone `@earendil-works/pi-codemode` QuickJS/WASM worker.
There is no unsafe Node VM fallback. Code cannot read host files, processes or network
except through explicitly supplied tools. The default VM memory cap is 64 MiB, wall deadline
five minutes, tool concurrency four (excess calls queue), and total call cap 1024. Exceeding the call cap aborts the program, even if it catches
tool errors; failed programs do not commit store writes. Limits
are caller-authored; finite wall deadlines must fit the worker timer (at most 2,147,483,647 ms).
`timeoutMs: Infinity` explicitly removes the wall deadline.

Return structured objects from tool handlers when programs need structured data. Existing
text handlers remain text: Runtime does not guess that arbitrary strings should be parsed as
JSON. Tool input validation, approvals, external-effect idempotency and metering remain the
original handler's responsibility. Code mode does not grant access or automatically retry effects.

Use `text()` for text output and `image()` with actual inline image data for image output.
Only selected output and the return value enter the next model turn; intermediate results stay
in the script, while the existing execution trace retains calls. `store`/`load` hold small JSON
state. Retain `codeModeStore` through the existing run/session owner and provide it as
`codeMode.store` on continuation. The router executor's `onMessages` callback receives the
store snapshot as its optional second argument. Only successful programs commit store writes.

A fresh VM runs each program. A stored JSON snapshot is not a checkpoint of the instruction
pointer or guest heap. A lost result does not prove an external operation did not run; inspect
its existing effect receipt rather than blindly replaying the script. Cancellation stops new
calls and closes program authority; it cannot undo a previously accepted external effect.

A harness that already supplies code mode should use its native surface, not wrap it in another
code-mode tool. `createCodeModeTools` refuses reserved-tool collisions instead of nesting engines.
Use `directTools` for capabilities the host keeps as direct-only model tools (for example, a
lifecycle decision). They are not available inside programs.

Tool names must have distinct normalized JavaScript identifiers. Runtime refuses collisions
(such as `send-email` and `send_email`) before running a program, because the engine otherwise
selects the first handler even for an exact-name access. Rename the host descriptors explicitly.

Run Node host applications from a file. The current engine inherits Node worker flags;
`node --input-type=module --eval ...` is unsupported because Node rejects that flag on
file-backed workers. This returns a sandbox error and never falls back to host execution.
