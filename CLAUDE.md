# agent-runtime

Shared task-lifecycle skeleton for domain agents, generated agents, red-team harnesses, and coding agents. Standardizes the lifecycle (`runAgentTask`, `runAgentTaskStream`); delegates domain behavior to adapters.

Imports `@tangle-network/agent-eval` for the control loop, knowledge readiness scoring, and run-record types. Does not own domain policy, models, tools, connectors, or UI.

## Repo layering — this package depends on agent-eval, never the reverse

```
agent-knowledge ─┐
                 ├──► agent-eval (substrate — the bottom)
agent-runtime ───┘   (this repo — wraps the substrate)
```

**Rule: agent-runtime depends on agent-eval. agent-eval MUST NOT import from agent-runtime.** No upward imports, no `peerDependencies` declaration in agent-eval pointing at agent-runtime, no `import type { X } from '@tangle-network/agent-runtime'` inside agent-eval. If reviewers spot one, it's a bug — file an issue and move the type into agent-eval where it belongs.

Substrate primitives that this repo CONSUMES from agent-eval:
- `DefaultVerdict` — validator-output shape (`@tangle-network/agent-eval`)
- `RunRecord` — canonical run-record type
- `AgentEvalError` + the error taxonomy
- `AnalystFinding`, `AnalystRunResult`, `FindingsDiff` — analyst types
- `TraceAnalystKindSpec`, `KnowledgeReadinessReport`

Types that stay in THIS repo because they're runtime-shaped:
- `Validator<Output, Verdict>` interface (coupled to `ValidationCtx`: iteration, signal, traceEmitter)
- `AgentRunSpec`, `OutputAdapter`, `Driver`, `LoopResult` — coupled to the sandbox loop
- `RuntimeRunHandle` — execution-context shape

**The test for "where does a type live?"** — does this concept make sense WITHOUT a running agent loop? If yes, it's substrate (belongs in agent-eval). If no, it's runtime (belongs here). When in doubt, lean substrate.

## Authorship

Do not add `Co-Authored-By:` trailers (or any other AI-attribution lines) to commits, PR descriptions, or other artifacts in this repo. Author = the human running the session. Applies to every contributor, including AI agents and subagents — do not include the default Claude Code template trailer.

## Comment & doc discipline (no historical narrative)

Comments describe **what the code does and why** — never what it used to do, what it replaced, which audit found a bug, or what the prior version looked like. History belongs in commit messages and PR descriptions, not the source tree.

- Bad: `// replaces the inline retry loop`, `// fix for the silent-zero bug`, `// the 2yr rewrite added this`, `// audit fix`
- Good: `// value: null when retries exhaust — callers must inspect succeeded`

Applies to docstrings, README sections, SKILL.md, AGENTS.md, CLAUDE.md — anywhere the source tree carries prose.

## No fallbacks. Fail loud.

Sloppy fallbacks corrupt every signal downstream. No silent zeros, no `?? default` on required fields, no `try/catch { return null }` that erases diagnostic info, no legacy back-compat mode defaulted on for new code.

External-boundary calls (LLM, network, FS, subprocess) return *typed outcomes* (`{ succeeded, value, error }`). Callers MUST inspect `succeeded` before using `value`. Named, opted-in fallback rotations (`policy.fallbackModels: [...]`) are fine; deep `?? "kimi"` helpers are not.

Full doctrine: `~/dotfiles/claude/AGENTS.md` → "No fallbacks. Fail loud."

