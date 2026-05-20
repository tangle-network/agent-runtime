/**
 * `AgentSurfaces` — declarative map of the mutable file/directory paths
 * the self-improvement loop can edit on behalf of an agent.
 *
 * The substrate uses this map to resolve every parsed `FindingSubject`
 * (from agent-eval) to a real on-disk path. No per-vertical glue;
 * no fabricated paths; no silent `existsSync(...)` skips that hide
 * misconfiguration from the operator.
 *
 * Surfaces are validated at `defineAgent` time — missing paths fail
 * loud with a list of every offender. A surface that's not needed
 * (e.g. an agent with no RAG corpora) is simply omitted; the loop
 * refuses to route those subjects rather than fabricating a target.
 */

import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { FindingSubject } from '@tangle-network/agent-eval'

/**
 * Surface declarations. Every path is repo-relative (or absolute) at
 * `defineAgent` time. At resolution time, paths are joined against the
 * agent's `repoRoot`.
 *
 * `systemPrompt`, `tools`, `personas` are DIRECTORIES; the loop appends
 * `<section>.md`, `<tool>/README.md`, `<persona-id>.yaml` etc.
 * `rubric`, `outputSchema` are SINGLE FILES; the loop edits them in
 * place.
 *
 * `knowledge` is the agent-knowledge root (typically `.agent-knowledge`);
 * `applyKnowledgeWriteBlocks` writes pages relative to it.
 *
 * Optional surfaces (`scaffolding`, `memory`, `rag`, `outputSchema`)
 * can be omitted — the loop will reject findings targeting them with a
 * clear log message instead of fabricating a path.
 */
export interface AgentSurfaces {
  /** Directory containing one markdown file per system-prompt section. */
  systemPrompt: string
  /** Directory containing one subdir per tool (`<tool>/README.md`). */
  tools: string
  /** Single file (TypeScript module) defining the rubric weights + dimensions. */
  rubric: string
  /** Knowledge-base root; typically `.agent-knowledge`. */
  knowledge: string
  /** Directory containing one YAML/JSON file per persona. */
  personas: string
  /** Optional: directory containing scaffolding rules (precondition checks, retry policies). */
  scaffolding?: string
  /** Optional: memory store path (JSONL / SQLite / DB). */
  memory?: string
  /** Optional: directory containing RAG corpora (`<corpus>/<doc-id>.md`). */
  rag?: string
  /** Optional: single file defining the output schema (Zod / JSON Schema). */
  outputSchema?: string
}

export interface ResolvedSurface {
  /** Absolute filesystem path the operator can `cat` / `vim`. */
  absolutePath: string
  /** Repo-relative path for PR descriptions, diffs, audit logs. */
  repoRelativePath: string
  /** Whether the path currently exists on disk. */
  exists: boolean
  /** The substrate's intent: edit an existing file or create a new one. */
  intent: 'edit-existing' | 'create-new'
}

/**
 * Resolve a parsed `FindingSubject` to the file path the substrate
 * should edit (or create) on disk.
 *
 * Returns `null` when:
 *   - the subject targets a surface the agent didn't declare
 *     (e.g. `rag:*` when `surfaces.rag` is undefined), OR
 *   - the subject is a `cluster` (failure-mode emits these as evidence,
 *     not actionable mutations — they don't route to a file).
 *
 * Returns a `ResolvedSurface` with `intent: 'create-new'` when the
 * subject names a path that doesn't yet exist (e.g. a new wiki page).
 * The caller chooses whether to honour the create — for tightly-managed
 * surfaces like `systemPrompt` it's usually a contract violation
 * (the analyst named a section that doesn't exist); for `knowledge`
 * it's the whole point.
 */
export function resolveSubjectPath(
  subject: FindingSubject,
  surfaces: AgentSurfaces,
  repoRoot: string,
): ResolvedSurface | null {
  const rel = relativePathForSubject(subject, surfaces)
  if (rel === null) return null
  const abs = isAbsolute(rel) ? rel : join(repoRoot, rel)
  const exists = existsSync(abs)
  return {
    absolutePath: abs,
    repoRelativePath: rel,
    exists,
    intent: exists ? 'edit-existing' : 'create-new',
  }
}

