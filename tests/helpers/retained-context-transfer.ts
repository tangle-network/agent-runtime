import {
  type ContextTransferRequest,
  ContextTransferRequestSchema,
  contextTransferRequestDigest,
  portableContextPlanDigest,
  portableConversationContextDigest,
} from '@tangle-network/agent-interface'

const retainedRequestDigest = `sha256:${'a'.repeat(64)}` as const

export function retainedContextTransfer(operationId = 'retained-transfer'): ContextTransferRequest {
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
    profileDigest: `sha256:${'b'.repeat(64)}` as const,
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
    acceptance: {
      planDigest: plan.digest,
      acceptedAt: '2026-08-01T20:01:00.000Z',
      acceptedBy: 'system' as const,
    },
  }
  return ContextTransferRequestSchema.parse({
    requestDigest: contextTransferRequestDigest(material),
    ...material,
  })
}
