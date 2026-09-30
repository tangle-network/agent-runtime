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

The executor materializes credentials in the format the selected harness requires.
Authentication files are private execution inputs, even when they are ordinary files inside the sandbox.
Keep their values outside public profiles, mounted research inputs, prompts, and evidence archives.
Use supported secret references or private backend configuration at the execution boundary.
Read the current schema before naming a profile field; metadata alone does not configure authentication.

The director authors each descendant's profile and grants its permitted capabilities.
It does not need to perform an interactive login or export a parent's token.
A descendant that can spawn receives the complete profile-authoring skill and the same authorized execution path.
Changing its harness requires a granted authentication route for that harness.
Native harness subagents and Runtime descendants remain distinct observation units.

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
