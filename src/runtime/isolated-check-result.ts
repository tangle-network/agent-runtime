import {
  agentCandidateArtifactRefSchema,
  agentCandidateWorkspaceManifestMaterialSchema,
  canonicalCandidateDigest,
  sha256DigestSchema,
} from '@tangle-network/agent-interface'
import { type ZodType, z } from 'zod'
import type { IsolatedCheckBoxEvidence, IsolatedCheckResult } from './isolated-checker'
import {
  type IsolatedCheckOutputEvidence,
  validateIsolatedCheckOutputs,
} from './isolated-checker-outputs'

const isolatedCheckOutputEvidenceSchema: ZodType<IsolatedCheckOutputEvidence> = z
  .object({
    executionId: z
      .string()
      .max(200)
      .refine((value) => value.trim() !== '' && !/\p{Cc}/u.test(value)),
    inputDigest: sha256DigestSchema,
    status: z.enum(['retained', 'incomplete']),
    files: z
      .array(z.object({ path: z.string(), artifact: agentCandidateArtifactRefSchema }).strict())
      .max(16),
    missing: z
      .array(
        z
          .object({
            path: z.string(),
            reason: z.enum([
              'missing',
              'unsafe-path',
              'size-limit',
              'capture-failed',
              'store-failed',
              'timeout',
            ]),
          })
          .strict(),
      )
      .max(16),
    source: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('local'), path: z.string().min(1) }).strict(),
        z
          .object({
            kind: z.literal('sandbox'),
            sandboxId: z.string().min(1),
            state: z.literal('stopped'),
          })
          .strict(),
      ])
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    try {
      validateIsolatedCheckOutputs({
        paths: [...value.files, ...value.missing].map((file) => file.path),
        maxFileBytes: 64 * 1024 * 1024,
        maxTotalBytes: 64 * 1024 * 1024,
      })
    } catch {
      context.addIssue({ code: 'custom', message: 'Check output evidence has invalid paths' })
    }
    if (
      (value.status === 'retained') !== (value.missing.length === 0) ||
      (value.status === 'retained' && value.source !== undefined) ||
      value.files.reduce((bytes, file) => bytes + file.artifact.byteLength, 0) > 64 * 1024 * 1024
    )
      context.addIssue({ code: 'custom', message: 'Check output evidence is inconsistent' })
  })

/** Decode the existing execution contract without widening or reinterpreting its evidence. */
export const isolatedCheckBoxEvidenceSchema: ZodType<IsolatedCheckBoxEvidence> = z
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
      context.addIssue({
        code: 'custom',
        message: 'Check input digest does not match its manifest',
      })
  })

/** Execution evidence, not a verdict about task correctness or permission to execute again. */
export const isolatedCheckResultSchema: ZodType<IsolatedCheckResult> = z.discriminatedUnion(
  'succeeded',
  [
    z
      .object({
        succeeded: z.literal(true),
        value: z.object({ stdout: z.string(), stderr: z.string() }).strict(),
        box: isolatedCheckBoxEvidenceSchema.optional(),
        outputs: isolatedCheckOutputEvidenceSchema.optional(),
      })
      .strict(),
    z
      .object({
        succeeded: z.literal(false),
        reason: z.enum([
          'refused',
          'failed',
          'timeout',
          'cancelled',
          'output-limit',
          'input-limit',
          'cleanup-failed',
        ]),
        diagnostic: z.string(),
        stdout: z.string().optional(),
        stderr: z.string().optional(),
        exitCode: z.number().int().nullable().optional(),
        cleanupDiagnostic: z.string().optional(),
        box: isolatedCheckBoxEvidenceSchema.optional(),
        outputs: isolatedCheckOutputEvidenceSchema.optional(),
      })
      .strict(),
  ],
)
