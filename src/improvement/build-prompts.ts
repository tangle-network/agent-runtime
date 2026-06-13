/**
 * Build-prompt starting points for the two buildable artifact types. There is
 * NO `toolGenerator`/`mcpGenerator` wrapper — the factory is `agenticGenerator`
 * + a verifier (docs/artifact-lifecycle-frontier.md), so a tool or an MCP
 * server is built by composing the pieces directly:
 *
 *   // a tool:
 *   agenticGenerator({ buildPrompt: toolBuildPrompt, verify: commandVerifier('pnpm', ['test']) })
 *   // an MCP server:
 *   agenticGenerator({ buildPrompt: mcpBuildPrompt, verify: mcpServeVerifier({ command: 'node', args: ['server.mjs'] }) })
 *
 * These are the only type-specific bit (the phrasing that points the agent at a
 * tool vs. an MCP); the worktree, resume-on-failure loop, and improvement-loop
 * wrapper are shared. MCP is the load-bearing target — it is how a harness
 * acquires tools; raw tools matter where we control the loader.
 */

import type { AnalystFinding } from '@tangle-network/agent-eval'

type FindingsArg = { report: unknown; findings: AnalystFinding[] }

function findingLines(findings: AnalystFinding[]): string[] {
  return findings.map((f) => {
    const where = f.subject ? ` [${f.subject}]` : ''
    const action = f.recommended_action ? ` → ${f.recommended_action}` : ''
    return `- (${f.severity})${where} ${f.claim}${action}`
  })
}

export function toolBuildPrompt(args: FindingsArg): string {
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

export function mcpBuildPrompt(args: FindingsArg): string {
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
