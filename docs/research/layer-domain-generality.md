> **Track:** Architecture (research) · **Role:** layer stress-test · **Status:** n=1 domain — the headline result's biggest validity risk

# Layer: domain generality and product transfer

**The claim under test:** the boundary law ("steering wins on stateful agentic work")
and the +16.4pp depth result generalize beyond EOPS-itsm — across gym domains, across
task families, and ultimately to live products.

## The exposure

Every positive steering result in this program sits on **one domain**: EOPS *itsm*
(ServiceNow ticket ops, SQL-state verifiers). The negatives sit on two stateless domains
(FinSearchComp, HumanEval). So the "boundary law" is interpolated from 3 points, and the
product thesis ("depth wins on ops-like agentic work") rests on n=1 domain, n=1 gym,
n=2 models. The canon's own discipline (eval-substrate: paired stats, honest scoping)
demands this be named: **the law is a hypothesis with one supporting stateful domain.**

## The cheap replication (nearly free)

`gym_dbs.zip` ships **eight** domain splits: itsm, csm, hr, email, drive, calendar,
teams, hybrid — same container, same MCP/verifier machinery, same `Environment`
implementation (`agentic-eops.ts` is domain-blind; only the HF split name changes). A
cross-domain run is a config change:

- **Experiment:** canonical depth-vs-breadth (Supervisor + observe, keep-best) on csm +
  hr at n≥16 each, same model. 
- **Outcomes:** (a) replicates → the law has 3 stateful domains and the product claim
  firms up; (b) fails on one → the boundary is finer than "stateful" (e.g. itsm's
  read-verify-write loops are unusually steerable) and we learn *which* property carries
  the win — either result is decision-grade.

## Stress test (why itsm might be idiosyncratic)

- itsm tasks have **many independent sub-goals** (2–18 SQL verifiers/task) — partial
  credit is dense, so a steer always has a "next unfinished item." Domains with one
  atomic verifier may behave like stateless tasks.
- itsm tools are **read/write symmetric** (every mutation is cheaply checkable by a
  read) — the verify-before-mutate steer is unusually actionable. Email/calendar may
  lack cheap verification reads.
- The gym DB **resets per task** — no long-horizon persistence *across* tasks, so this
  is still short-horizon steering. The long-horizon claim (hours-scale accumulation)
  needs commit0/SWE-class coding domains — currently platform-gated (#984 sandbox
  egress), the honest outer boundary of what's testable today.

## Product transfer (the falsifier the product-value claim wrote down)

The gym is a proxy. The five live products (gtm/tax/legal/creative/agent-builder) are
the target, and `.evolve/eops-steerer-product-claim.md` already names the falsifier:
*"the win doesn't transfer off the gym to a real connector-backed ops agent."* Transfer
is not a bigger gym run — it is the integration question (see
`product-integration-playbook.md`): implement an `Environment` over one product's real
tool surface + a deployable check from its domain (e.g. gtm: a campaign-state check;
tax: a return-validation check), and run the same gate. That is the experiment that
converts this research program into product value, and nothing in the current evidence
shortcuts it.

## Order of operations

1. csm + hr replication (config-change cheap, decision-grade either way).
2. The (correct,$,ms) vector on those runs (free, per layer-economics).
3. One product `Environment` (gtm first — richest tool surface, live traces flowing) —
   the bridge experiment, scoped in the playbook.
4. commit0/SWE long-horizon — parked on #984; revisit when the platform unblocks.
