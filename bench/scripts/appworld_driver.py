# AppWorld engine driver. Two subcommands the TS adapter shells out to:
#   load     --split S [--limit N] [--ids a,b]   -> {"tasks":[{task_id,instruction}]}
#   evaluate --task-id T --split S  (solution code on stdin)
#                                                -> {"success":bool,"passes":int,"fails":int}
# evaluate runs the worker's solution in a fresh AppWorld(task_id=T) world, then
# AppWorld's OWN programmatic evaluator (world.evaluate().to_dict()) reports the
# verdict. JSON is emitted as the LAST stdout line. Fail loud: any engine error is
# printed as {"error": "..."} and exits nonzero — never a fabricated verdict.

import argparse
import itertools
import json
import os
import re
import sys
import time
import uuid


def _wall_elapsed() -> float:
    """Real elapsed wall-clock seconds. AppWorld freezes the whole `time` module
    inside its world context (time.monotonic / perf_counter / time() are all
    pinned to the task's fixed "now", and even a pre-captured reference is frozen
    by the freezegun-style patch). os.times()[4] is a syscall AppWorld does NOT
    patch, so it is the only clock that advances inside the context — use it for
    the per-episode deadline."""
    return os.times()[4]


def fail(msg: str) -> None:
    print(json.dumps({"error": msg}))
    sys.exit(1)


_CODE_RE = re.compile(r"```(?:python|py)?\s*\n(.*?)```", re.DOTALL)


def _extract_code(text: str) -> str:
    blocks = _CODE_RE.findall(text or "")
    return (blocks[-1] if blocks else "").strip()


def _router_chat(base: str, key: str, model: str, messages: list, timeout: float = 180.0, retries: int = 4):
    """One router chat-completion with retry on transient/429/5xx. Returns
    (content, input_tokens, output_tokens). Raises on exhausted retries. The
    react loop passes a short timeout + few retries so a single slow/hung turn
    cannot dominate the per-episode wall-clock deadline."""
    import httpx

    url = base.rstrip("/") + "/chat/completions"
    last = None
    for attempt in range(retries):
        try:
            r = httpx.post(
                url,
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json={"model": model, "messages": messages},
                timeout=timeout,
            )
            if r.status_code in (429, 500, 502, 503, 504):
                last = f"{r.status_code}: {r.text[:160]}"
                time.sleep(2**attempt)
                continue
            r.raise_for_status()
            d = r.json()
            content = (d["choices"][0]["message"].get("content") or "")
            usage = d.get("usage") or {}
            return content, int(usage.get("prompt_tokens", 0) or 0), int(usage.get("completion_tokens", 0) or 0)
        except Exception as e:  # noqa: BLE001
            last = str(e)
            if attempt < retries - 1:
                time.sleep(2**attempt)
                continue
            raise RuntimeError(f"router_chat failed after retries: {last}")
    raise RuntimeError(f"router_chat exhausted: {last}")


def _build_system(directive: str, world) -> str:
    sup = world.task.supervisor
    apps = list(getattr(world.task, "allowed_apps", []) or [])
    descs = getattr(world.task, "app_descriptions", "")
    desc_str = json.dumps(descs) if isinstance(descs, (dict, list)) else str(descs)
    return (
        f"You are an AI agent completing a digital task for your supervisor "
        f"{getattr(sup, 'first_name', '')} {getattr(sup, 'last_name', '')} "
        f"(email {getattr(sup, 'email', '')}, phone {getattr(sup, 'phone_number', '')}) "
        "by WRITING PYTHON that calls app APIs (the apis.<app>.<function>(...) surface).\n\n"
        f"Available apps: {', '.join(apps)}.\n"
        f"App descriptions: {desc_str[:1500]}\n\n"
        "How to work, one step per turn:\n"
        "- Discover APIs with apis.api_docs.show_api_descriptions(app_name='<app>') and "
        "apis.api_docs.show_api_doc(app_name='<app>', api_name='<api>') BEFORE calling them.\n"
        "- Get the supervisor's app passwords with apis.supervisor.show_account_passwords(), then log in "
        "to each app you use to obtain its access_token.\n"
        "- Write ONE short Python code block per turn. After it runs you SEE its OUTPUT (or error "
        "traceback) — use that to decide the next step.\n"
        "- You ONLY see what you print(): assign every API result to a variable AND print() it "
        "(e.g. `r = apis.spotify.login(...); print(r)`), otherwise you are flying blind.\n"
        "- Keep going until the task is genuinely complete — do not stop early or give up after a "
        "few steps; real tasks take many turns of inspect -> act -> check.\n"
        "- Iterate: inspect -> authenticate -> act -> verify. Do not guess API names or arguments.\n"
        "- When the task is fully done call apis.supervisor.complete_task(answer=<answer>) (include the "
        "answer if the task asks a question, otherwise apis.supervisor.complete_task()).\n"
        "- Reply with EXACTLY ONE fenced ```python block per turn and nothing else.\n\n"
        f"{directive}"
    )


