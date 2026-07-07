"""Terminal-Bench opencode agent with a coordination MCP mounted into the task container."""

import json
import os
import shlex
import subprocess
import time
from pathlib import Path

from terminal_bench.agents.base_agent import AgentResult
from terminal_bench.agents.failure_mode import FailureMode
from terminal_bench.terminal.tmux_session import TmuxSession

from tb_agents.opencode_router_agent import (
    _CONTAINER_DIR,
    OpenCodeRouterAgent,
)

DOCKER_BRIDGE_GATEWAY = os.environ.get("DOCKER_BRIDGE_GATEWAY", "172.17.0.1")
_WORKER_CONFIG_PATH = f"{_CONTAINER_DIR}/opencode-worker.json"
# The sidecar entrypoint, resolved relative to the bench dir (this file is bench/tb_agents/...).
_BENCH_DIR = Path(__file__).resolve().parent.parent
_REPO_DIR = _BENCH_DIR.parent
_SIDECAR_TS = _BENCH_DIR / "src" / "tb-supervisor-sidecar.mts"


def _resolve_tsx() -> list[str]:
    """Prefer the pinned local tsx binary (no npx download / no shell hook rewrite)."""
    for cand in (
        _BENCH_DIR / "node_modules" / ".bin" / "tsx",
        _REPO_DIR / "node_modules" / ".bin" / "tsx",
    ):
        if cand.exists():
            return [str(cand)]
    return ["npx", "tsx"]


