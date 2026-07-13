"""Strict reader for runtime-prepared candidate execution artifacts.

The TypeScript runtime is the authority that verifies bundles and creates the
canonical execution plan and materialization receipt.  This module performs the
small, security-critical replay checks needed before Pier copies those prepared
bytes into a task container.  It deliberately does not define another plan.
"""

from __future__ import annotations

import base64
import hashlib
import json
import math
import re
import stat
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any


_SHA256_RE = re.compile(r"^sha256:[a-f0-9]{64}$")
_GIT_OBJECT_RE = re.compile(r"^(?:[a-f0-9]{40}|[a-f0-9]{64})$")
_ENV_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_EXECUTABLE_RE = re.compile(r"^[A-Za-z0-9._+/-]+$")
_DNS_LABEL_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$")
_SHELLS = {"sh", "bash", "zsh", "fish", "cmd", "cmd.exe", "powershell", "pwsh"}
_BLOCKED_GATEWAY_DOMAINS = {
    "localhost",
    "metadata.google.internal",
    "metadata.google",
}
_RESERVED_PATH_PARTS = {".git", ".sidecar"}
_PLAN_KIND = "agent-candidate-execution-plan-material"
_RECEIPT_KIND = "agent-candidate-materialization"
_PROFILE_PLAN_KIND = "agent-profile-workspace-plan"
_EXECUTION_EVIDENCE_KIND = "agent-candidate-execution-plan"
_STDIN_TASK_PATH = "/tangle/input/stdin.txt"


class CandidateContractError(ValueError):
    """Prepared execution bytes are missing, malformed, or inconsistent."""


@dataclass(frozen=True)
class InstructionEvidence:
    sha256: str
    byte_length: int
    delivery_kind: str
    delivery_env: str | None = None
    delivery_path: str | None = None


@dataclass(frozen=True)
class WorkspaceFile:
    path: str
    mode: int
    sha256: str
    byte_length: int


@dataclass(frozen=True)
class ProfileFile:
    path: str
    mode: int
    sha256: str


@dataclass(frozen=True)
class PreparedCandidateContract:
    plan: dict[str, Any]
    plan_raw: bytes
    receipt: dict[str, Any]
    receipt_raw: bytes
    bundle_digest: str
    execution_id: str
    execution_plan_digest: str
    materialization_receipt_digest: str
    instruction: InstructionEvidence
    repository_base_commit: str
    repository_base_tree: str
    task_root: str
    candidate_root: str | None
    task_files: tuple[WorkspaceFile, ...]
    candidate_files: tuple[WorkspaceFile, ...]
    profile_target: str
    profile_files: tuple[ProfileFile, ...]
    executable: str
    args: tuple[str, ...]
    env: dict[str, str]
    cwd_root: str
    cwd_path: str
    timeout_ms: int
    requested_model: str
    resolved_model: dict[str, Any]
    model_network_domains: tuple[str, ...]
    container: dict[str, Any]


def sha256_bytes(data: bytes) -> str:
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


def _object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise CandidateContractError(f"{label} must be a JSON object")
    return value


def _string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value or "\0" in value:
        raise CandidateContractError(f"{label} must be a non-empty string without NUL")
    return value


def _integer(value: Any, label: str, *, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise CandidateContractError(f"{label} must be an integer >= {minimum}")
    return value


def _number(value: Any, label: str, *, minimum: float = 0) -> float:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or value < minimum
    ):
        raise CandidateContractError(f"{label} must be a finite number >= {minimum}")
    return float(value)


def _digest(value: Any, label: str) -> str:
    digest = _string(value, label)
    if not _SHA256_RE.fullmatch(digest):
        raise CandidateContractError(f"{label} must be sha256:<64 lowercase hex>")
    return digest


def _git_object(value: Any, label: str) -> str:
    object_id = _string(value, label)
    if not _GIT_OBJECT_RE.fullmatch(object_id):
        raise CandidateContractError(f"{label} must be a full Git object id")
    return object_id


