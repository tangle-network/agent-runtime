import asyncio
import base64
import hashlib
import importlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import types
import unittest
from pathlib import Path


class _BaseAgent:
    def __init__(self, logs_dir, model_name=None, *args, **kwargs):
        self.logs_dir = Path(logs_dir)
        self.model_name = model_name


class _NonZeroAgentExitCodeError(RuntimeError):
    pass


class _AgentContext:
    def __init__(self):
        self.n_input_tokens = None
        self.n_cache_tokens = None
        self.n_output_tokens = None
        self.cost_usd = None
        self.metadata = None


class _NetworkAllowlist:
    def __init__(self, domains=None):
        self.domains = list(domains or [])


def _install_pier_stubs():
    modules = {
        name: types.ModuleType(name)
        for name in (
            "pier",
            "pier.agents",
            "pier.agents.base",
            "pier.agents.installed",
            "pier.agents.installed.base",
            "pier.environments",
            "pier.environments.base",
            "pier.models",
            "pier.models.agent",
            "pier.models.agent.context",
            "pier.models.agent.network",
        )
    }
    modules["pier.agents.base"].BaseAgent = _BaseAgent
    modules[
        "pier.agents.installed.base"
    ].NonZeroAgentExitCodeError = _NonZeroAgentExitCodeError
    modules["pier.environments.base"].BaseEnvironment = type("BaseEnvironment", (), {})
    modules["pier.models.agent.context"].AgentContext = _AgentContext
    modules["pier.models.agent.network"].NetworkAllowlist = _NetworkAllowlist
    sys.modules.update(modules)


_install_pier_stubs()
candidate = importlib.import_module("pier_agents.tangle_candidate")
contract_module = importlib.import_module("pier_agents.candidate_contract")
process_boundary_module = importlib.import_module("pier_agents.process_boundary")
workspace_boundary_module = importlib.import_module("pier_agents.workspace_boundary")
candidate._runtime_pier_version = lambda: "0.3.0"


class _LocalTangleCandidateAgent(candidate.TangleCandidateAgent):
    ISOLATE_CANDIDATE_USER = False

    async def _verify_pier_execution_identity(self, environment):
        del environment


class _Result:
    def __init__(self, return_code=0, stdout="", stderr=""):
        self.return_code = return_code
        self.stdout = stdout
        self.stderr = stderr


class _LocalEnvironment:
    def __init__(self):
        self.commands = []

    def agent_process_env(self, env):
        return {**os.environ, **(env or {})}

    async def upload_dir(self, source_dir, target_dir):
        shutil.copytree(source_dir, target_dir, dirs_exist_ok=True)

    async def upload_file(self, source_path, target_path):
        target = Path(target_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, target)

    async def exec(self, command, cwd=None, env=None, user=None, timeout_sec=None):
        del user
        self.commands.append(command)
        completed = subprocess.run(
            ["bash", "-c", command],
            cwd=cwd,
            env=env,
            capture_output=True,
            text=True,
            check=False,
            timeout=timeout_sec,
        )
        return _Result(completed.returncode, completed.stdout, completed.stderr)


class _CorruptingUploadEnvironment(_LocalEnvironment):
    async def upload_file(self, source_path, target_path):
        await super().upload_file(source_path, target_path)
        with Path(target_path).open("ab") as handle:
            handle.write(b"corrupted")


class _FailingWorkspaceCleanupEnvironment(_LocalEnvironment):
    async def exec(self, command, cwd=None, env=None, user=None, timeout_sec=None):
        if command.startswith("rm -f -- ") and "workspace-check-" in command:
            self.commands.append(command)
            return _Result(73, stderr="forced workspace cleanup failure")
        return await super().exec(command, cwd, env, user, timeout_sec)


class _LocalBoundaryHost:
    async def _exec(self, environment, command, **kwargs):
        check = kwargs.pop("check", True)
        result = await environment.exec(command=command, **kwargs)
        if check and result.return_code != 0:
            raise RuntimeError(result.stderr or f"boundary command exited {result.return_code}")
        return result


def _sha(raw):
    return f"sha256:{hashlib.sha256(raw).hexdigest()}"