def cmd_react(args) -> None:
    """Multi-turn REPL agent: the model writes a python block, the engine executes
    it in the PERSISTENT world, the output is fed back, and it iterates until it
    completes the task or hits max-turns. Then AppWorld's own evaluator scores it.
    Config (directive, model, router creds, max_turns) arrives as JSON on stdin so
    the candidate directive can be arbitrarily long. The directive is the optimized
    surface; the loop + contract are fixed."""
    cfg = {}
    raw = sys.stdin.read()
    if raw.strip():
        try:
            cfg = json.loads(raw)
        except Exception as e:  # noqa: BLE001
            fail(f"react config JSON parse failed: {e}")
    directive = str(cfg.get("directive", ""))
    model = str(cfg.get("model", "gpt-4o"))
    # 0 (the default) = unbounded: the agent runs until it calls
    # apis.supervisor.complete_task() (world.task_completed() flips True). A
    # positive value is a hard ceiling for ablations only.
    max_turns = int(cfg.get("max_turns", 0))
    # No-progress circuit breaker (NOT a turn cap): turn budget stays unbounded
    # for episodes that keep doing real work. This only ends an episode that has
    # gone `max_stall` consecutive turns producing NO new world state — i.e. the
    # model emits no runnable code, or repeats code with byte-identical output.
    # Without it a weak model can loop forever emitting prose/no-ops, never
    # reaching complete_task and never advancing — burning spend and blocking the
    # whole generation. A productive turn resets the counter, so genuine
    # multi-step exploration is never cut.
    max_stall = int(cfg.get("max_stall", 8))
    # Per-episode WALL-CLOCK deadline (seconds). The no-progress breaker is
    # turn-granular and cannot interrupt a wedge that happens INSIDE one turn
    # (a hung/slow LLM call, a long-running world.execute). This bounds total
    # episode time regardless of turn granularity. NOT a turn cap: a productive
    # AppWorld episode finishes well under this; it only cuts a stuck one. 0
    # disables it.
    episode_timeout_s = float(cfg.get("episode_timeout_s", 600))
    router_base = str(cfg.get("router_base", "https://router.tangle.tools/v1"))
    router_key = str(cfg.get("router_key") or os.environ.get("TANGLE_API_KEY", ""))
    if not router_key:
        fail("react: router_key/TANGLE_API_KEY required")

    try:
        from appworld import AppWorld
    except Exception as e:  # noqa: BLE001
        fail(f"appworld import failed: {e}")

    in_tok = 0
    out_tok = 0
    turns = 0
    turns_log: list = []
    try:
        with AppWorld(
            task_id=args.task_id,
            experiment_name="bench-react",
            raise_on_failure=False,
        ) as world:
            # Per-episode nonce: keeps each episode's requests distinct so router
            # response caching can never collapse two episodes (same task, different
            # directive) onto one cached completion. Semantically inert marker.
            nonce = uuid.uuid4().hex[:12]
            messages = [
                {"role": "system", "content": _build_system(directive, world)},
                {"role": "user", "content": f"Task: {world.task.instruction}\n\n[eval-session {nonce}]"},
            ]
            no_progress = 0
            last_output = None
            stop_reason = "max_turns"
            episode_start = _wall_elapsed()
            turn_iter = itertools.count() if max_turns <= 0 else range(max_turns)
            for turn in turn_iter:
                if episode_timeout_s > 0 and _wall_elapsed() - episode_start > episode_timeout_s:
                    stop_reason = "timeout"
                    break
                turns = turn + 1
                content, ui, uo = _router_chat(
                    router_base, router_key, model, messages, timeout=90.0, retries=2
                )
                in_tok += ui
                out_tok += uo
                code = _extract_code(content)
                messages.append({"role": "assistant", "content": content})
                if not code:
                    no_progress += 1
                    if no_progress >= max_stall:
                        stop_reason = "no_progress"
                        break
                    messages.append({
                        "role": "user",
                        "content": "Reply with exactly one ```python block that makes progress, "
                        "or call apis.supervisor.complete_task().",
                    })
                    continue
                output = world.execute(code)
                out_str = str(output)
                turns_log.append({"code": code[:600], "output": out_str[:600]})
                messages.append({"role": "user", "content": "OUTPUT:\n" + out_str[:4000]})
                # A turn that reproduces the previous output byte-for-byte made no
                # new progress; a distinct output resets the breaker.
                no_progress = no_progress + 1 if out_str == last_output else 0
                last_output = out_str
                if world.task_completed():
                    stop_reason = "completed"
                    break
                if no_progress >= max_stall:
                    stop_reason = "no_progress"
                    break
            evaluation = world.evaluate().to_dict()
    except Exception as e:  # noqa: BLE001
        fail(f"react of {args.task_id} failed: {e}")

    if "success" not in evaluation or "num_tests" not in evaluation:
        fail(f"evaluation dict missing success/num_tests keys: {sorted(evaluation.keys())}")
    passes = evaluation.get("passes", [])
    failures = evaluation.get("failures", [])
    n_pass = len(passes) if isinstance(passes, list) else int(passes or 0)
    n_fail = len(failures) if isinstance(failures, list) else int(failures or 0)
    print(
        json.dumps(
            {
                "success": bool(evaluation["success"]),
                "passes": n_pass,
                "fails": n_fail,
                "num_tests": int(evaluation["num_tests"]),
                "turns": turns,
                "stop_reason": stop_reason,
                "input_tokens": in_tok,
                "output_tokens": out_tok,
                "transcript": "\n---\n".join(
                    f"CODE:\n{t['code']}\nOUTPUT:\n{t['output']}" for t in turns_log[-3:]
                )[:1600],
            }
        )
    )


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

    p_react = sub.add_parser("react")
    p_react.add_argument("--task-id", required=True)
    p_react.add_argument("--split", required=True)

    args = ap.parse_args()
    if args.cmd == "load":
        cmd_load(args)
    elif args.cmd == "evaluate":
        cmd_evaluate(args)
    elif args.cmd == "react":
        cmd_react(args)


if __name__ == "__main__":
    main()
