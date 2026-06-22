[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / lifecycle

# lifecycle

## Classes

### ArtifactRegistry

Defined in: [lifecycle/registry.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/registry.ts#L47)

A typed, in-memory registry of `ProfileArtifact`s with stable ids.

Ids are stable for the life of the registry: `register` assigns one (or honors
a caller-supplied id idempotently), and no later operation reassigns it.
Re-registering the same id REPLACES the artifact's mutable fields but preserves
the id, so a re-proposed candidate keeps its identity across generations.

#### Constructors

##### Constructor

> **new ArtifactRegistry**(): [`ArtifactRegistry`](#artifactregistry)

###### Returns

[`ArtifactRegistry`](#artifactregistry)

#### Accessors

##### size

###### Get Signature

> **get** **size**(): `number`

Defined in: [lifecycle/registry.ts:254](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/registry.ts#L254)

Number of registered artifacts (any status).

###### Returns

`number`

#### Methods

##### register()

> **register**\<`K`\>(`input`): [`ProfileArtifact`](#profileartifact)\<`K`\>

Defined in: [lifecycle/registry.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/registry.ts#L57)

Register an artifact, returning the stored record (with its assigned id).
When `input.id` is set it is honored (idempotent re-registration replaces
the record under the same id); otherwise a stable id is minted as
`<kind>-<n>`. `status` defaults to `'candidate'`.

###### Type Parameters

###### K

`K` *extends* [`ArtifactKind`](#artifactkind)

###### Parameters

###### input

[`ArtifactInput`](#artifactinput)\<`K`\>

###### Returns

[`ProfileArtifact`](#profileartifact)\<`K`\>

##### get()

> **get**(`id`): [`ProfileArtifact`](#profileartifact)\<[`ArtifactKind`](#artifactkind)\> \| `undefined`

Defined in: [lifecycle/registry.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/registry.ts#L79)

Get an artifact by id, or `undefined` if it was never registered.

###### Parameters

###### id

`string`

###### Returns

[`ProfileArtifact`](#profileartifact)\<[`ArtifactKind`](#artifactkind)\> \| `undefined`

##### list()

> **list**(`query?`): [`ProfileArtifact`](#profileartifact)\<[`ArtifactKind`](#artifactkind)\>[]

Defined in: [lifecycle/registry.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/registry.ts#L87)

List artifacts, optionally filtered by `kind` and/or `status`. Returns a new
array in registration order; callers may safely sort/mutate the result.

###### Parameters

###### query?

[`ArtifactQuery`](#artifactquery) = `{}`

###### Returns

[`ProfileArtifact`](#profileartifact)\<[`ArtifactKind`](#artifactkind)\>[]

##### promote()

> **promote**(`id`): [`ProfileArtifact`](#profileartifact)

Defined in: [lifecycle/registry.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/registry.ts#L108)

Mark an artifact `active`. Fails loud on an unknown id — promoting a
non-existent artifact is a caller bug, not a no-op. Returns the updated
record. Idempotent: promoting an already-active artifact is a no-op return.

NOTE: the artifact-lifecycle INVARIANT (no measured lift ⇒ not active) is
enforced by `promoteWithLift`, the path the closed loop uses. This bare
`promote` exists for callers that gate elsewhere and just flip the flag; it
does NOT record a lift score, so `liftOf` returns `undefined` and a
lift-ranked `composeProfile` will skip it. Prefer `promoteWithLift`.

###### Parameters

###### id

`string`

###### Returns

[`ProfileArtifact`](#profileartifact)

##### promoteWithLift()

> **promoteWithLift**(`id`, `lift`): [`ProfileArtifact`](#profileartifact)

Defined in: [lifecycle/registry.ts:130](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/registry.ts#L130)

Promote an artifact AND record the measured held-back lift that earned it.
This is the closed loop's promotion path and the enforcement point of the
lifecycle invariant: an artifact becomes `active` only WITH a finite lift
number stamped under `liftMetadataKey`. A non-finite `lift` (NaN/Infinity)
fails loud — promoting on a broken measurement is exactly the silent-zero the
doctrine forbids. Re-promotes a `decayed` artifact whose lift recovered.
Returns the updated record.

###### Parameters

###### id

`string`

###### lift

`number`

###### Returns

[`ProfileArtifact`](#profileartifact)

##### demote()

> **demote**(`id`, `reason`, `lift?`): [`ProfileArtifact`](#profileartifact)

Defined in: [lifecycle/registry.ts:160](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/registry.ts#L160)

Demote an `active` artifact to `decayed`: it was promoted, but a later
re-measure (`driftWatch`) found its held-back lift fell below the keep-bar.
Records the latest re-measured `lift` (so `liftOf` reflects current evidence)
and the `reason` (so the demotion is auditable). The artifact stays in the
registry — `decayed`, not deleted — so it can be re-promoted if a future
re-measure recovers the lift. Fails loud on an unknown id. Demoting a
non-`active` artifact fails loud too: only the active set decays.

###### Parameters

###### id

`string`

###### reason

`string`

###### lift?

`number`

###### Returns

[`ProfileArtifact`](#profileartifact)

##### retire()

> **retire**(`id`, `reason`): [`ProfileArtifact`](#profileartifact)

Defined in: [lifecycle/registry.ts:197](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/registry.ts#L197)

Retire an artifact to the terminal `retired` state: it is permanently out of
the active set (`dedupeArtifacts` retires the weaker half of a non-stacking
pair). Records the `reason` for the audit trail. Unlike `demote`, this is
terminal — a retired artifact is never re-promoted by the loop. Idempotent on
an already-retired artifact; fails loud on an unknown id.

###### Parameters

###### id

`string`

###### reason

`string`

###### Returns

[`ProfileArtifact`](#profileartifact)

##### liftOf()

> **liftOf**(`id`): `number` \| `undefined`

Defined in: [lifecycle/registry.ts:224](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/registry.ts#L224)

The measured held-back lift recorded at promotion time (and overwritten by
the latest `driftWatch` re-measure), or `undefined` when the artifact was
never promoted WITH a lift (a fresh candidate, or one promoted via the bare
`promote`). The lifecycle invariant in one accessor: `liftOf(id) ===
undefined` ⇒ the artifact has no measured lift ⇒ it is not eligible for a
lift-ranked compose. Note this returns the recorded lift regardless of status
— `composeProfile` separately filters to `active`, so a `decayed` artifact's
stale lift is visible for audit but never folded into a profile.

###### Parameters

###### id

`string`

###### Returns

`number` \| `undefined`

##### compose()

> **compose**(`base`, `ids?`): `AgentProfile`

Defined in: [lifecycle/registry.ts:237](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/registry.ts#L237)

Compose a set of registered artifacts onto a baseline profile. With no ids
given, composes every `active` artifact (the "ship the passing set"
default). With explicit ids, composes exactly those (in id order given),
failing loud on any unknown id. The applied order is the order passed (or
registration order for the active-default), and later artifacts win on key
conflicts — same semantics as `applyArtifacts`.

###### Parameters

###### base

`AgentProfile`

###### ids?

readonly `string`[]

###### Returns

`AgentProfile`

## Interfaces

### ComposeProfileOptions

Defined in: [lifecycle/compose.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/compose.ts#L24)

#### Properties

##### k?

> `optional` **k?**: `number`

Defined in: [lifecycle/compose.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/compose.ts#L26)

Cap on how many artifacts to fold in. Default: all eligible.

##### kind?

> `optional` **kind?**: [`ArtifactKind`](#artifactkind)

Defined in: [lifecycle/compose.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/compose.ts#L28)

Restrict to one surface (e.g. only fold in skills). Default: all kinds.

***

### DedupeOptions

Defined in: [lifecycle/dedupe.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/dedupe.ts#L34)

#### Properties

##### registry

> **registry**: [`ArtifactRegistry`](#artifactregistry)

Defined in: [lifecycle/dedupe.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/dedupe.ts#L37)

The registry whose `active` artifacts are pairwise stack-tested. Mutated in
 place: the weaker member of each non-stacking pair is retired.

##### baseline

> **baseline**: `AgentProfile`

Defined in: [lifecycle/dedupe.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/dedupe.ts#L40)

The baseline profile the stacking ablation runs on top of. The "without"
 arm is scored once and shared across every pair.

##### evalRunner

> **evalRunner**: [`EvalRunner`](#evalrunner-2)

Defined in: [lifecycle/dedupe.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/dedupe.ts#L43)

Scores a profile on the held-back split. Called for the baseline, each
 artifact alone, and each candidate pair together.

##### tolerance?

> `optional` **tolerance?**: `number`

Defined in: [lifecycle/dedupe.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/dedupe.ts#L51)

The stacking tolerance. A pair is judged non-stacking (redundant) when the
combined lift falls SHORT of the sum of individual lifts by more than this:
`combined < a + b − tolerance`. A small positive tolerance absorbs eval
noise so only a real overlap retires an artifact. Default 0 — any shortfall
counts as non-stacking (use a positive value on noisy live evals).

##### kind?

> `optional` **kind?**: [`ArtifactKind`](#artifactkind)

Defined in: [lifecycle/dedupe.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/dedupe.ts#L54)

Restrict dedupe to one surface (only compare skills against skills, …).
 Default: every `active` artifact is a candidate, across kinds.

##### baselineResult?

> `optional` **baselineResult?**: [`EvalResult`](#evalresult)

Defined in: [lifecycle/dedupe.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/dedupe.ts#L56)

A pre-computed baseline result, to skip the shared "without" run.

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [lifecycle/dedupe.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/dedupe.ts#L58)

Cooperative cancellation, forwarded to every `evalRunner` call.

***

### PairStackCheck

Defined in: [lifecycle/dedupe.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/dedupe.ts#L62)

The stacking verdict for one pair of active artifacts.

#### Properties

##### pair

> **pair**: \[`string`, `string`\]

Defined in: [lifecycle/dedupe.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/dedupe.ts#L64)

Ids of the two artifacts compared, in (a, b) order as examined.

##### liftA

> **liftA**: `number`

Defined in: [lifecycle/dedupe.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/dedupe.ts#L66)

Individual held-back lift of the first artifact alone (re-measured).

##### liftB

> **liftB**: `number`

Defined in: [lifecycle/dedupe.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/dedupe.ts#L68)

Individual held-back lift of the second artifact alone (re-measured).

##### combinedLift

> **combinedLift**: `number`

Defined in: [lifecycle/dedupe.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/dedupe.ts#L70)

Held-back lift of BOTH artifacts composed together.

##### stackGap

> **stackGap**: `number`

Defined in: [lifecycle/dedupe.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/dedupe.ts#L73)

`combinedLift − (liftA + liftB)`: ≥ −tolerance ⇒ they stack; below ⇒ they
 overlap (redundant).

##### redundant

> **redundant**: `boolean`

Defined in: [lifecycle/dedupe.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/dedupe.ts#L75)

Whether the pair was judged non-stacking (redundant).

##### retiredId?

> `optional` **retiredId?**: `string`

Defined in: [lifecycle/dedupe.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/dedupe.ts#L77)

The id retired when redundant (the weaker member), else `undefined`.

***

### DedupeResult

Defined in: [lifecycle/dedupe.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/dedupe.ts#L80)

#### Properties

##### checks

> **checks**: [`PairStackCheck`](#pairstackcheck)[]

Defined in: [lifecycle/dedupe.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/dedupe.ts#L83)

One verdict per examined pair, in iteration order. Pairs where one member
 was already retired by an earlier pair this cycle are skipped.

##### retired

> **retired**: `string`[]

Defined in: [lifecycle/dedupe.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/dedupe.ts#L85)

Ids retired this cycle (the weaker member of each non-stacking pair).

##### baselineResult

> **baselineResult**: [`EvalResult`](#evalresult)

Defined in: [lifecycle/dedupe.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/dedupe.ts#L87)

The shared baseline eval (the "without" arm, measured once).

***

### DriftWatchOptions

Defined in: [lifecycle/drift-watch.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/drift-watch.ts#L33)

#### Properties

##### registry

> **registry**: [`ArtifactRegistry`](#artifactregistry)

Defined in: [lifecycle/drift-watch.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/drift-watch.ts#L36)

The registry whose `active` artifacts are re-measured. Mutated in place:
 artifacts that fail the keep-bar are demoted to `decayed`.

##### baseline

> **baseline**: `AgentProfile`

Defined in: [lifecycle/drift-watch.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/drift-watch.ts#L40)

The baseline profile each artifact is re-measured ON TOP OF — the SAME
 ablation shape as promotion. Pass the CURRENT baseline (the world the
 artifact lives in now), which may differ from the one it was promoted on.

##### evalRunner

> **evalRunner**: [`EvalRunner`](#evalrunner-2)

Defined in: [lifecycle/drift-watch.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/drift-watch.ts#L43)

Scores a profile on the held-back split. The shared baseline arm is run
 once and reused across every artifact's ablation (the "without" arm).

##### minLift?

> `optional` **minLift?**: `number`

Defined in: [lifecycle/drift-watch.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/drift-watch.ts#L50)

The absolute keep-bar: an artifact stays `active` only while its re-measured
held-back lift is STRICTLY ABOVE this floor. Default 0 — an artifact that no
longer adds anything (or now subtracts) decays. Mirrors `thresholdPromotionGate`'s
`minDelta` so the keep-bar and the promote-bar can be set consistently.

##### maxRelativeDecay?

> `optional` **maxRelativeDecay?**: `number`

Defined in: [lifecycle/drift-watch.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/drift-watch.ts#L59)

The relative keep-bar: an artifact also decays if its re-measured lift fell
to below this FRACTION of the lift recorded at promotion (`registry.liftOf`).
E.g. `0.5` demotes an artifact that lost more than half its original lift,
even if it still clears `minLift`. Default: unset (no relative check — only
the absolute `minLift` floor applies). Ignored for an artifact with no
recorded prior lift (a bare `promote`), which is judged on `minLift` alone.

##### kind?

> `optional` **kind?**: [`ArtifactKind`](#artifactkind)

Defined in: [lifecycle/drift-watch.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/drift-watch.ts#L62)

Restrict the watch to one surface (e.g. re-measure only skills). Default:
 every `active` artifact, regardless of kind.

##### baselineResult?

> `optional` **baselineResult?**: [`EvalResult`](#evalresult)

Defined in: [lifecycle/drift-watch.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/drift-watch.ts#L65)

A pre-computed baseline result, to skip the shared "without" run when the
 caller already scored the current baseline this cycle.

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [lifecycle/drift-watch.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/drift-watch.ts#L67)

Cooperative cancellation, forwarded to every `evalRunner` call.

***

### DriftCheck

Defined in: [lifecycle/drift-watch.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/drift-watch.ts#L71)

Per-artifact record of what the re-measure found and decided.

#### Properties

##### artifact

> **artifact**: [`ProfileArtifact`](#profileartifact)

Defined in: [lifecycle/drift-watch.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/drift-watch.ts#L74)

The re-measured artifact (status reflects the decision: still `active`, or
 now `decayed`).

##### priorLift

> **priorLift**: `number` \| `undefined`

Defined in: [lifecycle/drift-watch.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/drift-watch.ts#L77)

The lift recorded at promotion time (`registry.liftOf` before the check),
 or `undefined` if it was promoted without a lift receipt.

##### currentLift

> **currentLift**: `number`

Defined in: [lifecycle/drift-watch.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/drift-watch.ts#L79)

The freshly re-measured held-back lift (with − without composite).

##### demoted

> **demoted**: `boolean`

Defined in: [lifecycle/drift-watch.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/drift-watch.ts#L81)

Whether this re-measure demoted the artifact (`active` → `decayed`).

##### reason

> **reason**: `string`

Defined in: [lifecycle/drift-watch.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/drift-watch.ts#L84)

Human-readable reason the artifact was kept or demoted (the same string
 recorded under `lifecycleReasonKey` on a demotion).

***

### DriftWatchResult

Defined in: [lifecycle/drift-watch.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/drift-watch.ts#L87)

#### Properties

##### checks

> **checks**: [`DriftCheck`](#driftcheck)[]

Defined in: [lifecycle/drift-watch.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/drift-watch.ts#L89)

One check per `active` artifact examined, in registry order.

##### demoted

> **demoted**: `string`[]

Defined in: [lifecycle/drift-watch.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/drift-watch.ts#L91)

Ids of the artifacts demoted to `decayed` this cycle.

##### baselineResult

> **baselineResult**: [`EvalResult`](#evalresult)

Defined in: [lifecycle/drift-watch.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/drift-watch.ts#L93)

The shared baseline eval (the "without" arm, measured once).

***

### PromotionVerdict

Defined in: [lifecycle/gate.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/gate.ts#L24)

The verdict a gate returns for one candidate.

#### Properties

##### promote

> **promote**: `boolean`

Defined in: [lifecycle/gate.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/gate.ts#L26)

Whether to promote the candidate into the registry as `active`.

##### reason

> **reason**: `string`

Defined in: [lifecycle/gate.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/gate.ts#L28)

Human-readable reason (surfaced in provenance + reports).

##### rejectionCode

> **rejectionCode**: `string` \| `null`

Defined in: [lifecycle/gate.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/gate.ts#L31)

Machine-readable rejection code, or `null` on promote. Mirrors the
 `HeldOutGate` rejection taxonomy when that gate is the backend.

***

### PromotionGate

Defined in: [lifecycle/gate.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/gate.ts#L44)

Decides whether ONE measured candidate is promoted. The lifecycle calls this
once per candidate, after `measureMarginalLift` has produced the ablation.

`lift` carries the with/without ablation (the marginal contribution); the gate
MAY use it directly (the simple "positive lift on the held-back split" policy)
OR ignore the scalar and decide from the paired per-task records the eval
produced (`lift.withArtifact.runs` / `lift.withoutArtifact.runs`) when a
significance gate like `HeldOutGate` is the backend.

#### Properties

##### kind

> **kind**: `string`

Defined in: [lifecycle/gate.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/gate.ts#L46)

Stable label for the gate policy (provenance).

#### Methods

##### decide()

> **decide**(`lift`): [`PromotionVerdict`](#promotionverdict)

Defined in: [lifecycle/gate.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/gate.ts#L47)

###### Parameters

###### lift

[`MarginalLift`](#marginallift)

###### Returns

[`PromotionVerdict`](#promotionverdict)

***

### HeldOutPromotionGateOptions

Defined in: [lifecycle/gate.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/gate.ts#L80)

#### Properties

##### baselineKey

> **baselineKey**: `string`

Defined in: [lifecycle/gate.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/gate.ts#L82)

Stable label of the baseline candidate the held-out records pair against.

##### minProductiveRuns?

> `optional` **minProductiveRuns?**: `number`

Defined in: [lifecycle/gate.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/gate.ts#L84)

Minimum paired (candidate, baseline) holdout observations. Default 3.

##### pairedDeltaThreshold?

> `optional` **pairedDeltaThreshold?**: `number`

Defined in: [lifecycle/gate.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/gate.ts#L86)

Lower-bound on the bootstrap-CI of the median paired holdout delta. Default 0.

##### overfitGapThreshold?

> `optional` **overfitGapThreshold?**: `number`

Defined in: [lifecycle/gate.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/gate.ts#L88)

Max allowed worsening of the (search − holdout) overfit gap. Default 0.15.

##### seed?

> `optional` **seed?**: `number`

Defined in: [lifecycle/gate.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/gate.ts#L90)

Deterministic bootstrap seed (reproducible CIs). Default unseeded.

##### costPerTaskCeiling?

> `optional` **costPerTaskCeiling?**: `number`

Defined in: [lifecycle/gate.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/gate.ts#L92)

Hard ceiling on the candidate's median per-task USD cost. Default none.

***

### GenerateContext

Defined in: [lifecycle/generator.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/generator.ts#L35)

The read-only context a generator sees when proposing candidates. It is the
agent's HISTORY (what to learn from) plus the agent's CURRENT shape (what
already exists, so the generator does not re-propose a duplicate).

#### Properties

##### baseline

> **baseline**: `AgentProfile`

Defined in: [lifecycle/generator.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/generator.ts#L38)

The baseline profile candidates are proposed on top of. A generator reads
 it to avoid re-proposing something the profile already has.

##### domain

> **domain**: `string`

Defined in: [lifecycle/generator.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/generator.ts#L42)

The domain/agent id the lifecycle is running for — namespaces provenance
 and lets a generator scope its proposals (e.g. distill from this domain's
 traces only).

##### findings

> **findings**: readonly `AnalystFinding`[]

Defined in: [lifecycle/generator.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/generator.ts#L45)

Trace-analyst findings to ground proposals in observed behavior. The
 firewall holds: these are OBSERVED signals, never judge verdicts.

##### traces?

> `optional` **traces?**: `unknown`

Defined in: [lifecycle/generator.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/generator.ts#L49)

Raw captured trace text/records to distill from, opaque to the
 orchestrator. A skill generator's `distill` reads this; a tool generator
 may ignore it and read `findings` instead.

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [lifecycle/generator.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/generator.ts#L51)

Cooperative cancellation, forwarded from `runLifecycle`.

***

### CandidateGenerator

Defined in: [lifecycle/generator.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/generator.ts#L63)

Produces fresh, UNMEASURED candidate artifacts for ONE profile surface.

`kind` is the `ArtifactKind` this generator targets (so the orchestrator can
report and group by surface). `generate` returns candidate inputs the
orchestrator will register, measure (`measureMarginalLift`), gate
(`HeldOutGate`), and — on a pass — promote into the registry. Returning `[]`
is valid: the surface had nothing to contribute this round.

#### Type Parameters

##### K

`K` *extends* [`ArtifactKind`](#artifactkind) = [`ArtifactKind`](#artifactkind)

#### Properties

##### kind

> **kind**: `K`

Defined in: [lifecycle/generator.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/generator.ts#L65)

The profile surface this generator targets.

#### Methods

##### generate()

> **generate**(`ctx`): `Promise`\<[`ArtifactInput`](#artifactinput)\<`K`\>[]\>

Defined in: [lifecycle/generator.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/generator.ts#L72)

Propose candidate artifacts from the lifecycle context. MUST NOT measure,
gate, or register — that is the orchestrator's job. MUST NOT mutate
`ctx.baseline`. Returns unmeasured `ArtifactInput`s (no lift score yet); the
orchestrator stamps provenance + the measured lift before promotion.

###### Parameters

###### ctx

[`GenerateContext`](#generatecontext)

###### Returns

`Promise`\<[`ArtifactInput`](#artifactinput)\<`K`\>[]\>

***

### EvalResult

Defined in: [lifecycle/marginal-lift.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L29)

The result of running an eval over ONE profile: a composite score and the cost
to obtain it. This mirrors the project's score/cost convention (`composite`
from `OutcomeMeasurement`, `costUsd` from `LoopResult`), so a caller can pass a
thin wrapper over `runLoop` / `runBenchmark` / `runAgentEval` directly.

#### Properties

##### composite

> **composite**: `number`

Defined in: [lifecycle/marginal-lift.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L31)

Composite score in `[0, 1]` (higher is better) for the profile under test.

##### costUsd

> **costUsd**: `number`

Defined in: [lifecycle/marginal-lift.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L33)

USD cost to produce this result.

##### runs?

> `optional` **runs?**: `RunRecord`[]

Defined in: [lifecycle/marginal-lift.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L42)

Per-task records the run produced, when the runner emits them. The marginal
lift only needs `composite`, but the held-out promotion gate (`HeldOutGate`)
pairs candidate vs baseline per-task holdout records by (experimentId, seed)
— so a runner feeding `heldOutPromotionGate` MUST populate this with rows
carrying both `search` and `holdout` split scores. Omit it for evals scored
to a single composite (then use `thresholdPromotionGate`).

##### details?

> `optional` **details?**: `unknown`

Defined in: [lifecycle/marginal-lift.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L44)

Optional opaque passthrough (per-task cells, the raw report, …).

***

### MeasureMarginalLiftOptions

Defined in: [lifecycle/marginal-lift.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L54)

#### Properties

##### baseline

> **baseline**: `AgentProfile`

Defined in: [lifecycle/marginal-lift.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L56)

The profile the artifact is measured ON TOP OF (the "without" arm).

##### candidate

> **candidate**: [`ProfileArtifact`](#profileartifact)

Defined in: [lifecycle/marginal-lift.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L58)

The single artifact whose marginal contribution we want.

##### evalRunner

> **evalRunner**: [`EvalRunner`](#evalrunner-2)

Defined in: [lifecycle/marginal-lift.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L60)

The eval that scores a profile. Run once per arm (twice total).

##### baselineResult?

> `optional` **baselineResult?**: [`EvalResult`](#evalresult)

Defined in: [lifecycle/marginal-lift.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L66)

A pre-computed baseline result, to skip the "without" run when the caller
already scored the baseline (e.g. measuring several candidates against the
same baseline). When set, the baseline arm is NOT re-run.

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [lifecycle/marginal-lift.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L68)

Forwarded to both `evalRunner` invocations for cancellation.

***

### MarginalLift

Defined in: [lifecycle/marginal-lift.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L79)

The marginal lift of one artifact: the with/without ablation.

`scoreDelta = with.composite − without.composite`. A positive `scoreDelta` is
the evidence a gate needs to promote; a negative one is the signal to drop the
artifact. `costDelta` is the extra USD the artifact costs (often positive — a
new tool/MCP adds calls) and lets the gate weigh lift against spend.

#### Properties

##### artifactId

> **artifactId**: `string`

Defined in: [lifecycle/marginal-lift.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L81)

The artifact id this measurement is for (stable, from the registry).

##### withArtifact

> **withArtifact**: [`EvalResult`](#evalresult)

Defined in: [lifecycle/marginal-lift.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L83)

Eval of `applyArtifact(baseline, candidate)`.

##### withoutArtifact

> **withoutArtifact**: [`EvalResult`](#evalresult)

Defined in: [lifecycle/marginal-lift.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L85)

Eval of `baseline` alone.

##### scoreDelta

> **scoreDelta**: `number`

Defined in: [lifecycle/marginal-lift.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L87)

`withArtifact.composite − withoutArtifact.composite`.

##### costDelta

> **costDelta**: `number`

Defined in: [lifecycle/marginal-lift.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L89)

`withArtifact.costUsd − withoutArtifact.costUsd`.

***

### PromptDraft

Defined in: [lifecycle/prompt-generator.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/prompt-generator.ts#L50)

A proposed prompt instruction line plus the WHY behind it. The `rationale`
 rides into the artifact metadata so a promotion decision is auditable.

#### Properties

##### instruction

> **instruction**: `string`

Defined in: [lifecycle/prompt-generator.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/prompt-generator.ts#L52)

The instruction line appended to `profile.prompt.instructions`.

##### label

> **label**: `string`

Defined in: [lifecycle/prompt-generator.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/prompt-generator.ts#L54)

Short human label for review surfaces.

##### rationale

> **rationale**: `string`

Defined in: [lifecycle/prompt-generator.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/prompt-generator.ts#L56)

Why this line was proposed — which failure / framing it targets.

***

### PromptGeneratorOptions

Defined in: [lifecycle/prompt-generator.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/prompt-generator.ts#L79)

#### Properties

##### refine?

> `optional` **refine?**: [`RefinePrompt`](#refineprompt)

Defined in: [lifecycle/prompt-generator.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/prompt-generator.ts#L82)

OPTIONAL — the exploit arm (incumbent-grounded rewrites via `gepaProposer`).
 Omit to run seeds-only.

##### authorDiverseSeeds?

> `optional` **authorDiverseSeeds?**: [`AuthorDiverseSeeds`](#authordiverseseeds)

Defined in: [lifecycle/prompt-generator.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/prompt-generator.ts#L84)

OPTIONAL — the explore arm (diverse fresh seeds). Omit to run refine-only.

##### diverseSeedCount?

> `optional` **diverseSeedCount?**: `number`

Defined in: [lifecycle/prompt-generator.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/prompt-generator.ts#L87)

How many diverse seeds the explore arm authors each generation. Default 3.
 Zero disables seeding even when `authorDiverseSeeds` is set.

***

### ProductionPromptGeneratorOptions

Defined in: [lifecycle/prompt-generator.ts:166](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/prompt-generator.ts#L166)

#### Properties

##### llm

> **llm**: `LlmClientOptions`

Defined in: [lifecycle/prompt-generator.ts:168](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/prompt-generator.ts#L168)

Router transport (baseUrl/apiKey) for both the refine and seed arms.

##### model?

> `optional` **model?**: `string`

Defined in: [lifecycle/prompt-generator.ts:170](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/prompt-generator.ts#L170)

Model that performs reflection + seed authoring. Default `deepseek-v4-flash`.

##### refinePopulation?

> `optional` **refinePopulation?**: `number`

Defined in: [lifecycle/prompt-generator.ts:172](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/prompt-generator.ts#L172)

Population size handed to `gepaProposer`'s `propose`. Default 3.

##### diverseSeedCount?

> `optional` **diverseSeedCount?**: `number`

Defined in: [lifecycle/prompt-generator.ts:174](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/prompt-generator.ts#L174)

Diverse-seed count. Default 3.

##### seedTemperature?

> `optional` **seedTemperature?**: `number`

Defined in: [lifecycle/prompt-generator.ts:177](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/prompt-generator.ts#L177)

Seed-authoring temperature — high on purpose so the seeds spread across
 framings rather than collapsing onto one. Default 1.0.

***

### ArtifactQuery

Defined in: [lifecycle/registry.ts:17](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/registry.ts#L17)

Filter for `list`. Omit a field to leave that dimension unconstrained.

#### Properties

##### kind?

> `optional` **kind?**: [`ArtifactKind`](#artifactkind)

Defined in: [lifecycle/registry.ts:18](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/registry.ts#L18)

##### status?

> `optional` **status?**: [`ArtifactStatus`](#artifactstatus)

Defined in: [lifecycle/registry.ts:19](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/registry.ts#L19)

***

### RunLifecycleOptions

Defined in: [lifecycle/run-lifecycle.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/run-lifecycle.ts#L35)

#### Properties

##### baseline

> **baseline**: `AgentProfile`

Defined in: [lifecycle/run-lifecycle.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/run-lifecycle.ts#L38)

The baseline profile candidates are proposed and measured on top of. On a
 cold start this is the empty (or near-empty) profile.

##### domain

> **domain**: `string`

Defined in: [lifecycle/run-lifecycle.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/run-lifecycle.ts#L40)

The agent/domain id — namespaces provenance + scopes generators.

##### generators

> **generators**: readonly [`CandidateGenerator`](#candidategenerator)\<[`ArtifactKind`](#artifactkind)\>[]

Defined in: [lifecycle/run-lifecycle.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/run-lifecycle.ts#L43)

The per-surface candidate generators. One per surface the loop grows; the
 loop runs them in order and pools their candidates.

##### evalRunner

> **evalRunner**: [`EvalRunner`](#evalrunner-2)

Defined in: [lifecycle/run-lifecycle.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/run-lifecycle.ts#L46)

Scores a profile on the HELD-BACK split. Run by `measureMarginalLift` —
 once for the shared baseline, once per candidate.

##### gate

> **gate**: [`PromotionGate`](#promotiongate)

Defined in: [lifecycle/run-lifecycle.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/run-lifecycle.ts#L49)

The promotion gate (the held-back exam). Default-free on purpose: the
 caller chooses the policy (`thresholdPromotionGate` / `heldOutPromotionGate`).

##### findings?

> `optional` **findings?**: readonly `AnalystFinding`[]

Defined in: [lifecycle/run-lifecycle.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/run-lifecycle.ts#L51)

Trace-analyst findings the generators distill/propose from.

##### traces?

> `optional` **traces?**: `unknown`

Defined in: [lifecycle/run-lifecycle.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/run-lifecycle.ts#L53)

Raw captured traces for generators (e.g. a skill `distill`). Opaque.

##### generation?

> `optional` **generation?**: `number`

Defined in: [lifecycle/run-lifecycle.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/run-lifecycle.ts#L55)

Generation counter for provenance. Default 0.

##### registry?

> `optional` **registry?**: [`ArtifactRegistry`](#artifactregistry)

Defined in: [lifecycle/run-lifecycle.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/run-lifecycle.ts#L57)

An existing registry to grow across generations. Default: a fresh one.

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [lifecycle/run-lifecycle.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/run-lifecycle.ts#L59)

Cooperative cancellation.

***

### CandidateOutcome

Defined in: [lifecycle/run-lifecycle.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/run-lifecycle.ts#L63)

The per-candidate record of what the loop decided and why.

#### Properties

##### artifact

> **artifact**: [`ProfileArtifact`](#profileartifact)

Defined in: [lifecycle/run-lifecycle.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/run-lifecycle.ts#L65)

The stored artifact (status reflects the gate verdict).

##### kind

> **kind**: [`ArtifactKind`](#artifactkind)

Defined in: [lifecycle/run-lifecycle.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/run-lifecycle.ts#L67)

The surface this candidate targeted.

##### scoreDelta

> **scoreDelta**: `number`

Defined in: [lifecycle/run-lifecycle.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/run-lifecycle.ts#L69)

Measured held-back lift (with − without composite).

##### costDelta

> **costDelta**: `number`

Defined in: [lifecycle/run-lifecycle.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/run-lifecycle.ts#L71)

Measured extra USD cost the artifact adds.

##### verdict

> **verdict**: [`PromotionVerdict`](#promotionverdict)

Defined in: [lifecycle/run-lifecycle.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/run-lifecycle.ts#L73)

The gate's verdict.

##### promoted

> **promoted**: `boolean`

Defined in: [lifecycle/run-lifecycle.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/run-lifecycle.ts#L75)

Whether the candidate was promoted into the registry as active.

***

### RunLifecycleResult

Defined in: [lifecycle/run-lifecycle.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/run-lifecycle.ts#L78)

#### Properties

##### registry

> **registry**: [`ArtifactRegistry`](#artifactregistry)

Defined in: [lifecycle/run-lifecycle.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/run-lifecycle.ts#L80)

The registry, grown with this generation's candidates + promotions.

##### outcomes

> **outcomes**: [`CandidateOutcome`](#candidateoutcome)[]

Defined in: [lifecycle/run-lifecycle.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/run-lifecycle.ts#L82)

One outcome per candidate the generators produced, in generation order.

##### promoted

> **promoted**: `string`[]

Defined in: [lifecycle/run-lifecycle.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/run-lifecycle.ts#L84)

Ids of the artifacts promoted this generation.

##### baselineResult

> **baselineResult**: [`EvalResult`](#evalresult)

Defined in: [lifecycle/run-lifecycle.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/run-lifecycle.ts#L86)

The shared baseline eval (the "without" arm, measured once).

***

### SkillDraft

Defined in: [lifecycle/skill-generator.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/skill-generator.ts#L32)

A distilled skill draft: a name + the `SKILL.md` body.

#### Properties

##### name

> **name**: `string`

Defined in: [lifecycle/skill-generator.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/skill-generator.ts#L34)

Skill name — becomes the inline resource ref name + the artifact name.

##### content

> **content**: `string`

Defined in: [lifecycle/skill-generator.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/skill-generator.ts#L36)

The `SKILL.md` document body (markdown).

##### description?

> `optional` **description?**: `string`

Defined in: [lifecycle/skill-generator.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/skill-generator.ts#L38)

Optional one-line description for review surfaces.

***

### SkillGeneratorOptions

Defined in: [lifecycle/skill-generator.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/skill-generator.ts#L56)

#### Properties

##### distill

> **distill**: [`DistillSkills`](#distillskills)

Defined in: [lifecycle/skill-generator.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/skill-generator.ts#L58)

REQUIRED — the create step. Without it there is no skill to optimize.

##### refine?

> `optional` **refine?**: [`RefineSkill`](#refineskill)

Defined in: [lifecycle/skill-generator.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/skill-generator.ts#L60)

OPTIONAL — the optimize step. Omit to ship distilled drafts unrefined.

***

### WorktreeBuildOptions

Defined in: [lifecycle/tool-build.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/tool-build.ts#L39)

#### Properties

##### kind

> **kind**: [`BuildableKind`](#buildablekind)

Defined in: [lifecycle/tool-build.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/tool-build.ts#L41)

The buildable surface to build (`tool` / `mcp`).

##### repoRoot

> **repoRoot**: `string`

Defined in: [lifecycle/tool-build.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/tool-build.ts#L43)

Absolute path to the git checkout each candidate worktree is cut from.

##### harness?

> `optional` **harness?**: [`LocalHarness`](mcp.md#localharness)

Defined in: [lifecycle/tool-build.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/tool-build.ts#L45)

Which local coding harness drives the build. Default `claude`.

##### baseRef?

> `optional` **baseRef?**: `string`

Defined in: [lifecycle/tool-build.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/tool-build.ts#L47)

Base ref each worktree forks from. Default `main`.

##### maxShots?

> `optional` **maxShots?**: `number`

Defined in: [lifecycle/tool-build.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/tool-build.ts#L49)

Max harness shots per candidate (the depth dial — resume-on-failure). Default 3.

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [lifecycle/tool-build.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/tool-build.ts#L51)

Per-shot wall-clock timeout (ms). Forwarded to `agenticGenerator`.

##### tool?

> `optional` **tool?**: `object`

Defined in: [lifecycle/tool-build.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/tool-build.ts#L57)

For a `tool` build: the verify command (run in the worktree, exit 0 = pass)
and the tool name the resulting grant lands under. Default command
`pnpm test`.

###### verifyCommand?

> `optional` **verifyCommand?**: `string`

###### verifyArgs?

> `optional` **verifyArgs?**: `string`[]

###### toolName

> **toolName**: `string`

##### mcp?

> `optional` **mcp?**: [`McpServeSpec`](index.md#mcpservespec)

Defined in: [lifecycle/tool-build.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/tool-build.ts#L63)

For an `mcp` build: how to BOOT the built server (the boot-and-probe spec)
— used both to verify it serves AND as the artifact's start command. The
`cwd` defaults to the candidate worktree.

***

### BuiltCandidate

Defined in: [lifecycle/tool-generator.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/tool-generator.ts#L59)

The result of building ONE candidate in its own worktree. A build either
verified (compiled + tests passed, or — for an MCP — booted and served) or it
did not; an unverified build is dropped before ranking, so `verified:false`
carries the reason for the audit trail but never becomes a candidate.

#### Properties

##### label

> **label**: `string`

Defined in: [lifecycle/tool-generator.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/tool-generator.ts#L61)

A short label for this candidate (worktree branch / trace node).

##### verified

> **verified**: `boolean`

Defined in: [lifecycle/tool-generator.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/tool-generator.ts#L63)

Did the build compile + pass its verifier? Only verified builds rank.

##### worktreeRef

> **worktreeRef**: `string`

Defined in: [lifecycle/tool-generator.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/tool-generator.ts#L65)

The worktree path / git ref holding the built change (provenance).

##### serve?

> `optional` **serve?**: `object`

Defined in: [lifecycle/tool-generator.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/tool-generator.ts#L71)

For an `mcp` candidate: how to START the built server (stdio transport).
Becomes the `AgentProfileMcpServer` the artifact carries. REQUIRED for an
`mcp` build; ignored for a `tool` build.

###### command

> **command**: `string`

###### args?

> `optional` **args?**: `string`[]

###### cwd?

> `optional` **cwd?**: `string`

###### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

##### toolName?

> `optional` **toolName?**: `string`

Defined in: [lifecycle/tool-generator.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/tool-generator.ts#L76)

For a `tool` candidate: the tool name the grant lands under (the profile
`tools` key). REQUIRED for a `tool` build; ignored for an `mcp` build.

##### failureReason?

> `optional` **failureReason?**: `string`

Defined in: [lifecycle/tool-generator.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/tool-generator.ts#L78)

Why the build failed verification, when `verified` is false (audit only).

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [lifecycle/tool-generator.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/tool-generator.ts#L80)

Free-form provenance to ride into the artifact metadata (build summary, …).

***

### BuildableGeneratorOptions

Defined in: [lifecycle/tool-generator.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/tool-generator.ts#L98)

#### Properties

##### kind

> **kind**: [`BuildableKind`](#buildablekind)

Defined in: [lifecycle/tool-generator.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/tool-generator.ts#L100)

The buildable surface this generator targets (`tool` or `mcp`).

##### buildCandidate

> **buildCandidate**: [`BuildCandidate`](#buildcandidate)

Defined in: [lifecycle/tool-generator.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/tool-generator.ts#L102)

The per-candidate build seam (the fan-out leaf). REQUIRED.

##### fanout?

> `optional` **fanout?**: `number`

Defined in: [lifecycle/tool-generator.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/tool-generator.ts#L106)

How many candidate implementations to build in parallel each generation.
 Default 3. Must be >= 1. The conserved-budget / live-worker caps that bound
 the real fan-out live in the production `buildCandidate` wiring.

##### evalRunner

> **evalRunner**: [`EvalRunner`](#evalrunner-2)

Defined in: [lifecycle/tool-generator.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/tool-generator.ts#L110)

Scores a profile on the held-back split — used to RANK the verified
 siblings by `measureMarginalLift`. REQUIRED: without it there is no way to
 pick the best of N, and "best" is the whole point of a fan-out.

***

### ArtifactPayloads

Defined in: [lifecycle/types.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L46)

The payload for each `ArtifactKind`. The shapes are the SAME types the
`AgentProfile` field carries, so applying an artifact is a structural merge
onto the profile — never a bespoke per-kind transform.

  - `prompt`   — an instruction line appended to `profile.prompt.instructions`.
  - `skill`    — a `SKILL.md`-style resource ref added to `profile.resources.skills`.
  - `tool`     — a tool grant: `{ enabled }` set under `profile.tools[name]`.
  - `mcp`      — one MCP server added under `profile.mcp[name]`.
  - `hook`     — one or more hook commands added under `profile.hooks[event]`.
  - `subagent` — one subagent profile added under `profile.subagents[name]`.

#### Properties

##### prompt

> **prompt**: `object`

Defined in: [lifecycle/types.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L47)

###### instruction

> **instruction**: `string`

##### skill

> **skill**: `object`

Defined in: [lifecycle/types.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L48)

###### resource

> **resource**: `AgentProfileResourceRef`

##### tool

> **tool**: `object`

Defined in: [lifecycle/types.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L49)

###### enabled

> **enabled**: `boolean`

##### mcp

> **mcp**: `object`

Defined in: [lifecycle/types.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L50)

###### server

> **server**: `AgentProfileMcpServer`

##### hook

> **hook**: `object`

Defined in: [lifecycle/types.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L51)

###### event

> **event**: `string`

###### commands

> **commands**: `AgentProfileHookCommand`[]

##### subagent

> **subagent**: `object`

Defined in: [lifecycle/types.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L52)

###### profile

> **profile**: `AgentSubagentProfile`

***

### ProfileArtifact

Defined in: [lifecycle/types.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L64)

A discrete, individually-promotable piece of an agent profile.

`kind` selects the profile lever; `payload` is the kind-specific value; `key`
is the profile-field key the payload lands under (the tool name, the MCP server
name, the subagent name — unused for `prompt`, which appends). `id` is stable:
once registered, it never changes, so a marginal-lift measurement, a promotion
decision, and a ship record all reference the same artifact.

#### Type Parameters

##### K

`K` *extends* [`ArtifactKind`](#artifactkind) = [`ArtifactKind`](#artifactkind)

#### Properties

##### id

> **id**: `string`

Defined in: [lifecycle/types.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L66)

Stable id. Assigned by the registry at register time; never reassigned.

##### kind

> **kind**: `K`

Defined in: [lifecycle/types.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L67)

##### key?

> `optional` **key?**: `string`

Defined in: [lifecycle/types.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L74)

The profile-field key this artifact lands under (e.g. the tool name, the MCP
server name, the subagent name, the hook event). Optional for `prompt`
(instructions append, they have no key). Defaults to `id` when applying a
keyed artifact without an explicit key.

##### name

> **name**: `string`

Defined in: [lifecycle/types.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L76)

Human-facing label for review surfaces.

##### description?

> `optional` **description?**: `string`

Defined in: [lifecycle/types.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L78)

Optional one-line description of what this artifact does.

##### payload

> **payload**: [`ArtifactPayloads`](#artifactpayloads)\[`K`\]

Defined in: [lifecycle/types.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L79)

##### status

> **status**: [`ArtifactStatus`](#artifactstatus)

Defined in: [lifecycle/types.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L99)

Lifecycle status — the full artifact state machine:

  `candidate` → `active` → `decayed` (re-promotable)
                        ↘ `retired` (terminal)

  - `candidate` — registered, not yet promoted. The default at register time.
  - `active`    — passed the promotion gate and carries a measured held-back
                  lift; the only status `composeProfile` folds into a profile.
  - `decayed`   — was active, but a later re-measure (`driftWatch`) found its
                  lift fell below the keep-bar. Demoted out of the composed
                  profile; kept as an auditable record and a re-promotion
                  candidate if a future re-measure recovers the lift.
  - `retired`   — permanently removed from the active set (`dedupeArtifacts`
                  retires the weaker half of a non-stacking pair). Terminal.

The registry never auto-promotes; every transition is an explicit call
(`promote`/`promoteWithLift`/`demote`/`retire`).

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [lifecycle/types.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L101)

Free-form metadata (provenance, generation id, the measured lift, …).

## Type Aliases

### EvalRunner

> **EvalRunner** = (`profile`, `signal?`) => `Promise`\<[`EvalResult`](#evalresult)\>

Defined in: [lifecycle/marginal-lift.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L52)

Scores a profile. The caller wires this to whatever eval they run — a
`runLoop` rollout, a `runBenchmark` campaign, a `runAgentEval` cohort — and
returns the composite + cost. `signal` is forwarded for cancellation.

#### Parameters

##### profile

`AgentProfile`

##### signal?

`AbortSignal`

#### Returns

`Promise`\<[`EvalResult`](#evalresult)\>

***

### RefinePrompt

> **RefinePrompt** = (`ctx`) => `Promise`\<[`PromptDraft`](#promptdraft)[]\> \| [`PromptDraft`](#promptdraft)[]

Defined in: [lifecycle/prompt-generator.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/prompt-generator.ts#L65)

REFINE — incumbent-grounded rewrites. Given the lifecycle context, return
targeted edits OF the current prompt framing. The production implementation
drives `gepaProposer`; a test injects a pure function. Returns zero or more
drafts.

#### Parameters

##### ctx

[`GenerateContext`](#generatecontext)

#### Returns

`Promise`\<[`PromptDraft`](#promptdraft)[]\> \| [`PromptDraft`](#promptdraft)[]

***

### AuthorDiverseSeeds

> **AuthorDiverseSeeds** = (`ctx`, `count`) => `Promise`\<[`PromptDraft`](#promptdraft)[]\> \| [`PromptDraft`](#promptdraft)[]

Defined in: [lifecycle/prompt-generator.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/prompt-generator.ts#L74)

SEED — author N genuinely DIVERSE fresh instruction lines from the task spec,
NOT mutations of the incumbent. This is the local-minimum escape: each seed
MUST take a different framing so the population spans multiple basins. The
production implementation makes one LLM call at a non-trivial temperature; a
test injects a pure function. Returns up to `count` drafts.

#### Parameters

##### ctx

[`GenerateContext`](#generatecontext)

##### count

`number`

#### Returns

`Promise`\<[`PromptDraft`](#promptdraft)[]\> \| [`PromptDraft`](#promptdraft)[]

***

### DistillSkills

> **DistillSkills** = (`ctx`) => `Promise`\<[`SkillDraft`](#skilldraft)[]\> \| [`SkillDraft`](#skilldraft)[]

Defined in: [lifecycle/skill-generator.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/skill-generator.ts#L47)

DISTILL — create new skill drafts from the agent's history. Returns zero or
more drafts (zero is valid: nothing worth distilling this round). The
production implementation reflects over `ctx.traces` / `ctx.findings` with an
LLM; a test injects a pure function.

#### Parameters

##### ctx

[`GenerateContext`](#generatecontext)

#### Returns

`Promise`\<[`SkillDraft`](#skilldraft)[]\> \| [`SkillDraft`](#skilldraft)[]

***

### RefineSkill

> **RefineSkill** = (`draft`) => `Promise`\<[`SkillDraft`](#skilldraft)\> \| [`SkillDraft`](#skilldraft)

Defined in: [lifecycle/skill-generator.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/skill-generator.ts#L54)

REFINE — improve ONE distilled draft (wording, structure, examples). The
production implementation wraps `runSkillOpt`. Returns the refined draft; when
omitted from `skillGenerator`, the distilled draft is used as-is.

#### Parameters

##### draft

[`SkillDraft`](#skilldraft)

#### Returns

`Promise`\<[`SkillDraft`](#skilldraft)\> \| [`SkillDraft`](#skilldraft)

***

### BuildableKind

> **BuildableKind** = `"tool"` \| `"mcp"`

Defined in: [lifecycle/tool-generator.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/tool-generator.ts#L51)

The buildable surfaces — the kinds whose candidate IS code that must compile
 / serve, so building one is a fan-out-and-verify dispatch, not a one-shot.

***

### BuildCandidate

> **BuildCandidate** = (`ctx`, `index`, `signal`) => `Promise`\<[`BuiltCandidate`](#builtcandidate)\>

Defined in: [lifecycle/tool-generator.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/tool-generator.ts#L92)

BUILD ONE candidate. Given the lifecycle context and the index in the fan-out,
produce a fresh worktree implementation and report whether it verified. The
production implementation drives a real coding harness in a fresh worktree
(`worktreeBuildCandidate`); a test injects a pure function.

MUST NOT measure lift, gate, or register — that is the dispatch's / the
orchestrator's job. It only builds + verifies ONE sibling.

#### Parameters

##### ctx

[`GenerateContext`](#generatecontext)

##### index

`number`

##### signal

`AbortSignal`

#### Returns

`Promise`\<[`BuiltCandidate`](#builtcandidate)\>

***

### ArtifactKind

> **ArtifactKind** = `"skill"` \| `"tool"` \| `"mcp"` \| `"hook"` \| `"subagent"` \| `"prompt"`

Defined in: [lifecycle/types.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L32)

The profile levers an artifact can target. One-to-one with the §1.5 profile
surface (`prompt + skills + tools + mcp + hooks + subagents`). Each kind maps to
exactly one field of `AgentProfile`, so an artifact can be applied onto a
baseline profile deterministically (see `applyArtifact`).

***

### ArtifactStatus

> **ArtifactStatus** = `"candidate"` \| `"active"` \| `"decayed"` \| `"retired"`

Defined in: [lifecycle/types.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L112)

The artifact lifecycle states. `active` is the load-bearing one — it is the
sole status `composeProfile` folds into a deployable profile, and it is gated
by a measured held-back lift (the registry invariant). `decayed` and `retired`
are the two ways an artifact LEAVES the active set: a decayed artifact lost its
lift on re-measure (reversible — `driftWatch`), a retired one was deduped away
(terminal — `dedupeArtifacts`).

***

### ArtifactInput

> **ArtifactInput**\<`K`\> = `Omit`\<[`ProfileArtifact`](#profileartifact)\<`K`\>, `"id"` \| `"status"`\> & `object`

Defined in: [lifecycle/types.ts:117](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L117)

The input to `register` — everything on `ProfileArtifact` except the
 registry-owned `id` and `status`. An explicit `id` may be supplied for
 deterministic/idempotent registration; otherwise the registry assigns one.

#### Type Declaration

##### id?

> `optional` **id?**: `string`

##### status?

> `optional` **status?**: [`ArtifactStatus`](#artifactstatus)

#### Type Parameters

##### K

`K` *extends* [`ArtifactKind`](#artifactkind) = [`ArtifactKind`](#artifactkind)

## Variables

### liftMetadataKey

> `const` **liftMetadataKey**: `"measuredLift"` = `'measuredLift'`

Defined in: [lifecycle/registry.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/registry.ts#L30)

The metadata key under which the registry stores an artifact's measured held-
back lift. This is the registry INVARIANT's anchor: an artifact is `active`
IFF this key holds a finite number — see `promoteWithLift` and `liftOf`. The
lifecycle never promotes by status flag alone; the lift score is the receipt.
`driftWatch` overwrites it with the latest re-measure so `liftOf` always
reflects the most recent evidence.

***

### lifecycleReasonKey

> `const` **lifecycleReasonKey**: `"lifecycleReason"` = `'lifecycleReason'`

Defined in: [lifecycle/registry.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/registry.ts#L37)

The metadata key under which the registry records WHY an artifact left the
active set — the human-readable reason a `demote` (→ decayed) or `retire`
(→ retired) carried. Kept so a demotion/retirement is auditable, not silent.

## Functions

### applyArtifact()

> **applyArtifact**(`base`, `artifact`): `AgentProfile`

Defined in: [lifecycle/apply.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/apply.ts#L22)

Return a new profile with `artifact` merged onto `base`. Keyed kinds
(`tool`/`mcp`/`hook`/`subagent`) land under `artifact.key` (falling back to
`artifact.id`). `prompt` appends an instruction line; `skill` appends a
resource ref. Existing keys are overwritten by the artifact (the artifact is
the candidate being measured/promoted, so it wins on conflict).

#### Parameters

##### base

`AgentProfile`

##### artifact

[`ProfileArtifact`](#profileartifact)

#### Returns

`AgentProfile`

***

### applyArtifacts()

> **applyArtifacts**(`base`, `artifacts`): `AgentProfile`

Defined in: [lifecycle/apply.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/apply.ts#L61)

Apply many artifacts left-to-right; later artifacts win on key conflicts.

#### Parameters

##### base

`AgentProfile`

##### artifacts

readonly [`ProfileArtifact`](#profileartifact)\<[`ArtifactKind`](#artifactkind)\>[]

#### Returns

`AgentProfile`

***

### composeProfile()

> **composeProfile**(`registry`, `base`, `opts?`): `AgentProfile`

Defined in: [lifecycle/compose.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/compose.ts#L47)

Return a new profile with the top-`k` active artifacts (highest measured lift
first) applied onto `base`.

"Active" = promoted WITH a finite measured lift (`registry.liftOf` returns a
number) — the lifecycle invariant. Ties in lift fall back to registration
order (stable). With no `k`, every eligible artifact is folded in.

#### Parameters

##### registry

[`ArtifactRegistry`](#artifactregistry)

the catalog the loop populated

##### base

`AgentProfile`

the baseline profile to fold artifacts onto (the empty profile
                on a cold start)

##### opts?

[`ComposeProfileOptions`](#composeprofileoptions) = `{}`

`k` (top-k budget) and an optional `kind` filter

#### Returns

`AgentProfile`

#### Example

```ts
Cold start — fold the single best distilled skill back in:
  const composed = composeProfile(registry, emptyProfile, { kind: 'skill', k: 1 })
```

***

### dedupeArtifacts()

> **dedupeArtifacts**(`opts`): `Promise`\<[`DedupeResult`](#deduperesult)\>

Defined in: [lifecycle/dedupe.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/dedupe.ts#L108)

Pairwise stack-test the `active` artifacts and retire the redundant half of
each non-stacking pair.

For every unordered pair of active artifacts (optionally within one `kind`),
the combined lift is compared against the sum of individual lifts. A pair is
non-stacking when `combinedLift < liftA + liftB − tolerance`; the lower-lift
member is retired (ties retire the second-examined). An artifact retired by one
pair is removed from the remaining comparisons that cycle, so a cluster of
three mutually-redundant artifacts collapses to its single strongest member.

Cost is one shared baseline run, one re-measure per active artifact (cached
across the pairs it appears in), and one combined run per still-eligible pair.

#### Parameters

##### opts

[`DedupeOptions`](#dedupeoptions)

#### Returns

`Promise`\<[`DedupeResult`](#deduperesult)\>

#### Example

```ts
Retire skills that teach the same tactic as a stronger one:
  const out = await dedupeArtifacts({ registry, baseline, evalRunner, kind: 'skill' })
  if (out.retired.length) report(`retired ${out.retired.length} redundant skills`)
```

***

### driftWatch()

> **driftWatch**(`opts`): `Promise`\<[`DriftWatchResult`](#driftwatchresult)\>

Defined in: [lifecycle/drift-watch.ts:119](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/drift-watch.ts#L119)

Re-measure every `active` artifact and demote those whose held-back lift
decayed below the keep-bar.

For each `active` artifact (optionally filtered to one `kind`), this re-runs
`measureMarginalLift` over the supplied `baseline`, then applies the keep-bar:

  - ABSOLUTE: `currentLift > minLift` (default `> 0`), and
  - RELATIVE (when `maxRelativeDecay` is set AND a prior lift exists):
    `currentLift >= priorLift * (1 − maxRelativeDecay)`.

An artifact failing EITHER bar is demoted to `decayed` (recording the
re-measured lift + reason) and drops out of `composeProfile`. An artifact that
passes both bars stays `active`, with its recorded lift refreshed to the latest
measurement so `liftOf` never reports stale evidence.

The baseline "without" arm is scored ONCE and shared across all artifacts, so
the cost is `1 + (number of active artifacts)` eval runs.

#### Parameters

##### opts

[`DriftWatchOptions`](#driftwatchoptions)

#### Returns

`Promise`\<[`DriftWatchResult`](#driftwatchresult)\>

#### Example

```ts
A nightly cron that demotes any active artifact that lost its lift:
  const out = await driftWatch({ registry, baseline, evalRunner, minLift: 0 })
  if (out.demoted.length) report(`demoted ${out.demoted.length} decayed artifacts`)
```

***

### thresholdPromotionGate()

> **thresholdPromotionGate**(`minDelta?`): [`PromotionGate`](#promotiongate)

Defined in: [lifecycle/gate.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/gate.ts#L60)

The simplest honest gate: promote iff the candidate's marginal lift on the
held-back split clears `minDelta` (default `> 0`). It reads only the scalar
`scoreDelta`, so it works with any `EvalRunner` (no per-task records needed).

Use this when the eval is already scored ON the held-back split and you want a
threshold, not a significance test — e.g. a deterministic fixture domain, or a
cheap first pass before a paired-bootstrap gate. For paper-grade promotion on
noisy live evals, prefer `heldOutPromotionGate`.

#### Parameters

##### minDelta?

`number` = `0`

#### Returns

[`PromotionGate`](#promotiongate)

***

### heldOutPromotionGate()

> **heldOutPromotionGate**(`opts`): [`PromotionGate`](#promotiongate)

Defined in: [lifecycle/gate.ts:109](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/gate.ts#L109)

The paper-grade promotion gate: delegate to agent-eval's `HeldOutGate`, which
pairs the candidate and baseline per-task holdout records by (experimentId,
seed), runs a paired-bootstrap CI on the median delta, and checks the
overfit gap. Promotes only when the held-out generalization is real, not luck.

REQUIRES the eval to surface per-task records: `lift.withArtifact.runs` (the
candidate arm) and `lift.withoutArtifact.runs` (the baseline arm), each
carrying matched seeds with both `search` and `holdout` split scores. When the
records are absent, this gate FAILS LOUD — a held-out significance claim with
no per-task data behind it would be a fabricated number, which the
no-silent-fallback doctrine forbids. Use `thresholdPromotionGate` for evals
that only produce a scalar composite.

#### Parameters

##### opts

[`HeldOutPromotionGateOptions`](#heldoutpromotiongateoptions)

#### Returns

[`PromotionGate`](#promotiongate)

***

### measureMarginalLift()

> **measureMarginalLift**(`opts`): `Promise`\<[`MarginalLift`](#marginallift)\>

Defined in: [lifecycle/marginal-lift.ts:109](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L109)

Run the with/without ablation for `candidate` over `baseline` and return its
marginal score/cost contribution.

The "without" arm scores the baseline profile unchanged; the "with" arm scores
`applyArtifact(baseline, candidate)`. Both use the same `evalRunner`, so the
delta isolates the artifact's effect (eval method held constant). The baseline
arm is skipped when `baselineResult` is supplied.

#### Parameters

##### opts

[`MeasureMarginalLiftOptions`](#measuremarginalliftoptions)

#### Returns

`Promise`\<[`MarginalLift`](#marginallift)\>

#### Example

```ts
const lift = await measureMarginalLift({
    baseline,
    candidate: registry.get(id)!,
    evalRunner: (profile) => scoreProfileOnCohort(profile),
  })
  if (lift.scoreDelta > 0) registry.promote(lift.artifactId)
```

***

### promptGenerator()

> **promptGenerator**(`opts`): [`CandidateGenerator`](#candidategenerator)\<`"prompt"`\>

Defined in: [lifecycle/prompt-generator.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/prompt-generator.ts#L105)

Build a `CandidateGenerator` for the prompt surface. Each generation it pools
the refine arm (incumbent rewrites) and the seed arm (diverse fresh framings),
de-duplicates by instruction text, and emits each as a `prompt` artifact.

At least one of `refine` / `authorDiverseSeeds` MUST be provided — a generator
with neither has no way to produce a candidate and is a wiring bug, so it
throws at construction rather than silently returning `[]` every round.

#### Parameters

##### opts

[`PromptGeneratorOptions`](#promptgeneratoroptions)

#### Returns

[`CandidateGenerator`](#candidategenerator)\<`"prompt"`\>

#### Example

```ts
Production wiring (refine = gepaProposer, seed = LLM author):
  promptGenerator({
    refine: gepaRefine(llm, model),
    authorDiverseSeeds: routerSeedAuthor(llm, model),
  })
```

***

### productionPromptGenerator()

> **productionPromptGenerator**(`opts`): [`CandidateGenerator`](#candidategenerator)\<`"prompt"`\>

Defined in: [lifecycle/prompt-generator.ts:185](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/prompt-generator.ts#L185)

Production `promptGenerator`: refine via `gepaProposer`, seed via a
router-backed diverse author. The one call a consumer makes to grow prompt
artifacts with the real engines.

#### Parameters

##### opts

[`ProductionPromptGeneratorOptions`](#productionpromptgeneratoroptions)

#### Returns

[`CandidateGenerator`](#candidategenerator)\<`"prompt"`\>

***

### gepaRefine()

> **gepaRefine**(`llm`, `model`, `population`): [`RefinePrompt`](#refineprompt)

Defined in: [lifecycle/prompt-generator.ts:204](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/prompt-generator.ts#L204)

Wrap `gepaProposer` as a `RefinePrompt`. The proposer reflects on the
incumbent prompt (`ctx.baseline.prompt.systemPrompt`) and the trace findings
to propose `population` targeted rewrites. We feed it the generation-0
`ProposeContext` (no scored history yet inside one lifecycle round), so it
reflects on the current surface against its mutation primitives — exactly the
"polish the framing you already have" arm.

#### Parameters

##### llm

`LlmClientOptions`

##### model

`string`

##### population

`number`

#### Returns

[`RefinePrompt`](#refineprompt)

***

### routerSeedAuthor()

> **routerSeedAuthor**(`llm`, `model`, `temperature`): [`AuthorDiverseSeeds`](#authordiverseseeds)

Defined in: [lifecycle/prompt-generator.ts:234](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/prompt-generator.ts#L234)

A router-backed `AuthorDiverseSeeds`: one structured LLM call that authors
`count` instruction lines, each REQUIRED to take a distinct framing. The
prompt is grounded in the task spec (the incumbent system prompt as the spec
of WHAT the agent must do) plus the trace findings (what it gets wrong) — but
the model is told to author FRESH lines, not edits, so the output spans
basins the incumbent's neighborhood never reaches.

#### Parameters

##### llm

`LlmClientOptions`

##### model

`string`

##### temperature

`number`

#### Returns

[`AuthorDiverseSeeds`](#authordiverseseeds)

***

### createArtifactRegistry()

> **createArtifactRegistry**(): [`ArtifactRegistry`](#artifactregistry)

Defined in: [lifecycle/registry.ts:269](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/registry.ts#L269)

Construct an empty `ArtifactRegistry`.

#### Returns

[`ArtifactRegistry`](#artifactregistry)

***

### runLifecycle()

> **runLifecycle**(`opts`): `Promise`\<[`RunLifecycleResult`](#runlifecycleresult)\>

Defined in: [lifecycle/run-lifecycle.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/run-lifecycle.ts#L103)

Run ONE generation of the artifact lifecycle.

#### Parameters

##### opts

[`RunLifecycleOptions`](#runlifecycleoptions)

#### Returns

`Promise`\<[`RunLifecycleResult`](#runlifecycleresult)\>

#### Example

```ts
Cold start on a fixture domain (the closed loop in one call):
  const out = await runLifecycle({
    baseline: emptyProfile,
    domain: 'support-bot',
    generators: [skillGenerator({ distill, refine })],
    evalRunner: scoreOnHeldBackSplit,
    gate: thresholdPromotionGate(),
    traces: seededTraces,
  })
  const composed = composeProfile(out.registry, emptyProfile, { kind: 'skill' })
```

***

### skillGenerator()

> **skillGenerator**(`opts`): [`CandidateGenerator`](#candidategenerator)\<`"skill"`\>

Defined in: [lifecycle/skill-generator.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/skill-generator.ts#L74)

Build a `CandidateGenerator` for the skill surface that distills new skills
from history, then (optionally) refines them, and emits each as a `skill`
artifact carrying an inline `SKILL.md` resource ref.

#### Parameters

##### opts

[`SkillGeneratorOptions`](#skillgeneratoroptions)

#### Returns

[`CandidateGenerator`](#candidategenerator)\<`"skill"`\>

#### Example

```ts
Production wiring (distill = LLM reflection, refine = skillOpt):
  skillGenerator({
    distill: reflectiveDistill,   // creates the draft from traces
    refine: skillOptRefine,       // optimizes the draft
  })
```

***

### worktreeBuildCandidate()

> **worktreeBuildCandidate**(`opts`): [`BuildCandidate`](#buildcandidate)

Defined in: [lifecycle/tool-build.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/tool-build.ts#L72)

Build the production per-candidate seam for `buildableGenerator`. Each call to
the returned `BuildCandidate` cuts a fresh worktree, drives the harness to
implement + verify the surface, and reports the verified worktree (or
`verified:false` with the reason) back to the dispatch for ranking.

#### Parameters

##### opts

[`WorktreeBuildOptions`](#worktreebuildoptions)

#### Returns

[`BuildCandidate`](#buildcandidate)

***

### buildableGenerator()

> **buildableGenerator**(`opts`): [`CandidateGenerator`](#candidategenerator)\<[`BuildableKind`](#buildablekind)\>

Defined in: [lifecycle/tool-generator.ts:128](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/tool-generator.ts#L128)

Build a `CandidateGenerator` for a buildable surface (`tool` / `mcp`). Each
generation it fans out `fanout` parallel worktree builds, keeps the verified
ones, ranks them by held-back marginal lift, and emits the single best as one
artifact. Returns `[]` when no build verifies — the surface had nothing
shippable to contribute this round (a valid, common outcome for hard builds).

#### Parameters

##### opts

[`BuildableGeneratorOptions`](#buildablegeneratoroptions)

#### Returns

[`CandidateGenerator`](#candidategenerator)\<[`BuildableKind`](#buildablekind)\>

#### Example

```ts
Production wiring (build = real harness fan-out, rank = held-back eval):
  buildableGenerator({
    kind: 'mcp',
    buildCandidate: worktreeBuildCandidate({ repoRoot, harness: 'claude' }),
    evalRunner: scoreOnHeldBackSplit,
    fanout: 4,
  })
```
