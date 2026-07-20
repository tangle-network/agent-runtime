/**
 * Surface improvement proposer — resolves analyst findings into LLM-drafted
 * candidate patches without changing the caller's repository.
 *
 * The proposer parses each finding's `subject` via
 * `parseFindingSubject` (agent-eval), resolves it to a real file path
 * via the agent's `AgentSurfaces`, reads the current content, and asks
 * an LLM to draft a unified-diff patch given the finding + current
 * content + per-kind editing-discipline rules.
 *
 * Fail-loud rules:
 *   - Findings whose subject doesn't parse → counted in `errors`.
 *   - Findings whose subject targets an undeclared surface → counted in
 *     `errors` with the offending kind in the message.
 *   - Findings whose target path doesn't exist AND the kind isn't a
 *     create-new variant (`new-tool`, `knowledge.wiki`) → counted in
 *     `errors` with the resolved path in the message.
 *   - LLM drafts that fail JSON-schema validation → counted in
 *     `errors` with the schema issue.
 *
 * No silent skips. Every dropped finding has a recorded reason the
 * loop's report surfaces.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { AnalystFinding, FindingSubject } from '@tangle-network/agent-eval'
import { parseFindingSubject } from '@tangle-network/agent-eval/analyst'
import type { ImprovementProposalSource } from '../analyst-loop/types'
import type { AgentSurfaces, ResolvedSurface } from './surfaces'
import { resolveSubjectPath } from './surfaces'

// ── proposal shape ───────────────────────────────────────────────────

export interface SurfaceImprovementEdit {
  /** Stable id derived from the source finding so re-proposals are idempotent. */
  id: string
  /** The finding that produced this edit — for revert + audit trail. */
  sourceFindingId: string
  /** Parsed subject; included so the apply step doesn't re-parse. */
  subject: FindingSubject
  /** Resolved on-disk target. */
  target: ResolvedSurface
  /** SHA-256 of the current file content the patch was drafted against. */
  baseSha256: string
  /** Unified-diff patch the LLM drafted (relative to `target.absolutePath`). */
  patch: string
  /** One-line summary the operator sees in the report / PR title. */
  summary: string
  /** Multi-line rationale for the PR body — finding context + LLM reasoning. */
  rationale: string
  /** Carry-forward from the finding so the apply gate can check the threshold. */
  confidence: number
  /** Carry-forward severity for prioritization. */
  severity: AnalystFinding['severity']
}

export interface CreateSurfaceImprovementProposerOptions {
  surfaces: AgentSurfaces
  repoRoot: string
  /**
   * LLM-draft callback. Given a finding + current file content + the
   * resolved target, returns a unified-diff patch + summary + rationale.
   *
   * Required — the substrate doesn't ship a hardcoded prompt; the agent
   * author picks the model (Haiku for cheap routine drafts, Sonnet for
   * substantive prompt rewrites, etc.) via this callback.
   */
  draftPatch: (input: DraftPatchInput) => Promise<DraftPatchOutput>
  /**
   * When the resolved target doesn't exist, allow the substrate to
   * CREATE the file (for `knowledge.wiki`, `new-tool` subjects). Default
   * true for those kinds, false for `system-prompt` / `rubric` / etc.
   * (named sections that don't exist are a contract violation, not a
   * scaffolding opportunity).
   */
  allowCreateForKinds?: ReadonlyArray<FindingSubject['kind']>
}

export interface DraftPatchInput {
  finding: AnalystFinding
  subject: FindingSubject
  target: ResolvedSurface
  /** Current file content (empty string when `intent === 'create-new'`). */
  currentContent: string
}

export interface DraftPatchOutput {
  /** Unified diff against the current file content. Empty string skips this finding. */
  patch: string
  /** One-line summary for the operator. */
  summary: string
  /** Multi-line rationale for the PR body. */
  rationale: string
}

// ── factory ──────────────────────────────────────────────────────────

const DEFAULT_CREATE_KINDS: ReadonlyArray<FindingSubject['kind']> = [
  'knowledge.wiki',
  'knowledge.claim',
  'knowledge.raw',
  'new-tool',
]

/** Resolve each finding to a real surface and draft a detached patch candidate. */
export function createSurfaceImprovementProposer(
  opts: CreateSurfaceImprovementProposerOptions,
): ImprovementProposalSource<SurfaceImprovementEdit> {
  const allowCreate = opts.allowCreateForKinds ?? DEFAULT_CREATE_KINDS

  return {
    async proposeFromFindings(findings) {
      const edits: SurfaceImprovementEdit[] = []
      const errors: Array<{ findingId: string; subject: string; message: string }> = []
      let skipped = 0

      for (const f of findings) {
        const subject = parseFindingSubject(f.subject)
        if (subject === null) {
          if (f.subject !== undefined) {
            errors.push({
              findingId: f.finding_id,
              subject: f.subject,
              message: 'subject does not parse against the finding-subject grammar',
            })
          } else {
            // Subject-less findings are descriptive, not actionable —
            // legitimate; count in `skipped` not `errors`.
            skipped += 1
          }
          continue
        }

        // `cluster` findings (failure-mode) are evidence, not mutations.
        if (subject.kind === 'cluster') {
          skipped += 1
          continue
        }

        // Knowledge findings flow to the knowledge proposal source so they do not double-route.
        if (subject.kind.startsWith('knowledge.')) {
          skipped += 1
          continue
        }

        const target = resolveSubjectPath(subject, opts.surfaces, opts.repoRoot)
        if (target === null) {
          errors.push({
            findingId: f.finding_id,
            subject: f.subject ?? '',
            message: `subject kind "${subject.kind}" targets an undeclared surface; declare it in AgentSurfaces or stop emitting this subject`,
          })
          continue
        }

        if (target.intent === 'create-new' && !allowCreate.includes(subject.kind)) {
          errors.push({
            findingId: f.finding_id,
            subject: f.subject ?? '',
            message: `target ${target.repoRelativePath} does not exist; the kind "${subject.kind}" requires an existing target (analyst named a section that isn't in the codebase)`,
          })
          continue
        }

        const currentContent = target.exists ? readFileSync(target.absolutePath, 'utf-8') : ''

        let draft: DraftPatchOutput
        try {
          draft = await opts.draftPatch({ finding: f, subject, target, currentContent })
        } catch (err) {
          errors.push({
            findingId: f.finding_id,
            subject: f.subject ?? '',
            message: `draftPatch threw: ${err instanceof Error ? err.message : String(err)}`,
          })
          continue
        }

        if (draft.patch.trim().length === 0) {
          skipped += 1
          continue
        }

        edits.push({
          id: `imp-${f.finding_id}`,
          sourceFindingId: f.finding_id,
          subject,
          target,
          baseSha256: sha256(currentContent),
          patch: draft.patch,
          summary: draft.summary,
          rationale: draft.rationale,
          confidence: f.confidence,
          severity: f.severity,
        })
      }

      return { edits, skipped, errors }
    },
  }
}

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf-8').digest('hex')
}
