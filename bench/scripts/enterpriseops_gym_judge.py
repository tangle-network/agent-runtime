# EnterpriseOps-Gym judge driver.
#
# Scores a worker's tool-call transcript against a task's verifiers, deterministically,
# by REPLAYING the transcript into a FRESHLY-SEEDED gym database and then reading the
# verifier SQL back. The full deployable-checker loop (matches the official benchmark/
# executor.py protocol):
#
#   1. SEED   per gym: create an isolated database (its own database_id) from the task's
#             seed_database_file SQL snapshot via POST /api/seed-database. Every later call
#             targets that database via the `x-database-id` header, so concurrent judges on
#             one container never collide.
#   2. REPLAY each transcript call as an MCP JSON-RPC `tools/call` to /mcp (NOT a bare
#             {tool,arguments} POST, which the server accepts as a no-op 204 and never
#             executes). A tool-call HTTP error is the AGENT's mistake (wrong args / policy
#             violation) — counted + surfaced, never fatal; the verifiers score the result.
#             A transport failure (server down) IS fatal (fail loud, never a fake score).
#   3. VERIFY each database_state verifier's SQL via /api/sql-runner (parsing the server's
#             {"data":[{...}]} shape), compared to expected_value under comparison_type.
#   4. CLEAN  delete each seeded database (best-effort).
#
# Seed snapshots are resolved against EOPS_GYM_DBS_DIR (the unzipped gym_dbs.zip). A task
# whose server has no seed_database_file, or an unset EOPS_GYM_DBS_DIR, fails loud — an
# unseeded run would score every solve against the same default state (no signal).

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
import uuid


def fail(msg: str) -> None:
    print(json.dumps({"error": msg}))
    sys.exit(1)


def request(url: str, payload: dict, headers: dict, method: str = "POST", timeout: float = 60.0) -> str:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "application/json, text/event-stream")
    for k, v in (headers or {}).items():
        req.add_header(k, str(v))
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8")


def parse_body(raw: str) -> object:
    """Parse a JSON body OR an SSE `data: {...}` stream (the /mcp endpoint streams SSE)."""
    raw = raw.strip()
    if not raw:
        return {}
    if raw.startswith("event:") or raw.startswith("data:") or "\ndata:" in raw:
        matches = re.findall(r"data:\s*(\{.*\})", raw)
        if matches:
            return json.loads(matches[-1])
    return json.loads(raw)


def auth_headers(server: dict) -> dict:
    """Context auth headers (e.g. x-itsm-user-token) plus the per-run x-database-id."""
    headers = dict(server.get("context") or {})
    db_id = server.get("_database_id")
    if db_id:
        headers["x-database-id"] = db_id
    return headers


def server_for_gym(servers: list, gym_name: str) -> dict:
    by_name = {s.get("mcp_server_name"): s for s in servers}
    if gym_name in by_name:
        return by_name[gym_name]
    if len(servers) == 1:
        return servers[0]
    fail(f"verifier gym_name {gym_name!r} not in gym_servers_config ({sorted(by_name)})")


def seed_databases(servers: list, gym_dbs_dir: str) -> None:
    for s in servers:
        seed_file = s.get("seed_database_file")
        if not seed_file:
            fail(
                f"server {s.get('mcp_server_name')!r} has no seed_database_file — cannot seed a "
                "deterministic state (an unseeded run scores every solve against the same default DB)"
            )
        if not gym_dbs_dir:
            fail(
                "EOPS_GYM_DBS_DIR is unset — cannot resolve seed_database_file. Unzip gym_dbs.zip "
                "(from ServiceNow/EnterpriseOps-Gym) and set EOPS_GYM_DBS_DIR to its directory."
            )
        path = seed_file if os.path.isabs(seed_file) else os.path.join(gym_dbs_dir, seed_file)
        try:
            sql = open(path, encoding="utf-8").read()
        except Exception as e:  # noqa: BLE001
            fail(f"reading seed file {path} failed: {e}")
        db_id = "gate_" + uuid.uuid4().hex[:12]
        url = s["mcp_server_url"].rstrip("/") + "/api/seed-database"
        payload = {
            "database_id": db_id,
            "name": f"gate_{db_id}",
            "description": f"gate seed from {os.path.basename(seed_file)}",
            "sql_content": sql,
        }
        try:
            request(url, payload, {}, timeout=max(300.0, len(sql) / 1024))
        except Exception as e:  # noqa: BLE001
            fail(f"seed-database POST to {url} failed: {e}")
        s["_database_id"] = db_id


