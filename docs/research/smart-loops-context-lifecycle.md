# Smart loops over dumb loops: multi-agent topology as distributed context management

**Status:** thesis + research program. 2026-06-26.

## The reframe

Marginal results from naive multi-agent A/Bs (e.g. our two-agent research loop, the
Autodata fold) are **not** evidence that topology has no value. They are evidence we
measured in the wrong regime — the same failure mode that produced the Autodata
"null" (an extractive task + a memorized doc, not "the loop doesn't work").

Agent capability is, at bottom, a **context-management and knowledge problem**. The
finite context window is the binding constraint; output quality rots as it fills. The
value of a multi-agent topology is **latent**, and it is unlocked by exactly one
competency we have not yet built: **expert management of the context lifecycle.**

## What Ralph actually is (the correction)

Ralph is **not** a steered agent driven across many turns. Ralph is **respawn-from-zero**:

```
while :; do   fresh_agent( read TRACKING_DOCS )  →  do ONE thing  →  update TRACKING_DOCS   ; done
```

Each iteration is a **new agent with a clean context window**, handed a directive to
read and update external tracking documents (the spec, `@fix_plan.md`, progress,
checklists). The intelligence and the memory live in the **documents**, not in any
agent's context. Ralph never lets a context window fill; it sidesteps context
exhaustion entirely, which is why its task horizon is effectively unbounded. The loop
is dumb; the **externalized state** carries the work, and the agent is ephemeral and
disposable.

This is the part people miss: steering one agent across many turns fills its context
and degrades it; respawning a fresh agent against external state does not.

## The thesis: do this, but smart

Achieve the same property — **fresh-context continuation via externalized tracking** —
but with **smart multi-agent loops** whose supervisors, drivers, sub-agents, and
sub-loops are **experts at the context lifecycle**:

- **Close a chapter.** When a phase/sub-task completes — or context approaches its
  degradation band — checkpoint progress into the tracking documents, settle the
  sub-loop, and distill what the *next* chapter actually needs (not the raw transcript).
- **Open a new chapter.** Spawn a **fresh** sub-agent / sub-loop with a **clean**
  context window plus the tracking docs, and continue. The new chapter inherits
  *state*, not context-rot.
- **Recurse and distribute.** A supervisor manages drivers; a driver manages sub-loops;
  each manages its own context lifecycle. Workflows of workflows, loops of loops, run
  across multi-agent distributed infrastructure.

A dumb Ralph respawns blindly and re-derives everything from scratch each time. A smart
loop **decides**: what to carry forward, what to summarize, when to close and open,
which chapters can run in parallel, and which agent profile fits each chapter. That
decisioning **is** the multi-agent topology earning its keep — and it is exactly what a
single steered agent (context fills) and a dumb bash loop (blind respawn) cannot do.

## Localize dynamic workflows and loops

Dynamic workflows and loops should be a **first-class, local, recursive primitive** any
supervisor or driver can spawn — a sub-workflow / sub-loop materialized in-place,
managing its own context lifecycle, and itself able to spawn more. This is what Claude
Code does natively (subagents, the Task tool, context compaction at the boundary). We
build the **distributed** version: dynamic workflows OF dynamic workflows and loops,
leveraging the harness features natively AND multi-agent distributed infrastructure to
run the agents over them.

## We already own the substrate — the gap is the policy

| Need | We already have |
|---|---|
| externalized, replayable tracking state | `Scope`/`Supervisor` **journal** (append-only, replay/resume) |
| cross-chapter / cross-run memory | the **`Corpus`** primitive |
| the tracking/knowledge documents themselves | **agent-knowledge** (the KB *is* the external memory) |
| a chapter-close (distilled transfer brief) | the **`handoff`** skill; harness **context compaction** |
| workflows of workflows (recursion) | the recursive atom — `spawnChild` = worker OR sub-driver |

What is **missing is not substrate** — it is the **context-lifecycle policy**: the
supervisor/driver intelligence that decides *when* and *how* to close/open chapters,
*what* to distill, and *how* to route. That policy is the research.

## The research program — find where it works

The question is **not** "does multi-agent beat single-agent." It is:

> **What context-lifecycle policy, on what domain, with what prompts, with what agent
> profiles, makes the smart loop beat BOTH dumb-Ralph respawn AND a single steered
> agent?**

The search space — the configurations we must find the working settings of:

1. **Configurations** — chapter-close trigger (token threshold / task boundary / a
   "stuck" signal); what to distill (checklist vs summary vs structured state);
   carry-forward policy; parallel-chapter fan-out; recursion depth; how much the
   supervisor steers vs respawns.
2. **Domains** — where externalized-state-with-fresh-context beats steering: long-horizon
   greenfield build, research/knowledge accumulation, large migrations, broad audits —
   and where it does **not** (a task that fits one context window will tie; the
   constraint never bites).
3. **Prompts** — the chapter-open directive (how a fresh agent is told to read state and
   do one thing), the chapter-close directive (how to distill), and the supervisor's
   lifecycle-decision prompt.
4. **Agent profiles** — the right profile per chapter (research / build / verify), and the
   supervisor profile that is itself an expert at the lifecycle.

**Method** (using the discipline this repo already enforces): *calibrate first* — prove
the metric discriminates a good context-lifecycle policy from a bad one, and that the
test is in the regime where context exhaustion is the binding constraint. Then A/B at
equal compute: **single-steered** vs **dumb-Ralph-respawn** vs **smart-chapter-managed**,
on a **long-horizon** domain. A short task that fits one context window will tie — the
same way our extractive ML questions tied — so the domain choice is the experiment.

## The non-negotiable

Do **not** collapse this into a dumb single-agent or dumb-loop pattern because an early
A/B was marginal. A marginal result on a task that fit in one context window means the
**context constraint was not active** — not that the topology is worthless. The
reductive instinct ("it's unproven, simplify it away") deletes the exact thing that
will work once the lifecycle competency is built. **Hold the thesis; find the regime
where it bites; build the policy.** (Encoded as the `dont-collapse-the-architecture` skill.)
