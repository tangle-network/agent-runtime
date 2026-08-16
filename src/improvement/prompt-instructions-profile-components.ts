import { agentProfileSchema } from '@tangle-network/agent-interface'
import { ConfigError } from '../errors'
import type { ImproveProfileComponents } from './improve-types'

/** Stable component-name prefix used for `profile.prompt.instructions`. */
export const PROMPT_INSTRUCTION_COMPONENT_PREFIX = 'prompt.instruction:'

const COMPONENT_INDEX_WIDTH = 6

function componentName(index: number): string {
  return `${PROMPT_INSTRUCTION_COMPONENT_PREFIX}${String(index).padStart(COMPONENT_INDEX_WIDTH, '0')}`
}

function orderedInstructionValues(components: Readonly<Record<string, string>>): string[] {
  const entries = Object.entries(components).sort(([left], [right]) => left.localeCompare(right))
  if (entries.length === 0) {
    throw new ConfigError(
      'promptInstructionsProfileComponents: at least one prompt instruction is required',
    )
  }
  for (const [index, [name, value]] of entries.entries()) {
    const expected = componentName(index)
    if (name !== expected) {
      throw new ConfigError(
        `promptInstructionsProfileComponents: expected component ${JSON.stringify(expected)}, got ${JSON.stringify(name)}`,
      )
    }
    if (typeof value !== 'string') {
      throw new ConfigError(
        `promptInstructionsProfileComponents: component ${JSON.stringify(name)} must be a string`,
      )
    }
  }
  return entries.map(([, value]) => value)
}

/**
 * Canonical `ImproveProfileComponents` mapping for the ordered
 * `AgentProfile.prompt.instructions` list.
 *
 * Use it with `surface: 'agent-profile'` when an optimizer should rewrite the
 * exact instruction texts without being allowed to change their count, order,
 * labels, or any unrelated profile field:
 *
 * ```ts
 * await improve(profile, {
 *   surface: 'agent-profile',
 *   profileComponents: promptInstructionsProfileComponents,
 *   // method, scenarios, judge, executionRef, agent, ...
 * })
 * ```
 *
 * Component names are zero-padded and stable. Runtime's existing component
 * materializer requires every candidate to preserve the exact key set and
 * verifies that `apply(read(profile))` reproduces the baseline profile. A
 * profile with no prompt instructions is refused rather than inventing a
 * sentinel instruction that could accidentally ship.
 */
export const promptInstructionsProfileComponents: ImproveProfileComponents = Object.freeze({
  read(profile) {
    const instructions = profile.prompt?.instructions ?? []
    if (instructions.length === 0) {
      throw new ConfigError(
        'promptInstructionsProfileComponents: profile.prompt.instructions must contain at least one instruction',
      )
    }
    return Object.fromEntries(
      instructions.map((instruction, index) => [componentName(index), instruction]),
    )
  },
  apply(profile, components) {
    const instructions = orderedInstructionValues(components)
    return agentProfileSchema.parse({
      ...profile,
      prompt: {
        ...profile.prompt,
        instructions,
      },
    })
  },
})
