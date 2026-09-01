# provider-executor

Run supervised workers on someone else's boxes through the `AgentEnvironmentProvider` contract.

```bash
pnpm build   # examples resolve @tangle-network/agent-runtime from dist/
pnpm tsx examples/provider-executor/provider-executor.ts
```

Offline. No credentials, no network.

## What it teaches

`createExecutor({ backend: 'provider', provider })` takes an environment provider as data.
The provider owns environment creation, the turn, and the session.
Runtime owns recursion, the budget pool, the usage channel, and the settled artifact.

The example runs the same `ExecutorConfig` two ways:

1. as a leaf factory, driving one profile through one environment;
2. as `SuperviseOptions.backend`, so a supervisor spawns its workers into provider environments.

## Running workers on a Tangle box

In production the provider is `createTangleProvider({ client })` from
`@tangle-network/agent-provider-tangle`. Runtime holds no dependency on that package: the seam
accepts the contract, so the offline provider in this file and the Tangle provider compose
identically.

```ts
import { createTangleProvider } from '@tangle-network/agent-provider-tangle'
import { Sandbox } from '@tangle-network/sandbox'

const provider = createTangleProvider({ client: new Sandbox({ apiKey, baseUrl }) })
const backend = { backend: 'provider', provider } as const
```

Every field a create needs — the profile, the environment, the secrets, the resources — travels on
`CreateAgentEnvironmentInput`. Do not wrap the `SandboxClient` to reach a create field: a wrapper
is invisible to the runtime, so its create options are absent from every record the run produces.

## The per-turn channel

`promptOptions` is the same field, the same name, and the same kernel-owned exclusions as
`ExecCtx.promptOptions` on the sandbox path. It is merged under every turn the executor streams: a
mapped turn's own field wins, the runtime's abort signal is applied last, and `providerOptions`
merges one level so a `taskToTurn` cannot silently drop what is declared here.

A subscription seat is a caller-owned session credential. It belongs to the call, never to the
`AgentProfile` — a profile is portable and a credential is not — so it travels here:

```ts
promptOptions: {
  backend: {
    model: {
      authMode: 'oauth',
      authFiles: [{ path: '.codex/auth.json', content: seatTokenJson }],
    },
  },
  timeoutMs: 120_000,
}
```

Runtime lowers `backend` onto `AgentTurnInput.providerOptions.backend`, and a sandbox-shaped
provider raises it back onto its own `PromptOptions.backend` — which is how the credential reaches
the harness inside the box. The steerable provider path reads the same declaration with no
translation at all.

`sessionId` and `signal` are the kernel's, so neither is declarable. `model` is refused for a
different reason: this executor's materialization record names the model from `AgentProfile`, so a
turn-level override would make the record state a model the provider did not run.

## Scoring the worker against its live environment

`validator` is optional and has the sandbox seam's contract: `validate(out, ctx)` runs while the
environment is still alive, so `ctx.box` can read files or run commands in the environment it is
scoring. Every other supervised hook fires after teardown and can only read the artifact. The
verdict becomes the settled artifact's verdict.

## Readiness

`create()` resolving is the provider's promise that the environment can take a turn, so this
executor streams straight into it and adds no wait of its own. The sandbox seam's `acquireSandbox`
exists because a raw `SandboxClient.create` returns before the box is ready. A second readiness
poll here would hide a provider that does not honor the contract, and that provider is an upstream
defect to report.

## What the run cannot claim

No provider event carries a billing receipt, so the executor reports `usdKnown: false`. A
dollar-capped budget pool REFUSES an unknown dollar cost rather than comparing against a floor, so
this example sets a token budget and no dollar cap. That refusal is the contract working: a
ceiling priced off an unmeasured number is a ceiling that cannot fire.
