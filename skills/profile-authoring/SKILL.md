---
name: profile-authoring
description: Author AgentProfiles that start on first spawn and deliver checked work, new or continued.
---

# Profile authoring

A profile is right when its agent starts, delivers what its brief names, and the result survives the people it is for.
Before every spawn, follow the first two sections; before a run that matters, sections 1 to 9 as well.
Name the observed reason for a new or changed profile and the result that would reverse it.
Change what is rewarded and who is in the room so the honest path pays; prohibitions barely move agents.

References, mounted by path beside this skill when the work needs them:

- `references/profile-contract.md`: before writing `tools`, a harness, or a first profile; harness tool ids, Runtime verbs, a leaf that starts.
- `references/acceptance-examples.md`: when writing acceptance, a null certificate or traps; worked examples and edge cases.
- `references/research-directors.md`: when authoring or continuing a research director; every director carries it.
- `references/execution-and-credentials.md`: when the assignment includes cloud execution, accounts or persistence.

## A profile that starts

A refused profile fails before its first model turn, the same way on every retry.
Start from a profile that already ran and change only `name`, `description` and `prompt.instructions`.

- `harness`, `model.provider`, `model.default`: a triple the harness serves and `allowedModels` admits; a vendor harness runs only its vendor's models.
- `model.metadata.credentialSource`: always explicit; `"subscription"` runs on a seat, an omitted source means managed API credit.
- `tools`: native ids only from the harness table in the contract reference; Runtime keys as `agent_runtime_coordination_<verb>: true`, exactly that prefix.
- `prompt`: the role in `instructions[0]`, the procedure after it; no `systemPrompt`, and no `appendSystemPrompt` on Codex or Gemini.
- `resources`: `failOnError: true`; hand each file by path and let Runtime read the bytes, never retype it into `content`.

Write coordination keys on every child: one that names none, under a parent that can spawn, inherits spawn rights but no product verbs.
A leaf gets the product verbs it uses, `submit_result` and `report_blocked`.
A manager adds `agent_runtime_coordination_spawn_worker: true`, only the observation and steering verbs it uses, and carries this skill byte for byte as an inline resource with `resources.failOnError: true`.
Use Runtime spawn when a child needs its own record, budget or check; a harness's native subagent has none of them.
Before a large run, compare the materialization receipt and served tool list with what you wrote.
Keep credential values out of profiles, tasks, resources and journals.

## A brief that delivers

The assignment carries the work; the profile carries the role.
Every assignment names the exact page path and format to record, with one literal example line; the command that checks the part; what to do when blocked; and when to check in.
Hand every file the child judges by path, never a summary.
Set `deadlineMs` from the work: it is a check-in, not a kill.
A manager waits by ending its turn; Runtime wakes it with each settlement, finding or message. It ends on an accepted `submit_result` or a bound, never with work open.
Require each child to record partial work where its parent can recover it.
Before retrying a failed child, read what it recorded; a retry names the specific failure in a new profile.
After a transport error on spawn, observe before spawning again.

## 1. Name the audience and its acceptance test

Name the audience and the decision the result supports.
Quote its acceptance test from the source with its location, standing assumptions, exclusions and nondegeneracy conditions.
Keep the outcome classes it distinguishes (new, known, partial, conditional, reproduced null, stopped unverified, invalid, unassessed); a published answer counts as known.

## 2. Probe the proxy's gap before launch

The proxy is the check runnable during the work; its gap is everything it accepts and the audience rejects.
Plant trivial, excluded, published, degenerate and impossible cases: each must be refused or classed as known, or fix the proxy or narrow the claim.
Run it on one correct result in an unexpected allowed format; it must accept.
An LLM judge gates only after it beats always-reject on human-graded cases.

## 3. Keep acceptance out of the reward loop

Give agents a development check, and hold back a stricter acceptance check rerun from the delivered packet in a fresh environment by a party outside the authoring lineage.
Record root-authored claims in Knowledge before a child sees them; keep the headline gate fixed and report a stricter bar as a second line.

## 4. Choose roles and a model for each

Proposers: cheap models where an exact checker exists. Referee: another model family with its own instrument; it can reject, only the held-back check accepts. Monitor: reads the journal, steers or reports, never scores.
Choose each model from measured cost and quality, state its dollars, and admit it in `allowedModels`.
Spawn a helper only for independent, checkable work long enough to repay a cold start.

## 5. Define success, the honest null, and the stop

Success is an accepted result or a reproduced null; an unknown outside verdict is not absent progress.
A search null counts only with a coverage certificate (space as data, one row per cell, a calibration cell, the reproducer's sha256) that the outside check reruns with its own registered reproducer; without one it is "stopped, unverified".
Grant `submit_result` only where Runtime gives the node a check, and list every harness tool a child needs, defaults included.
State what the agent does the moment its check passes; for continued research, read the continuation contract and set `maxBarren` from the measured feedback cadence.

## 6. Carry known traps

Write each trap as what the held-back acceptance refuses, never as what the proxy passes, and record it where the next author reads it.

## 7. Set budget and caps

Limits live in Runtime options and per-assignment budgets (`budget`, `workerSlots`, `maxDepth`, `allowedModels`, `continuation`); prompt text enforces none, and `maxTokens` settles after the work.

## 8. Register arms, a control and outcomes

Before launch, register the claim, arms, measures, useful-effect threshold and refuting result; run each credited ingredient against a control without it.

## 9. Record what makes a hack visible

Record the authored and effective profiles and the materialization receipt with each file's sha256; prove recursion through real child-to-grandchild edges.
Keep unknown cost, output and state unknown, never zero or success.

## Checklist

Store this with the registration before launch.

```text
Starts: triple, credentialSource, tool ids, coordination keys, no systemPrompt, failOnError, files by path:
Assignment: page path and example, check command, blocked rule, check-in:
Audience, decision, quoted acceptance test, outcome classes:
Proxy and gap probe; held-back acceptance (who, where, from what):
Roles and models with dollars; null certificate and reproducer:
Stop, continuation, deadline, maxBarren, budget; traps; arms and control:
```

## Then consider

- `supervise` to drive the tree once its profiles exist.
- `eval-engineering` when a judge or checker has no calibration yet.
- `pursue` when the claim compares arms.
