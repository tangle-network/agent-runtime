"""Custom Terminal-Bench agent that executes a precomputed shell script in the
task container, then returns control to the harness so the task's own verifier
scores the resulting container state.

This is the deterministic-judge seam for agent-runtime/bench: our worker produces
an *artifact* (the commands it ran to attempt the task) and the judge replays that
artifact in a fresh task container via `tb run --agent-import-path
tb_agents.script_agent:ScriptAgent --agent-kwarg script_path=<file>`. The harness
then runs the per-task tests exactly as it does for the oracle agent, so the score
comes from Terminal-Bench's published verifier — never a self-authored judge.

Mechanism mirrors terminal_bench.agents.oracle_agent.OracleAgent: copy the script
into the container and run it with `block=True`, so the agent step completes only
after the script finishes (or the harness agent-timeout fires).
"""

from pathlib import Path

from terminal_bench.agents.base_agent import AgentResult, BaseAgent
from terminal_bench.agents.failure_mode import FailureMode
from terminal_bench.terminal.tmux_session import TmuxSession


class ScriptAgent(BaseAgent):
    def __init__(self, script_path: str | None = None, **kwargs):
        super().__init__(**kwargs)
        if not script_path:
            raise ValueError(
                "ScriptAgent requires --agent-kwarg script_path=<path to the "
                "artifact script>. Got none."
            )
        path = Path(script_path)
        if not path.is_file():
            raise FileNotFoundError(f"ScriptAgent script_path not found: {path}")
        self._script_path = path

    @staticmethod
    def name() -> str:
        return "agent-runtime-script"

    def perform_task(
        self,
        instruction: str,
        session: TmuxSession,
        logging_dir: Path | None = None,
    ) -> AgentResult:
        # An empty artifact = no-op attempt (the must-fail control). Skip execution
        # so the verifier scores the untouched container — equivalent to the nop
        # agent — instead of running an empty script.
        if self._script_path.read_text().strip():
            session.copy_to_container(
                self._script_path,
                container_dir="/agent-runtime",
                container_filename="attempt.sh",
            )
            session.send_keys(
                ["bash /agent-runtime/attempt.sh", "Enter"],
                max_timeout_sec=float("inf"),
                block=True,
            )

        return AgentResult(
            total_input_tokens=0,
            total_output_tokens=0,
            failure_mode=FailureMode.NONE,
        )
