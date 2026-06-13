/**
 * Buildable-artifact generators — the named executors for the `build-tool` and
 * `build-mcp` loop types (the intelligence plane's loop-runs registry already
 * carries those type names; these are the runtime side that runs them).
 *
 * Both are thin presets over `agenticGenerator`: the universal build-and-verify-
 * in-session factory. What each preset contributes is exactly the two stages
 * that define an artifact type (docs/artifact-lifecycle-frontier.md):
 *   - a type-specific `buildPrompt` (build a tool vs. build an MCP server), and
 *   - the type's intrinsic verifier (compile/test for a tool; boot-and-probe
 *     for an MCP server).
 * Everything else — the worktree, the resume-on-failure loop, the
 * improvement-loop wrapper that evaluates and promotes — is shared.
 *
 * Why MCP is the load-bearing one: this stack is harness-agnostic, and MCP is
 * the standard transport by which a harness (Claude Code / Codex / Hermes)
 * acquires new tools. So `mcpGenerator` is the primary tool-acquisition path;
 * `toolGenerator` (raw code) matters where we control the loader (the runtime's
 * own router-tools executor).
 */

import type { AnalystFinding } from '@tangle-network/agent-eval'
import { type AgenticGeneratorOptions, agenticGenerator, type Verifier } from './agentic-generator'
import type { CandidateGenerator } from './improvement-driver'
import { type McpServeSpec, mcpServeVerifier } from './mcp-serve-verifier'

type FindingsArg = { report: unknown; findings: AnalystFinding[] }

/** A `CandidateGenerator` that builds a new TOOL (executable code + tests) in
 *  the worktree. The caller supplies the intrinsic `verify` (e.g.
 *  `commandVerifier('pnpm', ['test'])`) — a tool with no checker is the exact
 *  thing the verify-loop exists to prevent, so it is not optional here. */
export interface ToolGeneratorOptions extends Omit<AgenticGeneratorOptions, 'buildPrompt'> {
  verify: Verifier
  buildPrompt?: (args: FindingsArg) => string
}

export function toolGenerator(opts: ToolGeneratorOptions): CandidateGenerator {
  const base = agenticGenerator({
    ...opts,
    buildPrompt: opts.buildPrompt ?? toolBuildPrompt,
  })
  return { ...base, kind: `build-tool:${opts.harness ?? 'claude'}` }
}

/** A `CandidateGenerator` that builds a new MCP SERVER exposing tool(s) in the
 *  worktree, verified by booting it and running the MCP handshake. Pass `serve`
 *  (how to start the built server) to get the default boot-and-probe verifier,
 *  or `verify` to override (e.g. an HTTP-transport probe). One of the two is
 *  required — an unprobed MCP server is not a candidate. */
export interface McpGeneratorOptions
  extends Omit<AgenticGeneratorOptions, 'buildPrompt' | 'verify'> {
  /** How to start the built server for the stdio boot-and-probe check. */
  serve?: McpServeSpec
  /** Override the verifier entirely (mutually exclusive with `serve`). */
  verify?: Verifier
  buildPrompt?: (args: FindingsArg) => string
}

export function mcpGenerator(opts: McpGeneratorOptions): CandidateGenerator {
  const verify = opts.verify ?? (opts.serve ? mcpServeVerifier(opts.serve) : undefined)
  if (!verify) {
    throw new Error(
      'mcpGenerator: pass `serve` (boot-and-probe) or `verify` — an MCP server that is never probed is not a candidate',
    )
  }
  const base = agenticGenerator({
    ...opts,
    buildPrompt: opts.buildPrompt ?? mcpBuildPrompt,
    verify,
  })
  return { ...base, kind: `build-mcp:${opts.harness ?? 'claude'}` }
}

function findingLines(findings: AnalystFinding[]): string[] {
  return findings.map((f) => {
    const where = f.subject ? ` [${f.subject}]` : ''
    const action = f.recommended_action ? ` → ${f.recommended_action}` : ''
    return `- (${f.severity})${where} ${f.claim}${action}`
  })
}

function toolBuildPrompt(args: FindingsArg): string {
  return [
    'You are building a new TOOL for this codebase to address the gaps below.',
    'Write the tool as a small, self-contained module PLUS tests that exercise it.',
    'The tool must compile and its tests must pass — they will be run automatically;',
    'if verification fails you will get the error and another attempt. Do not commit;',
    'leave the changes in the working tree.',
    '',
    'Gaps the tool should close:',
    ...findingLines(args.findings),
  ].join('\n')
}

function mcpBuildPrompt(args: FindingsArg): string {
  return [
    'You are building a new MCP SERVER (Model Context Protocol) that exposes',
    'tool(s) addressing the gaps below, so any harness can mount it.',
    'Requirements that WILL be checked by booting the server:',
    '- it starts over stdio and answers the MCP `initialize` handshake,',
    '- `tools/list` returns at least one tool with a valid input schema.',
    'Newline-delimited JSON-RPC 2.0, protocol version 2024-11-05. Include a start',
    'command (e.g. a package.json `start` script or a clear entrypoint). If the',
    'boot-and-probe fails you will get the error and another attempt. Do not',
    'commit; leave the changes in the working tree.',
    '',
    'Capabilities the server should provide:',
    ...findingLines(args.findings),
  ].join('\n')
}
