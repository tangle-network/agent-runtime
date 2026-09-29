---
name: profile-authoring
description: Author an AgentProfile from its audience's acceptance test, a probed proxy gap, and a control.
---

# Profile authoring

Use this before a run that matters, and before you author an agent that another agent spawns.
A profile is right when its result survives the people the result is for.
Do not constrain agents with prohibitions.
Change what is rewarded and who is in the room, so the honest path is the path that pays.

Every open problem has three parts.
The audience accepts or rejects the result: a paper's authors and referees, a repository's maintainers, a paying customer, or a domain expert.
The proxy is the check you can run during the work: an exact checker, a test suite, a rater, or a demo.
The gap is everything the proxy accepts and the audience rejects.
Hacks live in the gap, and a stronger model does not close it.

## 1. Name the audience and its acceptance test

Name the audience and the decision the result supports.
Quote the acceptance test from its source, word for word, with its location.
Include standing assumptions, exclusions and nondegeneracy conditions; a transcription drops them.
List the outcome classes the audience distinguishes: new, known, partial, conditional, reproduced null, stopped unverified, invalid, unassessed.
Never reduce them to solved and unsolved.
Make a literature search part of acceptance, and record an answer already published as known.

## 2. Probe the proxy's gap before launch

Try to make the proxy accept something the audience rejects.
Plant canaries: the source's trivial and excluded cases, a published answer, a degenerate artifact, an impossible variant, a stale comparator.
The proxy must refuse each canary or class it as known.
Record the probe, its inputs and its verdicts with the registration.
If a canary passes, fix the proxy or narrow the claim; do not launch into a known gap.
Use exact or interval arithmetic, and count only what is proven.
An LLM judge becomes a gate only after it beats an always-reject baseline on cases a human graded.

## 3. Keep acceptance out of the reward loop

Give agents a development check they can run; hiding every check also blocks honest work.
Hold back the acceptance check.
It is a stricter superset, run from the delivered packet in a fresh environment, by a party outside the authoring lineage.
Grade only outputs that the rerun reproduces.
A parent that promotes children on proxy passes alone selects for the gap; have the referee attack a result before anyone builds on it.
Keep the headline gate fixed for the whole task; report a stricter bar as a second line.

## 4. Choose roles and a model for each

Proposers: cheap, high-throughput models where an exact checker exists, with an occasional strong model.
Referee: a skeptic from another model family, holding the artifact itself and its own instrument.
An instrument is exact recomputation, execution, a literature search, or an attempt to build a counter-case.
A change of family alone is weak, because models share many errors.
A referee can reject a claim; only the held-back check accepts one.
Monitor: reads the journal and live notes during the run, flags drift or proxy gaming, and steers or reports; it never scores.
Choose each model from measured cost and quality on this kind of work, and state its dollars.
Admit the referee's model in `allowedModels`; Runtime refuses a model outside that list at spawn.
Hand every role the files it judges by path, never a summary.

## 5. Define success, the honest null, and the stop

Success is an accepted result or a reproduced null.
A null may end a run.
It counts as success only when a party outside the run reproduces what it claims to have covered.
A null from a search carries a coverage certificate:

- the searched space as data: the parameter ranges, the enumeration or sampling method with its seeds, and the bound reached;
- one row per cell of that space, with what the cell searched and found;
- a calibration cell where the search must find objects that exist, with the source's reason;
- the sha256 of the reproducer that printed the rows.

The reproducer belongs to the check, not to the run.
Register it before launch with its sha256, the statements it covers, and its own calibration: cells with the source's results, and a canary where the predicate certified as zero must fire.
Agents may run it; they never write it.
The outside check reruns its own copy, never code from the run: a script can print the recorded rows.
Its copy's hash must equal the registered hash and the certificate's.
It reruns the registered calibration first and credits nothing on a miss: a reproducer that searches nothing reproduces an empty row too.
Then it reruns the certificate's calibration cells and the cells that would be new, until its budget ends.
The pass rule is fixed: each rerun row equals the recorded row, field for field, and one mismatch refuses the certificate.
Credit only the cells that the check reran and matched; a sample can refuse a certificate, never extend credit.
A null that is no search, such as a spec conflict or a gap list, names each item with evidence; it counts when the held-back check reproduces each.
A null without a certificate, or without a registered reproducer, is recorded as "stopped, unverified", never as success.
A null inside a range the source checked or an earlier reproduced null covered adds nothing.
Tell agents the checker may be wrong; credit a checker-defect report the same way, once someone outside the run reproduces the defect.

Separate execution settlement, development progress, and final acceptance.
An unknown outside verdict does not establish absent research progress.
Match completion instructions to the tools actually served to that node.
Require `submit_result` only when its grant and checker exist.
Keep unassessed results unassessed when the execution contract permits settlement without acceptance.

For continued research, inspect the installed Runtime deliverable and continuation contracts before choosing bounds.
Use the existing `checkState` interface for calibrated development measurements when applicable.
Probe useful progress and unchanged or invalid artifacts before relying on the measurement.
An always-false acceptance placeholder alone cannot distinguish useful work from stagnation.
Preserve genuine no-progress limits, deadlines, budgets, and cancellation.
Choose `maxBarren` from the task's measured feedback cadence; pending assessment does not justify a universally low value.

