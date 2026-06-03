/**
 * @experimental
 *
 * UI-audit issue writer — pure I/O. Takes a workspace dir + `UiFinding[]`
 * and emits:
 *   - `<workspace>/issues/NNN--<lens>--<slug>.md` — one self-contained
 *     GitHub-issue-ready Markdown per finding, with embedded screenshot
 *     references.
 *   - `<workspace>/registry.json` — finding index for dedup and audit
 *     resume across iterations.
 *   - `<workspace>/index.md` — human-readable rollup (severity / lens /
 *     route counts plus a sorted finding list).
 *
 * The writer is deterministic, idempotent for `appendFindings()`, and
 * never invokes an LLM. It assigns the next monotonic id to a finding the
 * caller did not pre-id.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { UiFinding, UiLens } from '../profiles/ui-auditor/substrate'

/** @experimental */
export interface AuditRegistry {
  schemaVersion: 1
  findings: UiFinding[]
  /** Route → URL + captures sidecar; preserved across runs. */
  routes: Record<string, { url?: string; captures: AuditRegistryCapture[] }>
}

/** @experimental */
export interface AuditRegistryCapture {
  file: string
  viewport?: string
  fullPage?: boolean
  elementSelector?: string
  capturedAt: string
}

const SEVERITY_ORDER: Record<UiFinding['severity'], number> = {
  critical: 0,
  high: 1,
  med: 2,
  low: 3,
}

/** @experimental */
export async function initAuditWorkspace(workspaceDir: string): Promise<void> {
  await fs.mkdir(path.join(workspaceDir, 'issues'), { recursive: true })
  await fs.mkdir(path.join(workspaceDir, 'screenshots'), { recursive: true })
  const regPath = path.join(workspaceDir, 'registry.json')
  try {
    await fs.access(regPath)
  } catch {
    const fresh: AuditRegistry = { schemaVersion: 1, findings: [], routes: {} }
    await fs.writeFile(regPath, JSON.stringify(fresh, null, 2))
  }
}

/** @experimental */
export async function readAuditRegistry(workspaceDir: string): Promise<AuditRegistry> {
  const regPath = path.join(workspaceDir, 'registry.json')
  const text = await fs.readFile(regPath, 'utf8')
  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`audit-writer: registry.json at ${regPath} is not a JSON object`)
  }
  const reg = parsed as Partial<AuditRegistry>
  if (reg.schemaVersion !== 1 || !Array.isArray(reg.findings) || typeof reg.routes !== 'object') {
    throw new Error(`audit-writer: registry.json at ${regPath} has an unrecognized shape`)
  }
  return reg as AuditRegistry
}

async function writeAuditRegistry(workspaceDir: string, reg: AuditRegistry): Promise<void> {
  const regPath = path.join(workspaceDir, 'registry.json')
  await fs.writeFile(regPath, JSON.stringify(reg, null, 2))
}

function nextFindingId(reg: AuditRegistry): number {
  let max = 0
  for (const f of reg.findings) {
    if (typeof f.id === 'number' && f.id > max) max = f.id
  }
  return max + 1
}

function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  if (slug.length === 0) {
    throw new Error(`audit-writer: title slugified to empty string (got ${JSON.stringify(title)})`)
  }
  return slug
}