def _safe_relative(value: Any, label: str, *, allow_dot: bool = False) -> str:
    path = _string(value, label)
    if any(ord(char) < 32 or ord(char) == 127 for char in path) or "\\" in path:
        raise CandidateContractError(f"{label} contains a forbidden character")
    parsed = PurePosixPath(path)
    if parsed.is_absolute():
        raise CandidateContractError(f"{label} must be relative")
    if path == ".":
        if allow_dot:
            return path
        raise CandidateContractError(f"{label} must identify a child path")
    parts = path.split("/")
    if any(
        not part or part in {".", ".."} or part in _RESERVED_PATH_PARTS
        for part in parts
    ):
        raise CandidateContractError(f"{label} must be a canonical safe relative path")
    return path


def _absolute(value: Any, label: str) -> str:
    path = _string(value, label)
    if any(ord(char) < 32 or ord(char) == 127 for char in path) or "\\" in path:
        raise CandidateContractError(f"{label} contains a forbidden character")
    parsed = PurePosixPath(path)
    if (
        not parsed.is_absolute()
        or path == "/"
        or ".." in parsed.parts
        or str(parsed) != path
    ):
        raise CandidateContractError(f"{label} must be a canonical absolute POSIX path")
    return path


def _public(value: Any, label: str) -> str:
    obj = _object(value, label)
    if set(obj) != {"kind", "value"} or obj.get("kind") != "public":
        raise CandidateContractError(f"{label} must be one explicit public value")
    return _string(obj.get("value"), f"{label}.value")


def _gateway_domain(value: Any, label: str) -> str:
    domain = _string(value, label)
    labels = domain.split(".")
    if (
        len(domain) > 253
        or domain != domain.lower()
        or domain.endswith(".")
        or ":" in domain
        or domain in _BLOCKED_GATEWAY_DOMAINS
        or domain.endswith(".localhost")
        or len(labels) < 2
        or not all(1 <= len(part) <= 63 and _DNS_LABEL_RE.fullmatch(part) for part in labels)
        or not re.search(r"[a-z]", labels[-1])
    ):
        raise CandidateContractError(
            f"{label} must be an exact lowercase public DNS name"
        )
    return domain


def _read_json(path: Path, label: str) -> tuple[dict[str, Any], bytes]:
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise CandidateContractError(f"cannot read {label} {path}: {exc}") from exc
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CandidateContractError(f"{label} is not valid UTF-8 JSON: {exc}") from exc
    return _object(value, label), raw


def _embedded_bytes(value: Any, label: str) -> bytes:
    artifact = _object(value, label)
    if artifact.get("encoding") != "base64" or not isinstance(
        artifact.get("content"), str
    ):
        raise CandidateContractError(f"{label} must embed exact base64 bytes")
    try:
        raw = base64.b64decode(artifact["content"], validate=True)
    except ValueError as exc:
        raise CandidateContractError(f"{label} contains invalid base64") from exc
    expected_digest = _digest(artifact.get("sha256"), f"{label}.sha256")
    expected_length = _integer(artifact.get("byteLength"), f"{label}.byteLength")
    if len(raw) != expected_length or sha256_bytes(raw) != expected_digest:
        raise CandidateContractError(f"{label} bytes do not match their identity")
    return raw


def _workspace_files(value: Any, label: str) -> tuple[WorkspaceFile, ...]:
    snapshot = _object(value, label)
    if (
        snapshot.get("schemaVersion") != 1
        or snapshot.get("kind") != "agent-candidate-workspace-snapshot"
    ):
        raise CandidateContractError(f"{label} has the wrong snapshot kind")
    material = _object(snapshot.get("material"), f"{label}.material")
    if (
        material.get("schemaVersion") != 1
        or material.get("kind") != "agent-candidate-workspace-manifest"
    ):
        raise CandidateContractError(f"{label}.material has the wrong manifest kind")
    values = material.get("files")
    if not isinstance(values, list):
        raise CandidateContractError(f"{label}.material.files must be an array")
    files: list[WorkspaceFile] = []
    for index, value in enumerate(values):
        obj = _object(value, f"{label}.material.files[{index}]")
        mode = _integer(obj.get("mode"), f"{label}.material.files[{index}].mode")
        if mode > 0o777:
            raise CandidateContractError(
                f"{label} contains unsupported file mode {mode:o}"
            )
        files.append(
            WorkspaceFile(
                path=_safe_relative(
                    obj.get("path"), f"{label}.material.files[{index}].path"
                ),
                mode=mode,
                sha256=_digest(
                    obj.get("sha256"), f"{label}.material.files[{index}].sha256"
                ),
                byte_length=_integer(
                    obj.get("byteLength"), f"{label}.material.files[{index}].byteLength"
                ),
            )
        )
    paths = [file.path for file in files]
    if paths != sorted(set(paths)):
        raise CandidateContractError(f"{label} file paths must be unique and sorted")
    return tuple(files)


