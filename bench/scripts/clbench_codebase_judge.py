"""Deployable-checker bridge for CL-Bench (Continual) Codebase Adaptation.

CL-Bench's `codebase_adaptation` is the ONE domain whose scorer is a deployable
checker (not an oracle): it applies the instance's provided `test_patch` and runs
the project's pytest suite inside the instance's Docker image, keying off the exit
code — exactly the SWE-bench / commit0 regime. This bridge exposes that scorer as a
standalone (instance_id, patch) -> {success,status} call so our TypeScript gate can
rank K candidate patches by a verifier the agent could legitimately run itself.

Run it with CL-Bench's OWN venv + repo root on the path (its `src.tasks...` package):

    <clbench>/.venv/bin/python clbench_codebase_judge.py \
        --dataset <clbench>/data/codebase_adaptation/final-dataset.jsonl \
        --instance-id jazzband__tablib-534 --patch-file /tmp/candidate.patch
    # invoked with cwd=<clbench> so `import src.tasks...` resolves

Prints one JSON line: {"instance_id","success","status","error"}. Fail loud — a
Docker/import failure exits non-zero with the message on stderr, never a silent 0.
"""

from __future__ import annotations

import argparse
import json
import sys

from src.tasks.codebase_adaptation.evaluator import evaluate_submission


def load_instance(dataset_path: str, instance_id: str) -> dict:
    with open(dataset_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            if row.get("instance_id") == instance_id:
                return row
    raise SystemExit(f"instance_id not found in {dataset_path}: {instance_id}")


def main() -> None:
    ap = argparse.ArgumentParser(description="CL-Bench codebase_adaptation deployable judge")
    ap.add_argument("--dataset", required=True, help="path to final-dataset.jsonl")
    ap.add_argument("--instance-id", required=True)
    ap.add_argument("--patch-file", required=True, help="file holding the candidate unified git diff")
    args = ap.parse_args()

    instance = load_instance(args.dataset, args.instance_id)
    with open(args.patch_file, encoding="utf-8") as f:
        patch = f.read()

    # evaluate_submission spins the instance's Docker image, applies test_patch + the
    # candidate, runs pytest, and reports success on a clean exit. A genuine infra
    # failure raises — let it propagate (non-zero exit) so the caller never reads a
    # transport fault as a failed test.
    result = evaluate_submission(patch, instance)
    print(json.dumps({
        "instance_id": args.instance_id,
        "success": bool(result.success),
        "status": result.status,
        "error": (result.error or "")[:500],
    }))


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:  # infra/import failure — fail loud, do not emit a fake verdict
        print(f"clbench_codebase_judge: {type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(2)
