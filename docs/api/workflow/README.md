[**@tangle-network/agent-runtime**](../README.md)

***

[@tangle-network/agent-runtime](../README.md) / workflow

# workflow

## Classes

- [WorkflowBudget](classes/WorkflowBudget.md)

## Interfaces

- [WorkflowSandboxAgentTrace](interfaces/WorkflowSandboxAgentTrace.md)
- [CreateSandboxWorkflowAgentDelegateOptions](interfaces/CreateSandboxWorkflowAgentDelegateOptions.md)
- [WorkflowSandboxAgentDefaultTrace](interfaces/WorkflowSandboxAgentDefaultTrace.md)
- [CreateRunLoopWorkflowDelegateOptions](interfaces/CreateRunLoopWorkflowDelegateOptions.md)
- [NestedWorkflowDelegateInput](interfaces/NestedWorkflowDelegateInput.md)
- [NestedWorkflowTrace](interfaces/NestedWorkflowTrace.md)
- [CreateNestedWorkflowAgentDelegateOptions](interfaces/CreateNestedWorkflowAgentDelegateOptions.md)
- [WorkflowPhaseMeta](interfaces/WorkflowPhaseMeta.md)
- [WorkflowMeta](interfaces/WorkflowMeta.md)
- [WorkflowTokenUsage](interfaces/WorkflowTokenUsage.md)
- [WorkflowBudgetSnapshot](interfaces/WorkflowBudgetSnapshot.md)
- [WorkflowBudgetRemaining](interfaces/WorkflowBudgetRemaining.md)
- [WorkflowBudgetCaps](interfaces/WorkflowBudgetCaps.md)
- [WorkflowBudgetView](interfaces/WorkflowBudgetView.md)
- [WorkflowAgentOptions](interfaces/WorkflowAgentOptions.md)
- [WorkflowLoopOptions](interfaces/WorkflowLoopOptions.md)
- [WorkflowCheckpointOptions](interfaces/WorkflowCheckpointOptions.md)
- [WorkflowDelegateResult](interfaces/WorkflowDelegateResult.md)
- [WorkflowDelegateContext](interfaces/WorkflowDelegateContext.md)
- [WorkflowStartedPayload](interfaces/WorkflowStartedPayload.md)
- [WorkflowPhasePayload](interfaces/WorkflowPhasePayload.md)
- [WorkflowLogPayload](interfaces/WorkflowLogPayload.md)
- [WorkflowParallelStartedPayload](interfaces/WorkflowParallelStartedPayload.md)
- [WorkflowParallelEndedPayload](interfaces/WorkflowParallelEndedPayload.md)
- [WorkflowPipelineStartedPayload](interfaces/WorkflowPipelineStartedPayload.md)
- [WorkflowPipelineEndedPayload](interfaces/WorkflowPipelineEndedPayload.md)
- [WorkflowBranchStartedPayload](interfaces/WorkflowBranchStartedPayload.md)
- [WorkflowBranchEndedPayload](interfaces/WorkflowBranchEndedPayload.md)
- [WorkflowBranchFailedPayload](interfaces/WorkflowBranchFailedPayload.md)
- [WorkflowAgentStartedPayload](interfaces/WorkflowAgentStartedPayload.md)
- [WorkflowAgentEndedPayload](interfaces/WorkflowAgentEndedPayload.md)
- [WorkflowLoopStartedPayload](interfaces/WorkflowLoopStartedPayload.md)
- [WorkflowLoopEndedPayload](interfaces/WorkflowLoopEndedPayload.md)
- [WorkflowCheckpointStartedPayload](interfaces/WorkflowCheckpointStartedPayload.md)
- [WorkflowCheckpointEndedPayload](interfaces/WorkflowCheckpointEndedPayload.md)
- [WorkflowFailedPayload](interfaces/WorkflowFailedPayload.md)
- [WorkflowEndedPayload](interfaces/WorkflowEndedPayload.md)
- [WorkflowTraceEmitter](interfaces/WorkflowTraceEmitter.md)
- [WorkflowRuntimeOptions](interfaces/WorkflowRuntimeOptions.md)
- [WorkflowResult](interfaces/WorkflowResult.md)
- [ParsedWorkflowScript](interfaces/ParsedWorkflowScript.md)

## Type Aliases

- [WorkflowSandboxAgentStream](type-aliases/WorkflowSandboxAgentStream.md)
- [WorkflowSandboxAgentProfileResolver](type-aliases/WorkflowSandboxAgentProfileResolver.md)
- [WorkflowSandboxPromptOptionsResolver](type-aliases/WorkflowSandboxPromptOptionsResolver.md)
- [NestedWorkflowCapsResolver](type-aliases/NestedWorkflowCapsResolver.md)
- [NestedWorkflowMetadataResolver](type-aliases/NestedWorkflowMetadataResolver.md)
- [JsonSchema](type-aliases/JsonSchema.md)
- [WorkflowAgentDelegate](type-aliases/WorkflowAgentDelegate.md)
- [WorkflowLoopDelegate](type-aliases/WorkflowLoopDelegate.md)
- [WorkflowVerifierDelegate](type-aliases/WorkflowVerifierDelegate.md)
- [WorkflowAnalystDelegate](type-aliases/WorkflowAnalystDelegate.md)
- [WorkflowReviewerDelegate](type-aliases/WorkflowReviewerDelegate.md)
- [WorkflowTraceEvent](type-aliases/WorkflowTraceEvent.md)
- [WorkflowBranchOperation](type-aliases/WorkflowBranchOperation.md)

## Functions

- [createSandboxWorkflowAgentDelegate](functions/createSandboxWorkflowAgentDelegate.md)
- [parseSandboxAgentDefaultOutput](functions/parseSandboxAgentDefaultOutput.md)
- [createRunLoopWorkflowDelegate](functions/createRunLoopWorkflowDelegate.md)
- [createNestedWorkflowAgentDelegate](functions/createNestedWorkflowAgentDelegate.md)
- [runWorkflow](functions/runWorkflow.md)
- [validateJsonSchema](functions/validateJsonSchema.md)
- [parseWorkflowScript](functions/parseWorkflowScript.md)
- [validateWorkflowBody](functions/validateWorkflowBody.md)
