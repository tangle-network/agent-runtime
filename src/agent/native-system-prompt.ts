import { posix } from 'node:path'
import type { AgentProfilePrompt } from '@tangle-network/agent-interface'
import type { PlanFile } from '@tangle-network/agent-profile-materialize'

/** Native replace and append controls shared by local and sealed candidate execution. */
export function nativeSystemPrompt(
  harness: string,
  prompt: Pick<AgentProfilePrompt, 'systemPrompt' | 'appendSystemPrompt'> | undefined,
  systemPath = '.tangle/system-prompt.md',
): { files: PlanFile[]; flags: string[] } {
  const files: PlanFile[] = []
  const flags: string[] = []
  for (const intent of ['systemPrompt', 'appendSystemPrompt'] as const) {
    const text = prompt?.[intent]
    if (text === undefined) continue
    if (typeof text !== 'string' || (intent === 'appendSystemPrompt' && !text.trim())) {
      throw new Error(
        `profile.prompt.${intent} must be ${intent === 'systemPrompt' ? 'a string' : 'non-empty text'}`,
      )
    }
    const append = intent === 'appendSystemPrompt'
    const path = append
      ? posix.join(posix.dirname(systemPath), 'append-system-prompt.md')
      : systemPath
    if (harness === 'codex' && append) {
      flags.push('-c', `developer_instructions=${JSON.stringify(text)}`)
      continue
    }
    const flag =
      harness === 'claude-code'
        ? append
          ? '--append-system-prompt-file'
          : '--system-prompt-file'
        : harness === 'pi' || harness === 'prime'
          ? append
            ? '--append-system-prompt'
            : '--system-prompt'
          : harness === 'codex'
            ? '-c'
            : undefined
    if (!flag) throw new Error(`${harness} has no native ${intent} launch projection`)
    files.push({
      relPath: append ? '.tangle/append-system-prompt.md' : '.tangle/system-prompt.md',
      content: text,
      source: 'generated',
    })
    flags.push(flag, harness === 'codex' ? `model_instructions_file=${JSON.stringify(path)}` : path)
  }
  return { files, flags }
}
