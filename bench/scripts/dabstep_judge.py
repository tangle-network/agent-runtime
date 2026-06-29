#!/usr/bin/env python3
"""DABStep judge bridge.

Reads {"prediction": str, "golds": list} from stdin and delegates scoring to
the official DABStep grade.py module. This script owns no grading semantics.
"""

import argparse
import importlib.util
import json
import sys
from pathlib import Path


def load_grade(grade_file: Path):
    spec = importlib.util.spec_from_file_location("dabstep_grade", grade_file)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not import DABStep grade file: {grade_file}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.grade


def main() -> int:
    parser = argparse.ArgumentParser(description="Score one DABStep answer")
    parser.add_argument("--grade-file", required=True)
    args = parser.parse_args()

    try:
        payload = json.loads(sys.stdin.read())
        prediction = payload["prediction"]
        golds = payload["golds"]
        correct = bool(load_grade(Path(args.grade_file))(prediction, golds))
        print(json.dumps({"correct": correct, "score": 1.0 if correct else 0.0}))
        return 0
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