def delete_databases(servers: list) -> None:
    for s in servers:
        db_id = s.get("_database_id")
        if not db_id:
            continue
        url = s["mcp_server_url"].rstrip("/") + "/api/delete-database"
        try:
            request(url, {"database_id": db_id}, {}, method="DELETE", timeout=30)
        except Exception:  # noqa: BLE001
            pass  # best-effort cleanup; a leaked db never corrupts a future run (unique id)


def replay_transcript(servers: list, transcript: list) -> int:
    """Replay each call as an MCP tools/call. Returns the count of agent-side call errors
    (surfaced, never fatal). A transport failure fails loud."""
    errors = 0
    for i, call in enumerate(transcript):
        tool = call.get("tool")
        if not isinstance(tool, str) or not tool:
            errors += 1
            continue
        gym_name = call.get("gym_name")
        server = server_for_gym(servers, gym_name) if gym_name else servers[0]
        url = server["mcp_server_url"].rstrip("/") + "/mcp"
        payload = {
            "jsonrpc": "2.0",
            "id": i + 1,
            "method": "tools/call",
            "params": {"name": tool, "arguments": call.get("arguments") or {}},
        }
        try:
            raw = request(url, payload, auth_headers(server), timeout=60)
            result = parse_body(raw)
            # A JSON-RPC error or an isError tool result is the agent's mistake, not a judge
            # failure — count it so a wholesale replay failure is visible, but keep going.
            if isinstance(result, dict) and (result.get("error") or (result.get("result") or {}).get("isError")):
                errors += 1
        except urllib.error.HTTPError:
            errors += 1  # the agent issued a bad call (wrong args / policy) — verifiers score it
        except urllib.error.URLError as e:
            fail(f"gym server unreachable at {url} replaying tool {tool!r}: {e}")
        except Exception as e:  # noqa: BLE001
            fail(f"tool call {tool!r} against {url} failed unexpectedly: {e}")
    return errors


def run_sql(server: dict, query: str) -> object:
    url = server["mcp_server_url"].rstrip("/") + "/api/sql-runner"
    payload = {"query": query, "database_id": server.get("_database_id")}
    try:
        out = parse_body(request(url, payload, auth_headers(server), timeout=60))
    except urllib.error.URLError as e:
        fail(f"gym server unreachable at {url}: {e}")
    except Exception as e:  # noqa: BLE001
        fail(f"sql-runner POST to {url} failed: {e}")
    if isinstance(out, dict):
        if out.get("error"):
            fail(f"sql-runner error for query {query!r}: {out['error']}")
        # The gym server returns {"data":[{col:val}], ...}; older/other shapes use result/rows.
        for key in ("data", "rows"):
            rows = out.get(key)
            if rows:
                first = rows[0]
                if isinstance(first, dict) and first:
                    return next(iter(first.values()))
                if isinstance(first, list) and first:
                    return first[0]
                return first
        if "result" in out:
            return out["result"]
    return out


def compare(actual: object, expected: object, comparison_type: str) -> bool:
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

    transcript: list = []
    if raw_transcript.strip():
        try:
            parsed = json.loads(raw_transcript)
        except Exception as e:  # noqa: BLE001
            fail(f"transcript is not valid JSON: {e}")
        transcript = parsed.get("calls", []) if isinstance(parsed, dict) else parsed
        if not isinstance(transcript, list):
            fail('transcript must be a JSON list of tool calls (or {"calls":[...]})')

    gym_dbs_dir = os.environ.get("EOPS_GYM_DBS_DIR", "")
    seed_databases(servers, gym_dbs_dir)
    try:
        replay_errors = replay_transcript(servers, transcript)

        results = []
        passes = 0
        for v in verifiers:
            vtype = v.get("verifier_type")
            if vtype != "database_state":
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
                    "replay_calls": len(transcript),
                    "replay_errors": replay_errors,
                    "verifiers": results,
                }
            )
        )
    finally:
        delete_databases(servers)


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
