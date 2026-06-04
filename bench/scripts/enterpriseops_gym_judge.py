# EnterpriseOps-Gym judge driver. One subcommand the TS adapter shells out to:
#   judge --task-json PATH   (agent tool-call transcript on stdin)
#         -> {"success":bool,"passes":int,"total":int,"verifiers":[{name,passed}...]}
#
# This is the benchmark's OWN evaluation contract (ServiceNow/EnterpriseOps-Gym
# benchmark/verifier.py): tasks are scored on FINAL DATABASE STATE, not action
# sequences. The agent's tool-call transcript is replayed against the live,
# freshly-seeded gym MCP server (one HTTP POST per call to the server's /mcp
# endpoint); then each database_state verifier's SQL is executed via the gym
# server's /api/sql-runner endpoint and compared to expected_value under
# comparison_type (equals / greater_than / less_than / contains) — exactly the
# VerifierEngine._compare_values semantics. Per-task success = ALL verifiers pass
# (overall_success_rate); the fraction passing is the verifier_level_pass_rate.
#
# JSON is emitted as the LAST stdout line. Fail loud: an unreachable gym server,
# a non-database_state verifier we cannot run deterministically, or a malformed
# transcript prints {"error": "..."} and exits nonzero — never a fabricated score.

import argparse
import json
import sys
import urllib.error
import urllib.request


def fail(msg: str) -> None:
    print(json.dumps({"error": msg}))
    sys.exit(1)


def post_json(url: str, headers: dict, payload: dict, timeout: float = 30.0) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    for k, v in headers.items():
        req.add_header(k, str(v))
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
    return json.loads(raw) if raw.strip() else {}


def server_for_gym(servers: list, gym_name: str) -> dict:
    # The verifier names its target gym (gym_name); match it to the configured
    # server. A single-gym task falls back to the only configured server.
    by_name = {s.get("mcp_server_name"): s for s in servers}
    if gym_name in by_name:
        return by_name[gym_name]
    if len(servers) == 1:
        return servers[0]
    fail(f"verifier gym_name {gym_name!r} not in gym_servers_config ({sorted(by_name)})")


def replay_transcript(servers: list, transcript: list) -> None:
    # Replay each agent tool call against the live gym MCP server so the final DB
    # state reflects the agent's actions. The transcript is a list of
    # {"tool":..., "arguments":{...}, "gym_name"?:...} entries (the worker's
    # ordered tool calls). The server applies each call to its database; the
    # verifiers then read the resulting state. An empty transcript leaves the
    # seeded state untouched (the no-op-agent baseline → verifiers fail closed).
    if not transcript:
        return
    for i, call in enumerate(transcript):
        tool = call.get("tool")
        if not isinstance(tool, str) or not tool:
            fail(f"transcript[{i}] has no string 'tool' field: {call!r}")
        gym_name = call.get("gym_name")
        server = server_for_gym(servers, gym_name) if gym_name else servers[0]
        url = server["mcp_server_url"].rstrip("/") + "/mcp"
        headers = dict(server.get("context") or {})
        payload = {"tool": tool, "arguments": call.get("arguments") or {}}
        try:
            post_json(url, headers, payload)
        except urllib.error.URLError as e:
            fail(f"gym server unreachable at {url} replaying tool {tool!r}: {e}")
        except Exception as e:  # noqa: BLE001
            fail(f"tool call {tool!r} failed against {url}: {e}")


def run_sql(server: dict, query: str) -> object:
    url = server["mcp_server_url"].rstrip("/") + "/api/sql-runner"
    headers = dict(server.get("context") or {})
    try:
        out = post_json(url, headers, {"query": query})
    except urllib.error.URLError as e:
        fail(f"gym server unreachable at {url}: {e}")
    except Exception as e:  # noqa: BLE001
        fail(f"sql-runner POST to {url} failed: {e}")
    # The sql-runner returns the scalar/first-cell result. Accept the common
    # shapes (a bare value, {"result": v}, or rows -> first cell) without faking.
    if isinstance(out, dict):
        if "result" in out:
            return out["result"]
        if "rows" in out and out["rows"]:
            first = out["rows"][0]
            if isinstance(first, dict) and first:
                return next(iter(first.values()))
            if isinstance(first, list) and first:
                return first[0]
        if "error" in out:
            fail(f"sql-runner error for query {query!r}: {out['error']}")
    return out


def compare(actual: object, expected: object, comparison_type: str) -> bool:
    # Mirrors VerifierEngine._compare_values: equals / greater_than / less_than /
    # contains. Numeric comparisons coerce both sides to float; equals coerces to
    # match the SQL COUNT(*) integer against the JSON expected_value.
    if comparison_type == "equals":
        try:
            return float(actual) == float(expected)
        except (TypeError, ValueError):
            return str(actual) == str(expected)
    if comparison_type == "greater_than":
        return float(actual) > float(expected)
    if comparison_type == "less_than":
        return float(actual) < float(expected)
    if comparison_type == "contains":
        return str(expected) in str(actual)
    fail(f"unsupported comparison_type {comparison_type!r}")


def cmd_judge(args) -> None:
    raw_transcript = sys.stdin.read()
    try:
        task = json.load(open(args.task_json, encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        fail(f"reading task json {args.task_json} failed: {e}")

    servers = task.get("gym_servers_config")
    if isinstance(servers, str):
        servers = json.loads(servers)
    if not isinstance(servers, list) or not servers:
        fail("task has no gym_servers_config list")

    verifiers = task.get("verifiers")
    if isinstance(verifiers, str):
        verifiers = json.loads(verifiers)
    if not isinstance(verifiers, list) or not verifiers:
        fail("task has no verifiers list")

    # The transcript is JSON: either a list of tool-call objects or {"calls":[...]}.
    transcript: list = []
    if raw_transcript.strip():
        try:
            parsed = json.loads(raw_transcript)
        except Exception as e:  # noqa: BLE001
            fail(f"transcript is not valid JSON: {e}")
        transcript = parsed.get("calls", []) if isinstance(parsed, dict) else parsed
        if not isinstance(transcript, list):
            fail("transcript must be a JSON list of tool calls (or {\"calls\":[...]})")

    replay_transcript(servers, transcript)

    results = []
    passes = 0
    for v in verifiers:
        vtype = v.get("verifier_type")
        if vtype != "database_state":
            # Only the SQL state-checker is deterministic+deployable here; a
            # response_check / tool_execution verifier needs the live agent loop,
            # not this state replay. Fail loud rather than skip-and-inflate.
            fail(f"verifier {v.get('name')!r} has non-deterministic verifier_type {vtype!r}")
        cfg = v.get("validation_config") or {}
        query = cfg.get("query")
        if not isinstance(query, str) or not query.strip():
            fail(f"verifier {v.get('name')!r} has no SQL query")
        server = server_for_gym(servers, v.get("gym_name"))
        actual = run_sql(server, query)
        ok = compare(actual, cfg.get("expected_value"), cfg.get("comparison_type", "equals"))
        if ok:
            passes += 1
        results.append({"name": v.get("name"), "passed": bool(ok)})

    total = len(verifiers)
    print(
        json.dumps(
            {
                "success": passes == total,
                "passes": passes,
                "total": total,
                "verifiers": results,
            }
        )
    )


def main() -> None:
    ap = argparse.ArgumentParser(description="EnterpriseOps-Gym judge driver")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("judge")
    p.add_argument("--task-json", required=True)
    args = ap.parse_args()
    if args.cmd == "judge":
        cmd_judge(args)


if __name__ == "__main__":
    main()
