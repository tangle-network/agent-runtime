---
name: profile-authoring
description: Author AgentProfiles that start on first spawn and deliver checked work, new or continued.
---

# Profile authoring

A profile is right when its agent starts, delivers what its brief names, and the result survives the people it is for.
Before every spawn, read "A profile that starts" and "A brief that delivers". Before a run that matters, read sections 1 to 9 as well.
Before a new or changed profile, name the observed reason and the result that would reverse the choice.
Do not constrain agents with prohibitions: change what is rewarded and who is in the room, so the honest path pays.

## A profile that starts

A refused profile fails before its first model turn, and it fails the same way on every retry.
On 2026-10-10 Discovery lost 20 driver attempts to unpublished tool names and 3 spawns to a missing subscription source.
Start from a profile that already ran (in a Discovery play, `inputs/profile-examples/<family>.json`) and change only `name`, `description` and `prompt.instructions`.

| Field | Rule |
|---|---|
| `harness`, `model.provider`, `model.default` | A triple the harness serves and the run admits in `allowedModels`. A vendor harness runs only its vendor's models. Discovery plays: `opencode` + `zai-coding-plan` + `glm-5.3`; `claude-code` + `anthropic` + `claude-opus-5-5`; `codex` + `openai` + `gpt-6.1-sol`. |
| `model.metadata.credentialSource` | Always explicit: `"subscription"` runs on a seat. An omitted source means managed API credit, and a subscription-only run refuses that spawn before spend. |
| `tools`, native | Only the ids in the harness table below. |
| `tools`, Runtime | `agent_runtime_coordination_<verb>: true`, exactly that prefix, with underscores. |
| `prompt` | The role in `instructions[0]`, the procedure after it. No `systemPrompt`: it replaces the harness's own guidance (17,730 characters on Codex), and Discovery refuses one under 4,000 characters. No `appendSystemPrompt` on Codex or Gemini. |
| `resources` | `failOnError: true`. Hand each file by path, `{"path": "<mount>", "resource": {"kind": "inline", "name": "<name>", "path": "<file in your workspace>"}}`: Runtime reads the bytes (UTF-8, at most 4 MiB). Never retype a file into `content`: a manager that did delivered 5 wrong characters in 24,008. |

Native tool ids (agent-container `packages/agent-profile-materialize/src/control-maps.ts` and `execution-controls.ts`; matching ignores case and all but letters, digits and `_`):

| Harness | Accepted | Refused |
|---|---|---|
| opencode | read, write, edit, apply_patch (or patch), bash, glob, grep, webfetch, websearch, todowrite, skill, question, codesearch; the tool key `"task": true` turns native subagents on (`"task": false` turns them off) | list, ls, find, lsp, any other name |
| claude-code | Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch, TodoWrite, NotebookEdit, Skill, AskUserQuestion; Agent, Task and TaskOutput when the profile wants native subagents | any other name, every `mcp__` name included |
| codex | `web_search` (true or false); `web_fetch` only as false | every other key, and any `permissions` entry |
| pi | names in Pi's own registry: read, bash, edit, write (glob becomes find, shell becomes bash); a named tool Pi lacks ends the session | names Pi lacks |
| any other | no `tools` and no `permissions` | every entry |

A harness's own subagent runs outside Runtime: no journal row, no reservation from the shared budget, no grade. Turn native subagents on when the agent needs internal throughput (split and merge, maker and critic, best of N) and separate Runtime identity, budget and grading are unnecessary; their work counts only through the delivered artifact. Use Runtime spawn (`agent_runtime_coordination_spawn_worker`) when a child needs its own record, budget or check. agent-dev-container maps these tools in `packages/agent-profile-materialize/src/control-maps.ts`.

Runtime keys (agent-runtime `src/runtime/supervise/provider-visible-profile.ts`; verbs from `coordinationVerbNames` in `src/mcp/tools/coordination.ts`):

- Runtime removes every key that starts with `agent_runtime_coordination_` before the harness sees the profile. Any other spelling reaches the harness and is refused: a bare `knowledge_record`, OpenCode's `agent-runtime-coordination_spawn_worker`, Claude Code's `mcp__agent-runtime-coordination__spawn_worker`, or `agent_runtime_spawn_worker`.
- Verbs: `spawn_worker`, `cancel_worker`, `observe_agent`, `steer_agent`, `read_journal`, `submit_result`, `report_blocked`, `ask_parent`, `list_questions`, `answer_question`, `read_continuation`, `stop`, `list_analysts`, `run_analyst`, `define_analyst`, `run_graph`.
- A run's tool provider adds product verbs under the same prefix; Discovery serves `knowledge_read`, `knowledge_search`, `knowledge_resolve` and `knowledge_record`. A declared verb no provider serves fails when the run resolves its tools.
- `await_event` no longer exists; a profile that grants it is refused.

