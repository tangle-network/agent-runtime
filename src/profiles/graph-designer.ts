import { readFileSync } from 'node:fs'
import { type AgentProfile, agentProfileSchema } from '@tangle-network/agent-interface'
import { ValidationError } from '../errors'
import { assertExecutableAgentProfile } from '../runtime/supervise/model-policy'

/** Canonical owners of the separately bundled designer capabilities. */
export const graphDesignerSkillSources = Object.freeze({
  'graph-designer':
    'https://github.com/tangle-network/agent-runtime/blob/main/skills/graph-designer/SKILL.md',
  'agent-graphs':
    'https://github.com/tangle-network/agent-runtime/blob/main/skills/agent-graphs/SKILL.md',
  'be-ambitious':
    'https://github.com/drewstone/dotfiles/blob/main/claude/skills/be-ambitious/SKILL.md',
})

type SkillResource = NonNullable<NonNullable<AgentProfile['resources']>['skills']>[number]

/** Read this installation's bundled skills without depending on a user's skill installation.
 *  Self-resolution follows the public profiles entry in source checkouts and packed installs. */
export function graphDesignerSkills(): SkillResource[] {
  const directory = new URL(
    '../skills/',
    import.meta.resolve('@tangle-network/agent-runtime/profiles'),
  )
  return Object.keys(graphDesignerSkillSources).map((name) => ({
    kind: 'inline',
    name,
    content: readFileSync(new URL(`${name}/SKILL.md`, directory), 'utf8'),
  }))
}

export interface GraphDesignerProfileOptions {
  /** Caller-owned exact harness/model, tools, permissions, connections and other capabilities. */
  readonly profile: AgentProfile
  readonly name?: string
}

/** Compose graph design capabilities onto a complete execution profile; the skills remain
 *  distinct resources carried through the normal profile materializer. */
export function graphDesignerProfile(options: GraphDesignerProfileOptions): AgentProfile {
  const base = agentProfileSchema.parse(options.profile)
  assertExecutableAgentProfile(base, 'graphDesignerProfile')
  const skills = [...(base.resources?.skills ?? [])]
  for (const skill of graphDesignerSkills()) {
    const existing = skills.find((resource) => resource.name === skill.name)
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(skill))
        throw new ValidationError(`graphDesignerProfile: conflicting skill resource ${skill.name}`)
    } else skills.push(skill)
  }
  return agentProfileSchema.parse({
    ...base,
    name: options.name ?? base.name,
    description: base.description ?? 'Design, replay and improve checked Runtime graphs.',
    prompt: {
      ...base.prompt,
      instructions: [
        ...(base.prompt?.instructions ?? []),
        'You design or replay the graph requested by the task. Apply the bundled graph-designer, agent-graphs and be-ambitious skills; keep the task acceptance and granted authority fixed. Return the canonical graph file and its actual qualification evidence.',
      ],
    },
    resources: { ...base.resources, skills, failOnError: true },
  })
}