def _profile_files(value: Any) -> tuple[ProfileFile, ...]:
    values = value.get("files") if isinstance(value, dict) else None
    if not isinstance(values, list):
        raise CandidateContractError("profilePlan.material.files must be an array")
    files: list[ProfileFile] = []
    for index, value in enumerate(values):
        obj = _object(value, f"profilePlan.material.files[{index}]")
        mode = _integer(obj.get("mode"), f"profilePlan.material.files[{index}].mode")
        if mode > 0o777:
            raise CandidateContractError(
                f"profile plan contains unsupported mode {mode:o}"
            )
        files.append(
            ProfileFile(
                path=_safe_relative(
                    obj.get("relPath"), f"profilePlan.material.files[{index}].relPath"
                ),
                mode=mode,
                sha256=_digest(
                    obj.get("contentSha256"),
                    f"profilePlan.material.files[{index}].contentSha256",
                ),
            )
        )
    paths = [file.path for file in files]
    if paths != sorted(set(paths)):
        raise CandidateContractError(
            "profile plan file paths must be unique and sorted"
        )
    return tuple(files)


def _instruction(value: Any) -> InstructionEvidence:
    obj = _object(value, "task.instruction")
    if obj.get("encoding") != "utf8":
        raise CandidateContractError("task.instruction.encoding must equal utf8")
    delivery = _object(obj.get("delivery"), "task.instruction.delivery")
    kind = delivery.get("kind")
    if kind == "argv-append" or kind == "stdin-utf8":
        if set(delivery) != {"kind"}:
            raise CandidateContractError(f"{kind} delivery has unexpected fields")
        env = path = None
    elif kind == "utf8-file":
        if (
            set(delivery) != {"kind", "env", "path"}
            or delivery.get("env") != "TANGLE_CANDIDATE_TASK_PATH"
            or delivery.get("path") != "/tangle/input/task.txt"
        ):
            raise CandidateContractError(
                "utf8-file delivery has unexpected fields or does not use the fixed env and path"
            )
        env = "TANGLE_CANDIDATE_TASK_PATH"
        path = "/tangle/input/task.txt"
    else:
        raise CandidateContractError("unsupported task instruction delivery")
    return InstructionEvidence(
        sha256=_digest(obj.get("sha256"), "task.instruction.sha256"),
        byte_length=_integer(
            obj.get("byteLength"), "task.instruction.byteLength", minimum=1
        ),
        delivery_kind=kind,
        delivery_env=env,
        delivery_path=path,
    )