function renderFinding(finding: UiFinding): string {
  if (!finding.id) {
    throw new Error('audit-writer: cannot render a finding without an assigned id')
  }
  if (finding.screenshots.length === 0) {
    throw new Error(`audit-writer: finding #${finding.id} has no screenshots`)
  }
  const id = finding.id
  const numStr = String(id).padStart(3, '0')

  const metaLines: string[] = [
    `> **Issue #${numStr}** · **Severity:** ${finding.severity} · **Lens:** ${finding.lens}`,
    `> **Route:** \`${finding.route}\`${finding.url ? ` · **URL:** ${finding.url}` : ''}`,
  ]
  if (finding.viewport) metaLines.push(`> **Viewport:** ${finding.viewport}`)
  if (finding.selector) metaLines.push(`> **Selector:** \`${finding.selector}\``)
  if (finding.tags && finding.tags.length > 0) {
    metaLines.push(`> **Tags:** ${finding.tags.map((t) => `\`${t}\``).join(', ')}`)
  }
  if (finding.similarTo && finding.similarTo.length > 0) {
    metaLines.push(
      `> **Possible duplicates:** ${finding.similarTo.map((n) => `#${String(n).padStart(3, '0')}`).join(', ')}`,
    )
  }
  metaLines.push(`> _Generated: ${finding.createdAt ?? new Date().toISOString()}_`)

  const reproSteps =
    finding.reproSteps ??
    `1. Open \`${finding.route}\`${finding.url ? ` (${finding.url})` : ''}\n2. Observe the area shown in the screenshot${finding.selector ? ` (selector: \`${finding.selector}\`)` : ''}.`

  // Screenshot paths are workspace-relative; the issue file sits in
  // `<workspace>/issues/`, so we render `../<path>`.
  const evidence = finding.screenshots
    .map((s) => `![${path.basename(s.path)}](../${s.path})`)
    .join('\n\n')

  return [
    `# [UI] ${finding.title}`,
    '',
    metaLines.join('\n'),
    '',
    '## Observation',
    finding.observation.trim(),
    '',
    '## Why it matters',
    finding.impact.trim(),
    '',
    '## Steps to reproduce',
    reproSteps,
    '',
    '## Suggested fix',
    finding.suggestedFix.trim(),
    '',
    '## Evidence',
    evidence,
    '',
    '---',
    `<sub>Generated by agent-runtime/ui-auditor · lens=\`${finding.lens}\` · severity=\`${finding.severity}\`</sub>`,
    '',
  ].join('\n')
}

/** @experimental */
export interface AppendFindingsResult {
  /** Findings with id + createdAt assigned, in input order. */
  written: UiFinding[]
  /** Workspace-relative path to each issue Markdown file, in input order. */
  files: string[]
}

/**
 * Append findings to a workspace, writing one Markdown file per finding
 * and updating registry.json. Assigns monotonically increasing ids to
 * findings that arrived without one.
 *
 * Findings already carrying an id that collides with the registry are
 * rejected — callers must either freshly mint findings (id undefined) or
 * use a separate update path. This protects against accidental overwrite.
 *
 * @experimental
 */
export async function appendFindings(
  workspaceDir: string,
  findings: readonly UiFinding[],
): Promise<AppendFindingsResult> {
  await initAuditWorkspace(workspaceDir)
  const reg = await readAuditRegistry(workspaceDir)
  const usedIds = new Set<number>()
  for (const f of reg.findings) {
    if (typeof f.id === 'number') usedIds.add(f.id)
  }

  const written: UiFinding[] = []
  const files: string[] = []
  let nextId = nextFindingId(reg)

  for (const incoming of findings) {
    let id = incoming.id
    if (id !== undefined) {
      if (usedIds.has(id)) {
        throw new Error(
          `audit-writer: incoming finding id ${id} (title=${JSON.stringify(incoming.title)}) collides with an existing registry entry`,
        )
      }
    } else {
      id = nextId
      while (usedIds.has(id)) id += 1
      nextId = id + 1
    }
    usedIds.add(id)

    const createdAt = incoming.createdAt ?? new Date().toISOString()
    const persisted: UiFinding = { ...incoming, id, createdAt }

    const slug = slugifyTitle(persisted.title)
    const fileName = `${String(id).padStart(3, '0')}--${persisted.lens}--${slug}.md`
    const filePathAbs = path.join(workspaceDir, 'issues', fileName)
    const filePathRel = `issues/${fileName}`

    await fs.writeFile(filePathAbs, renderFinding(persisted))
    reg.findings.push(persisted)
    written.push(persisted)
    files.push(filePathRel)
  }

  await writeAuditRegistry(workspaceDir, reg)
  return { written, files }
}

