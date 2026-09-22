# Anti-Patterns

These patterns create incorrect results, unclear ownership, or duplicate runtime behavior.

## Rebuilding Provider Lifecycle

Do not recreate environment creation, streaming, session continuation, workspace reads, and cleanup inside an application loop.
Use an `AgentEnvironmentProvider` with `openEnvironmentRun` or `runAgentRounds`.
Implement a new provider only when an execution service cannot satisfy the existing contract.

## Selecting Execution By Vendor Branches

Do not spread provider-name conditionals through application code.
Construct providers at the application boundary and pass the selected provider into Runtime.
Use `AgentEnvironmentProviderRegistry` when selection must come from configuration.

## Hiding Unsupported Capabilities

Do not advertise session, workspace, command, or branching support that the provider cannot perform.
Missing capabilities should fail before work starts.
A provider fallback must preserve requested behavior instead of silently changing it.

## Putting Operations In Profiles

Do not place credentials, provider clients, deployment settings, or observation callbacks in `AgentProfile`.
Profiles describe portable agent behavior.
Applications own providers, secrets, cancellation, and runtime hooks.

## Mixing Providers And Executors

Do not treat `AgentEnvironmentProvider` and `Executor` as interchangeable contracts.
Providers own environment lifecycle and capabilities.
Executors own one supervised unit of work, steering, usage reporting, and cleanup.
Use the provider-backed executor when supervised work must run through a provider.

## Losing Lifecycle Ownership

Do not create an environment or lineage without a clear owner for shutdown.
Close persistent runs and tear down direct lineage objects in `finally` blocks.
Cleanup should remain idempotent when cancellation and normal completion race.

## Comparing Unequal Runs

Do not attribute an improvement to coordination, prompts, or provider choice when compared runs received different tasks or resources.
Record tasks, models, providers, iteration limits, concurrency, tokens, cost, and failures for each compared run.
Separate execution failures from task-quality failures.

## Letting Selection Grade Itself

Do not use the same unreviewed model output both to choose a candidate and to establish that the candidate is correct.
Use independent checks and held-back cases for promotion decisions.
Report uncertainty when the task set is too small to support the claimed difference.

## Silent Success

Do not ignore provider errors, `readError`, empty event streams, or exhausted budgets.
Preserve failure details in typed results or thrown errors that retain the observed events.
Inspect the produced artifact or terminal event before reporting completion.

## Preserving Obsolete Design History

Do not keep implementation plans as current documentation after their APIs are removed.
Move durable decisions into current reference docs and delete the stale plan.
Keep historical material only when it explains a still-enforced invariant that current docs cannot state directly.
