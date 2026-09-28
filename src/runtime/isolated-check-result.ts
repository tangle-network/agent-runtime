import {
  agentCandidateWorkspaceManifestMaterialSchema,
  canonicalCandidateDigest,
  sha256DigestSchema,
} from '@tangle-network/agent-interface'
import { z } from 'zod'
import type { IsolatedCheckBoxEvidence, IsolatedCheckResult } from './isolated-checker'

/** The existing execution type and its wire decoder must stay compatible in both directions. */
export const isolatedCheckBoxEvidenceSchema = z
  .object({
    sandboxId: z.string().min(1),
    account: z.string().min(1),
    memoryMB: z.number().finite().positive().optional(),
    input: agentCandidateWorkspaceManifestMaterialSchema,
    inputDigest: sha256DigestSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (canonicalCandidateDigest(value.input) !== value.inputDigest)
      context.addIssue({ code: 'custom', message: 'Check input digest does not match its manifest' })
  }) satisfies z.ZodType<IsolatedCheckBoxEvidence>

/** Execution evidence, not a verdict about task correctness or permission to execute again. */
export const isolatedCheckResultSchema = z.discriminatedUnion('succeeded', [
  z.object({
    succeeded: z.literal(true),
    value: z.object({ stdout: z.string(), stderr: z.string() }).strict(),
    box: isolatedCheckBoxEvidenceSchema.optional(),
  }).strict(),
  z.object({
    succeeded: z.literal(false),
    reason: z.enum([
      'refused', 'failed', 'timeout', 'cancelled', 'output-limit', 'input-limit', 'cleanup-failed',
    ]),
    diagnostic: z.string(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    exitCode: z.number().int().nullable().optional(),
    cleanupDiagnostic: z.string().optional(),
    box: isolatedCheckBoxEvidenceSchema.optional(),
  }).strict(),
]) satisfies z.ZodType<IsolatedCheckResult>
