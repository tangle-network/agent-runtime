# Training: purpose, critical audit, and completion criteria

**Scope:** Runtime main `3505d81e7f85683bc25bbd46a6bcbfdaf9503a71`, including merged
#1287 and #1300; their training, profile optimization, proposal, release, and test paths.
This is a source-level self-audit with executable regressions, not an independent reviewer
approval or an organization-wide production certification. Runtime's [architecture](../architecture.md)
and [benchmark ownership/evidence ladder](../../bench/HARNESS.md) remain authoritative.

## What are we actually building?

The useful product is a system whose retained experience improves outcomes on future work,
not a trainer launcher, a recursive tree, or a collection of evidence types. A concrete
customer promise is: give Tangle a task distribution, an objective, and a resource envelope;
it executes, retains useful improvements, and demonstrates that subsequent work benefits.
The improvements may change instructions, tools, skills, retrieval, routing, organization,
or weights. A weight update has no special entitlement to be the winning mechanism.

The existing ambition is already large: architecture section 0.5 includes complex software,
independently checked research, better learning methods, and transfer of how to learn.
Making that promise larger would not close the current gap. Make it discriminating:
separately establish a better specialist, a more efficient learning procedure, and transfer
to a new project or domain. Do not require all three before the first useful release, and
do not report evidence for one as evidence for the others.

The architecture previously called both across-run improvement and the recursive execution
tree the product. That invites optimizing machinery rather than outcomes. The maintained
architecture now explicitly identifies the tree as the substrate and sections 0.5/9 as the
success criteria. This is a clarification of the existing ambition, not a new framework.

## Findings and decisions

### 1. The training receipt recorded the wrong execution identity — fixed here

**Why is it here?** A receipt must identify the implementation and dependencies responsible
for a checkpoint and its serving proof. `ProfileImprovementHarness.train` instead overwrote
its caller's training identity with the harness's evaluation identity. Those identify
different operations; the bound evaluation callback does not execute the training job.
An old test asserted the substitution, so its green result protected a bad contract.

**Decision:** require the existing training `executionRef` explicitly on `train`, preserve
it unchanged, and keep the bound parent/validator. No second identity system. A test checks
the receipt against the supplied training identity; another rejects omission before work.
The packed consumer also proves omission is a TypeScript error. This corrects an API
contract and therefore carries a minor release and migration note.

### 2. Known training exposure was decorative at the final gate — fixed here

**Why record task ancestry?** To prevent a measurement described as held out from reusing
known training inputs. The trainer checked its own train/validation partitions, but neither
Runtime's method materializer nor its authored/optimized profile proposal paths checked
training receipts against final measurement. Four authored-candidate regressions accepted
current or ancestor exposure in either arm; method regressions also reached evaluation.

**Decision:** one internal check in `candidate-validation.ts`, called from existing
materialization and proposal boundaries. It checks both arms and all retained receipts,
including trainer-visible validation data. A contaminated baseline fails before method
construction or analyst work; a selected candidate fails before final measurement.

This checks exact `contentDigest` against the existing evaluator's scenario digest. It does
not invent equivalence between a training benchmark name and an evaluator scenario kind,
and does not reveal held-out task identities through optimizer errors. Names coinciding
with different content remain admissible. Exporters must preserve the same canonical content
identity; differently encoded duplicates and undeclared training remain unproven. This is
not a general decontamination certificate and does not change standalone Eval APIs.

### 3. The real checkpoint-to-worker path is not established — next integration gate

**Why launch a trainer?** To produce an agent that subsequently performs useful work.
`tests/profile-training.test.ts` learns a scalar and uses an injected serving fixture. That
proves command execution, byte preservation, and receipt construction. It does not prove
an LLM checkpoint loads in the serving backend or is consumed by the real coding worker.

