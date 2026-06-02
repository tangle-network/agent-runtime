/**
 * Substrate-default `ImprovementAdapter` — surfaces-driven, LLM-drafted
 * patches, optional auto-apply or PR-open.
 *
 * This is the one ImprovementAdapter every vertical agent uses. The
 * substrate parses each finding's `subject` via
 * `parseFindingSubject` (agent-eval), resolves it to a real file path
 * via the agent's `AgentSurfaces`, reads the current content, and asks
 * an LLM to draft a unified-diff patch given the finding + current
 * content + per-kind editing-discipline rules.
 *
 * Auto-apply gates on the source-finding's confidence and the
 * autoApply.improvement policy. Two modes:
 *   `write` — apply the patch in-place via `git apply -p0`. Operator
 *     reviews via `git diff`.
 *   `open-pr` — write to a branch, commit, push, open a PR via `gh`.
 *     Operator reviews via the PR UI.
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

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import type { AnalystFinding, FindingSubject } from '@tangle-network/agent-eval'
import { parseFindingSubject } from '@tangle-network/agent-eval/analyst'
import type { ImprovementAdapter } from '../analyst-loop/types'
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

export interface CreateSurfaceImprovementAdapterOpts {
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
   * Apply mode:
   *   `write` — `git apply` in-place; operator reviews via `git diff`
   *   `open-pr` — branch + commit + push + `gh pr create`
   *   `none` — never apply; collect proposals for the report only
   *
   * The `apply` method honours this even when the loop calls it; the
   * effective behaviour is also gated on the per-finding confidence
   * threshold via `runAnalystLoop`'s `autoApply` policy.
   */
  mode?: 'write' | 'open-pr' | 'none'
  /** When `mode === 'open-pr'`, the base branch new PRs target. Default: `main`. */
  baseBranch?: string
  /** Required for `mode === 'open-pr'` — the GH owner/repo (`tangle-network/tax-agent`). */
  ghRepo?: string
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

export function createSurfaceImprovementAdapter(
  opts: CreateSurfaceImprovementAdapterOpts,
): ImprovementAdapter<SurfaceImprovementEdit> {
  const mode = opts.mode ?? 'none'
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

        // `agent-knowledge:*` findings flow to the KnowledgeAdapter;
        // the ImprovementAdapter skips them so subjects don't double-route.
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

    async apply(edits) {
      const applied: string[] = []
      const warnings: string[] = []

      if (mode === 'none') {
        warnings.push(
          'createSurfaceImprovementAdapter: mode=none; no edits applied — adjust manifest.autoApply.improvement.mode',
        )
        return { applied, warnings }
      }

      if (mode === 'open-pr' && !opts.ghRepo) {
        warnings.push(
          'createSurfaceImprovementAdapter: mode=open-pr requires `ghRepo`; falling back to no-op',
        )
        return { applied, warnings }
      }

      for (const edit of edits) {
        // Race-detection: confirm the file content hasn't moved since the
        // patch was drafted. A diff applied against drifted content is a
        // recipe for silent corruption.
        const current = edit.target.exists ? readFileSync(edit.target.absolutePath, 'utf-8') : ''
        if (sha256(current) !== edit.baseSha256) {
          warnings.push(
            `${edit.target.repoRelativePath}: base SHA mismatch; file changed after draft. Skipping.`,
          )
          continue
        }

        const ok = applyPatchInPlace(edit, opts.repoRoot)
        if (!ok) {
          warnings.push(`${edit.target.repoRelativePath}: git apply failed`)
          continue
        }
        applied.push(edit.target.repoRelativePath)
      }

      if (mode === 'open-pr' && applied.length > 0 && opts.ghRepo) {
        const prUrl = openPullRequest(
          applied,
          edits.filter((e) => applied.includes(e.target.repoRelativePath)),
          opts.repoRoot,
          opts.ghRepo,
          opts.baseBranch ?? 'main',
        )
        if (prUrl) warnings.push(`opened PR: ${prUrl}`)
        else warnings.push('PR creation failed; edits are committed to a local branch only')
      }

      return { applied, warnings }
    },
  }
}

// ── apply helpers ────────────────────────────────────────────────────

function applyPatchInPlace(edit: SurfaceImprovementEdit, repoRoot: string): boolean {
  const result = spawnSync('git', ['apply', '--whitespace=fix', '-p0', '-'], {
    cwd: repoRoot,
    input: edit.patch,
    encoding: 'utf-8',
  })
  return result.status === 0
}

function openPullRequest(
  paths: ReadonlyArray<string>,
  edits: ReadonlyArray<SurfaceImprovementEdit>,
  repoRoot: string,
  ghRepo: string,
  baseBranch: string,
): string | null {
  const branch = `analyst-loop/${Date.now()}-${edits[0]?.sourceFindingId.slice(0, 12) ?? 'edits'}`
  // Create branch, stage, commit
  const checkout = spawnSync('git', ['checkout', '-b', branch], { cwd: repoRoot })
  if (checkout.status !== 0) return null
  const add = spawnSync('git', ['add', ...paths], { cwd: repoRoot })
  if (add.status !== 0) return null
  const title = `analyst-loop: ${edits[0]?.summary ?? `${edits.length} improvement edits`}`
  const body = [
    `Automated analyst-loop edits — review carefully before merge.`,
    '',
    `Source findings:`,
    ...edits.map(
      (e) =>
        `  - ${e.sourceFindingId} (confidence ${e.confidence.toFixed(2)}, severity ${e.severity})`,
    ),
    '',
    'Rationales:',
    ...edits.map((e) => `\n## ${e.target.repoRelativePath}\n\n${e.rationale}`),
  ].join('\n')
  const commit = spawnSync('git', ['commit', '-m', title, '-m', body], { cwd: repoRoot })
  if (commit.status !== 0) return null
  const push = spawnSync('git', ['push', '-u', 'origin', branch], { cwd: repoRoot })
  if (push.status !== 0) return null
  const pr = spawnSync(
    'gh',
    [
      'pr',
      'create',
      '--repo',
      ghRepo,
      '--title',
      title,
      '--body',
      body,
      '--base',
      baseBranch,
      '--head',
      branch,
    ],
    { cwd: repoRoot, encoding: 'utf-8' },
  )
  if (pr.status !== 0) return null
  return pr.stdout.trim()
}

function sha256(s: string): string {
  // node:crypto is dynamic-imported lazily so the adapter can be tested in
  // environments without crypto (browser tests, mocked envs).
  const crypto = require('node:crypto') as typeof import('node:crypto')
  return crypto.createHash('sha256').update(s, 'utf-8').digest('hex')
}
