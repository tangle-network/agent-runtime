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

import type { ProposalFinding } from '@tangle-network/agent-eval'
import { optimizerMethod } from './optimizer-prompt'

/** Evidence supplied to a generated tool or MCP build instruction. */
export interface BuildPromptFindingsInput {
  findings: ReadonlyArray<ProposalFinding>
}

/** Render findings as the ranked-evidence block every build prompt ends with. */
export function findingLines(findings: ReadonlyArray<ProposalFinding>): string[] {
  return findings.map((f) => {
    const where = f.subject ? ` [${f.subject}]` : ''
    const action = f.recommended_action ? ` → ${f.recommended_action}` : ''
    return `- (${f.severity})${where} ${f.claim}${action}`
  })
}

/** Build the starting instruction for a coder agent tasked with implementing a new tool. */
export function toolBuildPrompt(args: BuildPromptFindingsInput): string {
  return [
    'You are building a new TOOL for this codebase — a capability the agent measurably lacks,',
    'evidenced by the failure findings at the bottom. The tool is an experiment: after it is',
    'built and verified, its marginal lift is measured on held-out tasks, and only a real lift',
    'promotes it.',
    '',
    optimizerMethod,
    '',
    'THE SURFACE — what a deliverable tool looks like here:',
    '- ONE small, self-contained module PLUS tests that exercise its contract (what callers rely',
    '  on), not its internals. The tests are the experiment for sub-goal correctness — write the',
    '  test that would fail if your hypothesis about the gap were wrong.',
    '- It must compile and its tests must pass — they run automatically; on failure you get the',
    '  verifier output and another attempt, resuming on top of your own edits (fix in place, do',
    '  not start over).',
    '- Match the codebase grain: reuse its existing helpers, style, and test framework; a tool',
    '  that fights the codebase is the wrong tool even if it passes.',
    '- Do not commit; leave the changes in the working tree.',
    '',
    'FINDINGS — ranked evidence from real failed runs (the gaps the tool must close):',
    ...findingLines(args.findings),
  ].join('\n')
}

/** Build the starting instruction for a coder agent tasked with implementing a new MCP server. */
export function mcpBuildPrompt(args: BuildPromptFindingsInput): string {
  return [
    'You are building a new MCP SERVER (Model Context Protocol) exposing tool(s) that close the',
    'capability gaps evidenced by the failure findings at the bottom, so any harness can mount',
    'them. The server is an experiment: after it is built and boot-verified, its marginal lift is',
    'measured on held-out tasks, and only a real lift promotes it.',
    '',
    optimizerMethod,
    '',
    'RESEARCH FIRST — ADOPT BEFORE BUILD: you may discover and ADOPT an existing external MCP',
    'server if it fits the gaps better than building one. Registries and vendor docs list',
    'maintained servers for most common capabilities (web search, fetch, GitHub, filesystems,',
    'databases). To adopt, deliver a short adoption note instead of an implementation: the',
    "server's launch command or HTTP endpoint, and the API key it needs BY NAME (e.g.",
    'EXA_API_KEY) — never a key value; provisioning injects the value at materialize time. If',
    'your environment has no web access, decide from what you already know and say so.',
    '',
    'THE SURFACE — what a deliverable MCP server looks like here (checked by BOOTING it):',
    '- it starts over stdio and answers the MCP `initialize` handshake,',
    '- `tools/list` returns at least one tool with a valid input schema,',
    '- newline-delimited JSON-RPC 2.0, protocol version 2024-11-05,',
    '- a clear start command (a package.json `start` script or an obvious entrypoint).',
    'Design the tool surface for the FINDINGS, not for generality: each exposed tool should map to',
    'a named failure mechanism, with a description that tells the agent when to reach for it (a',
    'tool the agent never calls measures zero). If the boot-and-probe fails you get the error and',
    'another attempt, resuming on top of your own edits. Do not commit; leave the changes in the',
    'working tree.',
    '',
    'FINDINGS — ranked evidence from real failed runs (the capabilities the server must provide):',
    ...findingLines(args.findings),
  ].join('\n')
}