The existing consumer item is [Blueprint #2473](https://github.com/tangle-network/blueprint-agent/issues/2473).
Its latest inspected comment identifies `feat/p5-trained-arm-reentry` and says coder-profile
binding, matrix dispatch, and publication refusal validation remain pending. Do not create
another campaign or call a second Runtime cleanup completion of that consumer item.

**Done:** exported real trajectories reach one existing trainer, its real output reaches
one serving implementation, and the same production worker executes it in the existing
paired benchmark. Record the executed model, not just the requested route. A wrong-checkpoint
negative control must fail. Do not replace any of these joins with mocks for this claim.

### 4. A serving evidence digest is not self-authenticating — adapter obligation

**Why the serving port?** Runtime should not own every deployment backend. The injection
boundary is appropriate. However, `serve()` returns an artifact digest, model id, and evidence
digest; Runtime verifies consistency, not the existence or independence of the evidence.
A conforming fake port can pass. A hash identifies bytes, not who witnessed an event.

**Decision:** retain the port. The real adapter must retain retrievable evidence of the
loaded artifact and an inference through the actual consuming path, tied to immutable
provider/route identity. A route string alone is not a deployment attestation. Do not add
another registry or signature scheme until the existing serving evidence path is exercised.

### 5. One checkpoint file needs an explicit packaging convention — integration requirement

**Why one file?** It makes atomic hashing and publication tractable, and can contain an
archive. It is not inherently wrong. But native model output may include weight shards,
adapter configuration, tokenizer/configuration, and a specific base model. Current Runtime
accepts one opaque file and carries forward the parent provider; it does not resolve these
requirements or prove every parent harness can use the new route.

**Decision:** define and test one packaging convention in the adapter using existing
artifact/archive facilities. Pin its dependencies and base revision, and verify backend
compatibility. Do not invent a new tensor serialization or loosen byte checks to make a
single-file toy fixture look compatible with all backends.

### 6. Training cost is absent from the result contract — blocks economic claims

**Why account for cost?** A cheaper model can still lose after training, rollout generation,
rejected runs, validation, storage, and serving are included. `ProfileTrainer.execute`
returns a success/failure outcome with no cost settlement. The profile experiment's cost
ledger does not retroactively establish the cost of an earlier training job.

**Decision:** the real training adapter must join the existing execution/usage and Eval
cost-ledger paths. Report unknown cost as unknown. Compare cost per independently accepted
task including amortized adaptation cost, with the amortization horizon explicit. This is
not justification for a second billing system, and a receipt-only demo cannot claim ROI.

### 7. Remote effect uncertainty has no reconciliation operation here — production requirement

**Why the uncertainty flags?** Returning `trainingMayExist`/`servingMayExist` is more honest
than pretending cancellation deleted a remote job. But a new invocation allocates a fresh
local directory; this module has no caller-owned idempotent resume/reconcile operation.
A repeated call can represent another training or serving effect. Process-group teardown
is not remote recovery, and an omitted deadline is not crash durability.

**Decision:** bind a concrete managed adapter to the existing retained execution identity,
recovery, and terminal-outcome facilities. Test interrupted admission, response loss, and
cancellation acknowledgement. Do not implement another generic scheduler inside improvement.
No paid managed workflow should be advertised as retry-safe merely because local artifacts
survive. This PR does not claim to solve remote exactly-once execution.

### 8. Embedded ancestry bounds conflict with indefinite training — Interface-owned design limit

**Why retain ancestry?** Repeated training must not erase exposure history. Interface 2.10.0
embeds the current receipt plus at most eight ancestors; each dataset inventory admits at
most 10,000 task identities. This is a bounded control-plane representation, not indefinite
continual learning. Merely deleting the limits would trade a product limit for unbounded
profile parsing, transport, hashing, and storage.

**Decision:** when the real integration requires longer lineage, use content-addressed
receipt/inventory references with verified resolution in the portable contract owner.
Preserve missing-history refusal and the exposure check. Do not silently truncate, or make
Runtime maintain a competing lineage grammar. Prove a sequence beyond the old ancestry
boundary before claiming the limit has been removed.

### 9. The dataset envelope is a bounded snapshot, not a universal data plane

**Why is it here?** It ties opaque trainer payloads to exposed task identities without
reimplementing Eval's export policy. That is useful. The current implementation nevertheless
captures and parses one JSON document with a 128 MiB byte limit, and canonicalizes it for
validation. Large trajectory corpora need a different data transport, not larger buffers.
The `sft`/`dpo`/`grpo` tags do not implement those training algorithms.

**Decision:** keep the bounded snapshot for the current contract. Exercise the existing
Eval exporter unchanged. Add a manifest/streaming adapter only when the real consumer
requires it, preserving exposure identities and byte digests; do not create another SFT
row normalizer in Runtime. Use upstream training implementations, not hand-written RL math.

### 10. Failure diagnostics discard the command output — operational improvement

**Why bound output?** Prevent runaway trainers from flooding the control process. The current
command runner counts stdout/stderr bytes but retains neither channel. A nonzero exit can
therefore explain very little. This is a genuine supportability cost, not a reason to return
unlimited logs in a public receipt.

**Decision:** reuse bounded, private runtime artifacts for diagnostic streams, with explicit
retention and redaction. Keep receipt metadata and returned errors free of raw secrets or
training examples. Verify missing files, loader failures, termination, and byte-limit overflow
with useful diagnostics. Scope this to the real adapter path rather than adding an unrelated
logging abstraction while its deployment is still unproven.

### 11. Validation types and operation names should explain their actual contract

**Why validation?** Refuse candidates that cannot be materialized or compared legitimately.
The shared synchronous contract is coherent, but TypeScript's `void` return type permits
callbacks returning promises even though Runtime rejects those results. Documentation alone
cannot make compile-time and runtime acceptance identical.

**Decision:** plan an explicitly typed acceptance contract at the owning API, with consumer
migration tests. Do not casually make all materializers asynchronous. Similarly, keep
training candidate construction distinct from a measured `ship` result. The existing direct
`improve(profile, trainingOptions)` avoids constructing an evaluation harness solely to
train; a new train-only wrapper is not justified by that boilerplate.

### 12. Our own engineering process was rewarding infrastructure completion

**Why tests and release metadata?** They prevent real regressions and broken packages. But
more tests, types, hashes, and generated documentation are not evidence that retained
learning helps. The earlier training-identity test even asserted the wrong behavior.

**Decision:** every change needs either a demonstrated correctness failure, a measured
consumer simplification, or a discriminating product experiment. A new abstraction pays
for itself by deleting an existing implementation or closing a demonstrated integration
obstacle. Do not continue low-impact cleanup indefinitely while the real worker path is
unfinished. Preserve an independent review stage; bot auto-approval and author self-audit
must not be labelled completed independent reviews.

## Existing software: what to use instead of rebuilding

TRL already implements SFT, DPO, GRPO and other transformer-training methods, with PEFT and
vLLM integrations ([official documentation](https://huggingface.co/docs/trl/index), inspected
2026-09-19). vLLM already serves LoRA adapters and documents their base-model relationship
([official documentation](https://docs.vllm.ai/en/latest/features/lora/)). ART is another
upstream option for multi-step agent reinforcement training, not a reason to add a second
training loop in Runtime ([official repository](https://github.com/OpenPipe/ART)). These are
integration candidates, not claimed plug-and-play compatibility with Tangle.

Use the trainer/backend already closest to the existing consumer's working stack, then
pin and test it. An exhaustive bake-off is not a prerequisite. Runtime's differentiated
work is faithful execution of the improved agent and safe adoption; Eval owns measurement,
Knowledge owns retained knowledge, and the consuming lab owns the learning experiment.

## A finite definition of done

**Engineering-complete:** one real export-to-trainer-to-serving-to-worker-to-evaluation-to-
activation/rollback path works through existing owners; declared identity is preserved;
known exposure cannot produce a held-out claim; supported interruption/retry/cancellation
outcomes are demonstrated; package consumers work without unpublished overrides. No
unresolved critical/high correctness finding remains in the supported path. Unsupported
backends and recovery modes must be explicit, not silently generalized from this one path.

**Value-established:** the chosen learning procedure beats a preregistered strong baseline
on fresh work by a practically meaningful amount, with independent verification, comparable
resource accounting, uncertainty, failures, and human intervention reported. Compare retained
learning against the same system with learning disabled/reset and against the best existing
non-weight lever relevant to the task. Do not select a weak baseline to manufacture a win.
Weight training wins only if its improvement justifies its full costs for the target workload.

**Continual-learning evidence:** repeat adaptation on new batches/projects, preserve history,
and compare retained versus reset state. A few successive runs demonstrate plumbing, not
statistical generalization. Determine sample size, project clustering, minimum useful effect,
and stopping rules before final measurement. Report specialist improvement, learning-efficiency
improvement, and cross-domain transfer separately.

**Experiment-complete:** accepted, rejected under the tested conditions, or inconclusive with
the missing evidence and budget stated. A negative result finishes an experiment. It does
not require another abstraction, and an inconclusive result does not justify endless reruns.
Global research is not assigned a fictional finish date; each delivery has the above boundary.

## The review loop and its stopping rule

For each proposed change, ask: whose decision changes, which failure/benefit is observable,
what existing owner already handles it, what the smallest decisive test is, and what would
make us delete it. Reproduce the failure, fix the owner, run regression and packaged-consumer
checks, and review the modified behavior again. This round found wrong execution identity
and unused exposure provenance; the second pass extended the guard to both final-proposal
paths and added positive controls so training-only data is not mistakenly forbidden.

Stop this code tranche after these defects, migrations, and independent review are resolved.
Continue the existing #2473 integration rather than starting another generic cleanup campaign.
Stop the product experiment at its declared decision boundary. The moonshot is a system
that learns to produce better verified outcomes, not a system that can generate infinite
work for its maintainers.