/** @experimental */
export interface RegisterCapturesOptions {
  route: string
  url?: string
  captures: readonly AuditRegistryCapture[]
}

/**
 * Record screenshots taken for a route in the registry, without filing a
 * finding. Useful when the auditor wants to remember which captures
 * exist for resume / dedup purposes.
 *
 * @experimental
 */
export async function registerCaptures(
  workspaceDir: string,
  options: RegisterCapturesOptions,
): Promise<void> {
  await initAuditWorkspace(workspaceDir)
  const reg = await readAuditRegistry(workspaceDir)
  const slot = reg.routes[options.route] ?? { captures: [] }
  if (options.url) slot.url = options.url
  slot.captures = [...slot.captures, ...options.captures]
  reg.routes[options.route] = slot
  await writeAuditRegistry(workspaceDir, reg)
}

/** @experimental */
export interface AuditIndex {
  /** Total findings in the workspace. */
  total: number
  bySeverity: Record<UiFinding['severity'], number>
  byLens: Partial<Record<UiLens, number>>
  byRoute: Record<string, number>
}

/** @experimental */
export function summarizeRegistry(reg: AuditRegistry): AuditIndex {
  const bySeverity: Record<UiFinding['severity'], number> = {
    critical: 0,
    high: 0,
    med: 0,
    low: 0,
  }
  const byLens: Partial<Record<UiLens, number>> = {}
  const byRoute: Record<string, number> = {}
  for (const f of reg.findings) {
    bySeverity[f.severity] += 1
    byLens[f.lens] = (byLens[f.lens] ?? 0) + 1
    byRoute[f.route] = (byRoute[f.route] ?? 0) + 1
  }
  return { total: reg.findings.length, bySeverity, byLens, byRoute }
}

/**
 * Regenerate `<workspace>/index.md` from registry.json.
 *
 * @experimental
 */
export async function writeAuditIndex(workspaceDir: string): Promise<string> {
  const reg = await readAuditRegistry(workspaceDir)
  const summary = summarizeRegistry(reg)

  const sorted = [...reg.findings].sort((a, b) => {
    const sa = SEVERITY_ORDER[a.severity]
    const sb = SEVERITY_ORDER[b.severity]
    if (sa !== sb) return sa - sb
    return (a.id ?? 0) - (b.id ?? 0)
  })

  const lines: string[] = []
  lines.push('# UI audit index', '')
  lines.push(`_Generated: ${new Date().toISOString()}_`, '')
  lines.push(`**Total findings:** ${summary.total}`, '')
  lines.push('## By severity')
  for (const s of ['critical', 'high', 'med', 'low'] as const) {
    const n = summary.bySeverity[s] ?? 0
    if (n > 0) lines.push(`- **${s}** — ${n}`)
  }
  lines.push('', '## By lens')
  const lensEntries: [string, number][] = Object.entries(summary.byLens).map(([k, v]) => [
    k,
    v ?? 0,
  ])
  for (const [lens, n] of lensEntries.sort((a, b) => b[1] - a[1])) {
    lines.push(`- **${lens}** — ${n}`)
  }
  lines.push('', '## By route')
  const routeEntries: [string, number][] = Object.entries(summary.byRoute).map(([k, v]) => [
    k,
    v ?? 0,
  ])
  for (const [route, n] of routeEntries.sort((a, b) => b[1] - a[1])) {
    lines.push(`- \`${route}\` — ${n}`)
  }
  lines.push('', '## Findings', '')
  for (const f of sorted) {
    if (typeof f.id !== 'number') continue
    const num = String(f.id).padStart(3, '0')
    const slug = slugifyTitle(f.title)
    const file = `issues/${num}--${f.lens}--${slug}.md`
    lines.push(`- [#${num} \`${f.severity}\` \`${f.lens}\` \`${f.route}\` — ${f.title}](${file})`)
  }
  lines.push('')

  const out = path.join(workspaceDir, 'index.md')
  const body = lines.join('\n')
  await fs.writeFile(out, body)
  return out
}
