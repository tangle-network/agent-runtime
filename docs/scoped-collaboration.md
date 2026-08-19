# Scoped collaboration

Runtime has three directions of coordination:

```text
up:       question, finding, result

down:     answer, steer, stop

sideways: ask, tell, challenge, answer
```

Upward escalation and downward authority remain parent/child operations. Scoped collaboration is the sideways channel: it carries information, never control.

## Common case

```ts
await supervise(supervisor, task, {
  backend,
  budget,
  collaboration: true,
})
```

Each manager and its direct children form a team. A nested lead belongs to its parent's team and forms another team with its own children.

Every participating manager and worker receives the same two tools:

- `read_mail`: inspect retained messages, visible peers, groups, and quota.
- `send_mail`: send `ask`, `tell`, `challenge`, or `answer` to one visible actor.

`tell` and `challenge` require evidence references. Collaboration cannot spawn, steer, interrupt, stop, activate, or impersonate a supervisor.

## Whole-graph collaboration

```ts
await supervise(supervisor, task, {
  backend,
  budget,
  collaboration: { scope: 'graph' },
})
```

All actors in the recursive supervision tree share a graph group in addition to their direct teams.

## Named subsets

```ts
await supervise(supervisor, task, {
  backend,
  budget,
  collaboration: {
    scope: 'team',
    groupsForActor: (actor) =>
      actor.label.startsWith('verifier') ? ['verification'] : [],
  },
})
```

Custom groups add exact communication edges without exposing unrelated actors.

## Explicit federation

Several Runtime graphs collaborate only when the host shares one hub and assigns a common custom group:

```ts
const hub = createCollaborationHub()

const collaboration = {
  hub,
  scope: 'none' as const,
  groupsForActor: () => ['joint-investigation'],
}

await Promise.all([
  supervise(profileA, taskA, { backend: backendA, budget, collaboration }),
  supervise(profileB, taskB, { backend: backendB, budget, collaboration }),
])
```

A shared hub alone grants nothing. Actors still need a shared group. There is no implicit global discovery or broadcast.

## Context behavior

Messages are direct and bounded. The retained mailbox is the complete record. Runtime also attempts a small live inbox notification so a running actor can react before its next explicit `read_mail` call.

Send references to artifacts, findings, spans, and files instead of pasting full traces or transcripts. The recipient decides whether to retrieve and verify the referenced evidence.

## Actor identity

`read_mail` returns both:

- `actorId`: globally unambiguous within the hub; use this for federated graphs.
- `localId`: the Runtime node id; convenient when it is unambiguous among visible peers.

The sender identity and group membership are Runtime-owned facts. They are never accepted from model-authored tool arguments.

## Limits

The hub enforces per-actor send quotas, per-actor inbox count and byte limits, maximum message sizes, and reply-depth limits. A refused attempt is recorded with an explicit outcome.

These limits bound context and communication cost. They do not judge whether collaboration is useful. Discovery Lab and Eval should compare independent workers, collaborating teams, whole-graph collaboration, and selective analysis routing under equal resources.
