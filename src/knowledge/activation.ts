import type {
  AgentImprovementActivationOutcome,
  AgentImprovementActivationResult,
  AgentImprovementActivationTarget,
  Sha256Digest,
} from '@tangle-network/agent-interface'
import { sha256DigestSchema } from '@tangle-network/agent-interface'
import {
  fromAgentCandidateKnowledgeRef,
  type KnowledgeImprovementMutationReceipt,
  loadKnowledgeImprovementActivationResult,
  type PromoteKnowledgeCandidateOptions,
  promoteKnowledgeCandidate,
  restoreKnowledgeCandidateBaseline,
} from '@tangle-network/agent-knowledge'

import {
  type AgentImprovementActivationReconciliation,
  type AgentImprovementActivationResultStore,
  type AgentImprovementActivationTransition,
  type AgentImprovementActivationTransitionInput,
  createAgentImprovementActivationResult,
} from '../intelligence/activation'

export interface CreateKnowledgeImprovementActivationExecutorOptions
  extends Omit<PromoteKnowledgeCandidateOptions, 'root' | 'candidate'> {
  root: string
  identity: string
  results: AgentImprovementActivationResultStore
}

export interface KnowledgeImprovementActivationExecutor {
  transition: AgentImprovementActivationTransition
  reconcile: AgentImprovementActivationReconciliation
}

/** Apply or restore one local knowledge candidate through the shared activation contract. */
export function createKnowledgeImprovementActivationExecutor(
  options: CreateKnowledgeImprovementActivationExecutorOptions,
): KnowledgeImprovementActivationExecutor {
  if (!options.identity.trim()) throw new Error('knowledge activation identity is required')
  return {
    reconcile: async (transition) => {
      const inspected = await inspectKnowledgeActivation(options, transition)
      return inspected.settled ? inspected.result : undefined
    },
    transition: async (transition) => {
      if (transition.expired) {
        throw new Error('knowledge write transition cannot run after authorization expires')
      }
      const inspected = await inspectKnowledgeActivation(options, transition)
      if (inspected.settled) return inspected.result

      const mutationOptions = {
        root: options.root,
        candidate: inspected.candidate,
        activation: {
          activation: transition.activation,
          attemptedAt: transition.attemptedAt,
          identity: options.identity,
          createResult: (receipt: KnowledgeImprovementMutationReceipt) =>
            inspected.create(
              knowledgeMutationOutcome(receipt, inspected, transition.activation.intent),
            ),
        },
        ...(options.ownerId ? { ownerId: options.ownerId } : {}),
        ...(options.leaseTtlMs === undefined ? {} : { leaseTtlMs: options.leaseTtlMs }),
        ...(options.now ? { now: options.now } : {}),
        ...(options.onState ? { onState: options.onState } : {}),
      }
      const improvement =
        transition.activation.intent === 'activate-candidate'
          ? await promoteKnowledgeCandidate(mutationOptions)
          : await restoreKnowledgeCandidateBaseline(mutationOptions)
      if (!improvement.activationResult) {
        throw new Error('knowledge mutation did not persist its shared activation result')
      }
      return options.results.putIfAbsent(improvement.activationResult)
    },
  }
}

type CreateKnowledgeActivation = (
  outcome: AgentImprovementActivationOutcome,
) => AgentImprovementActivationResult

type InspectedKnowledgeActivation =
  | { settled: true; result: unknown | undefined }
  | {
      settled: false
      target: AgentImprovementActivationTransitionInput['targets'][number]
      candidate: PromoteKnowledgeCandidateOptions['candidate']
      expectedDigest: Sha256Digest
      desiredDigest: Sha256Digest
      create: CreateKnowledgeActivation
    }

