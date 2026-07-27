/**
 * The AgentProfile genome as independently-optimizable coordinates. Every field the harness lets
 * you define — prompt, skills, subagents, hooks, tools, mcp — is a coordinate: a way to inject a
 * set of named candidates into a profile while holding every OTHER field fixed. This is the one
 * abstraction behind "improve any part of the agent, freeze the rest, combine freely":
 *
 *   compose(baseProfile, selected) = { ...baseProfile, <thisField>: inject(selected) }
 *
 * Freeze a coordinate ⇒ never select it (it stays as-is in the base profile). Optimize one ⇒
 * vary its selection. Combine ⇒ compose several coordinates' composers in sequence. Because a
 * subagent is ITSELF an AgentProfile, the same coordinates apply recursively to any node in the
 * supervisor flow (root driver, worker, sub-worker) — you point a coordinate at that node's
 * base profile.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { defineInlineResource } from '@tangle-network/agent-interface'

export interface ProfileCoordinate {
  /** Coordinate id (the COORDINATE= knob value). */
  readonly name: string
  /** Candidate names the optimizer screens (one per independently-testable unit). */
  candidates(): readonly string[]
  /** Inject the selected candidates into THIS field of the profile, holding all others fixed.
   *  Empty selection ⇒ the base profile unchanged (the frozen/baseline arm). */
  compose(base: AgentProfile, selected: readonly string[]): AgentProfile
}

const here = (p: string) => join(import.meta.dirname, p)

// ── skills: SKILL.md packages materialized to disk (resources.skills) ───────────────
function skillsCoordinate(dir = here(process.env.SKILLS_DIR ?? 'coding-skills')): ProfileCoordinate {
  const files = () => readdirSync(dir).filter((f) => f.endsWith('.md')).sort()
  return {
    name: 'skills',
    candidates: () => files().map((f) => f.replace(/\.md$/, '')),
    compose: (base, selected) => {
      if (!selected.length) return base
      const refs = selected.map((n) => defineInlineResource(n, readFileSync(join(dir, `${n}.md`), 'utf8')))
      return { ...base, resources: { ...base.resources, skills: [...(base.resources?.skills ?? []), ...refs] } }
    },
  }
}

// ── hooks: shell commands the harness fires on lifecycle events (enforced, not advisory) ──
const hookDefs: Record<string, { event: string; command: string; matcher?: string }> = {
  'lint-before-edit': { event: 'PreToolUse', matcher: 'Edit|Write', command: 'ruff check . 2>/dev/null || true' },
  'tests-after-edit': { event: 'PostToolUse', matcher: 'Edit|Write', command: 'python -m pytest -q 2>/dev/null | tail -5 || true' },
  'no-print-debugging': { event: 'PreToolUse', matcher: 'Edit|Write', command: 'true' },
}
function hooksCoordinate(): ProfileCoordinate {
  return {
    name: 'hooks',
    candidates: () => Object.keys(hookDefs),
    compose: (base, selected) => {
      if (!selected.length) return base
      const hooks: Record<string, { command: string; matcher?: string }[]> = { ...(base.hooks ?? {}) }
      for (const n of selected) {
        const d = hookDefs[n]
        if (!d) throw new Error(`unknown hook ${n}`)
        hooks[d.event] = [...(hooks[d.event] ?? []), { command: d.command, ...(d.matcher ? { matcher: d.matcher } : {}) }]
      }
      return { ...base, hooks: hooks as AgentProfile['hooks'] }
    },
  }
}

// ── tools: enable/disable named harness tools ───────────────────────────────────────
const toolCandidates = ['webfetch', 'websearch', 'bash', 'edit', 'read', 'grep']
function toolsCoordinate(): ProfileCoordinate {
  return {
    name: 'tools',
    candidates: () => toolCandidates,
    compose: (base, selected) => {
      if (!selected.length) return base
      const tools: Record<string, boolean> = { ...(base.tools ?? {}) }
      for (const n of selected) tools[n] = true
      return { ...base, tools }
    },
  }
}

// ── prompt: extra instruction lines appended to the active system prompt ─────────────
const instructionDefs: Record<string, string> = {
  'be-surgical': 'Make the smallest change that satisfies the task; do not touch unrelated code.',
  'check-examples': 'Before finalizing, re-read the examples in the docstring and confirm your output matches them exactly.',
  'edge-cases': 'Enumerate boundary inputs (empty, zero, negative, max) and make sure your solution handles each.',
}
function promptCoordinate(): ProfileCoordinate {
  return {
    name: 'prompt',
    candidates: () => Object.keys(instructionDefs),
    compose: (base, selected) => {
      if (!selected.length) return base
      const instructions = [...(base.prompt?.instructions ?? []), ...selected.map((n) => instructionDefs[n]!)]
      return { ...base, prompt: { ...base.prompt, instructions } }
    },
  }
}

// ── subagents: helper agents the root can delegate to (each is itself a mini-profile) ──
const subagentDefs: Record<string, { description: string; prompt: string; tools?: Record<string, boolean> }> = {
  reviewer: { description: 'Reviews a proposed change for bugs before it is finalized.', prompt: 'You are a strict code reviewer. Find bugs, edge cases, and contract violations in the proposed change. Be concise.' },
  tester: { description: 'Writes and runs a focused test for the change.', prompt: 'You write the minimal test that would catch a regression in this change, run it, and report pass/fail.' },
}
function subagentsCoordinate(): ProfileCoordinate {
  return {
    name: 'subagents',
    candidates: () => Object.keys(subagentDefs),
    compose: (base, selected) => {
      if (!selected.length) return base
      const subagents = { ...(base.subagents ?? {}) }
      for (const n of selected) subagents[n] = subagentDefs[n]!
      return { ...base, subagents: subagents as AgentProfile['subagents'] }
    },
  }
}

const REGISTRY: Record<string, () => ProfileCoordinate> = {
  skills: () => skillsCoordinate(),
  hooks: hooksCoordinate,
  tools: toolsCoordinate,
  prompt: promptCoordinate,
  subagents: subagentsCoordinate,
}

export function getCoordinate(name: string): ProfileCoordinate {
  const make = REGISTRY[name]
  if (!make) throw new Error(`unknown coordinate ${name} (have: ${Object.keys(REGISTRY).join(', ')})`)
  return make()
}

export const coordinateNames = (): string[] => Object.keys(REGISTRY)
