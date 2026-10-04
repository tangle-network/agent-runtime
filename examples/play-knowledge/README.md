# Bind retained knowledge to one play

This example connects Knowledge's memory and retrieval tools through Runtime's existing `resolveSupervisorTools` option. Each exact profile declares its own grants. Runtime gives the factory a trusted run, namespace, and node identity before starting that node's driver. No role name adds tools.

`runtime-tools.ts` is a consumer example, not an additional Runtime API or execution policy. The application admits its source corpus, opens Knowledge adapters, and owns checkpoint persistence. Runtime continues to own execution and its journal.

## Required deployment boundary

The controller must be able to open the admitted QMD corpus and reach the commissioned memory backend before agent execution. An operator machine's QMD installation and SSH loopback forward are not available inside a cloud controller. Runtime's authenticated coordination MCP serves already-bound tools to agent sandboxes; it does not connect a controller to private host storage.

Do not expose an unauthenticated Hindsight API or pass a global bank selector to an agent. Supply an authenticated private transport and construct the Knowledge client in the trusted controller. Refuse startup if its declared endpoint, credentials, or admitted corpus are unavailable. Credentials come from the deployment's secret environment, never from the profile, tool arguments, or retained input. This example does not claim that such a cloud transport has been deployed. The concrete Fleet deployment gap is tracked in [tangle-tools#541](https://github.com/tangle-network/tangle-tools/issues/541).

## Bind the commissioned input

Retain the play's `runId`, `namespace`, memory `branchId`, backend reference, admitted source manifest and hashes, and checkpoint digest with the application's immutable input. The namespace and branch identify the logical play across execution attempts. A continuation explicitly commissioned within that play can use a new Runtime run ID with the same namespace and branch; an independent play or checkpoint fork gets a fresh namespace and branch. The caller passes opened, scoped Knowledge objects:

```ts
import { createFileRunContext, supervise } from '@tangle-network/agent-runtime/kernel'
import { createPlayKnowledgeResolver } from './runtime-tools.js'

// commissioned, profile, task, runDir, backend, memoryBranch, and qmdProvider
// are supplied by the application after source and credential admission.
const resolveSupervisorTools = await createPlayKnowledgeResolver({
  run: { runId: commissioned.runId, namespace: commissioned.namespace },
  branch: memoryBranch,
  qmd: qmdProvider, // createQmdSearchProvider bound to commissioned.namespace
  onCheckpoint: persistCheckpoint, // acknowledge only after durable persistence
  recordRetrieval: retainSourceReceipt,
})

await supervise(profile, task, {
  backend,
  budget: commissioned.budget,
  runId: commissioned.runId,
  runDir,
  runContext: {
    ...createFileRunContext(runDir, { withDriver: true }),
    runId: commissioned.runId,
    namespace: commissioned.namespace,
  },
  inheritSpawnRights: false,
  resolveSupervisorTools,
})
```

The memory branch has `lifetime: 'resumable'`, `baseScope: { namespace }`, and a shared read/write policy for this play. Its Hindsight adapter is bound to that branch's physical backend scope. The resolver rejects a checkpoint belonging to another play and rejects a different Runtime identity. It records `[context.runId, context.nodeId]` as a JSON tuple in `actorId`, preserving both trusted coordinates when a node label repeats across executions. Attribution changes while agents keep sharing the same play memory.

Profiles opt into any of these exact tool names:

```json
{
  "tools": {
    "agent_runtime_coordination_memory_recall": true,
    "agent_runtime_coordination_memory_record": true,
    "agent_runtime_coordination_qmd_search": true,
    "agent_runtime_coordination_qmd_read": true
  }
}
```

Omitted or `false` grants expose no such tool. A descendant can declare these tools without permission to spawn. A declared QMD tool with no admitted provider fails before its driver runs. The resolver rejects a foreign QMD scope and calls `verifySnapshot()` before returning; every document must match its authoritative hash. Reads check again. This does not establish retrieval recall or prevent an external index from changing later. The resolver does not rewrite child profiles. Agent-authored child profiles must request the tools they intend to use; the product may separately authorize those profiles with Runtime's existing spawn policy.

Memory writes require stable operation IDs and source references where available. A recorded fact is an attributed claim, not verification that it is true. Retrieval receipts retain the returned source identity; dispatch or search alone does not prove an agent used that knowledge.

## Resume and fork

For an eligible interrupted run, reopen the same backend reference, reconstruct the same resumable memory branch from its accepted checkpoint (reuse the checkpoint’s normalized scope and policy), and use the same Runtime run ID, namespace, and journal directory. The controller must hold the application's normal single-owner lease. A checkpoint callback is part of a write's acknowledgement; preserve an uncertain backend outcome instead of retrying it under a fresh operation ID.

For a new play, use Knowledge's `forkAgentMemoryBranchSnapshot` with a fresh branch adapter, branch ID, and `{ namespace }`. The fork carries the accepted checkpoint journal into an isolated scope. It is not an external database transaction or a clone of all facts that another process might have written. Runtime's settled-play rules still apply: a changed task or a settled run is a new input, not a resume.

A Discovery `runtimeOptions` module can return the same `runContext`, `inheritSpawnRights`, and `resolveSupervisorTools` options. Bundle its dependencies using the maintained consumer's packaging path and retain the module in the input; do not edit a frozen run. Placement, run ID, budgets, and profile choices remain owned by the recorded run input. Source admission and the private backend transport must succeed in the actual controller environment.

## Checked boundary

`tests/kernel/play-knowledge-binding.test.ts` exercises this example through `supervise`, its real node resolver, and HTTP MCP tool calls. It checks a root, a director, a nonspawning descendant, exact grants, binding reconstruction, a new execution identity within the same play, fork isolation, and missing or stale source refusal before driver invocation. Memory storage and the QMD SDK client are explicit local fixtures; the tests call Knowledge's actual memory and QMD tool factories. These tests do not establish a saved write in a deployed Hindsight service or measure its inference. They do not establish QMD ranking quality, sandbox deployment, research quality, eligible interrupted execution resume, or cross-process controller recovery. The reconstruction check re-enters the low-level kernel after a fixture invocation; it does not reopen a settled `supervisePursuit`.
