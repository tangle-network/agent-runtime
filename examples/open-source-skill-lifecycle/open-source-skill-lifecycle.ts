/**
 * Import a real open-source `SKILL.md` into the AgentProfile lifecycle.
 *
 * This is intentionally not a new skill system. The remote skill becomes a
 * `SkillDraft`, then the existing lifecycle does the work:
 *
 *   skillGenerator -> runLifecycle -> thresholdPromotionGate -> composeProfile
 *
 * Default source:
 *   anthropics/skills: skills/frontend-design/SKILL.md
 *
 * Run:
 *   pnpm tsx examples/open-source-skill-lifecycle/open-source-skill-lifecycle.ts
 *
 * Or pass another raw SKILL.md URL:
 *   SKILL_URL=https://raw.githubusercontent.com/.../SKILL.md pnpm tsx examples/open-source-skill-lifecycle/open-source-skill-lifecycle.ts
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  composeProfile,
  type EvalResult,
  runLifecycle,
  type SkillDraft,
  skillGenerator,
  thresholdPromotionGate,
} from '@tangle-network/agent-runtime/lifecycle'

const defaultSkillUrl =
  'https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md'

async function main(): Promise<void> {
  const url = process.env.SKILL_URL ?? process.argv[2] ?? defaultSkillUrl
  const imported = await fetchSkillDraft(url)
  const baseline: AgentProfile = { name: 'open-source-skill-import', resources: { skills: [] } }
  const requiredNeedle = firstUsefulTerm(imported)

  const result = await runLifecycle({
    baseline,
    domain: 'open-source-skill-import-smoke',
    generators: [
      skillGenerator({
        distill: () => [imported],
      }),
    ],
    evalRunner: (profile) => heldBackSkillPresenceCheck(profile, requiredNeedle),
    gate: thresholdPromotionGate(),
    traces: { sourceUrl: url },
  })

  const composed = composeProfile(result.registry, baseline, { kind: 'skill', k: 1 })
  const composedSkills = composed.resources?.skills ?? []
  const summary = {
    sourceUrl: url,
    importedSkill: imported.name,
    requiredNeedle,
    candidates: result.outcomes.length,
    promoted: result.promoted.length,
    baselineScore: result.baselineResult.composite,
    composedScore: (await heldBackSkillPresenceCheck(composed, requiredNeedle)).composite,
    composedSkills: composedSkills.length,
  }
  console.log(JSON.stringify(summary, null, 2))
}

async function fetchSkillDraft(url: string): Promise<SkillDraft> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`fetchSkillDraft: ${response.status} ${response.statusText} for ${url}`)
  }
  const content = await response.text()
  const metadata = parseSkillFrontmatter(content)
  return {
    name: metadata.name ?? nameFromUrl(url),
    description: metadata.description,
    content,
  }
}

function parseSkillFrontmatter(content: string): { name?: string; description?: string } {
  if (!content.startsWith('---\n')) return {}
  const end = content.indexOf('\n---', 4)
  if (end === -1) return {}
  const metadata: { name?: string; description?: string } = {}
  for (const line of content.slice(4, end).split('\n')) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim())
    if (!match) continue
    const key = match[1]
    const raw = match[2]
    if (!key || raw === undefined) continue
    const value = raw.replace(/^['"]|['"]$/g, '').trim()
    if (key === 'name') metadata.name = value
    if (key === 'description') metadata.description = value
  }
  return metadata
}

function nameFromUrl(url: string): string {
  const parts = new URL(url).pathname.split('/').filter(Boolean)
  const file = parts.at(-1) ?? 'imported-skill'
  if (file.toLowerCase() !== 'skill.md') return file.replace(/\.md$/i, '')
  return parts.at(-2) ?? 'imported-skill'
}

function firstUsefulTerm(skill: SkillDraft): string {
  const haystack = `${skill.name}\n${skill.description ?? ''}\n${skill.content}`.toLowerCase()
  for (const term of ['frontend', 'design', 'testing', 'mcp', 'skill']) {
    if (haystack.includes(term)) return term
  }
  return skill.name.toLowerCase()
}

async function heldBackSkillPresenceCheck(
  profile: AgentProfile,
  requiredNeedle: string,
): Promise<EvalResult> {
  const skills = profile.resources?.skills ?? []
  const matched = skills.some(
    (skill) =>
      skill.kind === 'inline' && skill.content.toLowerCase().includes(requiredNeedle.toLowerCase()),
  )
  return { composite: matched ? 1 : 0, costUsd: skills.length * 0.001 }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
