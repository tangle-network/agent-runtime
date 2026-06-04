# ProgramBench judge driver: materialize the worker's file-manifest submission
# (read from stdin, ===FILE:<path>=== envelopes) into a run-dir
# (<run>/<instance>/submission.tar.gz + <instance>.traj.json), pull the hidden
# test blobs with `programbench blob sync`, run `programbench eval`, then parse
# <instance>.eval.json applying the tests.json ignore mask. Emit
# {"passed","total","resolved"} as the LAST stdout line. Fail loud: any harness or
# Docker error prints {"error": "..."} and exits nonzero — never a fabricated score.

import argparse
import io
import json
import os
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path


def fail(msg: str) -> None:
    print(json.dumps({"error": msg}))
    sys.exit(1)


def parse_manifest(text: str) -> dict[str, str]:
    """Split the ===FILE:<path>=== envelope stream into {path: contents}."""
    files: dict[str, str] = {}
    parts = text.split("===FILE:")
    for part in parts[1:]:
        header, _, body = part.partition("\n")
        path = header.replace("===", "").strip()
        if path:
            files[path] = body
    return files


def run(cmd: list[str], cwd: str | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)


def main() -> None:
    ap = argparse.ArgumentParser(description="programbench single-instance judge")
    ap.add_argument("--instance", required=True)
    args = ap.parse_args()

    submission_text = sys.stdin.read()
    files = parse_manifest(submission_text)
    # A submission with no compile.sh cannot build; the harness scores it 0, which
    # is the honest fail-closed outcome — we still stage it so `total` is real.

    pb = os.environ.get("PROGRAMBENCH_BIN", "programbench")

    run_dir = tempfile.mkdtemp(prefix="programbench-run-")
    try:
        inst_dir = Path(run_dir) / args.instance
        inst_dir.mkdir(parents=True, exist_ok=True)

        # submission.tar.gz = gzipped tar of the agent's workspace files.
        tar_path = inst_dir / "submission.tar.gz"
        with tarfile.open(tar_path, "w:gz") as tar:
            for path, content in files.items():
                data = content.encode("utf-8")
                info = tarfile.TarInfo(name=path)
                info.size = len(data)
                # compile.sh must be executable for the harness to run it.
                info.mode = 0o755 if path.endswith(".sh") else 0o644
                tar.addfile(info, io.BytesIO(data))

        # Minimal trajectory file the harness expects alongside the submission.
        (inst_dir / f"{args.instance}.traj.json").write_text(json.dumps({"instance_id": args.instance, "steps": []}))

        # Pull the hidden behavioral test blobs for this instance.
        sync = run([pb, "blob", "sync", args.instance], cwd=run_dir)
        if sync.returncode != 0:
            fail(f"programbench blob sync failed: {sync.stderr.strip()[:600]}")

        # Run the cleanroom Docker image, build via compile.sh, run hidden tests.
        ev = run([pb, "eval", run_dir], cwd=run_dir)
        if ev.returncode != 0:
            fail(f"programbench eval failed: {ev.stderr.strip()[:800]}")

        eval_path = inst_dir / f"{args.instance}.eval.json"
        if not eval_path.exists():
            fail(f"programbench wrote no eval.json at {eval_path}: {ev.stdout.strip()[:400]}")

        report = json.loads(eval_path.read_text())
        if report.get("error_code"):
            fail(f"programbench eval error_code={report['error_code']}: {report.get('error_details')}")

        results = report.get("test_results", [])

        # Apply the tests.json ignore mask (the same logic `programbench info`
        # applies). The mask ships in the package data; load it if present.
        ignored: set[str] = set()
        try:
            import programbench  # noqa: F401
            from importlib import resources

            data = resources.files("programbench").joinpath("data/tests.json")
            if data.is_file():
                mask = json.loads(data.read_text())
                entry = mask.get(args.instance, {})
                ignored = set(entry.get("ignored_tests", []))
        except Exception:  # noqa: BLE001
            ignored = set()

        scored = [r for r in results if r.get("name") not in ignored]
        passed = sum(1 for r in scored if r.get("status") == "passed")
        total = len(scored)
        resolved = total > 0 and passed == total

        print(json.dumps({"passed": passed, "total": total, "resolved": resolved}))
    finally:
        import shutil

        shutil.rmtree(run_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
