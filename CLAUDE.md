# agent-runtime

Shared task-lifecycle skeleton for domain agents, generated agents, red-team harnesses, and coding agents. Standardizes the lifecycle (`runAgentTask`, `runAgentTaskStream`); delegates domain behavior to adapters.

Imports `@tangle-network/agent-eval` for the control loop, knowledge readiness scoring, and run-record types. Does not own domain policy, models, tools, connectors, or UI.

## Authorship

Do not add `Co-Authored-By:` trailers (or any other AI-attribution lines) to commits, PR descriptions, or other artifacts in this repo. Author = the human running the session. Applies to every contributor, including AI agents and subagents — do not include the default Claude Code template trailer.