Leaf or manager is decided by the keys you write (`withInheritedSpawnRights`, `src/runtime/supervise/supervise.ts`).
A child whose profile names any `agent_runtime_coordination_` key gets exactly those keys.
A child that names none, under a parent that can spawn, inherits the parent's coordination verbs (`spawn_worker` included) and `submit_result`, but no product verbs, so it cannot write Knowledge pages.
So always write them. A leaf gets the product verbs it uses, `submit_result` and `report_blocked`.
A manager adds `agent_runtime_coordination_spawn_worker: true` and only the observation and steering verbs it will use, and carries this skill byte for byte: `"skills": [{"kind": "inline", "name": "profile-authoring", "path": "<this file in your workspace>"}]` beside `resources.failOnError: true`.

A leaf that starts on OpenCode:

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

Before a large run, compare the materialization receipt and served tool list with what you wrote; a mounted skill or listed tool proves only availability.
Keep credential values out of profiles, tasks, resources and journals.

## A brief that delivers

The spawn's assignment carries the work; the profile carries the role.
Every assignment names four things: the exact page path and format to record, with one literal example line; the command that checks the part; what to do when blocked; and when to check in.
Hand every file the child judges by path, never a summary.
A spawn's `deadlineMs` is a check-in, not a kill: the child is told to record its state and submit what it has, and is stopped only if it then makes no progress. Set it from the work.
A manager waits by ending its turn: Runtime wakes it with each settlement, finding or message, and with a notice before its deadline. Polling or a shell timer is not re-entry and spends turns. Ending a turn with work open is not completion; a manager with a check ends on an accepted `submit_result` or a bound.
A nested manager that returns early can end its scope and cancel live descendants.
Require each child to record partial work where its parent can recover it after an interruption.
Before retrying a failed child, read what it recorded; finished work may be usable. A retry names the specific failure in a new profile.
A spawn that returned a transport error may still have started a child: observe before spawning again.

## 1. Name the audience and its acceptance test

Name the audience and the decision the result supports: a paper's referees, a repository's maintainers, a paying customer, a domain expert.
Quote its acceptance test from the source, word for word, with its location, standing assumptions, exclusions and nondegeneracy conditions; a transcription drops them.
List the outcome classes the audience distinguishes: new, known, partial, conditional, reproduced null, stopped unverified, invalid, unassessed. Never reduce them to solved and unsolved.
Make a literature search part of acceptance, and record an answer already published as known.

## 2. Probe the proxy's gap before launch

The proxy is the check you can run during the work: an exact checker, a test suite, a rater or a demo. The gap is everything it accepts and the audience rejects; hacks live there, and a stronger model does not close it.
Try to make the proxy accept what the audience rejects: plant trivial and excluded cases, a published answer, a degenerate artifact, an impossible variant, a stale comparator. Each must be refused or classed as known; if one passes, fix the proxy or narrow the claim.
Probe the other side too: run the proxy on one correct result in a format the brief allows but its author did not expect. A proxy that refuses it trains agents on format, not substance.
Use exact or interval arithmetic, and count only what is proven.
An LLM judge becomes a gate only after it beats an always-reject baseline on cases a human graded.

## 3. Keep acceptance out of the reward loop

Give agents a development check they can run; hiding every check also blocks honest work.
Hold back a stricter acceptance check, run from the delivered packet in a fresh environment by a party outside the authoring lineage; grade only what its rerun reproduces.
Record any root-authored boundary or comparison claim in Knowledge before a child sees it, so the blind check compares the same statement.
A parent that promotes children on proxy passes alone selects for the gap; have the referee attack a result before anyone builds on it.
Keep the headline gate fixed for the whole task; report a stricter bar as a second line.
For a customer commission the bar is the first deliverable: the root's first milestone writes 50 to 100 checkable expectations, the deliverable spec and a workplan; a partner outside the authoring lineage raises the bar against named exemplars and holds part back.

## 4. Choose roles and a model for each

Proposers: cheap, high-throughput models where an exact checker exists, with an occasional strong model.
Referee: a skeptic from another model family, holding the artifact and its own instrument (exact recomputation, execution, a literature search, an attempted counter-case). It can reject a claim; only the held-back check accepts one. A change of family alone is weak.
Monitor: reads the journal and live notes, flags drift or proxy gaming, and steers or reports; it never scores.
Choose each model from measured cost and quality on this kind of work, state its dollars, and admit it in `allowedModels`; Runtime refuses any other at spawn.
Spawn a helper only for work that is independent, long enough to repay a cold start, and checkable on its own.

