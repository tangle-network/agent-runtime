import {
  type AgentProfile,
  type ContextTransferReceipt,
  type ContextTransferRequest,
  canonicalAgentProfileDigest,
  createContextTransferRequest,
  type PortableContextDestination,
  portableContextPlanDigest,
  portableConversationContextDigest,
} from '@tangle-network/agent-interface'

const retainedRequestDigest = `sha256:${'a'.repeat(64)}` as const

export const retainedContextProfile: AgentProfile = { name: 'worker', harness: 'codex' }

export function retainedContextTransfer(
  operationId = 'retained-transfer',
  destinationOverrides: Partial<PortableContextDestination> = {},
): ContextTransferRequest {
  const sourceMaterial = {
    source: {
      runId: 'source-run',
      messageId: 'source-message',
      provider: 'source-provider',
      environmentId: 'source-environment',
      sessionId: 'source-session',
      executionId: 'source-execution',
      requestDigest: retainedRequestDigest,
    },
    completeness: 'complete' as const,
    messages: [
      {
        id: 'source-message',
        role: 'user' as const,
        parts: [{ type: 'text' as const, text: 'portable context' }],
        timestamp: '2026-08-01T20:00:00.000Z',
      },
    ],
    attachments: [],
  }
  const source = {
    ...sourceMaterial,
    digest: portableConversationContextDigest(sourceMaterial),
  }
  const destination = {
    runner: 'codex',
    provider: 'test-provider',
    environmentId: 'destination-environment',
    sessionId: 'destination-session',
    runId: 'destination-run',
    executionId: 'destination-execution',
    profileDigest: canonicalAgentProfileDigest(retainedContextProfile),
    ...destinationOverrides,
  }
  const contextMaterial = {
    source: source.source,
    completeness: 'complete' as const,
    messages: source.messages,
    attachments: [],
  }
  const context = {
    ...contextMaterial,
    digest: portableConversationContextDigest(contextMaterial),
  }
  const planMaterial = {
    planId: 'retained-plan',
    source,
    destination,
    messages: [
      {
        messageId: 'source-message',
        action: 'include' as const,
        parts: [{ partIndex: 0, action: 'include' as const }],
      },
    ],
    context,
    requiresAcceptance: false,
  }
  const plan = {
    ...planMaterial,
    digest: portableContextPlanDigest(planMaterial),
  }
  const material = {
    operationId,
    plan,
    profile: retainedContextProfile,
    acceptance: {
      planDigest: plan.digest,
      acceptedAt: '2026-08-01T20:01:00.000Z',
      acceptedBy: 'system' as const,
    },
  }
  return createContextTransferRequest(material)
}

export function acceptedContextTransferReceipt(
  request: ContextTransferRequest,
): ContextTransferReceipt {
  const destination = request.plan.destination
  return {
    status: 'accepted',
    operationId: request.operationId,
    requestDigest: request.requestDigest,
    planDigest: request.plan.digest,
    contextDigest: request.plan.context.digest,
    source: request.plan.source.source,
    destination,
    provider: destination.provider,
    environmentId: destination.environmentId!,
    sessionId: destination.sessionId,
    executionId: destination.executionId,
    runId: destination.runId,
    sessionCreatedForOperationId: request.operationId,
    sessionCreatedAt: '2026-08-01T20:01:01.000Z',
    admittedAt: '2026-08-01T20:01:02.000Z',
    transferredMessageIds: request.plan.messages
      .filter((m) => m.action === 'include')
      .map((m) => m.messageId),
    omittedMessageIds: request.plan.messages
      .filter((m) => m.action === 'omit')
      .map((m) => m.messageId),
  }
}
