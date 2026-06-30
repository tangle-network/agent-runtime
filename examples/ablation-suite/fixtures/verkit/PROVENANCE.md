# verkit fixture — provenance, transformations, contamination

## What this is

A real, strongly-coupled, pure-Python library vendored as the source for a
reconstruction benchmark: the agent is given the library with every function body
replaced by `raise NotImplementedError`, plus the real test suite (read-only), and
must re-implement the bodies until the tests pass. Graded by real `pytest`.

## Upstream source (version-pinned)

- Upstream package: `semver` (python-semver) **3.0.4**
- sdist: `https://files.pythonhosted.org/packages/72/d1/d3159231aec234a59dd7d601e9dd9fe96f3afff15efd33c1070019b26132/semver-3.0.4.tar.gz`
- License: BSD-3-Clause (see `./LICENSE`)
- Files taken: `src/semver/version.py` (the `Version` value type), the public
  module-level functions from `src/semver/_deprecated.py`, the type aliases from
  `src/semver/_types.py`, and the `Version`-relevant test files from `tests/`.

## Why this library

- **Strongly coupled, many small entry points.** One value type plus 16 module-level
  functions, all sharing the same parse grammar, string format, and (the hard part)
  the prerelease *natural ordering* rule. A change to the shared ordering / parse /
  format logic fixes one family of tests and regresses another — the fix-one /
  break-another coupling. Unlike a parser (where one un-implemented tokenizer gates
  *all* partial credit), here `bump_major` can pass while `compare` fails, so partial
  credit is smooth — the same shape as the synthetic `long-coding-env-lite`.
- **Long but tractable.** 257 real tests across 11 files; ~276 implementation lines to
  write across 57 functions/methods. Not one-shot-solvable, not impossible.
- **Self-contained.** Pure Python, standard library only, zero runtime dependencies.
- **Real-test-graded.** Behaviour is pinned by the upstream pytest suite, not a judge.

## Transformations applied (real → vendored)

1. **Consolidated into one module** `verkit.py` (the writable artifact): the `Version`
   class + inlined `_types` aliases + plain module-level delegator functions. The
   delegators are the upstream `_deprecated.py` functions **without** the
   `@deprecated` decorator (the decorator only emits a warning; no test asserts the
   warning, so return values are identical — verified by the real suite passing
   257/257). The argparse CLI (`cli.py`) and its `cmd_*` wrappers are dropped (not
   exercised by the Version tests).
2. **Symbol + module rename (contamination mitigation):**
   - module `semver` → `verkit`
   - class `Version` → `Release`; alias `VersionInfo` → `ReleaseInfo`
   - internal type aliases `Version{Tuple,Dict,Iterator,Part}` → `Release{...}`
   - the same rename applied verbatim across the test files (so
     `match=`-asserted error messages such as `"Expected a Release type ..."`,
     `"Release part undefined"`, the `Release(...)` repr strings stay consistent).
3. **Beacon scrub:** explicit standard-name references in docstrings / messages
   (`SemVer`, `Semantic Versioning`, `semver.org`, `valid SemVer string`) were
   replaced with neutral phrasing. No test asserts on these strings.
4. **Minimal `conftest.py`:** provides only the `version` fixture (a `Release`),
   dropping the upstream doctest-namespace fixture and its `packaging` /
   `coerce` / `semverwithvprefix` imports.

`verkit_stub.py` is generated from `verkit.py` by `./stub.py` (AST transform: keep
every signature, decorator, docstring, and class/module-level data; replace each
function body with `raise NotImplementedError`). The one exception is `_comparator`,
a decorator applied at class-definition time — its body is kept real so the stubbed
module still *imports* and the runner reports a per-test failing list (rather than one
collection error). The agent rewrites the whole file anyway, so this does not give
away domain logic.

Regenerate the stub after editing `verkit.py`:

```
python3 stub.py verkit.py verkit_stub.py
```

## Calibration ($0, host pytest, no LLM)

- real `verkit.py`  → **257 / 257 pass**
- `verkit_stub.py`  → **0 pass**: 234 failed + 9 fixture-setup errors + `test_format.py`'s
  14 tests blocked at collection (that file constructs `Release(...)` at module scope, so the
  whole file errors during collection — 1 file-level error, which is why the pytest summary
  reads "10 errors"). 234 + 9 + 14 = 257; the 14 unblock once `__init__` is implemented.

`verkit-env.ts` runs `pytest` with `--continue-on-collection-errors` and scores
`passes / 257` (a fixed denominator), so collection-blocked files count as 0 rather
than shrinking the denominator.

## Contamination assessment (honest)

The mitigation (rename module + value type + symbols, scrub standard-name beacons)
defeats **verbatim recall** of python-semver's source: a model can no longer
`import semver` from memory and dump the file, and the public handles it would pattern
-match on are gone. It does **not** hide the underlying *semantics*: this is still a
three-part `MAJOR.MINOR.PATCH(-prerelease)(+build)` version scheme, and a strong model
will likely recognize it and reconstruct the spec-defined behaviour (basic
parse/compare/bump/str) largely from memory.

So treat the spec-covered surface as **contaminated** and the **library-idiosyncratic,
non-spec behaviour as the real signal** — and that is exactly where the coupling and
oscillation live:

- the prerelease *natural* ordering with mixed numeric/alphanumeric identifiers and
  unequal identifier counts (`_nat_cmp`),
- the `match` mini-language (`>=`, `!=`, bare version means `==`, exact error text),
- `optional_minor_and_patch` parsing,
- tuple/dict round-trips and `__getitem__` slicing semantics (negative-index and
  undefined-part `IndexError`s),
- `next_version`'s interaction with an existing prerelease/build,
- `is_compatible`'s major-0 special case,
- the exact `Type`/`Value`/`Attribute`/`IndexError` contracts (several are
  `match=`-asserted).

A from-memory model reliably gets these edge cases wrong, and because they share the
parse/format/ordering core, fixing one regresses another. **Bottom line:** this fixture
is well-suited to studying the *oscillation / fix-one-break-another* regime and as a
real long coding task; it is **not** a clean held-out capability probe for "can the
model do semantic versioning" (the spec half is memorized). For a fully
contamination-controlled task, use the synthetic `long-coding-env-lite` (every
convention value is seed-randomized and exists only in its tests).
