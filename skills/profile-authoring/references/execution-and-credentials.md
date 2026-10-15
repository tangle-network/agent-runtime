# Execution and credentials

## Choose the profile; inherit the authorized execution

The profile defines the harness, model, instructions, capabilities, and research behavior.
The private executor supplies authentication and placement under the run's authority.
An account credential does not select a different model or grant additional tools.

Select the harness and model explicitly from the installed capability contract.
Use the granted provider for the root and its Runtime descendants.
Let its credential resolver select an authorized account for each exact profile and creation identity.
Use the installed provider's supported static binding when no dynamic selector is configured.
Account selection, quota, validity, and renewal belong to that account owner.

For local/offline work, the executor may materialize readable credentials in the format the harness requires.
Keep these private execution inputs outside public profiles, mounted research inputs, prompts and evidence archives; metadata alone does not configure authentication.

The director authors each descendant's profile and grants its permitted capabilities.
It does not need to perform an interactive login or export a parent's token.
A descendant that can spawn receives the complete profile-authoring skill and the same authorized execution path.
Changing its harness requires a granted authentication route for that harness.
Native harness subagents and Runtime descendants remain distinct observation units.

## Proxy-held network credentials

Choose custody by what must read the value. A `secret-ref` names an authorized store entry; ordinary MCP env references and native auth files can still deliver readable bytes. Local signing and offline tools need that readable execution mode. Network-only authentication uses `proxySecrets`: the trusted proxy resolves the reference, while the guest receives a placeholder. Neither a secret name nor a private file proves proxy custody.

Use the [canonical portable declaration](https://github.com/tangle-network/agent-sdk/blob/main/packages/agent-interface/src/agent-profile.ts) and the installed provider's capability contract. Author `envName`, `secretRef: {"kind":"secret-ref","key":"…"}`, exact `hosts`, and a discriminated `presentation`; choose explicit `methods`, canonical `paths` and a finite `ttlSeconds` for the task. Read supported presentations, selector semantics and lifetime bounds from that owner. Keep values, alternate aliases and readable copies out of env, MCP headers, native auth, resources and prompts. The endpoint must be reviewed for reflection and credential issuance; provider-side account/resource restrictions remain required.

The [manager](../examples/proxy-manager.json) and [worker](../examples/proxy-worker.json) are editable profiles, with a reserved example host and a named store reference. Replace both with the reviewed endpoint and an authorized reference; choose the lifetime from the task and installed policy. Select the harness/model from the served seat contract. Mount the installed skill byte for byte at `skills/profile-authoring/SKILL.md` and the worker at `profiles/proxy-worker.json` with `failOnError`. Verify that the served harness shell has curl and the output directory before launch; a prompt does not install them. The worker deliberately grants fewer request paths than its manager.

Proxy bindings do not inherit through ordinary profile defaults. Each child must request its own subset of its parent's authenticated authority: same reference and presentation, no added host/method/path, no later expiry. A child that can spawn carries this skill and follows the same rule for its grandchild. Put different authorities in separate sandboxes; processes in one sandbox cannot authenticate themselves to the proxy as different actors. The issuer, not the model-authored parent identifier, establishes ancestry.

Before dispatch or retained-box continuation, compare the installed capability and placement receipt with the effective declaration and native adapter. Confirm that every binding was installed at the expected generation and scope, with placeholder-only env/auth files and no unresolved reference. Unsupported capability, adapter, expiry, failed renewal or missing receipt stops dispatch. Preserve the non-secret refusal; never substitute readable delivery. Renewal, rotation and recovery must re-establish custody before the next turn. A local HTTP coordination listener needs the Runtime's supported trusted broker path or public HTTPS ingress; an ordinary proxy binding does not authorize a private-address exception.

### Public-boundary acceptance: installed recursive proxy profile

Run this through the released skill and installed Runtime/provider path, with an isolated test store entry and a reviewed non-reflecting endpoint. Source lint is the cheapest preliminary check; it does not prove placement or execution.

1. Load the released manager and worker examples from the executor's installed skill receipt, adapt the reference/scope to the authorized fixture, and pass them through the canonical profile schema and Runtime admission. Keep the authored/effective profiles and non-secret placement receipts.
2. Start the root through that installed path; make a real authorized request, spawn the manager as a child, and let it spawn the worker as a grandchild. Prove both edges from actor identities and journal records, plus a tool action and response artifact from the worker.
3. Inspect env, `/proc`, mounted config/auth files, journal, trace and retained snapshot exports for the fixture value and readable aliases; require placeholders only. Try a disallowed host, method and path, an unresolved reference, a readable duplicate, an unsupported adapter and a child authority expansion; each must fail before credential use.
4. Continue the retained child after renewal, then rotate and confirm the new generation before dispatch. Revoke the ancestor binding, confirm descendant enforcement and a failed next request, and separately record whether the upstream credential was revoked. Repeat after listener rebinding and recovery; a lost or expired grant must stay closed.

Stop only when the released examples executed through those installed paths, all confinement/renewal/revocation checks passed, and the non-secret artifacts are retrievable. If a required published contract, placement capability or Discovery path is unavailable, report that owner and missing release as blocked; a local checker, package publication or mock receipt cannot replace this acceptance test.

## Cloud execution and persistence

When the run requires cloud execution, place its controller, root, and descendants in the managed cloud.
Use the maintained managed-process deployment and ingress rather than a detached host process.
Choose a distinct run identity and immutable controller image for each commission.
The ingress binds each Runtime actor to its own authenticated listener.
Research policy stays in profiles and the registered method, not the ingress.

Retain the original workspace and native session through the execution owner's supported continuation path.
Record account changes, renewal, reconnects, and native-session changes separately.
A fresh environment with copied files is not proof that the original native session resumed.
Preserve partial artifacts before environment cleanup and archive them through the existing storage path.
Check that retained capture excludes authentication files and other private credentials.

## What proves execution

Separate configuration, materialization, model execution, research progress, and outside acceptance.
For a root and a recursively spawned child, inspect:

- The exact authored profile and materialization receipt.
- The cloud placement, Runtime actor, and native session identities.
- The granted account reference and actual harness/model evidence, without credential values.
- The first model invocation and a real tool action.
- The child-to-grandchild edge when claiming recursion.
- Retrievable trace and artifact bytes after capture.

A merged source change or published package does not prove a running deployment supports it.
A supported deployment does not prove an account was used.
An agent's claim of delegation does not prove that its child executed.
Keep missing identity, usage, cost, and renewal evidence unknown.

The operator establishes the execution path before research begins.
When an authorized capability fails inside a run, retain its receipt and use the granted reporting or recovery tool.
Continue useful research through capabilities that remain available within the same authority.

## Maintained contracts

Use these owners for changing fields and commands instead of copying an API catalog into this skill.

- [Runtime profile and execution composition](https://github.com/tangle-network/agent-runtime/blob/main/docs/canonical-api.md#15-the-agentprofile-rule-author-the-profile-the-substrate-materializes-it).
- [Runtime managed compute](https://github.com/tangle-network/agent-runtime/blob/main/docs/agent-managed-compute/README.md).
- [Portable profile schema](https://github.com/tangle-network/agent-sdk/blob/main/packages/agent-interface/src/profile-schema.ts).
- [Tangle provider credentials and execution](https://github.com/tangle-network/agent-sdk/blob/main/packages/agent-provider-tangle/README.md).
- [Discovery cloud submission and retention](https://github.com/tangle-network/discovery-lab/blob/master/README.md).

Read the installed provider's contract before using a newer source-only resolver or capability.
The core skill remains sufficient to author a child; mount this reference when its assignment includes execution integration.
