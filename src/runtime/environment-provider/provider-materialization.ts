import type { AgentProfile } from '@tangle-network/agent-interface'
import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import { newExecutionAttemptId } from '../supervise/materialization'
import {
  concreteProfileModel,
  enforceTokenLimits,
  profileModelExecutionSettings,
} from '../supervise/model-policy'
import type { RetainedExecutorContext } from '../supervise/retained-executor'
import type {
  ExecutorExecutionBinding,
  ExecutorMaterialization,
  ExecutorNodeContext,
} from '../supervise/types'
import type { ProviderExecutorOptions } from './provider-executor-admission'

export function providerMaterialization(
  provider: AgentEnvironmentProvider,
  createProfile: AgentProfile,
  node: ExecutorNodeContext | undefined,
  executionId: string,
  retention: RetainedExecutorContext | undefined,
  options: ProviderExecutorOptions,
  placement: { id: string; digest: string } | undefined,
): { plannedDeclaration: ExecutorMaterialization; plannedBinding: ExecutorExecutionBinding } {
  const attemptId = node?.attemptId ?? newExecutionAttemptId(executionId)
  const providerModel = concreteProfileModel(createProfile)
  // The provider owns the model call inside its environment and the create input carries no
  // completion cap, so a requested ceiling is refused before the environment is paid for.
  const tokenLimits = enforceTokenLimits(
    profileModelExecutionSettings(createProfile, `providerAsExecutor(${provider.name})`, 'provider')
      .tokenLimits,
    'provider',
    `providerAsExecutor(${provider.name})`,
  )
  // The environment identity is server-issued, so before `create` resolves this declaration is a
  // planned authority check, never a receipt.
  const plannedDeclaration: ExecutorMaterialization = {
    effectiveProfile: createProfile,
    backend: provider.name,
    model: providerModel
      ? { status: 'known', id: providerModel }
      : { status: 'unknown', reason: 'provider environment selected its default model' },
    execution: { kind: 'environment', id: executionId },
    materializer: 'environment-provider-create',
    plan: {
      kind: 'agent-environment',
      provider: provider.name,
      destroyOnSettle: retention?.preserveEnvironment ? false : (options.destroyOnSettle ?? true),
      requireTerminalEvent: options.requireTerminalEvent ?? true,
      tokenLimits,
      ...(placement ? { placement } : {}),
    },
  }
  const plannedBinding: ExecutorExecutionBinding = {
    attemptId,
    binding: {
      provider: provider.name,
      executionId,
      model: providerModel ?? null,
      ...(placement ? { placement } : {}),
    },
    descriptor: {
      kind: 'agent-environment',
      transport: 'provider',
      backend: provider.name,
      ...(placement ? { placementId: placement.id, placementDigest: placement.digest } : {}),
    },
  }
  return { plannedDeclaration, plannedBinding }
}
