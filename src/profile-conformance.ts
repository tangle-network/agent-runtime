/**
 * Profile conformance — refuses decorative tools, dead MCP, scaffold-as-real.
 *
 * The canonical audit (2026-05-17) found:
 *   - gtm + creative declare `tools: { bash: true, web: true, ... }` where
 *     `bash` / `web` are shell capabilities (permissions), not tools, and
 *     the `gtm-*` tool keys had no corresponding `AgentProfileMcpServer`
 *     entry. Decoration, not contract.
 *   - legal + tax mark 5 of 7 subagents `metadata.status: 'scaffold'` and
 *     still let the runtime dispatch them, producing 5-10 line scaffold
 *     prompts that read like prose stubs.
 *   - Cross-repo: zero usage of `continuousAgreement` or `HypothesisManifest`
 *     for judge calibration / pre-registration.
 *
 * `assertProfileConformance` is the runtime / CI guard that fails LOUD on
 * any of those anti-patterns. Every consumer imports this and runs it in
 * a unit test against their profile (`tests/agent-profile.test.ts`); the
 * test fails CI if the profile re-introduces decorative tools or scaffold
 * subagents claiming to be real.
 *
 * Pure — no I/O — so callers can use it inside a unit test or at module
 * load to fail-fast on misconfiguration.
 */

import type {
  AgentProfile,
  AgentProfileMcpServer,
  AgentSubagentProfile,
} from '@tangle-network/sandbox'

export interface ConformanceIssue {
  severity: 'error' | 'warn'
  /** Stable kebab-case code, useful for CI matching. */
  code: string
  /** Profile path the issue is anchored to, e.g. `tools.bash` or `subagents.foo`. */
  path: string
  /** Human-readable failure reason. */
  message: string
}

export interface ConformanceResult {
  valid: boolean
  errors: ConformanceIssue[]
  warnings: ConformanceIssue[]
}

export interface ConformanceOptions {
  /**
   * Shell-style capabilities that may appear in `permissions` but NEVER in
   * `tools`. Declaring these as tools is decorative — the runtime doesn't
   * dispatch them as MCP servers. Default covers the observed offenders.
   */
  knownShellCapabilities?: readonly string[]
  /**
   * If true, treat `subagents[id].metadata.status === 'scaffold'` as an
   * error rather than a warning. Default false — scaffolds are honest
   * stubs as long as the router skips them.
   */
  strictNoScaffolds?: boolean
  /**
   * Names that may appear in `tools` without a corresponding MCP server or
   * resource mount. Default empty — kills decorative-tool anti-pattern.
   */
  toolsAllowedWithoutMcp?: readonly string[]
  /**
   * Minimum length of `prompt.systemPrompt`. Profiles below this are
   * likely incomplete. Default 800 chars (rough lower bound for the
   * partner-tier prompts the product agents target).
   */
  minSystemPromptChars?: number
}

const DEFAULT_SHELL_CAPS = ['bash', 'sh', 'python', 'node', 'curl', 'web', 'browser', 'shell'] as const

const DEFAULT_MIN_PROMPT_CHARS = 800

function checkSystemPrompt(profile: AgentProfile, minChars: number): ConformanceIssue[] {
  const prompt = profile.prompt?.systemPrompt
  if (!prompt || prompt.trim().length < minChars) {
    return [
      {
        severity: 'error',
        code: 'system-prompt-too-short',
        path: 'prompt.systemPrompt',
        message: `prompt.systemPrompt is ${prompt?.length ?? 0} chars; min required is ${minChars}. A canonical agent profile carries a partner-tier system prompt; below threshold is almost always a placeholder.`,
      },
    ]
  }
  return []
}

