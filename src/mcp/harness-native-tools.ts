/**
 *
 * The SUB-AGENT tool names a coding harness publishes to its OWN model, by harness — the family
 * that starts, drives, and stops a child agent. It is deliberately not every tool a harness
 * publishes: a harness's file, shell, and search tools are a much larger and faster-moving set,
 * and the runtime publishes nothing that could be confused for one.
 *
 * A harness mounts an MCP server's tools under a prefix built from the server name
 * (`agent-runtime-coordination_spawn_worker`), so a runtime tool and a harness tool never collide
 * on the wire. The collision this registry exists to prevent is in PROSE. A prompt, a skill, or an
 * authored profile names a tool by its bare word, and a bare word the harness also publishes
 * resolves to the HARNESS's tool. The runtime then never sees the call: no journal row, no budget
 * reservation from the conserved pool, no grade — while a real agent runs and spends real tokens.
 * The sub-agent family is exactly where that confusion is possible, because it is the family the
 * coordination verbs duplicate.
 *
 * This is a list of names the runtime must AVOID, not a behavior switch. Nothing consults it on a
 * hot path, an entry disables no harness feature, and adding a harness only widens what the guard
 * refuses to publish. `tests/kernel/harness-native-tools.test.ts` reads it against every tool list
 * the runtime's own MCP builders produce, and `tests/kernel/skill-tool-names.test.ts` reads it
 * against the shipped skills, which are the prompt text that carries a bare name to a model.
 *
 * Every entry names where its list comes from, because a harness renames its own tools and a list
 * with no source cannot be re-checked. A harness absent from the registry has no sourced list —
 * {@link harnessNativeToolNames} reports `undefined` for it rather than an empty list, so "we have
 * not looked" never reads as "it publishes nothing".
 *
 * @module
 */
import type { HarnessType } from '@tangle-network/agent-interface'

/**
 * Sourced native sub-agent tool names, keyed by the same `HarnessType` vocabulary the rest of the
 * runtime draws harness names from, so a harness the interface renames is a compile error here.
 */
export const harnessNativeTools = {
  // codex CLI 0.150.1: the `multi_agents_v2` collab family, read out of the shipped binary.
  codex: [
    'spawn_agent',
    'send_input',
    'resume_agent',
    'close_agent',
    'list_agents',
    'wait_agent',
    'send_message',
    'interrupt_agent',
    'followup_task',
  ],
  // claude-code: the sub-agent family agent-eval's rollout reader keys on — `DEFAULT_SPAWN_TOOLS`
  // (`Task` is the older name for `Agent`), `DEFAULT_STEER_TOOLS`, `DEFAULT_CANCEL_TOOLS`.
  'claude-code': ['Agent', 'Task', 'SendMessage', 'TaskStop', 'KillAgent'],
  // opencode: one native sub-agent spawner, `task`.
  opencode: ['task'],
} as const satisfies Partial<Record<HarnessType, ReadonlyArray<string>>>

/** A harness with a sourced native tool list. */
export type SourcedHarness = keyof typeof harnessNativeTools

/** The harnesses this registry has a sourced list for. */
export const sourcedHarnesses = Object.keys(harnessNativeTools) as ReadonlyArray<SourcedHarness>

/**
 * The tool names `harness` publishes natively, or `undefined` when no list has been sourced for it.
 * The two are different facts and a caller must not read one as the other.
 */
export function harnessNativeToolNames(harness: HarnessType): ReadonlyArray<string> | undefined {
  const names = (harnessNativeTools as Partial<Record<HarnessType, ReadonlyArray<string>>>)[harness]
  return names
}

/**
 * The sourced harnesses that publish `name` natively — empty when the name is clear of all of them.
 *
 * The comparison folds case. A model resolving a bare word out of a prompt does not hold the
 * harness's exact casing, so `task` and `Task` are one collision, not two distinct names.
 */
export function collidesWithHarnessNativeTool(name: string): ReadonlyArray<SourcedHarness> {
  const wanted = name.toLowerCase()
  return sourcedHarnesses.filter((harness) =>
    harnessNativeTools[harness].some((native: string) => native.toLowerCase() === wanted),
  )
}