class OpenCodeSupervisorAgent(OpenCodeRouterAgent):
    """`OpenCodeRouterAgent` + a coordination MCP mounted into the in-container opencode.

    Adds a host orchestration sidecar and the `mcp.coordination` config block; otherwise
    identical to Arm A. Worker model defaults to the same model as the supervisor.
    """

    def __init__(self, model_name: str, *args, **kwargs):
        super().__init__(model_name, *args, **kwargs)
        self._mcp_port: int | None = None
        self._sidecar: subprocess.Popen | None = None
        self._sidecar_stdout = None
        self._sidecar_port_file: Path | None = None
        self._sidecar_log_file: Path | None = None

    @staticmethod
    def name() -> str:
        return "agent-runtime-opencode-supervisor"

    def _mcp_url(self) -> str:
        return f"http://{DOCKER_BRIDGE_GATEWAY}:{self._mcp_port}/mcp"

    def _build_router_config(self) -> str:
        config = json.loads(super()._build_router_config())
        perm = config.setdefault("permission", {})
        perm.update(
            {
                "edit": "allow",
                "bash": "allow",
                "webfetch": "allow",
                "read": "allow",
                "write": "allow",
                "task": "allow",
                "plan_enter": "allow",
                "plan_exit": "allow",
                "question": "allow",
            }
        )
        if self._mcp_port is not None:
            config["mcp"] = {
                "coordination": {
                    "type": "remote",
                    "url": self._mcp_url(),
                    "enabled": True,
                }
            }
        return json.dumps(config)

    def _write_config_to_container(self, session: TmuxSession) -> None:
        super()._write_config_to_container(session)
        worker_config = OpenCodeRouterAgent._build_router_config(self)
        session.container.exec_run(
            [
                "sh",
                "-c",
                f"printf '%s' {shlex.quote(worker_config)} > {_WORKER_CONFIG_PATH}",
            ]
        )

    def _resolve_container_id(self, session: TmuxSession) -> str | None:
        return getattr(session.container, "id", None) or getattr(
            session.container, "short_id", None
        )

    def _start_sidecar(self, container_id: str, logging_dir: Path | None) -> None:
        base = logging_dir if logging_dir is not None else Path.cwd()
        base.mkdir(parents=True, exist_ok=True)
        self._sidecar_port_file = base / ".tb-sidecar-port"
        self._sidecar_log_file = base / "tb-sidecar-events.jsonl"
        self._sidecar_port_file.unlink(missing_ok=True)

        env = dict(os.environ)
        env.update(
            {
                "TB_TARGET_CONTAINER": container_id,
                "OPENAI_API_KEY": self._router_api_key,
                "OPENAI_BASE_URL": self._router_base_url,
                "WORKER_MODEL": self._model_name,
                "TB_SIDECAR_PORT_FILE": str(self._sidecar_port_file),
                "TB_SIDECAR_LOG": str(self._sidecar_log_file),
                "DOCKER_BRIDGE_GATEWAY": DOCKER_BRIDGE_GATEWAY,
            }
        )
        self._sidecar_stdout = open(base / "tb-sidecar.stdout.log", "w")
        self._logger.info("Starting orchestration sidecar for container %s", container_id)
        self._sidecar = subprocess.Popen(
            [*_resolve_tsx(), str(_SIDECAR_TS)],
            cwd=str(_BENCH_DIR),
            env=env,
            stdout=self._sidecar_stdout,
            stderr=subprocess.STDOUT,
        )
        deadline = time.time() + 60.0
        while time.time() < deadline:
            if self._sidecar.poll() is not None:
                raise RuntimeError(
                    f"orchestration sidecar exited early with code {self._sidecar.returncode} "
                    f"(see {base / 'tb-sidecar.stdout.log'})"
                )
            if self._sidecar_port_file.exists():
                txt = self._sidecar_port_file.read_text().strip()
                if txt.isdigit():
                    self._mcp_port = int(txt)
                    self._logger.info(
                        "Sidecar ready: mcp port=%d url=%s", self._mcp_port, self._mcp_url()
                    )
                    return
            time.sleep(0.5)
        raise RuntimeError("orchestration sidecar did not publish a port within 60s")

    def _stop_sidecar(self) -> None:
        if self._sidecar is None:
            return
        try:
            self._sidecar.terminate()
            try:
                self._sidecar.wait(timeout=30)
            except subprocess.TimeoutExpired:
                self._sidecar.kill()
        except Exception as e:  # noqa: BLE001 - teardown is never fatal
            self._logger.warning("Could not stop sidecar cleanly: %s", e)
        finally:
            if self._sidecar_stdout is not None:
                try:
                    self._sidecar_stdout.close()
                except Exception:  # noqa: BLE001
                    pass

    def _orchestration_summary(self) -> dict:
        summary: dict = {
            "settled": [],
            "worker_outputs": [],
            "history_len": 0,
            "worker_ran": False,
            "worker_tokens": {"input": 0, "output": 0},
        }
        if self._sidecar_log_file is None:
            return summary
        final = Path(str(self._sidecar_log_file) + ".final.json")
        try:
            if final.exists():
                data = json.loads(final.read_text())
                settled = data.get("settled", []) or []
                summary["settled"] = settled
                summary["worker_outputs"] = data.get("workerOutputs", []) or []
                summary["history_len"] = len(data.get("history", []) or [])
                summary["worker_tokens"] = data.get(
                    "workerTokens", {"input": 0, "output": 0}
                )
                summary["worker_ran"] = any(
                    isinstance(w, dict) and w.get("containerId")
                    for w in summary["worker_outputs"]
                ) or len(settled) > 0
        except Exception as e:  # noqa: BLE001
            self._logger.warning("Could not read orchestration summary: %s", e)
        return summary

    def perform_task(
        self,
        instruction: str,
        session: TmuxSession,
        logging_dir: Path | None = None,
    ) -> AgentResult:
        container_id = self._resolve_container_id(session)
        if not container_id:
            self._logger.error("Could not resolve container id for supervisor sidecar.")
            return AgentResult(failure_mode=FailureMode.UNKNOWN_AGENT_ERROR)

        try:
            self._start_sidecar(container_id, logging_dir)
        except Exception as e:  # noqa: BLE001
            self._logger.error("Sidecar failed to start: %s", e)
            self._mcp_port = None
            return AgentResult(failure_mode=FailureMode.UNKNOWN_AGENT_ERROR)

        try:
            supervised_instruction = (
                "You are the supervisor. You have an MCP server named \"coordination\" with "
                "tools including spawn_agent(profile, task), observe_agent(workerId), "
                "await_event(), and stop(). A spawned worker runs a full coding agent INSIDE "
                "THIS SAME container and its file changes persist here, so you may delegate "
                "concrete sub-tasks (e.g. \"install perl and 7z\", \"crack the hash with john\") "
                "to workers via spawn_agent, then observe_agent/await_event for their results. "
                "Delegate independent or heavy sub-tasks to workers when useful; do the rest "
                "yourself. Complete the task fully.\n\n"
                f"TASK:\n{instruction}"
            )
            result = super().perform_task(supervised_instruction, session, logging_dir)
        finally:
            self._stop_sidecar()

        summary = self._orchestration_summary()
        if logging_dir is not None:
            try:
                (logging_dir / "orchestration-summary.json").write_text(
                    json.dumps(summary, indent=2)
                )
            except Exception:  # noqa: BLE001
                pass
        self._logger.info(
            "Arm B orchestration: workers_settled=%d history_len=%d worker_ran=%s",
            len(summary.get("settled", [])),
            summary.get("history_len", 0),
            summary.get("worker_ran"),
        )
        wt = summary.get("worker_tokens") or {}
        worker_in = int(wt.get("input") or 0)
        worker_out = int(wt.get("output") or 0)
        if result.failure_mode == FailureMode.AGENT_INSTALLATION_FAILED:
            return result
        return AgentResult(
            total_input_tokens=result.total_input_tokens + worker_in,
            total_output_tokens=result.total_output_tokens + worker_out,
            failure_mode=result.failure_mode,
        )
