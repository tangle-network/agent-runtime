# Keep a run alive after your process dies

## When to use it

Use this when the job must outlive the process that started it.
The provider owns the job; you own a claim ticket that any process can present.

The runtime has five ways to continue work.
Pick by what died.

| What died | What continues it |
|---|---|
| The HTTP connection to the browser | Call `streamPrompt` again with the same `executionId` and the last event id |
| Nothing; you want the same box for the next turn | `openSandboxRun` |
| The coordinator process, mid-orchestration | `supervise({ runDir })`, which replays settled children |
| The user left and came back to a chat | The `/conversation` store adapters |
| Everything except the provider | **This example**: `startRetainedRun` and `reconnectRetainedRun` |

The last row is the expensive one.
Use it only when a dropped reader or a restarted application must not lose the job.

## How to use it

```bash
pnpm typecheck:examples   # this file is compile-checked, not runnable offline
```

`startRetainedRun` refuses a provider that cannot promise exact run identity, event and result identity, idempotent cancellation, detach, and replay.
No provider in this repository advertises those seven capabilities, so supply your own provider to run [`retained-run.ts`](./retained-run.ts).

Process A starts the job and persists the ticket.

```ts
const run = await startRetainedRun({
  provider,
  environment: { idempotencyKey: 'workspace-42', profile },
  turn: { turnId: 'turn-7', prompt: 'Finish the migration and run its tests.' },
  identity: { sessionId: 'thread-42', executionId: 'execution-7' },
  onAdmission: async (admission) => {
    await journal.write(admission)
  },
})
```

The runtime awaits `onAdmission` twice: after the environment exists, and again after the dispatch is verified.
The start promise resolves only after the second record is durable.
Write each record inside the hook before the hook returns.

Process B rebuilds control from the persisted ticket.

```ts
const handle = await reconnectRetainedRun({ provider, controlRef: dispatched.controlRef })
const snapshot = await handle.status({ waitMs: 30_000 })
const result = await handle.result()
```

Three rules keep a restart safe.

- Persist each event cursor and sequence before you show the event to a user.
- After a crash that landed only the environment record, call `recoverRetainedRun` with its coordinates.
- Never destroy an environment on the `unverifiable` outcome. Keep it, retry the reconnect later, or inspect it with the provider's tools.

An unknown provider result stays unknown.
The runtime never reports it as success or as a confirmed cancellation.

## Why this exists

`runAgentRounds` is a loop your process runs.
It holds your `plan`, `decide`, `parse`, and `validate` functions in memory, so when your process dies the loop dies and nothing outside ever knew it existed.
A retained run is a job the provider runs: your process holds only a claim ticket — provider, environment, session, execution, and request digest — so any process holding the ticket can reattach, replay, or cancel, which is why every read is verified against the ticket instead of trusted from memory.
It is a separate call because it must refuse providers that cannot honor the ticket, and it must force you to save the ticket durably before it reports success.
Neither demand can be bolted onto the in-process loop without breaking its callers or reopening the crash-orphan bug it was built to close.
