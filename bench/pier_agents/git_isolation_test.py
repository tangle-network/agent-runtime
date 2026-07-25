import asyncio
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from pier_agents import tangle_candidate_test as support


candidate = support.candidate
_CANDIDATE_UID = 65532
_CANDIDATE_GID = 65532
_CLEAN_GIT_ENV = {
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_CONFIG_GLOBAL": "/dev/null",
    "GIT_CONFIG_SYSTEM": "/dev/null",
    "GIT_NO_REPLACE_OBJECTS": "1",
    "GIT_TERMINAL_PROMPT": "0",
    "LC_ALL": "C",
}


def _safe_git(root, *args):
    git_env = support.workspace_boundary_module.candidate_git_env(str(root))
    return subprocess.check_output(
        [*shlex.split(candidate._evaluator_git(str(root))), *args],
        env={**os.environ, **_CLEAN_GIT_ENV, **git_env},
        text=True,
    ).strip()


def _require(condition, message):
    if not condition:
        raise AssertionError(message)


def _write_candidate_probes(task_root):
    sidecar = task_root / ".sidecar"
    hooks = sidecar / "hooks"
    hooks.mkdir(parents=True)
    marker = sidecar / "invoked"
    marker_path = shlex.quote(str(marker))
    probes = {
        sidecar
        / "fsmonitor.sh": f"#!/bin/sh\nprintf 'fsmonitor\\n' >> {marker_path}\nprintf '\\n'\n",
        sidecar
        / "clean-filter.sh": f"#!/bin/sh\nprintf 'filter\\n' >> {marker_path}\ncat\n",
        hooks / "pre-commit": f"#!/bin/sh\nprintf 'hook\\n' >> {marker_path}\n",
    }
    for path, body in probes.items():
        path.write_text(body)
        path.chmod(0o755)
    (sidecar / "private.txt").write_text("evaluator metadata\n")
    (task_root / ".gitattributes").write_text("src/status.txt filter=candidate\n")
    return sidecar, hooks, marker


def _run_isolated_case():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        root.chmod(0o755)
        with mock.patch.dict(os.environ, _CLEAN_GIT_ENV):
            fixture = support._fixture(root)
        agent = support._agent(fixture)
        environment = support._LocalEnvironment()
        asyncio.run(agent.setup(environment))

        task_root = fixture["task_root"]
        sidecar, hooks, marker = _write_candidate_probes(task_root)
        subprocess.run(
            [
                "chown",
                "-R",
                f"{_CANDIDATE_UID}:{_CANDIDATE_GID}",
                task_root,
                fixture["candidate_root"],
            ],
            check=True,
        )
        candidate_command = [
            "setpriv",
            f"--reuid={_CANDIDATE_UID}",
            f"--regid={_CANDIDATE_GID}",
            "--clear-groups",
            "--no-new-privs",
            "--bounding-set=-all",
            "--inh-caps=-all",
            "--ambient-caps=-all",
            "--",
            "env",
            "-i",
            f"PATH={candidate._FIXED_PATH}",
        ]
        subprocess.run(
            [
                *candidate_command,
                "python3",
                fixture["candidate_root"] / "runner.py",
                "make the task ready",
            ],
            cwd=task_root,
            check=True,
        )
        for key, value in (
            ("core.fsmonitor", sidecar / "fsmonitor.sh"),
            ("core.untrackedCache", "true"),
            ("core.hooksPath", hooks),
            ("protocol.file.allow", "always"),
            ("filter.candidate.clean", sidecar / "clean-filter.sh"),
            ("filter.candidate.required", "true"),
        ):
            subprocess.run(
                [*candidate_command, "git", "config", key, str(value)],
                cwd=task_root,
                check=True,
            )
        _require(
            (task_root / ".git/config").stat().st_uid == _CANDIDATE_UID,
            "repository config is not candidate-owned",
        )
        _require(not marker.exists(), "candidate setup invoked a Git probe")

        environment.commands.clear()
        asyncio.run(agent._restore_profile_and_capture_solution(environment))
        prefix = [
            "git",
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.untrackedCache=false",
            "-c",
            "protocol.file.allow=never",
            "-C",
            str(task_root),
        ]
        commands = [
            shlex.split(command)
            for command in environment.commands
            if command.startswith("git ")
        ]
        _require(
            all(argv[: len(prefix)] == prefix for argv in commands),
            "a post-candidate Git command omitted evaluator overrides",
        )
        expected_commands = [
            ["reset", "--mixed", fixture["base_commit"]],
            ["add", "-A", "--", ".", ":(exclude).sidecar"],
            [
                "rm",
                "-r",
                "-f",
                "--cached",
                "--ignore-unmatch",
                "--",
                "AGENTS.md",
            ],
            ["diff", "--cached", "--quiet"],
            ["commit", "-m", "capture candidate solution"],
        ]
        _require(
            [argv[len(prefix) :] for argv in commands] == expected_commands,
            "post-candidate Git command coverage changed",
        )
        _require(not marker.exists(), "evaluator Git invoked candidate-owned code")
        changed = _safe_git(
            task_root,
            "diff",
            "--name-only",
            f"{fixture['base_commit']}..HEAD",
        ).splitlines()
        _require(
            changed == [".gitattributes", "src/status.txt"],
            f"captured unexpected files: {changed}",
        )


class EvaluatorGitIsolationTest(unittest.TestCase):
    def test_evaluator_config_preserves_signed_object_format(self):
        for object_format, object_id in (("sha1", "a" * 40), ("sha256", "a" * 64)):
            with self.subTest(
                object_format=object_format
            ), tempfile.TemporaryDirectory() as directory:
                repository = Path(directory)
                subprocess.run(
                    [
                        "git",
                        "init",
                        "--quiet",
                        f"--object-format={object_format}",
                        repository,
                    ],
                    env={**os.environ, **_CLEAN_GIT_ENV},
                    check=True,
                )
                (repository / ".git/config").write_bytes(
                    candidate._evaluator_git_config(object_id)
                )
                observed = subprocess.check_output(
                    ["git", "-C", repository, "rev-parse", "--show-object-format"],
                    env={**os.environ, **_CLEAN_GIT_ENV},
                    text=True,
                ).strip()
                self.assertEqual(observed, object_format)

    def test_candidate_git_config_cannot_run_during_solution_capture(self):
        if shutil.which("setpriv") is None:
            self.skipTest("isolated-user test requires setpriv")
        root_prefix = [] if os.geteuid() == 0 else ["sudo", "-n"]
        if root_prefix and (
            shutil.which("sudo") is None
            or subprocess.run(
                [*root_prefix, "true"], check=False, capture_output=True
            ).returncode
            != 0
        ):
            self.skipTest("isolated-user test requires root or passwordless sudo")

        bench_root = Path(__file__).resolve().parents[1]
        command = [
            *root_prefix,
            "env",
            "PYTHONNOUSERSITE=1",
            f"PYTHONPATH={bench_root}",
            *(f"{name}={value}" for name, value in _CLEAN_GIT_ENV.items()),
            sys.executable,
            Path(__file__).resolve(),
            "--isolated-case",
        ]
        completed = subprocess.run(
            command,
            cwd=bench_root,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(
            completed.returncode,
            0,
            msg=f"stdout:\n{completed.stdout}\nstderr:\n{completed.stderr}",
        )


if __name__ == "__main__":
    if sys.argv[1:] == ["--isolated-case"]:
        _run_isolated_case()
    else:
        unittest.main()
