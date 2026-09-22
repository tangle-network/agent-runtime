import { existsSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { FindingSubject } from '@tangle-network/agent-eval'

/**
 * Repository paths an improvement job may edit.
 *
 * Paths are resolved against `repoRoot` unless absolute. Every field is
 * optional. Applications declare only paths they own, and findings aimed at
 * undeclared paths are rejected.
 */
export interface AgentImprovementPaths {
  /** Directory containing one markdown file per system-prompt section. */
  systemPrompt?: string
  /** Directory containing one subdirectory per tool. */
  tools?: string
  /** Knowledge-base root, typically `.agent-knowledge`. */
  knowledge?: string
  /** Directory containing precondition, retry, and control policies. */
  scaffolding?: string
  /** Directory containing mutable memory records. */
  memory?: string
  /** Directory containing retrieval corpora. */
  rag?: string
  /** Single file defining the output schema. */
  outputSchema?: string
  /** Directory containing Agent Skill packages. */
  skills?: string
  /** Directory containing MCP server and tool configuration. */
  mcp?: string
  /** Directory containing hook definitions. */
  hooks?: string
  /** Directory containing subagent definitions. */
  subagents?: string
  /** Directory containing orchestration policies. */
  workflows?: string
  /** Single file containing rollout-policy settings. */
  rolloutPolicy?: string
  /** Single canonical AgentProfile file. */
  agentProfile?: string
  /** Source root for code findings. */
  code?: string
}

export interface ResolvedImprovementPath {
  /** Absolute filesystem path. */
  absolutePath: string
  /** Path produced from the declared root and finding subject. */
  declaredPath: string
  /** Whether the path currently exists. */
  exists: boolean
  /** Whether the caller should edit an existing file or create a new one. */
  intent: 'edit-existing' | 'create-new'
}

/** Resolve a parsed finding subject to one declared repository path. */
export function resolveSubjectPath(
  subject: FindingSubject,
  paths: AgentImprovementPaths,
  repoRoot: string,
): ResolvedImprovementPath | null {
  const candidates = candidatePathsForSubject(subject, paths)
  if (candidates.length === 0) return null

  for (const declaredPath of candidates) {
    const absolutePath = isAbsolute(declaredPath) ? declaredPath : join(repoRoot, declaredPath)
    if (existsSync(absolutePath)) {
      return {
        absolutePath,
        declaredPath,
        exists: true,
        intent: 'edit-existing',
      }
    }
  }

  const declaredPath = candidates[0]!
  return {
    absolutePath: isAbsolute(declaredPath) ? declaredPath : join(repoRoot, declaredPath),
    declaredPath,
    exists: false,
    intent: 'create-new',
  }
}

function candidatePathsForSubject(
  subject: FindingSubject,
  paths: AgentImprovementPaths,
): ReadonlyArray<string> {
  switch (subject.kind) {
    case 'knowledge.wiki':
    case 'knowledge.stale':
      return paths.knowledge ? optionalPath(safeJoin(paths.knowledge, `${subject.slug}.md`)) : []
    case 'knowledge.claim':
      return paths.knowledge
        ? optionalPath(safeJoin(paths.knowledge, 'claims', `${slugify(subject.topic)}.md`))
        : []
    case 'knowledge.raw':
      return paths.knowledge
        ? optionalPath(safeJoin(paths.knowledge, 'raw', `${subject.sourceId}.md`))
        : []
    case 'system-prompt': {
      if (!paths.systemPrompt) return []
      const slug = slugify(subject.section)
      return compactPaths([
        safeJoin(paths.systemPrompt, `${slug}.md`),
        safeJoin(paths.systemPrompt, slug, 'SKILL.md'),
        safeJoin(paths.systemPrompt, slug, 'index.md'),
      ])
    }
    case 'skill':
      return paths.skills
        ? compactPaths([
            safeJoin(paths.skills, subject.name, 'SKILL.md'),
            safeJoin(paths.skills, `${subject.name}.md`),
          ])
        : []
    case 'tool-doc':
      if (!paths.tools) return []
      return subject.aspect
        ? optionalPath(safeJoin(paths.tools, subject.tool, `${slugify(subject.aspect)}.md`))
        : compactPaths([
            safeJoin(paths.tools, subject.tool, 'README.md'),
            safeJoin(paths.tools, `${subject.tool}.md`),
          ])
    case 'new-tool':
      return paths.tools ? optionalPath(safeJoin(paths.tools, subject.name, 'README.md')) : []
    case 'mcp':
      if (!paths.mcp) return []
      return subject.tool
        ? optionalPath(safeJoin(paths.mcp, subject.server, `${subject.tool}.md`))
        : compactPaths([
            safeJoin(paths.mcp, `${subject.server}.json`),
            safeJoin(paths.mcp, subject.server, 'README.md'),
          ])
    case 'hook':
      return paths.hooks
        ? compactPaths([
            safeJoin(paths.hooks, `${subject.name}.md`),
            safeJoin(paths.hooks, `${subject.name}.json`),
          ])
        : []
    case 'subagent':
      return paths.subagents
        ? compactPaths([
            safeJoin(paths.subagents, `${subject.name}.md`),
            safeJoin(paths.subagents, `${subject.name}.yaml`),
            safeJoin(paths.subagents, `${subject.name}.json`),
          ])
        : []
    case 'workflow':
      return paths.workflows
        ? compactPaths([
            safeJoin(paths.workflows, `${subject.name}.md`),
            safeJoin(paths.workflows, `${subject.name}.yaml`),
            safeJoin(paths.workflows, `${subject.name}.json`),
          ])
        : []
    case 'rollout-policy':
      return paths.rolloutPolicy ? [paths.rolloutPolicy] : []
    case 'agent-profile':
      return paths.agentProfile ? [paths.agentProfile] : []
    case 'code': {
      if (!paths.code) return []
      return optionalPath(safeJoin(paths.code, subject.path))
    }
    case 'rag':
      return paths.rag
        ? optionalPath(safeJoin(paths.rag, subject.corpus, `${subject.docId}.md`))
        : []
    case 'memory':
      return paths.memory
        ? optionalPath(safeJoin(paths.memory, `${slugify(subject.key)}.json`))
        : []
    case 'scaffolding':
      return paths.scaffolding
        ? optionalPath(safeJoin(paths.scaffolding, `${slugify(subject.concern)}.md`))
        : []
    case 'output-schema':
      return paths.outputSchema ? [paths.outputSchema] : []
    case 'websearch.outdated':
    case 'prior-run-summary':
    case 'cluster':
      return []
  }
}

function safeJoin(root: string, ...children: string[]): string | null {
  if (children.some((child) => child.includes('\0') || isAbsolute(child))) return null
  const rootAbsolute = resolve(root)
  const targetAbsolute = resolve(rootAbsolute, ...children)
  const escaped = relative(rootAbsolute, targetAbsolute)
  if (escaped === '..' || escaped.startsWith(`..${sep}`) || isAbsolute(escaped)) return null
  return join(root, ...children)
}

function optionalPath(path: string | null): string[] {
  return path ? [path] : []
}

function compactPaths(paths: ReadonlyArray<string | null>): string[] {
  return paths.filter((path): path is string => path !== null)
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 200) || 'untitled'
  )
}

