# Acceptance examples

The method detail below expands sections 1 to 9 of the skill. The examples keep historical observations; their counts are not current fleet measurements or defaults.

## Method detail

- Audiences: a paper's referees, a repository's maintainers, a paying customer, a domain expert. A transcription of the acceptance test drops its assumptions; never reduce outcome classes to solved and unsolved. A literature search is part of acceptance.
- Hacks live in the proxy's gap, and a stronger model does not close it. Canaries include a stale comparator. A proxy that refuses a correct result in an unexpected format trains agents on format, not substance. Use exact or interval arithmetic and count only what is proven.
- Hiding every check also blocks honest work. Grade only what the outside rerun reproduces; record root-authored claims first so the blind check compares the same statement. A parent that promotes children on proxy passes alone selects for the gap: have the referee attack a result before anyone builds on it.
- For a customer commission the bar is the first deliverable: the root's first milestone writes 50 to 100 checkable expectations, the deliverable spec and a workplan; a partner outside the authoring lineage raises the bar against named exemplars and holds part back.
- Proposers get an occasional strong model. The referee's instrument is exact recomputation, execution, a literature search or an attempted counter-case; a change of family alone is weak. Runtime refuses an unadmitted model at spawn.
- Separate execution settlement, development progress and final acceptance. The null certificate lists ranges, method, seeds and bound reached, and its calibration cell holds objects the search must find. The reproducer is registered before launch with its hash, the statements it covers and its own calibration; agents may run it and never write it. The outside check reruns its own copy, the calibration first (crediting nothing on a miss), then cells until its budget ends; one mismatched row refuses the certificate, and only rerun, matched cells earn credit. A null that is no search (a spec conflict, a gap list) counts when the held-back check reproduces each named item; one inside a range already covered adds nothing.
- Tell agents the checker may be wrong; credit a reproduced checker-defect report like a result. A child returning no structured validity verdict stays unresolved in the parent's comparison. A harness honoring a map of coordination tools alone serves nothing else, and a revision states why it drops a tool its source listed. Work after a pass spends seats and adds nothing.
- Traps give the rule, not the incident: the operator owns the stack. Typical ones: wrong-field comparators, tests versus users, a demo versus a customer, a rater versus an expert. A profile that imitates a person is not accepted on checks written from its own rules, which measure obedience: its acceptance is the person's own next action on held-out turns, against a control arm, a blind judge and the best no-persona predictor. Record a new trap in the same change as its fix.
- An overspent child keeps its output and carries a `budgetViolation`; a child's total counts input tokens on every turn, so reserve turns times context. For subscriptions keep the token, iteration, time and compute bounds the installed path enforces; an unmeasured dollar cost stays unknown, and an unsupported dollar cap is not protection.
- Report reviewed-claim precision, canary pass rate, how many proxy passes the audience accepts, and the cost per accepted result. Controls cover the referee, the credited exit, live notes and the wording.
- Distinguish declared, delivered, accessed and applied capabilities; group retries of one assignment into one lineage. Keep dated live notes that separate observation from inference and name the next check; they are never scored. Record the termination cause apart from the research outcome.

## Counterexample hunt, before and after

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

## A null that counts

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
The run retains the certificate and ends under its registered stop policy; only the outside rerun gives credit.
The trap for this conjecture reads: "the outside check does not count a c = 0 instance; the source sets c = 0 aside".

## Coding task scored by tests

Audience: the task's author, and a maintainer who decides whether to merge.
Proxy: the visible tests.
Gap: a change that passes the tests and that a maintainer rejects, such as a special-cased input, an edited test or a skipped check.
Measured: in an 8-lane Terminal-Bench batch, Runtime marked 6 lanes as winners and the task's verifier passed 1 of them.
Profile: agents run the visible tests.
The held-back verifier and hidden tests run on the patch in a fresh container.
Hash the test files; a changed test fails acceptance.
A referee from another family reads the diff for special cases.
A conflict report follows the registered completion and stop policy.
It counts only after the held-back verifier reproduces the conflict.

## Product for a customer

Audience: the customer who pays, and the decision the product supports.
Acceptance: the customer's own evaluation criteria, quoted, and a walkthrough of the running product doing the customer's task.
Proxy: an LLM fulfilment rater and a compliance checklist.
Gap, measured across product lanes: the rater accepted 19 of 31 failed lanes and scored 0.45 where always-reject scored 0.73.
In one wave, 19 of 44 reviewers never received the product.
Profile: reviewers mount the product by path and must run it.
A referee from another family walks the customer's task on the running product.
The rater stays a ruler, not a gate, until it beats always-reject.
Acceptance is the owner's or the customer's walkthrough.
A gap report follows the registered completion and stop policy.
It counts only after the owner's walkthrough reproduces each gap.

## Other historical observations

These observations motivated the original guidance.
Consult their underlying records before reusing their numerical claims.

- Measured: where a known gap existed, 15 of 27 lanes with claims filed false "new" results; where none was known, 0 of 34 lanes did.
- Measured elsewhere: a credited exit cut one model's test cheating from 54% to 9%, while prohibitions barely moved another's.
- Measured: an in-run check that accepted a documented null made it the cheapest hack in 11 of 16 blind judgments.
- Measured: a director told of an infrastructure failure spent 2 of its first 4 children probing it.
- Measured elsewhere: prompt wording alone moved one model's cheating from over 85% to 1%.
