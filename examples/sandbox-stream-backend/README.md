# sandbox-stream-backend

Wires `runAgentTaskStream` to `createSandboxPromptBackend` against a
**synthetic** sandbox client so the example is self-contained. The real
sandbox client (the kind `agent-builder` uses) implements the same
interface; just swap it in.

The whole point of this example: when you read the snippet, you can see
exactly where `sandboxClient` and `sandboxId` come from — *you supply
them*. agent-runtime never invents them; `getBox()` is your callback that
returns whichever sandbox handle the task should run against.

## Run

```bash
pnpm tsx examples/sandbox-stream-backend/sandbox-stream-backend.ts
```

## What it shows

- Defining a minimal `SandboxBox` interface and a synthetic `sandboxClient`
- Resolving a sandbox by id via `getBox`
- Streaming events through `runAgentTaskStream`
- Persisting session state via `InMemoryRuntimeSessionStore`
- Serializing each event to Server-Sent Events via `runtimeStreamServerSentEvent`

## To use against a real sandbox

Replace `sandboxClient` with whichever client owns sandbox lifecycle in
your product (in `agent-builder`, that's the sandbox SDK + a per-chat
session id). The shape required by `createSandboxPromptBackend` is small:
a `streamPrompt(message)` async iterable + a stable `id`. Everything else
is your call.