export interface ImprovementPathIssue {
  pathKind: keyof AgentImprovementPaths
  path: string
  reason: 'missing' | 'not-directory' | 'not-file'
}

const DIRECTORY_PATHS: ReadonlyArray<keyof AgentImprovementPaths> = [
  'systemPrompt',
  'tools',
  'knowledge',
  'scaffolding',
  'memory',
  'rag',
  'skills',
  'mcp',
  'hooks',
  'subagents',
  'workflows',
  'code',
]

const FILE_PATHS: ReadonlyArray<keyof AgentImprovementPaths> = [
  'outputSchema',
  'rolloutPolicy',
  'agentProfile',
]

/** Validate every path the application explicitly declared. */
export function validateImprovementPaths(
  paths: AgentImprovementPaths,
  repoRoot: string,
): ReadonlyArray<ImprovementPathIssue> {
  const issues: ImprovementPathIssue[] = []

  for (const pathKind of [...DIRECTORY_PATHS, ...FILE_PATHS]) {
    const path = paths[pathKind]
    if (path === undefined) continue
    const absolutePath = isAbsolute(path) ? path : join(repoRoot, path)
    if (!existsSync(absolutePath)) {
      issues.push({ pathKind, path, reason: 'missing' })
      continue
    }
    const expectsDirectory = DIRECTORY_PATHS.includes(pathKind)
    if (expectsDirectory && !statSync(absolutePath).isDirectory()) {
      issues.push({ pathKind, path, reason: 'not-directory' })
    } else if (!expectsDirectory && !statSync(absolutePath).isFile()) {
      issues.push({ pathKind, path, reason: 'not-file' })
    }
  }

  return issues
}

/** Format improvement-path errors for logs and command output. */
export function renderImprovementPathIssues(
  issues: ReadonlyArray<ImprovementPathIssue>,
  repoRoot: string,
): string {
  if (issues.length === 0) return ''
  const lines = issues.map((issue) => `  - ${issue.pathKind}: "${issue.path}" (${issue.reason})`)
  return [
    `Agent improvement path validation failed against repoRoot=${repoRoot}:`,
    ...lines,
    '',
    'Every declared path must exist and have the expected file or directory type.',
  ].join('\n')
}
