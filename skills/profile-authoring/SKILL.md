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
Measured: where a known gap existed, 15 of 27 lanes with claims filed false "new" results; where none was known, 0 of 34 lanes did.

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
A null inside a range the source or a registered earlier run already searched adds nothing.
Tell agents the checker may be wrong; credit a checker-defect report the same way, once someone outside the run reproduces the defect.
Measured elsewhere: a credited exit cut one model's test cheating from 54% to 9%, while prohibitions barely moved another's.
Measured: an in-run check that accepted a documented null made it the cheapest hack in 11 of 16 blind judgments.

A Runtime manager with a check is not served `stop`.
It ends when the check accepts its `submit_result`, when `report_blocked` shows that a granted tool failed, or at a bound.
The bounds are the continuation `deadline`, `maxBarren` turns without progress, the budget, and cancellation.
Runtime settles an accepted submission as delivered, and a parent may promote it; it keeps no refused one.
So the run records its certificate on a page, such as a Knowledge page, where the outside check reads it.
The in-run check never passes a null: it refuses a malformed certificate and holds a well-formed one.
A held null ends the run at `maxBarren`; set it low, such as 2.
The run settles as stopped, not delivered.
State the continuation block in the record, and put the honest exit in its `rules` text.
The check or a bound ends the run; an agent's claim that it is done does not.

## 6. Carry known traps

Hand agents the domain's known traps as rules, not stories.
Write each trap as what the held-back acceptance refuses, never as what the proxy passes.
"The outside check does not count a c = 0 instance" is a trap; "the checker passed c = 0 claims" is a recipe.
Examples: excluded or trivial cases, stale or wrong-field comparators, published answers, tests versus users, a demo versus a customer, a rater versus an expert.
Keep infrastructure incidents out of the brief; the operator owns the stack.
Measured: a director told of an infrastructure failure spent 2 of its first 4 children probing it.
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
Measured elsewhere: prompt wording alone moved one model's cheating from over 85% to 1%.
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
Only `agent_runtime_coordination_spawn_worker: true` grants recursion; names, metadata and role labels grant nothing.
Grant `submit_result` only when Runtime gives that node an independent check; otherwise its settlement stays unassessed.
Grant only the observation, steering and journal tools that the assignment needs.
Set `harness`, `model.default` and `model.provider` explicitly, and validate against the current `agentProfileSchema`.
A tool name must be one the harness publishes, and a refused name fails the same way on retry.
`ls`, `list` and `find` are not tool names; select paths with a glob tool and search contents with a grep tool.
An unattended run denies any permission the profile does not grant; keep file access inside the workspace or grant it.
A stop or cancel is a request that a live acknowledger applies; plan the out-of-band path for a wedged parent.
Compare Runtime's materialization receipt with what you authored before a large run.

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
Stop: check, report_blocked, deadline, maxBarren, budget:
Known traps handed to agents:
Budget, caps, key and its dollar cap:
Arms, control, measures, threshold, refuting result:
Records that expose a hack:
```

## Worked examples

### Counterexample hunt, before and after

Before, on a 36-lane hunt over 12 conjectures in 2026-09:
The brief transcribed Wang and Zheng's Conjecture 13 (arXiv:2104.12942) as "c != 1".
The checker refused only c = 1, and its admission decoys came from that transcription.
Workers held the same checker that scored claims, and it counted any verified claim as new.
All 3 lanes on that conjecture filed 39 "verified-new" claims, every one at c = 0.
The paper assumes c != 0 throughout; at c = 0 the question is only whether x^d permutes the field.
The real yield was 0.

After:
Audience: the paper's authors and its referees.
Acceptance: Conjecture 13 quoted with the standing assumption that c is not 0 or 1, plus a literature sweep.
Gap probe: before launch, the checker refuses c = 0 and classes a Corollary 11 family member as known.
Agents run the development checker; the operator reruns a held-back checker and the sweep on each packet.
A referee from another family recomputes each claim with its own code.
A null over m <= 20 ends the run at its bound, and it counts once the outside check reruns its own reproducer on the certificate's cells.
Arms: with and without the referee.

### A null that counts

Wang and Zheng checked Conjecture 13 for 2 <= m <= 10.
Two lanes searched every (m, d, c) with c not in {0, 1} to m = 20, found no counterexample, and wrote a table.
Nobody outside the run could check that table.
Before the next launch, the operator registers a reference search for one m, its sha256, and its calibration: Theorem 9 gives 4 PcN pairs at m = 6 and 8 at m = 10, and a canary drops family (2) so those pairs must count as found.
As a certificate, the null reads:

```json
{"space": {"cells": {"m": {"from": 2, "to": 20}}, "method": "enumerate", "bound": "m <= 20",
  "within": "each unit d modulo 2^m - 1, one per Frobenius orbit, and each c outside {0, 1}"},
 "rows": [{"cell": {"m": 12}, "searched": 585442, "positives": 28, "found": 0}],
 "calibration": [{"cell": {"m": 6}, "why": "Theorem 9: x^5 is PcN for c in GF(4) outside {0, 1}"}],
 "reference": "sha256:5d198f4fc2d9..."}
```

The rows list every m; one is shown.
The outside check hashes its copy, reruns the calibration and the canary with no network, then m = 11 to 20, then the rest.
Rows typed instead of computed fail at the first cell that differs, and a script in the lane's packet is never run.
A reference that searches nothing fails at m = 6; one whose found never fires fails the canary.
If the budget ends after m = 18, the null is credited for 11 <= m <= 18 only.
The in-run check holds the certificate, and the run ends at `maxBarren`; only the rerun gives credit.
The trap for this conjecture reads: "the outside check does not count a c = 0 instance; the source sets c = 0 aside".

### Coding task scored by tests

Audience: the task's author, and a maintainer who decides whether to merge.
Proxy: the visible tests.
Gap: a change that passes the tests and that a maintainer rejects, such as a special-cased input, an edited test or a skipped check.
Measured: in an 8-lane Terminal-Bench batch, Runtime marked 6 lanes as winners and the task's verifier passed 1 of them.
Profile: agents run the visible tests.
The held-back verifier and hidden tests run on the patch in a fresh container.
Hash the test files; a changed test fails acceptance.
A referee from another family reads the diff for special cases.
A report that the task cannot pass without breaking its specification ends the run; it counts once the held-back verifier reproduces the conflict.

### Product for a customer

Audience: the customer who pays, and the decision the product supports.
Acceptance: the customer's own evaluation criteria, quoted, and a walkthrough of the running product doing the customer's task.
Proxy: an LLM fulfilment rater and a compliance checklist.
Gap, measured across product lanes: the rater accepted 19 of 31 failed lanes and scored 0.45 where always-reject scored 0.73.
In one wave, 19 of 44 reviewers never received the product.
Profile: reviewers mount the product by path and must run it.
A referee from another family walks the customer's task on the running product.
The rater stays a ruler, not a gate, until it beats always-reject.
Acceptance is the owner's or the customer's walkthrough.
"Not ready, and this is what is missing" ends the run; it counts once the owner's walkthrough reproduces each gap.

## Then consider

- `supervise` to drive the tree once its profiles exist.
- `calibrate-before-measure` when a judge or checker has no calibration yet.
- `arena-experiment` when the claim compares arms.