def load_prepared_candidate_contract(
    plan_path: Path,
    receipt_path: Path,
    expected_receipt_digest: str,
) -> PreparedCandidateContract:
    """Load exact runtime bytes and prove the receipt binds the plan."""

    plan, plan_raw = _read_json(plan_path, "execution plan")
    receipt, receipt_raw = _read_json(receipt_path, "materialization receipt")
    receipt_digest = _digest(expected_receipt_digest, "expected receipt digest")
    if sha256_bytes(receipt_raw) != receipt_digest:
        raise CandidateContractError(
            "materialization receipt bytes do not match the expected digest"
        )
    if plan.get("schemaVersion") != 1 or plan.get("kind") != _PLAN_KIND:
        raise CandidateContractError("execution plan has the wrong schema or kind")
    if receipt.get("schemaVersion") != 1 or receipt.get("kind") != _RECEIPT_KIND:
        raise CandidateContractError(
            "materialization receipt has the wrong schema or kind"
        )
    if receipt.get("digestAlgorithm") != "rfc8785-sha256" or "digest" in receipt:
        raise CandidateContractError(
            "materialization receipt must be exact digest-free canonical material"
        )

    execution_evidence = _object(receipt.get("executionPlan"), "receipt.executionPlan")
    plan_digest = _digest(
        execution_evidence.get("digest"), "receipt.executionPlan.digest"
    )
    if (
        execution_evidence.get("schemaVersion") != 1
        or execution_evidence.get("kind") != _EXECUTION_EVIDENCE_KIND
    ):
        raise CandidateContractError("receipt execution evidence has the wrong kind")
    if (
        sha256_bytes(plan_raw) != plan_digest
        or execution_evidence.get("material") != plan
    ):
        raise CandidateContractError(
            "receipt does not bind the exact execution plan material"
        )
    if (
        _embedded_bytes(
            execution_evidence.get("artifact"), "receipt.executionPlan.artifact"
        )
        != plan_raw
    ):
        raise CandidateContractError(
            "receipt execution-plan artifact differs from the executed bytes"
        )

    bundle_digest = _digest(plan.get("bundleDigest"), "plan.bundleDigest")
    if receipt.get("bundleDigest") != bundle_digest:
        raise CandidateContractError("receipt and plan bundle digests differ")
    execution_id = _string(plan.get("executionId"), "plan.executionId")

    task = _object(plan.get("task"), "plan.task")
    outcome = _object(task.get("outcome"), "plan.task.outcome")
    if outcome.get("kind") != "workspace":
        raise CandidateContractError("Pier requires a workspace task outcome")
    repository = _object(task.get("repository"), "plan.task.repository")
    base_commit = _git_object(
        repository.get("baseCommit"), "plan.task.repository.baseCommit"
    )
    base_tree = _git_object(
        repository.get("baseTree"), "plan.task.repository.baseTree"
    )
    if len(base_commit) != len(base_tree):
        raise CandidateContractError("task Git objects use different hash formats")
    instruction = _instruction(task.get("instruction"))
    task_files = _workspace_files(task.get("workspace"), "plan.task.workspace")
    if not task_files:
        raise CandidateContractError("task workspace cannot be empty")

    roots = _object(plan.get("workspaces"), "plan.workspaces")
    task_root = _absolute(roots.get("taskRoot"), "plan.workspaces.taskRoot")
    candidate_root_value = roots.get("candidateRoot")
    candidate_root = (
        _absolute(candidate_root_value, "plan.workspaces.candidateRoot")
        if candidate_root_value is not None
        else None
    )
    if candidate_root is not None and (
        candidate_root == task_root
        or candidate_root.startswith(f"{task_root}/")
        or task_root.startswith(f"{candidate_root}/")
    ):
        raise CandidateContractError("task and candidate workspace roots overlap")
    protected_instruction_path = (
        instruction.delivery_path
        if instruction.delivery_path is not None
        else _STDIN_TASK_PATH
        if instruction.delivery_kind == "stdin-utf8"
        else None
    )
    if protected_instruction_path is not None and (
        protected_instruction_path == task_root
        or protected_instruction_path.startswith(f"{task_root}/")
        or task_root.startswith(f"{protected_instruction_path}/")
        or (
            candidate_root is not None
            and (
                protected_instruction_path == candidate_root
                or protected_instruction_path.startswith(f"{candidate_root}/")
                or candidate_root.startswith(f"{protected_instruction_path}/")
            )
        )
    ):
        raise CandidateContractError("instruction path overlaps an execution workspace")

    code_kind = plan.get("codeKind")
    candidate_snapshot = plan.get("candidateWorkspace")
    active_code = code_kind in {"no-op", "git-patch"}
    if code_kind not in {"disabled", "no-op", "git-patch"}:
        raise CandidateContractError("plan.codeKind is unsupported")
    if active_code != (candidate_snapshot is not None) or active_code != (
        candidate_root is not None
    ):
        raise CandidateContractError(
            "active code and candidate workspace presence disagree"
        )
    candidate_files = (
        _workspace_files(candidate_snapshot, "plan.candidateWorkspace")
        if candidate_snapshot is not None
        else ()
    )
    if active_code and not candidate_files:
        raise CandidateContractError("active candidate workspace cannot be empty")
    if receipt.get("candidateWorkspace") != candidate_snapshot:
        raise CandidateContractError("receipt and plan candidate workspaces differ")

    profile_evidence = _object(receipt.get("profilePlan"), "receipt.profilePlan")
    if (
        profile_evidence.get("schemaVersion") != 1
        or profile_evidence.get("kind") != _PROFILE_PLAN_KIND
    ):
        raise CandidateContractError("receipt profile evidence has the wrong kind")
    profile_digest = _digest(
        profile_evidence.get("digest"), "receipt.profilePlan.digest"
    )
    profile_raw = _embedded_bytes(
        profile_evidence.get("artifact"), "receipt.profilePlan.artifact"
    )
    if sha256_bytes(profile_raw) != profile_digest:
        raise CandidateContractError("profile artifact does not match its digest")
    try:
        profile_artifact_material = json.loads(profile_raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CandidateContractError("profile artifact is not UTF-8 JSON") from exc
    profile_material = _object(
        profile_evidence.get("material"), "receipt.profilePlan.material"
    )
    if profile_artifact_material != profile_material:
        raise CandidateContractError("profile artifact and material differ")
    profile_files = _profile_files(profile_material)
    profile_application = _object(plan.get("profile"), "plan.profile")
    if profile_application.get("planDigest") != profile_digest:
        raise CandidateContractError("plan does not bind the profile digest")
    profile_target = profile_application.get("targetWorkspace")
    if profile_target not in {"task", "candidate"}:
        raise CandidateContractError("profile target workspace is unsupported")
    if profile_target == "candidate" and candidate_root is None:
        raise CandidateContractError(
            "candidate-targeted profile lacks a candidate workspace"
        )
    if profile_application.get("mountPaths") != [file.path for file in profile_files]:
        raise CandidateContractError(
            "profile mount paths differ from the exact profile files"
        )

    launch = _object(plan.get("launch"), "plan.launch")
    executable = _string(launch.get("executable"), "plan.launch.executable")
    executable_parts = executable.split("/")
    if executable.startswith("/"):
        executable_parts = executable_parts[1:]
    if (
        not _EXECUTABLE_RE.fullmatch(executable)
        or not executable_parts
        or any(part in {"", ".", ".."} for part in executable_parts)
        or executable_parts[-1].lower() in _SHELLS
    ):
        raise CandidateContractError("plan launch executable is unsafe")
    args_value = launch.get("args")
    if not isinstance(args_value, list):
        raise CandidateContractError("plan.launch.args must be an array")
    args = tuple(
        _public(value, f"plan.launch.args[{index}]")
        for index, value in enumerate(args_value)
    )
    env_value = _object(launch.get("env"), "plan.launch.env")
    env: dict[str, str] = {}
    for name, value in env_value.items():
        if not _ENV_RE.fullmatch(name):
            raise CandidateContractError(f"invalid launch environment name: {name}")
        env[name] = _public(value, f"plan.launch.env.{name}")
    if instruction.delivery_kind == "utf8-file":
        if env.get("TANGLE_CANDIDATE_TASK_PATH") != instruction.delivery_path:
            raise CandidateContractError(
                "launch env does not bind the fixed instruction path"
            )
    elif "TANGLE_CANDIDATE_TASK_PATH" in env:
        raise CandidateContractError(
            "non-file instruction delivery exposes a task path"
        )

    cwd = _object(launch.get("cwd"), "plan.launch.cwd")
    cwd_workspace = cwd.get("workspace")
    if cwd_workspace == "task":
        cwd_root = task_root
    elif cwd_workspace == "candidate" and candidate_root is not None:
        cwd_root = candidate_root
    else:
        raise CandidateContractError("launch cwd names an unavailable workspace")
    cwd_path = _safe_relative(cwd.get("path"), "plan.launch.cwd.path", allow_dot=True)
    limits = _object(plan.get("limits"), "plan.limits")
    timeout_ms = _integer(limits.get("timeoutMs"), "plan.limits.timeoutMs", minimum=1)
    _integer(limits.get("maxSteps"), "plan.limits.maxSteps", minimum=1)
    max_model_calls = _integer(
        limits.get("maxModelCalls"), "plan.limits.maxModelCalls"
    )
    _integer(limits.get("maxInputTokens"), "plan.limits.maxInputTokens")
    _integer(limits.get("maxOutputTokens"), "plan.limits.maxOutputTokens")
    _number(limits.get("maxCostUsd"), "plan.limits.maxCostUsd")
    attempt = _object(plan.get("attempt"), "plan.attempt")
    _integer(attempt.get("number"), "plan.attempt.number", minimum=1)
    _integer(attempt.get("maxAttempts"), "plan.attempt.maxAttempts", minimum=1)
    if attempt.get("retryPolicy") != "none":
        raise CandidateContractError("Pier execution requires runtime-owned retries")
    container = _object(plan.get("container"), "plan.container")
    if receipt.get("container") != container:
        raise CandidateContractError("receipt and plan container identities differ")
    _digest(container.get("indexDigest"), "plan.container.indexDigest")
    _digest(container.get("manifestDigest"), "plan.container.manifestDigest")
    image = _string(container.get("image"), "plan.container.image")
    if "@" in image or "://" in image or any(char.isspace() for char in image):
        raise CandidateContractError(
            "container image must be an unpinned OCI reference without credentials"
        )
    if container.get("source") not in {
        "pinned-container",
        "evaluator-task-container",
    }:
        raise CandidateContractError("plan container source is unsupported")
    platform = _object(container.get("platform"), "plan.container.platform")
    if platform.get("os") != "linux" or platform.get("architecture") not in {
        "amd64",
        "arm64",
    }:
        raise CandidateContractError("Pier adapter requires a supported Linux platform")
    model = _object(plan.get("model"), "plan.model")
    resolved_model = _object(model.get("resolved"), "plan.model.resolved")
    requested_model = _string(
        resolved_model.get("requested"), "plan.model.resolved.requested"
    )
    _string(resolved_model.get("provider"), "plan.model.resolved.provider")
    _string(resolved_model.get("model"), "plan.model.resolved.model")
    _string(resolved_model.get("snapshot"), "plan.model.resolved.snapshot")
    if receipt.get("resolvedModel") != resolved_model:
        raise CandidateContractError("receipt and plan resolved models differ")
    model_access = _object(model.get("access"), "plan.model.access")
    if set(model_access) != {"kind", "grantDigest", "network"}:
        raise CandidateContractError("plan.model.access has unexpected fields")
    if model_access.get("kind") != "evaluator-mediated":
        raise CandidateContractError(
            "plan.model.access.kind must equal evaluator-mediated"
        )
    _digest(model_access.get("grantDigest"), "plan.model.access.grantDigest")
    model_network = _object(
        model_access.get("network"), "plan.model.access.network"
    )
    if max_model_calls == 0:
        if model_network != {"mode": "disabled"}:
            raise CandidateContractError(
                "zero-call plans cannot expose a model gateway"
            )
        model_network_domains: tuple[str, ...] = ()
    else:
        if set(model_network) != {"mode", "domains"} or model_network.get(
            "mode"
        ) != "gateway-only":
            raise CandidateContractError(
                "model-calling plans require one frozen gateway allowlist"
            )
        domain_values = model_network.get("domains")
        if not isinstance(domain_values, list) or not domain_values:
            raise CandidateContractError(
                "plan.model.access.network.domains must be a non-empty array"
            )
        model_network_domains = tuple(
            _gateway_domain(
                value, f"plan.model.access.network.domains[{index}]"
            )
            for index, value in enumerate(domain_values)
        )
        if list(model_network_domains) != sorted(set(model_network_domains)):
            raise CandidateContractError(
                "model gateway domains must be unique and sorted"
            )
    if receipt.get("harness") != plan.get("harness") or receipt.get(
        "harnessVersion"
    ) != plan.get("harnessVersion"):
        raise CandidateContractError("receipt and plan harness identities differ")
    if receipt.get("codeKind") != code_kind:
        raise CandidateContractError("receipt and plan code kinds differ")
    memory = _object(plan.get("memory"), "plan.memory")
    if memory != {"mode": "disabled"}:
        raise CandidateContractError(
            "Pier adapter does not yet support isolated candidate memory"
        )
    if plan.get("knowledgeManifestDigest") is not None:
        raise CandidateContractError(
            "Pier adapter does not yet support candidate knowledge snapshots"
        )
    network = _object(plan.get("network"), "plan.network")
    if network != {"mode": "disabled"}:
        raise CandidateContractError(
            "Pier candidate execution requires disabled network"
        )

    return PreparedCandidateContract(
        plan=plan,
        plan_raw=plan_raw,
        receipt=receipt,
        receipt_raw=receipt_raw,
        bundle_digest=bundle_digest,
        execution_id=execution_id,
        execution_plan_digest=plan_digest,
        materialization_receipt_digest=receipt_digest,
        instruction=instruction,
        repository_base_commit=base_commit,
        repository_base_tree=base_tree,
        task_root=task_root,
        candidate_root=candidate_root,
        task_files=task_files,
        candidate_files=candidate_files,
        profile_target=profile_target,
        profile_files=profile_files,
        executable=executable,
        args=args,
        env=env,
        cwd_root=cwd_root,
        cwd_path=cwd_path,
        timeout_ms=timeout_ms,
        requested_model=requested_model,
        resolved_model=resolved_model,
        model_network_domains=model_network_domains,
        container=container,
    )


def verify_local_files(
    root: Path,
    expected: tuple[WorkspaceFile, ...] | tuple[ProfileFile, ...],
    label: str,
) -> None:
    """Require exact regular files, modes, and bytes below one staging root."""

    if root.is_symlink() or not root.is_dir():
        raise CandidateContractError(f"{label} must be a real directory: {root}")
    if root.resolve(strict=True) != root.absolute():
        raise CandidateContractError(f"{label} has a symlinked path component: {root}")
    observed: dict[str, tuple[int, str, int]] = {}
    for entry in root.rglob("*"):
        relative = entry.relative_to(root).as_posix()
        info = entry.lstat()
        if stat.S_ISLNK(info.st_mode):
            raise CandidateContractError(f"{label} contains a symlink: {relative}")
        if stat.S_ISDIR(info.st_mode):
            continue
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise CandidateContractError(
                f"{label} contains a non-regular or hard-linked file: {relative}"
            )
        raw = entry.read_bytes()
        observed[relative] = (stat.S_IMODE(info.st_mode), sha256_bytes(raw), len(raw))
    expected_map = {file.path: file for file in expected}
    if set(observed) != set(expected_map):
        raise CandidateContractError(
            f"{label} file set differs from the signed manifest"
        )
    for path, expected_file in expected_map.items():
        actual = observed[path]
        if isinstance(expected_file, ProfileFile):
            if actual[:2] != (expected_file.mode, expected_file.sha256):
                raise CandidateContractError(f"{label} bytes or mode differ: {path}")
        elif actual != (
            expected_file.mode,
            expected_file.sha256,
            expected_file.byte_length,
        ):
            raise CandidateContractError(
                f"{label} bytes, length, or mode differ: {path}"
            )


def immutable_snapshot(
    source: Path, destination: Path, expected: tuple[Any, ...], label: str
) -> None:
    """Copy a verified staging tree and prove it did not change during capture."""

    import shutil

    verify_local_files(source, expected, label)
    shutil.copytree(source, destination, symlinks=True, copy_function=shutil.copy2)
    verify_local_files(destination, expected, f"{label} snapshot")