function relativePathForSubject(subject: FindingSubject, surfaces: AgentSurfaces): string | null {
  switch (subject.kind) {
    case 'knowledge.wiki':
    case 'knowledge.stale':
      return join(surfaces.knowledge, `${subject.slug}.md`)
    case 'knowledge.claim':
      // Claims land in a per-topic claims directory under the knowledge root.
      return join(surfaces.knowledge, 'claims', `${slugify(subject.topic)}.md`)
    case 'knowledge.raw':
      return join(surfaces.knowledge, 'raw', `${subject.sourceId}.md`)
    case 'system-prompt':
      return join(surfaces.systemPrompt, `${slugify(subject.section)}.md`)
    case 'tool-doc':
      return subject.aspect
        ? join(surfaces.tools, subject.tool, `${slugify(subject.aspect)}.md`)
        : join(surfaces.tools, subject.tool, 'README.md')
    case 'new-tool':
      return join(surfaces.tools, subject.name, 'README.md')
    case 'rag':
      if (!surfaces.rag) return null
      return join(surfaces.rag, subject.corpus, `${subject.docId}.md`)
    case 'memory':
      if (!surfaces.memory) return null
      return join(surfaces.memory, `${slugify(subject.key)}.json`)
    case 'scaffolding':
      if (!surfaces.scaffolding) return null
      return join(surfaces.scaffolding, `${slugify(subject.concern)}.md`)
    case 'output-schema':
      if (!surfaces.outputSchema) return null
      // outputSchema is a single file — the field name is metadata for
      // the LLM-drafted patch, not a separate path.
      return surfaces.outputSchema
    case 'websearch.outdated':
    case 'prior-run-summary':
      // Stale signals don't map to a single file — they're handled by
      // the knowledge adapter as `agent-knowledge:stale:*` after the
      // operator decides which wiki page to retract. The substrate
      // doesn't auto-route them.
      return null
    case 'cluster':
      // failure-mode cluster labels are evidence, not mutations.
      return null
  }
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 200) || 'untitled'
  )
}

/**
 * Validate that every declared surface exists on disk under `repoRoot`.
 *
 * Returns an array of `SurfaceValidationIssue` — empty when all required
 * surfaces resolve. `defineAgent` throws with the issues rendered, so
 * a misconfigured manifest fails at startup (not at the first finding
 * the loop produces 20 minutes later).
 */
export interface SurfaceValidationIssue {
  surface: keyof AgentSurfaces
  path: string
  reason: 'missing' | 'not-directory' | 'not-file'
}

export function validateSurfaces(
  surfaces: AgentSurfaces,
  repoRoot: string,
): ReadonlyArray<SurfaceValidationIssue> {
  const issues: SurfaceValidationIssue[] = []
  const dirSurfaces: ReadonlyArray<keyof AgentSurfaces> = [
    'systemPrompt',
    'tools',
    'personas',
    'knowledge',
  ]
  const fileSurfaces: ReadonlyArray<keyof AgentSurfaces> = ['rubric']
  const optionalDirSurfaces: ReadonlyArray<keyof AgentSurfaces> = ['scaffolding', 'memory', 'rag']
  const optionalFileSurfaces: ReadonlyArray<keyof AgentSurfaces> = ['outputSchema']

  for (const key of dirSurfaces) {
    const p = surfaces[key] as string | undefined
    if (!p) {
      issues.push({ surface: key, path: '', reason: 'missing' })
      continue
    }
    const abs = isAbsolute(p) ? p : join(repoRoot, p)
    if (!existsSync(abs)) {
      issues.push({ surface: key, path: p, reason: 'missing' })
    }
  }
  for (const key of fileSurfaces) {
    const p = surfaces[key] as string | undefined
    if (!p) {
      issues.push({ surface: key, path: '', reason: 'missing' })
      continue
    }
    const abs = isAbsolute(p) ? p : join(repoRoot, p)
    if (!existsSync(abs)) {
      issues.push({ surface: key, path: p, reason: 'missing' })
    }
  }
  for (const key of [...optionalDirSurfaces, ...optionalFileSurfaces]) {
    const p = surfaces[key] as string | undefined
    if (p === undefined) continue
    const abs = isAbsolute(p) ? p : join(repoRoot, p)
    if (!existsSync(abs)) {
      issues.push({ surface: key, path: p, reason: 'missing' })
    }
  }
  return issues
}

export function renderSurfaceIssues(
  issues: ReadonlyArray<SurfaceValidationIssue>,
  repoRoot: string,
): string {
  if (issues.length === 0) return ''
  const lines = issues.map(
    (i) => `  - ${i.surface}: ${i.path ? `"${i.path}"` : '<not set>'} (${i.reason})`,
  )
  return [
    `Agent surface validation failed against repoRoot=${repoRoot}:`,
    ...lines,
    '',
    'Fix the manifest: every required surface must point at an existing',
    'directory (systemPrompt / tools / personas / knowledge) or file',
    '(rubric). Optional surfaces (scaffolding / memory / rag / outputSchema)',
    'may be omitted; the loop will reject findings targeting omitted',
    'surfaces rather than fabricating a path.',
  ].join('\n')
}