def _canonical(value):
    return json.dumps(
        value, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode()


def _embedded(raw):
    return {
        "encoding": "base64",
        "content": base64.b64encode(raw).decode(),
        "sha256": _sha(raw),
        "byteLength": len(raw),
    }


def _workspace(files):
    material = {
        "kind": "agent-candidate-workspace-manifest",
        "files": [
            {
                "path": path,
                "mode": mode,
                "sha256": _sha(raw),
                "byteLength": len(raw),
            }
            for path, mode, raw in sorted(files)
        ],
    }
    manifest = _canonical(material)
    return {
        "kind": "agent-candidate-workspace-snapshot",
        "digest": _sha(manifest),
        "material": material,
        "manifest": _embedded(manifest),
        "archive": _embedded(b"fixture-archive"),
    }


def _git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()


def _fixture(root: Path):
    task_root = root / "execution-task"
    task_staging = root / "task-staging"
    candidate_root = root / "execution-candidate"
    candidate_staging = root / "candidate-staging"
    profile_staging = root / "profile-staging"
    sealed = root / "sealed"
    logs = root / "logs"
    task_root.mkdir()
    (task_staging / "src").mkdir(parents=True)
    candidate_staging.mkdir()
    profile_staging.mkdir()
    sealed.mkdir()

    status = b"not-ready\n"
    (task_root / "src").mkdir()
    (task_root / "src/status.txt").write_bytes(status)
    os.chmod(task_root / "src/status.txt", 0o644)
    (task_staging / "src/status.txt").write_bytes(status)
    os.chmod(task_staging / "src/status.txt", 0o644)
    subprocess.run(
        ["git", "init", "-b", "main", str(task_root)], check=True, capture_output=True
    )
    _git(task_root, "config", "user.email", "fixture@example.com")
    _git(task_root, "config", "user.name", "Fixture")
    _git(task_root, "add", "-A")
    _git(task_root, "commit", "-m", "base")
    base_commit = _git(task_root, "rev-parse", "HEAD")
    base_tree = _git(task_root, "rev-parse", "HEAD^{tree}")

    runner = (
        "import os, pathlib, sys, time\n"
        "root = pathlib.Path.cwd()\n"
        "profile = root / 'AGENTS.md'\n"
        "if not profile.exists():\n"
        "    profile = pathlib.Path(__file__).parent / 'AGENTS.md'\n"
        "assert profile.read_text() == 'fixture-profile\\n'\n"
        "assert sys.argv[-1] == 'make the task ready'\n"
        "if os.environ.get('FIXTURE_SLEEP'):\n"
        "    time.sleep(float(os.environ['FIXTURE_SLEEP']))\n"
        "attack = os.environ.get('FIXTURE_ATTACK')\n"
        "if attack == 'symlink':\n"
        "    profile.unlink()\n"
        "    profile.symlink_to('src/status.txt')\n"
        "elif attack == 'hardlink':\n"
        "    profile.unlink()\n"
        "    os.link(root / 'src/status.txt', profile)\n"
        "(root / 'src/status.txt').write_text('ready\\n')\n"
    ).encode()
    (candidate_staging / "runner.py").write_bytes(runner)
    os.chmod(candidate_staging / "runner.py", 0o755)
    profile = b"fixture-profile\n"
    (profile_staging / "AGENTS.md").write_bytes(profile)
    os.chmod(profile_staging / "AGENTS.md", 0o600)

    instruction = "make the task ready".encode()
    task_snapshot = _workspace([("src/status.txt", 0o644, status)])
    candidate_snapshot = _workspace([("runner.py", 0o755, runner)])
    profile_material = {
        "harness": "codex",
        "files": [
            {
                "relPath": "AGENTS.md",
                "mode": 0o600,
                "contentSha256": _sha(profile),
            }
        ],
        "env": {},
        "flags": [],
        "unsupported": [],
    }
    profile_raw = _canonical(profile_material)
    profile_digest = _sha(profile_raw)
    bundle_digest = f"sha256:{'b' * 64}"
    plan = {
        "kind": "agent-candidate-execution-plan-material",
        "bundleDigest": bundle_digest,
        "executionId": "pier-fixture-execution",
        "attempt": {"number": 1, "maxAttempts": 1, "retryPolicy": "none"},
        "task": {
            "benchmark": "pier-fixture",
            "benchmarkVersion": "1",
            "taskId": "fixture-1",
            "splitDigest": f"sha256:{'1' * 64}",
            "instruction": {
                "encoding": "utf8",
                "sha256": _sha(instruction),
                "byteLength": len(instruction),
                "delivery": {"kind": "argv-append"},
            },
            "repository": {
                "identity": "fixture/repository",
                "rootIdentity": "fixture/repository",
                "baseCommit": base_commit,
                "baseTree": base_tree,
            },
            "outcome": {"kind": "workspace"},
            "workspace": task_snapshot,
        },
        "workspaces": {
            "taskRoot": str(task_root),
            "candidateRoot": str(candidate_root),
        },
        "codeKind": "no-op",
        "candidateWorkspace": candidate_snapshot,
        "profile": {
            "planDigest": profile_digest,
            "targetWorkspace": "task",
            "mountPaths": ["AGENTS.md"],
        },
        "harness": "codex",
        "harnessVersion": "fixture",
        "container": {
            "source": "evaluator-task-container",
            "image": "ghcr.io/tangle-network/fixture:latest",
            "indexDigest": f"sha256:{'2' * 64}",
            "manifestDigest": f"sha256:{'3' * 64}",
            "platform": {"os": "linux", "architecture": "amd64"},
        },
        "model": {
            "policy": "single",
            "resolved": {
                "requested": "openai/gpt-5.4",
                "provider": "openai",
                "model": "gpt-5.4",
                "snapshot": "fixture",
                "reasoningEffort": "xhigh",
            },
            "access": {
                "kind": "evaluator-mediated",
                "grantDigest": f"sha256:{'4' * 64}",
                "network": {"mode": "disabled"},
            },
            "routes": [{"kind": "primary", "requested": "openai/gpt-5.4"}],
        },
        "launch": {
            "executable": "python3",
            "args": [{"kind": "public", "value": str(candidate_root / "runner.py")}],
            "env": {},
            "cwd": {"workspace": "task", "path": "."},
        },
        "memory": {"mode": "disabled"},
        "limits": {
            "timeoutMs": 60_000,
            "maxSteps": 8,
            "maxModelCalls": 0,
            "maxInputTokens": 0,
            "maxOutputTokens": 0,
            "maxCostUsd": 0,
        },
        "network": {"mode": "disabled"},
    }
    plan_raw = _canonical(plan)
    plan_digest = _sha(plan_raw)
    execution_evidence = {
        "kind": "agent-candidate-execution-plan",
        "digest": plan_digest,
        "material": plan,
        "artifact": _embedded(plan_raw),
    }
    profile_evidence = {
        "kind": "agent-profile-workspace-plan",
        "digest": profile_digest,
        "material": profile_material,
        "artifact": _embedded(profile_raw),
    }
    receipt = {
        "kind": "agent-candidate-materialization",
        "digestAlgorithm": "rfc8785-sha256",
        "bundleDigest": bundle_digest,
        "profilePlan": profile_evidence,
        "executionPlan": execution_evidence,
        "candidateWorkspace": candidate_snapshot,
        "codeKind": "no-op",
        "materializedTree": base_tree,
        "harness": "codex",
        "harnessVersion": "fixture",
        "container": plan["container"],
        "resolvedModel": plan["model"]["resolved"],
        "entrypoint": {
            "path": "runner.py",
            "sha256": _sha(runner),
            "byteLength": len(runner),
        },
    }
    receipt_raw = _canonical(receipt)
    plan_path = sealed / "execution-plan.json"
    receipt_path = sealed / "materialization-receipt.json"
    plan_path.write_bytes(plan_raw)
    receipt_path.write_bytes(receipt_raw)
    return {
        "plan_path": plan_path,
        "receipt_path": receipt_path,
        "receipt_digest": _sha(receipt_raw),
        "candidate_staging": candidate_staging,
        "task_staging": task_staging,
        "profile_staging": profile_staging,
        "candidate_root": candidate_root,
        "task_root": task_root,
        "logs": logs,
        "base_commit": base_commit,
        "plan": plan,
    }


def _rewrite_signed_plan(fixture):
    plan_raw = _canonical(fixture["plan"])
    plan_digest = _sha(plan_raw)
    receipt = json.loads(fixture["receipt_path"].read_text())
    receipt["executionPlan"] = {
        "kind": "agent-candidate-execution-plan",
        "digest": plan_digest,
        "material": fixture["plan"],
        "artifact": _embedded(plan_raw),
    }
    receipt["container"] = fixture["plan"]["container"]
    receipt["resolvedModel"] = fixture["plan"]["model"]["resolved"]
    receipt_raw = _canonical(receipt)
    fixture["plan_path"].write_bytes(plan_raw)
    fixture["receipt_path"].write_bytes(receipt_raw)
    fixture["receipt_digest"] = _sha(receipt_raw)


def _agent(fixture):
    evaluator_root = fixture["plan_path"].parent / "evaluator"
    candidate._CANDIDATE_UID = os.getuid()
    candidate._CANDIDATE_GID = os.getgid()
    candidate._EVALUATOR_ROOT = str(evaluator_root)
    candidate._CONTROL_ROOT = str(evaluator_root / "control")
    candidate._CANDIDATE_HOME = str(evaluator_root / "home")
    candidate._CANDIDATE_TMP = str(evaluator_root / "tmp")
    plan_digest = _sha(fixture["plan_path"].read_bytes())
    trace_env = {
        "TANGLE_CANDIDATE_EXECUTION_ID": fixture["plan"]["executionId"],
        "TANGLE_CANDIDATE_BUNDLE_DIGEST": fixture["plan"]["bundleDigest"],
        "TANGLE_CANDIDATE_EXECUTION_PLAN_DIGEST": plan_digest,
        "TANGLE_CANDIDATE_MATERIALIZATION_RECEIPT_DIGEST": fixture["receipt_digest"],
        "TANGLE_TRACE_RUN_ID": fixture["plan"]["executionId"],
    }
    return _LocalTangleCandidateAgent(
        logs_dir=fixture["logs"],
        model_name=fixture["plan"]["model"]["resolved"]["requested"],
        plan_path=str(fixture["plan_path"]),
        receipt_path=str(fixture["receipt_path"]),
        expected_receipt_digest=fixture["receipt_digest"],
        trace_run_id=fixture["plan"]["executionId"],
        task_dir=str(fixture["task_staging"]),
        candidate_dir=str(fixture["candidate_staging"]),
        profile_dir=str(fixture["profile_staging"]),
        pier_version="0.3.0",
        extra_env=trace_env,
    )


class WorkspaceBoundaryTest(unittest.TestCase):
    def test_large_workspace_identity_is_not_serialized_into_one_command(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = _fixture(Path(directory))
            agent = _agent(fixture)
            environment = _LocalEnvironment()
            workspace = Path(directory) / "large-workspace"
            long_parent = Path("a" * 200) / ("b" * 200)
            (workspace / long_parent).mkdir(parents=True)
            files = []
            for index in range(326):
                relative = str(long_parent / f"file-{index:03d}.txt")
                raw = f"{index}\n".encode()
                (workspace / relative).write_bytes(raw)
                os.chmod(workspace / relative, 0o644)
                files.append(
                    contract_module.WorkspaceFile(
                        path=relative,
                        mode=0o644,
                        sha256=_sha(raw),
                        byte_length=len(raw),
                    )
                )

            identity_script = workspace_boundary_module._workspace_check_script(
                str(workspace),
                tuple(files),
                allow_task_metadata=False,
            )
            self.assertGreater(len(identity_script), 131_072)
            try:
                asyncio.run(
                    agent._workspace_boundary.verify_container_workspace(
                        environment,
                        str(workspace),
                        tuple(files),
                        allow_task_metadata=False,
                    )
                )
            finally:
                agent._snapshots.cleanup()

            self.assertTrue(environment.commands)
            self.assertLess(
                max(len(command.encode("utf-8")) for command in environment.commands),
                32 * 1024,
            )
            self.assertTrue(
                any(command.startswith("/bin/sh ") for command in environment.commands)
            )
            control = fixture["plan_path"].parent / "evaluator" / "control"
            self.assertEqual(list(control.glob("workspace-check-*.sh")), [])
            self.assertEqual(list(control.glob(".tangle-*")), [])

    def test_workspace_identity_rejects_every_file_identity_mutation(self):
        for mutation in (
            "content",
            "length",
            "mode",
            "missing",
            "extra",
            "symlink",
            "hardlink",
            "fifo",
        ):
            with (
                self.subTest(mutation=mutation),
                tempfile.TemporaryDirectory() as directory,
            ):
                fixture = _fixture(Path(directory))
                agent = _agent(fixture)
                environment = _LocalEnvironment()
                workspace = Path(directory) / "workspace"
                workspace.mkdir()
                original = b"signed\n"
                target = workspace / "signed.txt"
                target.write_bytes(original)
                os.chmod(target, 0o644)
                files = (
                    contract_module.WorkspaceFile(
                        path="signed.txt",
                        mode=0o644,
                        sha256=_sha(original),
                        byte_length=len(original),
                    ),
                )
                if mutation == "content":
                    target.write_bytes(b"tigned\n")
                elif mutation == "length":
                    target.write_bytes(b"signed-longer\n")
                elif mutation == "mode":
                    os.chmod(target, 0o755)
                elif mutation == "missing":
                    target.unlink()
                elif mutation == "extra":
                    (workspace / "unsigned.txt").write_text("unsigned\n")
                elif mutation == "symlink":
                    outside = Path(directory) / "outside.txt"
                    outside.write_bytes(original)
                    target.unlink()
                    target.symlink_to(outside)
                elif mutation == "hardlink":
                    os.link(target, Path(directory) / "second-link.txt")
                else:
                    target.unlink()
                    os.mkfifo(target)

                try:
                    with self.assertRaises(candidate.PierCandidateError):
                        asyncio.run(
                            agent._workspace_boundary.verify_container_workspace(
                                environment,
                                str(workspace),
                                files,
                                allow_task_metadata=False,
                            )
                        )
                finally:
                    agent._snapshots.cleanup()
                control = fixture["plan_path"].parent / "evaluator" / "control"
                self.assertEqual(list(control.glob("workspace-check-*.sh")), [])
                self.assertEqual(list(control.glob(".tangle-*")), [])

    def test_failed_staged_workspace_check_cleans_up(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = _fixture(Path(directory))
            agent = _agent(fixture)
            environment = _LocalEnvironment()
            workspace = Path(directory) / "workspace"
            workspace.mkdir()
            original = b"signed\n"
            target = workspace / "signed.txt"
            target.write_bytes(original)
            os.chmod(target, 0o644)
            files = (
                contract_module.WorkspaceFile(
                    path="signed.txt",
                    mode=0o644,
                    sha256=_sha(original),
                    byte_length=len(original),
                ),
            )
            target.write_bytes(b"tigned\n")
            try:
                with self.assertRaises(candidate.PierCandidateError):
                    asyncio.run(
                        agent._workspace_boundary.verify_container_workspace(
                            environment,
                            str(workspace),
                            files,
                            allow_task_metadata=False,
                        )
                    )
            finally:
                agent._snapshots.cleanup()
            self.assertTrue(
                any(command.startswith("/bin/sh ") for command in environment.commands)
            )
            control = fixture["plan_path"].parent / "evaluator" / "control"
            self.assertEqual(list(control.glob("workspace-check-*.sh")), [])
            self.assertEqual(list(control.glob(".tangle-*")), [])

    def test_workspace_identity_quotes_shell_metacharacters(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = _fixture(Path(directory))
            agent = _agent(fixture)
            environment = _LocalEnvironment()
            workspace = Path(directory) / "quoted-workspace"
            workspace.mkdir()
            names = (
                "-leading.txt",
                "$(printf injected).txt",
                "*.glob",
                "apostrophe's.txt",
                "space name.txt",
            )
            files = []
            for name in names:
                raw = f"{name}\n".encode()
                target = workspace / name
                target.write_bytes(raw)
                os.chmod(target, 0o644)
                files.append(
                    contract_module.WorkspaceFile(
                        path=name,
                        mode=0o644,
                        sha256=_sha(raw),
                        byte_length=len(raw),
                    )
                )
            try:
                asyncio.run(
                    agent._workspace_boundary.verify_container_workspace(
                        environment,
                        str(workspace),
                        tuple(sorted(files, key=lambda file: file.path)),
                        allow_task_metadata=False,
                    )
                )
            finally:
                agent._snapshots.cleanup()
            self.assertEqual(
                sorted(path.name for path in workspace.iterdir()), sorted(names)
            )

    def test_workspace_identity_rejects_corrupted_staged_program_and_cleans_up(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = _fixture(Path(directory))
            agent = _agent(fixture)
            environment = _CorruptingUploadEnvironment()
            workspace = Path(directory) / "workspace"
            workspace.mkdir()
            raw = b"signed\n"
            target = workspace / "signed.txt"
            target.write_bytes(raw)
            os.chmod(target, 0o644)
            files = (
                contract_module.WorkspaceFile(
                    path="signed.txt",
                    mode=0o644,
                    sha256=_sha(raw),
                    byte_length=len(raw),
                ),
            )
            try:
                with self.assertRaises(candidate.PierCandidateError):
                    asyncio.run(
                        agent._workspace_boundary.verify_container_workspace(
                            environment,
                            str(workspace),
                            files,
                            allow_task_metadata=False,
                        )
                    )
            finally:
                agent._snapshots.cleanup()
            control = fixture["plan_path"].parent / "evaluator" / "control"
            self.assertEqual(list(control.glob("workspace-check-*.sh")), [])
            self.assertEqual(list(control.glob(".tangle-*")), [])

    def test_workspace_check_preserves_primary_failure_when_cleanup_also_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = _fixture(Path(directory))
            agent = _agent(fixture)
            environment = _FailingWorkspaceCleanupEnvironment()
            workspace = Path(directory) / "workspace"
            workspace.mkdir()
            original = b"signed\n"
            target = workspace / "signed.txt"
            target.write_bytes(b"tigned\n")
            os.chmod(target, 0o644)
            files = (
                contract_module.WorkspaceFile(
                    path="signed.txt",
                    mode=0o644,
                    sha256=_sha(original),
                    byte_length=len(original),
                ),
            )
            try:
                with self.assertRaisesRegex(
                    candidate.PierCandidateError,
                    r"candidate bridge command failed \(1\): /bin/sh",
                ) as raised:
                    asyncio.run(
                        agent._workspace_boundary.verify_container_workspace(
                            environment,
                            str(workspace),
                            files,
                            allow_task_metadata=False,
                        )
                    )
            finally:
                agent._snapshots.cleanup()
            self.assertTrue(
                any(
                    "workspace check cleanup failed" in note
                    and "forced workspace cleanup failure" in note
                    for note in raised.exception.__notes__
                )
            )


class CandidateContractTest(unittest.TestCase):
    def test_loads_exact_runtime_artifacts_and_rejects_plan_substitution(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = _fixture(Path(directory))
            loaded = contract_module.load_prepared_candidate_contract(
                fixture["plan_path"],
                fixture["receipt_path"],
                fixture["receipt_digest"],
            )
            self.assertEqual(loaded.execution_id, "pier-fixture-execution")
            self.assertEqual(loaded.instruction.delivery_kind, "argv-append")
            self.assertEqual(loaded.model_network_domains, ())

            fixture["plan"]["executionId"] = "substituted"
            fixture["plan_path"].write_bytes(_canonical(fixture["plan"]))
            with self.assertRaisesRegex(
                contract_module.CandidateContractError, "does not bind"
            ):
                contract_module.load_prepared_candidate_contract(
                    fixture["plan_path"],
                    fixture["receipt_path"],
                    fixture["receipt_digest"],
                )

    def test_rejects_extra_utf8_file_delivery_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = _fixture(Path(directory))
            fixture["plan"]["task"]["instruction"]["delivery"] = {
                "kind": "utf8-file",
                "env": "TANGLE_CANDIDATE_TASK_PATH",
                "path": "/tangle/input/task.txt",
                "ignored": "unsigned-semantics",
            }
            fixture["plan"]["launch"]["env"] = {
                "TANGLE_CANDIDATE_TASK_PATH": {
                    "kind": "public",
                    "value": "/tangle/input/task.txt",
                }
            }
            _rewrite_signed_plan(fixture)

            with self.assertRaisesRegex(
                contract_module.CandidateContractError, "unexpected fields"
            ):
                contract_module.load_prepared_candidate_contract(
                    fixture["plan_path"],
                    fixture["receipt_path"],
                    fixture["receipt_digest"],
                )

    def test_rejects_obsolete_contract_version_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = _fixture(Path(directory))
            fixture["plan"]["schemaVersion"] = 1
            _rewrite_signed_plan(fixture)

            with self.assertRaisesRegex(
                contract_module.CandidateContractError, "obsolete version fields"
            ):
                contract_module.load_prepared_candidate_contract(
                    fixture["plan_path"],
                    fixture["receipt_path"],
                    fixture["receipt_digest"],
                )

    def test_accepts_only_frozen_public_model_gateway_domains(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = _fixture(Path(directory))
            fixture["plan"]["limits"]["maxModelCalls"] = 1
            fixture["plan"]["model"]["access"]["network"] = {
                "mode": "gateway-only",
                "domains": ["router.tangle.tools"],
            }
            _rewrite_signed_plan(fixture)
            loaded = contract_module.load_prepared_candidate_contract(
                fixture["plan_path"],
                fixture["receipt_path"],
                fixture["receipt_digest"],
            )
            self.assertEqual(
                loaded.model_network_domains, ("router.tangle.tools",)
            )
            agent = _agent(fixture)
            try:
                self.assertEqual(
                    agent.network_allowlist().domains,
                    ["router.tangle.tools"],
                )
            finally:
                agent._snapshots.cleanup()

    def test_rejects_wildcard_or_unsorted_model_gateway_domains(self):
        for domains in (
            ["*.tangle.tools"],
            ["router.tangle.tools", "api.openai.com"],
        ):
            with (
                self.subTest(domains=domains),
                tempfile.TemporaryDirectory() as directory,
            ):
                fixture = _fixture(Path(directory))
                fixture["plan"]["limits"]["maxModelCalls"] = 1
                fixture["plan"]["model"]["access"]["network"] = {
                    "mode": "gateway-only",
                    "domains": domains,
                }
                _rewrite_signed_plan(fixture)
                with self.assertRaises(contract_module.CandidateContractError):
                    contract_module.load_prepared_candidate_contract(
                        fixture["plan_path"],
                        fixture["receipt_path"],
                        fixture["receipt_digest"],
                    )

    def test_rejects_model_gateway_when_call_budget_is_zero(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = _fixture(Path(directory))
            fixture["plan"]["model"]["access"]["network"] = {
                "mode": "gateway-only",
                "domains": ["router.tangle.tools"],
            }
            _rewrite_signed_plan(fixture)
            with self.assertRaisesRegex(
                contract_module.CandidateContractError, "zero-call plans"
            ):
                contract_module.load_prepared_candidate_contract(
                    fixture["plan_path"],
                    fixture["receipt_path"],
                    fixture["receipt_digest"],
                )

    def test_rejects_unsigned_candidate_workspace_files(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = _fixture(Path(directory))
            (fixture["candidate_staging"] / "unsigned.py").write_text("bad\n")
            with self.assertRaisesRegex(
                contract_module.CandidateContractError, "file set differs"
            ):
                _agent(fixture)

    def test_rejects_container_image_with_embedded_digest(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = _fixture(Path(directory))
            fixture["plan"]["container"]["image"] += f"@sha256:{'9' * 64}"
            _rewrite_signed_plan(fixture)
            with self.assertRaisesRegex(
                contract_module.CandidateContractError, "unpinned OCI reference"
            ):
                contract_module.load_prepared_candidate_contract(
                    fixture["plan_path"],
                    fixture["receipt_path"],
                    fixture["receipt_digest"],
                )


class TangleCandidateAgentTest(unittest.TestCase):
    def test_process_stop_acknowledges_candidate_identity_is_empty(self):
        boundary = process_boundary_module.CandidateProcessBoundary(
            _LocalBoundaryHost(),
            process_boundary_module.ProcessBoundaryConfig(
                uid=2_000_000_000,
                gid=2_000_000_000,
                evaluator_root="/tmp/unused-evaluator",
                control_root="/tmp/unused-control",
                home="/tmp/unused-home",
                temporary="/tmp/unused-tmp",
            ),
        )
        asyncio.run(boundary.kill_and_wait(_LocalEnvironment()))

    def test_executes_exact_instruction_and_excludes_profile_from_patch(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = _fixture(Path(directory))
            agent = _agent(fixture)
            environment = _LocalEnvironment()
            context = _AgentContext()
            asyncio.run(agent.setup(environment))
            self.assertEqual(
                (fixture["task_root"] / "AGENTS.md").read_text(),
                "fixture-profile\n",
            )
            asyncio.run(agent.run("make the task ready", environment, context))

            self.assertEqual(
                (fixture["task_root"] / "src/status.txt").read_text(), "ready\n"
            )
            self.assertFalse((fixture["task_root"] / "AGENTS.md").exists())
            changed = _git(
                fixture["task_root"],
                "diff",
                "--name-only",
                f"{fixture['base_commit']}..HEAD",
            ).splitlines()
            self.assertEqual(changed, ["src/status.txt"])
            self.assertEqual(context.n_input_tokens, None)
            self.assertEqual(context.cost_usd, None)
            self.assertEqual(context.metadata["executionId"], "pier-fixture-execution")
            self.assertEqual(
                context.metadata["termination"], {"kind": "exit", "exitCode": 0}
            )
            self.assertEqual(
                context.metadata["usageSource"], "protected-agent-eval-trace"
            )

    def test_rejects_instruction_substitution_before_launch(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = _fixture(Path(directory))
            agent = _agent(fixture)
            environment = _LocalEnvironment()
            asyncio.run(agent.setup(environment))
            with self.assertRaisesRegex(
                candidate.PierCandidateError, "instruction bytes do not match"
            ):
                asyncio.run(agent.run("different task", environment, _AgentContext()))

    def test_candidate_target_profile_still_captures_task_solution(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = _fixture(Path(directory))
            fixture["plan"]["profile"]["targetWorkspace"] = "candidate"
            _rewrite_signed_plan(fixture)
            agent = _agent(fixture)
            environment = _LocalEnvironment()
            context = _AgentContext()
            asyncio.run(agent.setup(environment))
            asyncio.run(agent.run("make the task ready", environment, context))

            changed = _git(
                fixture["task_root"],
                "diff",
                "--name-only",
                f"{fixture['base_commit']}..HEAD",
            ).splitlines()
            self.assertEqual(changed, ["src/status.txt"])
            self.assertEqual(
                (fixture["task_root"] / "src/status.txt").read_text(), "ready\n"
            )

    def test_enforces_exact_signed_timeout(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = _fixture(Path(directory))
            fixture["plan"]["launch"]["env"] = {
                "FIXTURE_SLEEP": {"kind": "public", "value": "0.25"}
            }
            fixture["plan"]["limits"]["timeoutMs"] = 10
            _rewrite_signed_plan(fixture)
            agent = _agent(fixture)
            environment = _LocalEnvironment()
            context = _AgentContext()
            asyncio.run(agent.setup(environment))
            started = time.monotonic()
            with self.assertRaises(asyncio.TimeoutError):
                asyncio.run(agent.run("make the task ready", environment, context))
            self.assertLess(time.monotonic() - started, 0.2)
            self.assertEqual(context.metadata["termination"]["kind"], "timeout")
            self.assertEqual(context.metadata["termination"]["timeoutMs"], 10)

    def test_profile_cleanup_does_not_follow_candidate_links(self):
        for attack in ("symlink", "hardlink"):
            with (
                self.subTest(attack=attack),
                tempfile.TemporaryDirectory() as directory,
            ):
                fixture = _fixture(Path(directory))
                fixture["plan"]["launch"]["env"] = {
                    "FIXTURE_ATTACK": {"kind": "public", "value": attack}
                }
                _rewrite_signed_plan(fixture)
                agent = _agent(fixture)
                environment = _LocalEnvironment()
                context = _AgentContext()
                asyncio.run(agent.setup(environment))
                asyncio.run(agent.run("make the task ready", environment, context))

                self.assertFalse((fixture["task_root"] / "AGENTS.md").exists())
                self.assertEqual(
                    (fixture["task_root"] / "src/status.txt").read_text(),
                    "ready\n",
                )
                changed = _git(
                    fixture["task_root"],
                    "diff",
                    "--name-only",
                    f"{fixture['base_commit']}..HEAD",
                ).splitlines()
                self.assertEqual(changed, ["src/status.txt"])

    def test_rejects_symlinked_candidate_root_ancestor(self):
        with tempfile.TemporaryDirectory() as directory:
            fixture = _fixture(Path(directory))
            alias = Path(directory) / "aliased-parent"
            alias.symlink_to(fixture["task_root"], target_is_directory=True)
            candidate_root = alias / "candidate"
            fixture["plan"]["workspaces"]["candidateRoot"] = str(candidate_root)
            fixture["plan"]["launch"]["args"] = [
                {"kind": "public", "value": str(candidate_root / "runner.py")}
            ]
            _rewrite_signed_plan(fixture)
            agent = _agent(fixture)
            with self.assertRaises(candidate.PierCandidateError):
                asyncio.run(agent.setup(_LocalEnvironment()))


if __name__ == "__main__":
    unittest.main()
