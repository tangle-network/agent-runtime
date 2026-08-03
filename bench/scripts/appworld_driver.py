# AppWorld engine driver. Two subcommands the TS adapter shells out to:
#   load     --split S [--limit N] [--ids a,b]   -> {"tasks":[{task_id,instruction}]}
#   evaluate --task-id T --split S  (solution code on stdin)
#                                                -> {"success":bool,"passes":int,"fails":int}
# evaluate runs the worker's solution in a fresh AppWorld(task_id=T) world, then
# AppWorld's OWN programmatic evaluator (world.evaluate().to_dict()) reports the
# verdict. JSON is emitted as the LAST stdout line. Fail loud: any engine error is
# printed as {"error": "..."} and exits nonzero — never a fabricated verdict.

import argparse
import json
import sys


def fail(msg: str) -> None:
    print(json.dumps({"error": msg}))
    sys.exit(1)


def cmd_session(args) -> None:
    """Dumb world shim: a persistent AppWorld session driven over stdin JSONL.
    NO LLM calls here — the agent loop lives in the runtime (routerToolLoop);
    this process only owns world state. One JSON object per line, both ways:
      {"op":"execute","code":"..."} -> {"output":"...","task_completed":bool}
      {"op":"evaluate"}             -> the evaluate verdict JSON (+failure_names)
    Emits {"ready":true,"instruction":...} on start; exits on stdin EOF."""
    try:
        from appworld import AppWorld
    except Exception as e:  # noqa: BLE001
        fail(f"appworld import failed: {e}")
    try:
        with AppWorld(
            task_id=args.task_id,
            experiment_name="bench-session",
            raise_on_failure=False,
        ) as world:
            print(json.dumps({"ready": True, "instruction": world.task.instruction}), flush=True)
            for line in sys.stdin:
                line = line.strip()
                if not line:
                    continue
                try:
                    cmd = json.loads(line)
                except Exception as e:  # noqa: BLE001
                    print(json.dumps({"error": f"bad command JSON: {e}"}), flush=True)
                    continue
                op = cmd.get("op")
                if op == "execute":
                    # An exception here is the AGENT's outcome (bad code), not an
                    # infra fault — feed it back, keep the world alive.
                    try:
                        output = str(world.execute(str(cmd.get("code", ""))))
                    except Exception as e:  # noqa: BLE001
                        output = f"EXECUTION ERROR: {e}"
                    print(
                        json.dumps(
                            {"output": output[:4000], "task_completed": bool(world.task_completed())}
                        ),
                        flush=True,
                    )
                elif op == "evaluate":
                    ev = world.evaluate().to_dict()
                    passes = ev.get("passes", [])
                    failures = ev.get("failures", [])
                    print(
                        json.dumps(
                            {
                                "success": bool(ev.get("success")),
                                "passes": len(passes) if isinstance(passes, list) else int(passes or 0),
                                "fails": len(failures) if isinstance(failures, list) else int(failures or 0),
                                "num_tests": int(ev.get("num_tests", 0)),
                                "failure_names": [str(f)[:160] for f in failures][:8]
                                if isinstance(failures, list)
                                else [],
                            }
                        ),
                        flush=True,
                    )
                else:
                    print(json.dumps({"error": f"unknown op: {op}"}), flush=True)
    except Exception as e:  # noqa: BLE001
        fail(f"session of {args.task_id} failed: {e}")


def cmd_load(args) -> None:
    try:
        from appworld import load_task_ids
    except Exception as e:  # noqa: BLE001
        fail(f"appworld import failed: {e}")

    try:
        ids = list(load_task_ids(args.split))
    except Exception as e:  # noqa: BLE001
        fail(f"load_task_ids({args.split}) failed: {e}")

    if args.ids:
        want = set(args.ids.split(","))
        ids = [i for i in ids if i in want]
    elif args.limit is not None:
        ids = ids[: args.limit]

    from appworld import AppWorld

    tasks = []
    for task_id in ids:
        # Open each world read-only just to read the instruction; close immediately.
        try:
            with AppWorld(task_id=task_id, experiment_name="bench-load") as world:
                tasks.append({"task_id": task_id, "instruction": world.task.instruction})
        except Exception as e:  # noqa: BLE001
            fail(f"opening task {task_id} failed: {e}")
    print(json.dumps({"tasks": tasks}))


def cmd_evaluate(args) -> None:
    code = sys.stdin.read()
    try:
        from appworld import AppWorld
    except Exception as e:  # noqa: BLE001
        fail(f"appworld import failed: {e}")

    try:
        with AppWorld(
            task_id=args.task_id,
            experiment_name="bench-eval",
            # An API error should surface to the agent's output, not crash the world.
            raise_on_failure=False,
        ) as world:
            if code.strip():
                world.execute(code)
            evaluation = world.evaluate().to_dict()
    except Exception as e:  # noqa: BLE001
        fail(f"evaluate of {args.task_id} failed: {e}")

    # TestTracker.to_dict() carries `success` (binary task-goal-completion),
    # `num_tests` (the authoritative per-requirement total), and the
    # `passes`/`failures` lists. `failures` (not `fails`) is the real key — read it
    # directly and never substitute a default count.
    if "success" not in evaluation or "num_tests" not in evaluation:
        fail(f"evaluation dict missing success/num_tests keys: {sorted(evaluation.keys())}")
    success = bool(evaluation["success"])
    passes = evaluation.get("passes", [])
    failures = evaluation.get("failures", [])
    n_pass = len(passes) if isinstance(passes, list) else int(passes or 0)
    n_fail = len(failures) if isinstance(failures, list) else int(failures or 0)
    print(
        json.dumps(
            {
                "success": success,
                "passes": n_pass,
                "fails": n_fail,
                "num_tests": int(evaluation["num_tests"]),
                # The failed sub-test names are the diagnosable evidence a trace
                # analyst steers on — bounded so the JSON line stays small.
                "failure_names": [str(f)[:160] for f in failures][:8]
                if isinstance(failures, list)
                else [],
            }
        )
    )


def main() -> None:
    ap = argparse.ArgumentParser(description="appworld engine driver")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_load = sub.add_parser("load")
    p_load.add_argument("--split", required=True)
    p_load.add_argument("--limit", type=int, default=None)
    p_load.add_argument("--ids", default=None)

    p_eval = sub.add_parser("evaluate")
    p_eval.add_argument("--task-id", required=True)
    p_eval.add_argument("--split", required=True)

    p_session = sub.add_parser("session")
    p_session.add_argument("--task-id", required=True)
    p_session.add_argument("--split", required=True)

    args = ap.parse_args()
    if args.cmd == "load":
        cmd_load(args)
    elif args.cmd == "evaluate":
        cmd_evaluate(args)
    elif args.cmd == "session":
        cmd_session(args)


if __name__ == "__main__":
    main()
