import {
  AgentExactRunControlRefSchema,
  canonicalCandidateDigest,
  isProxySecretParentsTotal,
  ProxySecretParentsSchema,
  type ProxySecretReceipt,
  ProxySecretReceiptSchema,
  ProxySecretsSchema,
} from '@tangle-network/agent-interface'
import { z } from 'zod'
import { ValidationError } from '../errors'
import {
  type CoordinationProxySecretSourceIdentity,
  captureCoordinationProxySecretSourceIdentity,
} from './supervise/coordination-credential'
import { detachedSnapshot } from './supervise/snapshot'

const sourceIdentitySchema = z.unknown().transform((value, context) => {
  try {
    return captureCoordinationProxySecretSourceIdentity(value)
  } catch {
    context.addIssue({ code: 'custom', message: 'invalid proxy-secret source metadata' })
    return z.NEVER
  }
})

const selected = z.strictObject({
  phase: z.literal('proxy-secrets'),
  stage: z.literal('selected'),
  provider: AgentExactRunControlRefSchema.shape.provider,
  environmentId: AgentExactRunControlRefSchema.shape.environmentId.optional(),
  idempotencyKey: z.string().min(1).optional(),
  proxySecrets: ProxySecretsSchema,
  proxySecretParents: ProxySecretParentsSchema,
  requestDigest: z.string(),
  sourceIdentity: sourceIdentitySchema.optional(),
})
const replacement = selected.extend({
  stage: z.literal('replacement'),
  environmentId: AgentExactRunControlRefSchema.shape.environmentId,
  priorReceipt: ProxySecretReceiptSchema,
  expectedProxySecretGeneration: z.number().int(),
})
const installed = selected.extend({
  stage: z.literal('installed'),
  environmentId: AgentExactRunControlRefSchema.shape.environmentId,
  priorReceipt: ProxySecretReceiptSchema.optional(),
  expectedProxySecretGeneration: z.number().int().optional(),
  receipt: ProxySecretReceiptSchema,
})
const admissionSchema = z.discriminatedUnion('stage', [selected, replacement, installed])

/** Public metadata only, carried through the existing awaited admission hook.
 * @useDeclaredType
 */
export type ProxySecretBindingAdmission = z.infer<typeof admissionSchema>

/** The owner admits only canonical, exactly digested metadata into its private evidence channel. */
export function captureProxySecretBindingAdmission(value: unknown): ProxySecretBindingAdmission {
  const parsed = admissionSchema.safeParse(value)
  if (!parsed.success) throw invalidAdmission()
  const admission = parsed.data
  const { requestDigest, ...material } = admission
  if (
    canonicalCandidateDigest(material) !== requestDigest ||
    (admission.environmentId === undefined && admission.idempotencyKey === undefined) ||
    !isProxySecretParentsTotal(admission.proxySecrets, admission.proxySecretParents) ||
    (admission.sourceIdentity !== undefined &&
      !admission.proxySecrets.some(
        (binding) => binding.secretRef.key === admission.sourceIdentity?.key,
      )) ||
    (admission.stage !== 'selected' &&
      admission.priorReceipt !== undefined &&
      (admission.priorReceipt.sandboxId !== admission.environmentId ||
        admission.expectedProxySecretGeneration !== admission.priorReceipt.generation)) ||
    (admission.stage === 'installed' &&
      (admission.receipt.sandboxId !== admission.environmentId ||
        (admission.priorReceipt === undefined &&
          (admission.idempotencyKey === undefined ||
            admission.expectedProxySecretGeneration !== undefined))))
  )
    throw invalidAdmission()
  if (admission.stage === 'installed') {
    if (
      admission.receipt.status !==
        (admission.proxySecrets.length === 0 ? 'revoked' : 'installed') ||
      admission.receipt.bindings.length !== admission.proxySecrets.length ||
      admission.proxySecrets.some(
        (binding) =>
          !admission.receipt.bindings.some(
            (entry) =>
              entry.envName === binding.envName && entry.secretRef.key === binding.secretRef.key,
          ),
      )
    )
      throw invalidAdmission()
    assertProxySecretSourceIdentity(admission.receipt, admission.sourceIdentity)
  }
  return detachedSnapshot(admission, 'proxy-secret binding admission')
}

export function createProxySecretBindingAdmission(
  material: Record<string, unknown>,
): ProxySecretBindingAdmission {
  return captureProxySecretBindingAdmission({
    ...material,
    requestDigest: canonicalCandidateDigest(material),
  })
}

function invalidAdmission(): ValidationError {
  return new ValidationError(
    'proxy-secret binding admission is invalid or conflicts with its public metadata',
  )
}

/** The new grant must resolve the exact metadata-only source the host admitted. */
export function assertProxySecretSourceIdentity(
  receipt: ProxySecretReceipt | undefined,
  source: CoordinationProxySecretSourceIdentity | undefined,
): void {
  if (source === undefined) return
  const expected = captureCoordinationProxySecretSourceIdentity(source)
  const parsed = ProxySecretReceiptSchema.safeParse(receipt)
  const entries = parsed.success
    ? parsed.data.bindings.filter((entry) => entry.secretRef.key === expected.key)
    : []
  if (
    !parsed.success ||
    entries.length === 0 ||
    entries.some(
      (entry) =>
        canonicalCandidateDigest(entry.grant.identity) !==
          canonicalCandidateDigest(expected.identity) ||
        Date.parse(entry.grant.expiresAt) > Date.parse(expected.expiresAt),
    )
  ) {
    throw new ValidationError(
      'provider custody does not match the admitted proxy-secret source identity',
    )
  }
}