function checkToolsVsMcp(
  profile: AgentProfile,
  opts: ConformanceOptions,
): ConformanceIssue[] {
  const issues: ConformanceIssue[] = []
  const shellCaps = new Set(opts.knownShellCapabilities ?? DEFAULT_SHELL_CAPS)
  const allowedWithoutMcp = new Set(opts.toolsAllowedWithoutMcp ?? [])
  const tools = (profile.tools ?? {}) as Record<string, unknown>
  const mcp = (profile.mcp ?? {}) as Record<string, AgentProfileMcpServer>
  for (const [name, value] of Object.entries(tools)) {
    // Shell capabilities masquerading as tools — should be in permissions, not tools.
    if (shellCaps.has(name)) {
      issues.push({
        severity: 'error',
        code: 'shell-capability-as-tool',
        path: `tools.${name}`,
        message: `'${name}' is a shell capability, not a tool. Move to permissions and remove from tools. Anti-pattern from the canonical audit.`,
      })
      continue
    }
    if (allowedWithoutMcp.has(name)) continue
    if (value === false) continue
    if (!mcp[name]) {
      issues.push({
        severity: 'error',
        code: 'decorative-tool-without-mcp',
        path: `tools.${name}`,
        message: `'${name}' declared in tools but no corresponding mcp[${name}] AgentProfileMcpServer. Either wire an MCP server, list this name in toolsAllowedWithoutMcp (if it's a file-mounted CLI binary), or remove from tools. Decorative tools were the #2 anti-pattern in the canonical audit.`,
      })
    }
  }
  return issues
}

function checkSubagentShape(subagent: AgentSubagentProfile, id: string): ConformanceIssue[] {
  const issues: ConformanceIssue[] = []
  if (!subagent.description || subagent.description.trim().length < 40) {
    issues.push({
      severity: 'error',
      code: 'subagent-description-too-short',
      path: `subagents.${id}.description`,
      message: `subagents.${id}.description is missing or too short. Required for routing UX + audit trail.`,
    })
  }
  if (!subagent.prompt || subagent.prompt.trim().length < 100) {
    issues.push({
      severity: 'error',
      code: 'subagent-prompt-too-short',
      path: `subagents.${id}.prompt`,
      message: `subagents.${id}.prompt is missing or below 100 chars. Either ship the specialist prompt or move this subagent under metadata.plannedSubagents.`,
    })
  }
  return issues
}

function checkScaffoldSubagents(
  profile: AgentProfile,
  strict: boolean,
): ConformanceIssue[] {
  const issues: ConformanceIssue[] = []
  const subagents = profile.subagents ?? {}
  for (const [id, subagent] of Object.entries(subagents)) {
    const meta = subagent.metadata as Record<string, unknown> | undefined
    const status = meta?.status
    if (status === 'scaffold' || status === 'not-implemented' || (meta as { implemented?: boolean })?.implemented === false) {
      issues.push({
        severity: strict ? 'error' : 'warn',
        code: 'subagent-scaffold-shipped',
        path: `subagents.${id}`,
        message: `subagents.${id} is a scaffold (metadata.status='${status}'). Router must gate on metadata.status === 'full' OR caller must opt into scaffolds explicitly.`,
      })
    }
  }
  return issues
}

/**
 * Run all conformance checks against a profile. Designed to be called from
 * a unit test:
 *
 *     it('legalAgentProfile passes conformance', () => {
 *       const result = assertProfileConformance(legalAgentProfile, {
 *         toolsAllowedWithoutMcp: ['agent-knowledge:query'],  // in-process function
 *       })
 *       expect(result.valid).toBe(true)
 *       expect(result.errors).toEqual([])
 *     })
 *
 * The result lets the test report exactly which path/code failed instead
 * of a generic "validation failed."
 */
export function assertProfileConformance(
  profile: AgentProfile,
  opts: ConformanceOptions = {},
): ConformanceResult {
  const issues = [
    ...checkSystemPrompt(profile, opts.minSystemPromptChars ?? DEFAULT_MIN_PROMPT_CHARS),
    ...checkToolsVsMcp(profile, opts),
    ...checkScaffoldSubagents(profile, opts.strictNoScaffolds ?? false),
  ]
  for (const [id, subagent] of Object.entries(profile.subagents ?? {})) {
    issues.push(...checkSubagentShape(subagent, id))
  }
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warn')
  return { valid: errors.length === 0, errors, warnings }
}
