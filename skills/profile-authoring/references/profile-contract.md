# Profile contract

Discovery lost 20 driver attempts to unpublished tool names and 3 spawns to a missing subscription source.
In a Discovery play, start from `inputs/profile-examples/<family>.json`.

## Fields

- Discovery triples: `opencode` + `zai-coding-plan` + `glm-5.3`; `claude-code` + `anthropic` + `claude-opus-5-5`; `codex` + `openai` + `gpt-6.1-sol`.
- A subscription-only run refuses a spawn with no `credentialSource` before spend.
- `prompt.systemPrompt` replaces the harness's own guidance (17,730 characters on Codex), and Discovery refuses one under 4,000 characters.
- A file by path: `{"path": "<mount>", "resource": {"kind": "inline", "name": "<name>", "path": "<file in your workspace>"}}`; Runtime reads the bytes (UTF-8, at most 4 MiB). A manager that retyped a file into `content` delivered 5 wrong characters in 24,008.
- A manager carries this skill as `"skills": [{"kind": "inline", "name": "profile-authoring", "path": "<SKILL.md in your workspace>"}]`.
- A mounted skill or listed tool proves only availability.

## Native tool ids

From agent-container's `agent-profile-materialize` package (`control-maps` and `execution-controls`); matching ignores case and all but letters, digits and `_`.

| Harness | Accepted | Refused |
|---|---|---|
| opencode | read, write, edit, apply_patch (or patch), bash, glob, grep, webfetch, websearch, todowrite, skill, question, codesearch; the tool key `"task": true` turns native subagents on (`"task": false` turns them off) | list, ls, find, lsp, any other name |
| claude-code | Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch, TodoWrite, NotebookEdit, Skill, AskUserQuestion; Agent, Task and TaskOutput when the profile wants native subagents | any other name, every `mcp__` name included |
| codex | `web_search` (true or false); `web_fetch` only as false | every other key, and any `permissions` entry |
| pi | names in Pi's own registry: read, bash, edit, write (glob becomes find, shell becomes bash); a named tool Pi lacks ends the session | names Pi lacks |
| any other | no `tools` and no `permissions` | every entry |

A harness's own subagent runs outside Runtime: no journal row, no reservation from the shared budget, no grade.
Turn native subagents on for internal throughput (split and merge, maker and critic, best of N) when separate Runtime identity, budget and grading are unnecessary; their work counts only through the delivered artifact.

## Runtime keys

Sources: agent-runtime `src/runtime/supervise/provider-visible-profile.ts`; verbs from `coordinationVerbNames` in `src/mcp/tools/coordination-events.ts`; inheritance from `withInheritedSpawnRights` in `src/runtime/supervise/supervise.ts`.

- Runtime removes every key that starts with `agent_runtime_coordination_` before the harness sees the profile. Any other spelling reaches the harness and is refused: a bare `knowledge_record`, OpenCode's `agent-runtime-coordination_spawn_worker`, Claude Code's `mcp__agent-runtime-coordination__spawn_worker`, or `agent_runtime_spawn_worker`.
- Verbs: `spawn_worker`, `cancel_worker`, `observe_agent`, `steer_agent`, `read_journal`, `submit_result`, `report_blocked`, `ask_parent`, `list_questions`, `answer_question`, `read_continuation`, `stop`, `list_analysts`, `run_analyst`, `define_analyst`, `run_graph`.
- A run's tool provider adds product verbs under the same prefix; Discovery serves `knowledge_read`, `knowledge_search`, `knowledge_resolve` and `knowledge_record`. A declared verb no provider serves fails when the run resolves its tools.
- `await_event` no longer exists; a profile that grants it is refused.
- A child that names any coordination key gets exactly those keys; an inheriting child also gets `submit_result`, but cannot write Knowledge pages.

## A leaf that starts on OpenCode

```json
{"name": "csv-edge-case-tester", "description": "Finds RFC 4180 inputs that break csvstat.mjs",
 "harness": "opencode",
 "model": {"provider": "zai-coding-plan", "default": "glm-5.3", "reasoningEffort": "high", "metadata": {"credentialSource": "subscription"}},
 "prompt": {"instructions": ["You are the CSV edge-case tester: you find inputs that break csvstat.mjs.", "Write each case under out/cases/, run it, and record failures at pages/csvstat-cli/work/tester/failures.md.", "Call submit_result with that page path, then end your turn."]},
 "tools": {"read": true, "write": true, "edit": true, "bash": true, "glob": true, "grep": true, "task": false,
   "agent_runtime_coordination_knowledge_read": true, "agent_runtime_coordination_knowledge_record": true,
   "agent_runtime_coordination_submit_result": true, "agent_runtime_coordination_report_blocked": true},
 "permissions": {"bash": "allow", "edit": "allow", "external_directory": "allow"},
 "resources": {"failOnError": true}}
```

## Brief detail

- At `deadlineMs` the child is told to record its state and submit what it has; it is stopped only if it then makes no progress.
- A manager also gets a notice before its deadline. Polling or a shell timer is not re-entry and spends turns.
- A nested manager that returns early can end its scope and cancel live descendants.
- A failed child's recorded work may be usable; a spawn that returned a transport error may still have started a child.
