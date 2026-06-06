# Commit0 judge driver: stage one repo at base_commit, apply the worker's diff
# (read from stdin) into src_dir, run the official commit0 pytest harness on a
# local Docker backend, and emit {"passed": int, "total": int} as the LAST stdout
# line. The TS adapter wraps this; scoring (passed+xfail)/total mirrors
# commit0.harness.evaluate. Fail loud: any harness/Docker error is printed as
# {"error": "..."} and a nonzero exit — never a fabricated pass count.

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


def fail(msg: str) -> None:
    print(json.dumps({"error": msg}))
    sys.exit(1)


def main() -> None:
    ap = argparse.ArgumentParser(description="commit0 single-instance judge")
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--split", required=True)
    ap.add_argument("--instance", required=True)  # e.g. commit-0/wcwidth
    ap.add_argument("--src-dir", required=True)
    ap.add_argument("--backend", default=os.environ.get("COMMIT0_BACKEND", "local"))
    ap.add_argument("--timeout", type=int, default=int(os.environ.get("COMMIT0_TIMEOUT", "1800")))
    args = ap.parse_args()

    diff = sys.stdin.read()
    if not diff.strip():
        # Empty implementation: nothing to apply → 0 of the suite passes. Stage the
        # repo anyway so `total` reflects the real test count (fail-closed, real).
        diff = ""

    try:
        from datasets import load_dataset
        from commit0.harness.setup import main as setup_main
        from commit0.harness.run_pytest_ids import main as run_tests
        from commit0.harness.get_pytest_ids import main as get_tests
        from commit0.harness.constants import BASE_BRANCH, RUN_PYTEST_LOG_DIR
        from commit0.harness.utils import get_hash_string
    except Exception as e:  # noqa: BLE001
        fail(f"commit0 import failed: {e}")

    repo_name = args.instance.split("/")[-1]
    ds = load_dataset(args.dataset, split=args.split)
    example = next((x for x in ds if x["instance_id"] == args.instance), None)
    if example is None:
        fail(f"instance not found in {args.dataset}: {args.instance}")

    # run_pytest_ids wants the SPACE-joined test-id STRING (e.g. "tests/a.py::t1 ...")
    # — NOT the dataset's test_dir — and keys its report dir on get_hash_string(that
    # same string). Passing test_dir ran zero tests and wrote the report under a
    # different hash, so the judge silently found nothing. get_tests reads the test-ids.
    test_ids = [t for t in get_tests(repo_name, 0) if t.strip()]
    test_ids_str = " ".join(test_ids)
    # setup.main checks out the stubbed repo onto BASE_BRANCH ("commit0") and the
    # worker's diff is committed there; run_pytest_ids resolves `branch` -> a git
    # commit (NOT a checkout) to diff against base_commit, so it must be the
    # branch the work actually lives on. The dataset short name is not a git ref.
    branch = BASE_BRANCH

    base_dir = tempfile.mkdtemp(prefix="commit0-base-")
    try:
        # Clone + checkout the stubbed base branch for just this repo.
        setup_main(args.dataset, args.split, repo_name, base_dir)

        repo_dir = Path(base_dir) / repo_name
        if not repo_dir.exists():
            fail(f"commit0 setup did not clone {repo_name} into {base_dir}")

        # Apply the worker's unified diff into the cloned repo (src only). git apply
        # tolerates a/ b/ prefixes; --reject is avoided so a bad hunk fails loud.
        if diff:
            patch_path = Path(base_dir) / "worker.diff"
            patch_path.write_text(diff)
            r = subprocess.run(
                ["git", "apply", "--whitespace=nowarn", str(patch_path)],
                cwd=str(repo_dir),
                capture_output=True,
                text=True,
            )
            if r.returncode != 0:
                # Retry with -p0 (diffs sometimes lack the a/ b/ prefix).
                r2 = subprocess.run(
                    ["git", "apply", "-p0", "--whitespace=nowarn", str(patch_path)],
                    cwd=str(repo_dir),
                    capture_output=True,
                    text=True,
                )
                if r2.returncode != 0:
                    fail(f"git apply failed: {r.stderr.strip()[:500]} / {r2.stderr.strip()[:500]}")
            subprocess.run(["git", "add", "-A"], cwd=str(repo_dir), check=False)
            subprocess.run(
                ["git", "-c", "user.email=bench@local", "-c", "user.name=bench", "commit", "-m", "worker"],
                cwd=str(repo_dir),
                capture_output=True,
                text=True,
            )

        # Run the official per-repo pytest harness on the requested backend.
        try:
            run_tests(
                args.dataset,
                args.split,
                base_dir,
                repo_name,
                branch,
                test_ids_str,
                False,  # coverage
                args.backend,
                args.timeout,
                1,  # num_cpus
                # Per-repo image is normally pre-built once via `commit0 build`; set
                # COMMIT0_REBUILD_IMAGE=1 to self-build on first touch (slow, multi-GB).
                rebuild_image=os.environ.get("COMMIT0_REBUILD_IMAGE") == "1",
                verbose=0,
            )
        except SystemExit:
            # run_pytest_ids ends with sys.exit(pytest_exit_code): 0 = all pass, nonzero
            # = some tests failed — the NORMAL graded/partial-credit case, NOT a harness
            # error. report.json is already written; fall through and read it.
            pass
        except BaseException as e:  # noqa: BLE001 — never exit silently on a real backend fault
            if isinstance(e, KeyboardInterrupt):
                raise
            import traceback

            fail(f"commit0 run_pytest_ids failed for {repo_name}: {e!r} | {traceback.format_exc()[-1200:]}")

        hashed = get_hash_string(test_ids_str)
        report_file = RUN_PYTEST_LOG_DIR / repo_name / branch / hashed / "report.json"
        if not report_file.exists():
            fail(f"commit0 wrote no report.json at {report_file}")

        report = json.loads(report_file.read_text())
        # pytest-json: new form has "created"+"tests"; old form is a flat list.
        if isinstance(report, dict) and "created" in report:
            calls = {x["nodeid"]: x.get("call", {}) for x in report.get("tests", []) if "call" in x}
            outcomes = [c.get("outcome") for c in calls.values()]
        else:
            outcomes = [x["outcome"] for x in report if x.get("when") == "call"]

        passed = sum(1 for o in outcomes if o in ("passed", "xfailed"))
        total = len(outcomes)
        # Fall back to the declared test-id count when the harness produced no call
        # records (e.g. collection error) so `total` is never a phantom 0.
        if total == 0:
            # COUNT of test ids, not their character lengths (get_tests returns a flat
            # list of node-id strings). Only fires on a collection error, where passed
            # is already 0 — but a phantom inflated total would still mislead a reader.
            total = len(test_ids)

        print(json.dumps({"passed": passed, "total": total}))
    finally:
        import shutil

        shutil.rmtree(base_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