async function inspectKnowledgeActivation(
  options: CreateKnowledgeImprovementActivationExecutorOptions,
  transition: AgentImprovementActivationTransitionInput,
): Promise<InspectedKnowledgeActivation> {
  const stored = await options.results.load(transition.activation.digest)
  if (stored !== undefined) return { settled: true, result: stored }

  const create: CreateKnowledgeActivation = (outcome) =>
    createAgentImprovementActivationResult(transition, {
      completedAt: completionTime(transition, options.now),
      outcome,
    })
  const store = (outcome: AgentImprovementActivationOutcome) =>
    options.results.putIfAbsent(create(outcome))
  if (transition.kind !== 'sealed-candidate') {
    if (transition.expired) return { settled: true, result: undefined }
    return {
      settled: true,
      result: await store({
        status: 'unsupported',
        code: 'KNOWLEDGE_PROFILE_TRANSITION_UNSUPPORTED',
        message: 'The knowledge adapter accepts only sealed knowledge candidates.',
      }),
    }
  }
  const target = supportedKnowledgeTarget(transition, options.identity)
  if (!target) {
    if (transition.expired) return { settled: true, result: undefined }
    return {
      settled: true,
      result: await store({
        status: 'unsupported',
        code: 'KNOWLEDGE_TARGET_SET_UNSUPPORTED',
        message: 'The knowledge adapter requires exactly one matching knowledge target.',
      }),
    }
  }
  const knowledge = transition.candidateBundle.knowledge
  if (!knowledge) {
    if (transition.expired) return { settled: true, result: undefined }
    return {
      settled: true,
      result: await store({
        status: 'unsupported',
        code: 'KNOWLEDGE_CANDIDATE_MISSING',
        message: 'The measured candidate bundle does not contain a knowledge candidate.',
      }),
    }
  }
  const candidate = fromAgentCandidateKnowledgeRef(knowledge.candidate)
  const expectedDigest =
    transition.activation.intent === 'activate-candidate'
      ? knowledge.candidate.baseHash
      : knowledge.candidate.candidateHash
  const desiredDigest =
    transition.activation.intent === 'activate-candidate'
      ? knowledge.candidate.candidateHash
      : knowledge.candidate.baseHash
  if (target.expectedBaseDigest !== expectedDigest || target.desiredDigest !== desiredDigest) {
    if (transition.expired) return { settled: true, result: undefined }
    return {
      settled: true,
      result: await store({
        status: 'failed',
        code: 'KNOWLEDGE_TARGET_MISMATCH',
        message: 'The activation target does not match the measured knowledge candidate.',
      }),
    }
  }

  const durable = await loadKnowledgeImprovementActivationResult({
    root: options.root,
    candidate,
    activation: transition.activation,
    identity: options.identity,
  })
  if (durable) {
    return {
      settled: true,
      result: await options.results.putIfAbsent(durable),
    }
  }
  if (transition.expired) return { settled: true, result: undefined }
  return { settled: false, target, candidate, expectedDigest, desiredDigest, create }
}

function supportedKnowledgeTarget(
  transition: AgentImprovementActivationTransitionInput,
  identity: string,
): AgentImprovementActivationTransitionInput['targets'][number] | undefined {
  if (transition.targets.length !== 1) return undefined
  const target = transition.targets[0]
  return target.surface === 'knowledge' && target.identity === identity ? target : undefined
}

function knowledgeMutationOutcome(
  receipt: KnowledgeImprovementMutationReceipt,
  inspected: Extract<InspectedKnowledgeActivation, { settled: false }>,
  intent: AgentImprovementActivationTransitionInput['activation']['intent'],
): AgentImprovementActivationOutcome {
  const expectedTarget = intent === 'activate-candidate' ? 'candidate' : 'baseline'
  const beforeDigest = prefixedDigest(receipt.beforeHash)
  const afterDigest = prefixedDigest(receipt.afterHash)
  if (
    receipt.target !== expectedTarget ||
    receipt.changed !== (beforeDigest !== afterDigest) ||
    (!receipt.changed && (receipt.transactionId !== null || receipt.recovered))
  ) {
    throw new Error('knowledge mutation returned inconsistent state evidence')
  }
  if (receipt.changed) {
    if (
      receipt.transactionId === null ||
      beforeDigest !== inspected.expectedDigest ||
      afterDigest !== inspected.desiredDigest
    ) {
      throw new Error('knowledge activation did not apply its authorized content transition')
    }
    return {
      status: 'applied',
      transactionId: receipt.transactionId,
      targets: [
        {
          surface: inspected.target.surface,
          identity: inspected.target.identity,
          beforeDigest,
          afterDigest,
        },
      ],
    }
  }
  if (afterDigest === inspected.desiredDigest) {
    return {
      status: 'already-applied',
      targets: [targetState(inspected.target, afterDigest)],
    }
  }
  if (afterDigest === inspected.expectedDigest) {
    throw new Error('knowledge activation did not attempt its authorized content transition')
  }
  return {
    status: 'conflict',
    targets: [targetState(inspected.target, afterDigest)],
  }
}

function targetState(target: AgentImprovementActivationTarget, currentDigest: Sha256Digest) {
  return {
    surface: target.surface,
    identity: target.identity,
    currentDigest,
  }
}

function prefixedDigest(hash: string): Sha256Digest {
  return sha256DigestSchema.parse(`sha256:${hash}`)
}

function completionTime(
  transition: AgentImprovementActivationTransitionInput,
  now: (() => Date) | undefined,
): string {
  const completedAt = (now ?? (() => new Date()))().toISOString()
  return Date.parse(completedAt) < Date.parse(transition.attemptedAt)
    ? transition.attemptedAt
    : completedAt
}