Retain certificates and partial work where the outside assessor can read exact bytes.
A certificate becomes accepted only through the registered outside check.
Record the actual termination cause separately from the research outcome.
State the continuation policy and available completion path in the immutable input.
A source merge proves no change to an installed or running process.

## 6. Carry known traps

Hand agents the domain's known traps as rules, not stories.
Write each trap as what the held-back acceptance refuses, never as what the proxy passes.
"The outside check does not count a c = 0 instance" is a trap; "the checker passed c = 0 claims" is a recipe.
Examples: excluded or trivial cases, stale or wrong-field comparators, published answers, tests versus users, a demo versus a customer, a rater versus an expert.
Keep infrastructure incidents out of the brief; the operator owns the stack.
Record each new trap where the next author reads it, in the same change as its fix.

## 7. Set budget and caps

Hard limits live in Runtime options and per-assignment budgets: `budget`, `workerSlots`, `maxDepth`, `allowedModels`, `continuation`.
Prompt text enforces no limit.
`maxTokens` is settled after the work: an overspent child keeps its output and carries a `budgetViolation`.
A child's total counts input tokens on every turn, so reserve turns times context.
Give each paid job its own named key with a dollar cap, and state the dollars before launch.

## 8. Register arms, a control and outcomes

Before launch, register the claim, the arms, the outcome measures, the useful-effect threshold, and the result that would refute the claim.
Run each ingredient you want to credit against a control without it: the referee, the credited exit, live notes, the wording.
Count precision after review, not claim volume.
Report reviewed-claim precision, canary pass rate, how many proxy passes the audience accepts, and the cost per accepted result.

## 9. Record what makes a hack visible

Record the authored profile, the task and the materialization receipt, with each mounted file's sha256.
Record every proxy verdict, the held-back verdict, and the referee's instrument and attempts.
Record each claim with its artifact, the quoted statement it answers and its outcome class.
Keep dated live notes that separate observation from inference and name the next check.
Live notes coordinate the team and support an audit; they never certify honesty, so never score them.
Keep unknown cost, output and state unknown; never record them as zero or success.

## Write the profile

Before a new or changed profile, name the observed reason and the result that would reverse the choice.
Before you retry a null or failed child, inspect its recorded artifacts; finished work may be usable.
A profile with no Runtime coordination tool is a leaf; any coordination tool makes it a managed node.
`agent_runtime_coordination_spawn_worker: true` grants Runtime spawning; names, metadata and role labels grant nothing.
Prove recursive execution through actual child-to-grandchild edges.
Record harness-native children separately from Runtime children.
Group retries of the same assignment into one lineage when comparing teams.
Grant `submit_result` only when Runtime gives that node an independent check; otherwise its settlement stays unassessed.
Grant only the observation, steering and journal tools that the assignment needs.
Set `harness`, `model.default` and `model.provider` explicitly, and validate against the current `agentProfileSchema`.
A tool name must be one the harness publishes, and a refused name fails the same way on retry.
`ls`, `list` and `find` are not tool names; select paths with a glob tool and search contents with a grep tool.
Inspect materialized permissions and served tools before relying on a restriction.
Distinguish exact Runtime grants from harness-native defaults, which may expose additional tools.
Keep file access within the actual permission boundary.
Use the execution owner's supported cancellation and recovery procedures for a wedged parent.
Compare Runtime's materialization receipt and served tool set with what you authored before a large run.

Hand a file by path in `resources.files`, and compare the returned sha256 with your source:

```json
{"path":"input.txt","resource":{"kind":"inline","name":"input","path":"inputs/input.txt"}}
```

The outer `path` is the child's mount; the nested `resource.path` is a UTF-8 source file in your workspace, under 4 MiB.
Every profile that can spawn carries this complete skill as an immutable inline `resources.skills` entry, with `resources.failOnError: true`.
Copy the mounted bytes; never retype them.

## Checklist

Fill this in and store it with the registration before launch.

```text
Audience and decision:
Acceptance test, quoted, with location and exclusions:
Outcome classes:
Proxy (in-run check) and who sees it:
Gap probe: canaries, verdicts, date:
Held-back acceptance: who runs it, where, from what:
Proposers: models, dollars:
Referee: family, instrument, dollars:
Monitor: model, what it may steer:
Null certificate: space, rows, calibration; registered reproducer, sha256, source calibration; who reruns it, budget:
Credited exit, in the agents' words:
Served completion tools and observed materialization:
Development progress measurement, calibration, and feedback cadence:
Stop: installed check/continuation policy, deadline, maxBarren, budget, cancellation:
Known traps handed to agents:
Budget, caps, key and its dollar cap:
Arms, control, measures, threshold, refuting result:
Records that expose a hack:
```

## Examples

For acceptance gaps and null certificates, read [acceptance examples](references/acceptance-examples.md).
The core instructions above are complete when only this file is mounted.
Mount the reference as well when the assignment needs its worked examples.

## Then consider

- `supervise` to drive the tree once its profiles exist.
- `calibrate-before-measure` when a judge or checker has no calibration yet.
- `arena-experiment` when the claim compares arms.
