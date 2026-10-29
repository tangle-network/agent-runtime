import { CODEX_DISABLED_FEATURE_ARGS } from '@tangle-network/agent-profile-materialize'

export const CODEX_EXECUTION_POLICY = {
  sessionPersistence: 'ephemeral',
  userConfig: false,
  rules: false,
  projectInstructions: false,
  skillInstructions: false,
  appInstructions: false,
  toolSuggestions: false,
  multiAgentInstructions: false,
  sandbox: 'workspace-write',
  permissionProfile: 'agent_runtime_reproducible',
  approvalPolicy: 'never',
  shellNetwork: false,
  webSearch: false,
  serviceTier: 'default',
  shellEnvironment: 'core-filtered',
  loginShell: false,
  credentialsReadable: false,
  hostHomeReadable: false,
  procEnvironment: 'private-sanitized',
  sensitiveEnvironmentNamesVisible: false,
  parentRepoRead: false,
  gitMetadata: false,
  temporaryDirectory: 'workspace-private',
  stagedExecutable: 'static-elf-read-only',
  callerReadDeniedPaths: 'enforced',
  containerSockets: false,
} as const

type CodexPolicyValues = {
  -readonly [K in keyof typeof CODEX_EXECUTION_POLICY]: (typeof CODEX_EXECUTION_POLICY)[K]
}

/** Mutable public contract derived from the single enforced policy value. */
export interface CodexExecutionPolicy extends CodexPolicyValues {}

export const CODEX_REPRODUCIBLE_ARGS = [
  ...CODEX_DISABLED_FEATURE_ARGS,
  '--ephemeral',
  '--ignore-rules',
  '--json',
  '-c',
  'approval_policy="never"',
  '-c',
  'web_search="disabled"',
  '-c',
  'project_doc_max_bytes=0',
  '-c',
  'skills.include_instructions=false',
  '-c',
  'include_apps_instructions=false',
  '--disable',
  'tool_suggest',
  '-c',
  'features.multi_agent_v2.root_agent_usage_hint_text=""',
  '-c',
  'features.multi_agent_v2.subagent_usage_hint_text=""',
  '-c',
  'features.multi_agent_v2.multi_agent_mode_hint_text=""',
  '--strict-config',
] as const

export const CODEX_PERMISSION_PROFILE = 'agent_runtime_reproducible'