## 5. Define success, the honest null, and the stop

Success is an accepted result or a reproduced null. Separate execution settlement, development progress and final acceptance; an unknown outside verdict is not absent progress.
A null from a search counts only with a coverage certificate: the searched space as data (ranges, method, seeds, bound reached), one row per cell, a calibration cell with objects the search must find, and the reproducer's sha256.
The reproducer belongs to the check: registered before launch with its hash, the statements it covers and its own calibration; agents may run it and never write it.
The outside check reruns its own copy: the calibration first, crediting nothing on a miss, then cells until its budget ends; one mismatched row refuses the certificate, and only rerun, matched cells earn credit.
A null that is no search (a spec conflict, a gap list) counts when the held-back check reproduces each named item. A null without a certificate is "stopped, unverified"; one inside a range already covered adds nothing.
Tell agents the checker may be wrong; credit a reproduced checker-defect report like a result.
Grant `submit_result` only where Runtime gives the node a check; otherwise its settlement stays unassessed, and a child returning no structured validity verdict stays unresolved in the parent's comparison.
Match completion instructions to the tools served to each node. List every harness tool a child needs in `tools`, defaults included: a harness honoring a map of coordination tools alone serves nothing else. A revision states why it drops any tool its source profile listed.
State the stop: what the agent does the moment its check passes, and that work after a pass spends seats and adds nothing.
For continued research, read the installed continuation contract first and choose `maxBarren` from the measured feedback cadence.

## 6. Carry known traps

Write each trap as what the held-back acceptance refuses, never as what the proxy passes: "the outside check does not count a c = 0 instance" is a trap; "the checker passed c = 0 claims" is a recipe. Give the rule, not the incident: the operator owns the stack.
Typical traps beyond the gap probe's canaries: wrong-field comparators, tests versus users, a demo versus a customer, a rater versus an expert.
A profile that imitates a person (an operator, a reviewer, a voice) is not accepted on checks written from its own rules; those measure obedience. The held-back acceptance is the person's own next action on held-out turns, scored against a control arm, a blind judge, and the best predictor that uses no persona at all. Matching the person's voice does not establish matching their judgment.
Record each new trap where the next author reads it, in the same change as its fix.

## 7. Set budget and caps

Hard limits live in Runtime options and per-assignment budgets: `budget`, `workerSlots`, `maxDepth`, `allowedModels`, `continuation`. Prompt text enforces no limit.
`maxTokens` is settled after the work: an overspent child keeps its output and carries a `budgetViolation`. A child's total counts input tokens on every turn, so reserve turns times context.
For subscriptions, keep the token, iteration, time and compute bounds the installed path enforces. An unmeasured dollar cost stays unknown; an unsupported dollar cap is not protection.

## 8. Register arms, a control and outcomes

Before launch, register the claim, the arms, the outcome measures, the useful-effect threshold and the result that would refute it.
Run each ingredient you want to credit against a control without it: the referee, the credited exit, live notes, the wording.
Report reviewed-claim precision, canary pass rate, how many proxy passes the audience accepts, and the cost per accepted result.

## 9. Record what makes a hack visible

Record the authored profile, the effective profile after composition, and the materialization receipt with each mounted file's sha256. Distinguish declared, delivered, accessed and applied capabilities.
Prove recursion through actual child-to-grandchild edges, and group retries of one assignment into one lineage.
Keep dated live notes that separate observation from inference and name the next check; they coordinate and support an audit, and are never scored.
Record the termination cause apart from the research outcome. Keep unknown cost, output and state unknown, never zero or success.
When mounted, `references/research-directors.md`, `references/execution-and-credentials.md` and `references/acceptance-examples.md` give the worked detail.

## Checklist

Store this with the registration before launch.

```text
Starts: harness/provider/model triple, credentialSource, native tool ids, coordination keys (leaf or manager), no systemPrompt, failOnError, files by path:
Assignment: page paths and literal example, part check command, blocked rule, check-in:
Audience, decision and quoted acceptance test with exclusions:
Outcome classes:
Proxy, who sees it; gap probe (canaries refused, correct variants accepted):
Held-back acceptance: who runs it, where, from what:
Roles and models with dollars: proposers, referee and instrument, monitor:
Null certificate and registered reproducer:
Stop: check, what happens on a pass, continuation, deadline, maxBarren, budget, cancellation:
Known traps handed to agents:
Arms, control, measures, threshold, refuting result:
Records that expose a hack, and unavailable observations:
```

## Then consider

- `supervise` to drive the tree once its profiles exist.
- `eval-engineering` when a judge or checker has no calibration yet.
- `pursue` when the claim compares arms.
