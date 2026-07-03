/**
 * Substrate-default `KnowledgeAdapter` — wraps agent-knowledge's
 * `proposeFromFindings` + `applyKnowledgeWriteBlocks` with substrate
 * defaults (auto-lint after apply, source linkage via finding id).
 *
 * Every agent that ships a `.agent-knowledge/` tree uses this adapter
 * unmodified. Per-agent customization happens at the manifest level
 * (`autoApply.knowledge.confidenceThreshold`, etc.), not by writing a
 * new adapter.
 *
 * Lint discipline: after each apply we run agent-knowledge's
 * `lintKnowledgeIndex` to catch broken links / circular claims /
 * duplicate pages introduced by the new writes. Findings that fail the
 * post-apply lint are recorded in `warnings`; the apply itself is not
 * rolled back (lint failures are soft — humans review the wiki state).
 */

import type { AnalystFinding } from '@tangle-network/agent-eval'
import type { KnowledgeAdapter } from '../analyst-loop/types'

export interface CreateSurfaceKnowledgeAdapterOpts {
  /** `.agent-knowledge/` root (absolute path the substrate writes blocks against). */
  knowledgeRoot: string
}

/**
 * Build the adapter. We accept the agent-knowledge functions as DI so
 * the substrate stays decoupled from a specific agent-knowledge
 * version — the agent author imports them in their manifest module
 * and hands them to the factory.
 *
 * `proposeFromFindings(findings)` returns
 *   `{ proposals: KnowledgeProposal[]; skipped: number; errors: ... }`.
 *
 * `applyKnowledgeWriteBlocks(root, content)` returns
 *   `{ written: string[]; warnings: string[] }`.
 *
 * `lintKnowledgeIndex(index)` (optional) returns `KnowledgeLintFinding[]`.
 */
export interface KnowledgeAdapterDeps<TProposal> {
  proposeFromFindings: (findings: ReadonlyArray<AnalystFinding>) => {
    proposals: TProposal[]
    skipped: number
    errors: Array<{ findingId: string; subject: string; message: string }>
  }
  applyKnowledgeWriteBlocks: (
    root: string,
    proposalText: string,
  ) => Promise<{ written: string[]; warnings: string[] }>
  /**
   * Optional post-apply lint hook. The substrate runs it after each
   * batch of writes; failures land in `warnings` (the apply is not
   * rolled back — lint signals drift to review, not block).
   */
  lintAfterApply?: (root: string) => Promise<ReadonlyArray<string>>
}

/** Wire a surface-based `KnowledgeAdapter` that writes analyst proposals to agent surface files. */
export function createSurfaceKnowledgeAdapter<TProposal>(
  opts: CreateSurfaceKnowledgeAdapterOpts,
  deps: KnowledgeAdapterDeps<TProposal>,
): KnowledgeAdapter<TProposal> {
  return {
    proposeFromFindings(findings) {
      const batch = deps.proposeFromFindings(findings)
      return {
        proposals: batch.proposals,
        skipped: batch.skipped,
        errors: batch.errors,
      }
    },
    async apply(proposals) {
      const written: string[] = []
      const warnings: string[] = []
      for (const p of proposals) {
        const proposalText = renderProposalAsWriteBlock(p)
        if (proposalText === null) {
          warnings.push(
            `proposal has no writeBlocks/content; skipping (sourceFindingId=${getSourceFindingId(p)})`,
          )
          continue
        }
        try {
          const r = await deps.applyKnowledgeWriteBlocks(opts.knowledgeRoot, proposalText)
          written.push(...r.written)
          warnings.push(...r.warnings)
        } catch (err) {
          warnings.push(
            `applyKnowledgeWriteBlocks failed: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
      if (deps.lintAfterApply && written.length > 0) {
        try {
          const lintIssues = await deps.lintAfterApply(opts.knowledgeRoot)
          for (const issue of lintIssues) warnings.push(`lint: ${issue}`)
        } catch (err) {
          warnings.push(
            `lintAfterApply failed: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
      return { written, warnings }
    },
  }
}

/**
 * Pluck the canonical write-block text from a proposal regardless of
 * which exact agent-knowledge version produced it. We accept either:
 *   - `{ writeBlocks: Array<{ path, content }> }` — the typed shape
 *     1.3.0+ emits
 *   - `{ proposalText: string }` — legacy single-block shape
 *   - `{ content: string }` — minimal raw form
 *
 * Returns `null` when nothing parseable is present (warned upstream).
 */
function renderProposalAsWriteBlock(p: unknown): string | null {
  if (!p || typeof p !== 'object') return null
  const obj = p as Record<string, unknown>
  if (Array.isArray(obj.writeBlocks)) {
    const blocks = obj.writeBlocks as Array<{ path?: string; content?: string }>
    if (blocks.length === 0) return null
    return blocks
      .map((b) => (typeof b.content === 'string' ? b.content : ''))
      .filter((s) => s.length > 0)
      .join('\n\n')
  }
  if (typeof obj.proposalText === 'string') return obj.proposalText
  if (typeof obj.content === 'string') return obj.content
  return null
}

function getSourceFindingId(p: unknown): string {
  if (!p || typeof p !== 'object') return '<unknown>'
  const obj = p as Record<string, unknown>
  if (typeof obj.sourceFindingId === 'string') return obj.sourceFindingId
  if (typeof obj.id === 'string') return obj.id
  return '<unknown>'
}
