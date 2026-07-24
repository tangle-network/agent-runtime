import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { canonicalJson } from '@tangle-network/agent-eval'
import type {
  PrimeIntellectJson,
  PrimeIntellectPackageBundle,
  PrimeIntellectPackageManifest,
  PrimeIntellectPackageOptions,
  PrimeIntellectScoring,
  PrimeIntellectTask,
} from './types'
import { validatePrimeIntellectJson, validatePrimeIntellectPrompt } from './validation'

const VERIFIERS_RANGE = '>=0.2.0,<0.3.0' as const
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/
const PACKAGE_NAME = /^[a-z][a-z0-9-]{0,62}$/
const VERSION = /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/
const DEFAULT_MAX_TURNS = 16
const DEFAULT_ROLLOUT_TIMEOUT = 3_600
const DEFAULT_SCORING_TIMEOUT = 300

export interface WritePrimeIntellectPackageOptions {
  /** Replace an existing generated package and restore it if the final swap fails. */
  replace?: boolean
}

/** Build a complete PrimeIntellect Verifiers package without writing to disk. */
export function createPrimeIntellectPackage(
  options: PrimeIntellectPackageOptions,
): PrimeIntellectPackageBundle {
  const validated = validateOptions(options)
  const moduleName = validated.name.replaceAll('-', '_')
  const rows = validated.tasks.map((task, idx) => taskRow(task, idx))
  const runnerFiles = validated.runner.files ?? {}
  const scoringFiles = validated.scoring.kind === 'command' ? (validated.scoring.files ?? {}) : {}
  const files: Record<string, string> = {
    'pyproject.toml': renderPyproject(validated, moduleName),
    'prime.eval.toml': renderPrimeConfig(validated, 'eval'),
    'prime.train.toml': renderPrimeConfig(validated, 'train'),
    'README.md': renderReadme(validated),
    [`${moduleName}/__init__.py`]: renderInit(moduleName),
    [`${moduleName}/taskset.py`]: renderTaskset(moduleName, validated.scoring),
    [`${moduleName}/harness.py`]: renderHarness(moduleName),
    [`${moduleName}/tasks.jsonl`]: `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
    [`${moduleName}/runner.json`]: `${JSON.stringify(
      {
        command: validated.runner.command,
        files: runnerFiles,
        setup: validated.runner.setup ?? [],
        forwardEnv: validated.runner.forwardEnv ?? [],
      },
      null,
      2,
    )}\n`,
  }
  for (const [path, contents] of Object.entries(scoringFiles)) {
    files[`${moduleName}/scoring/${path}`] = contents
  }

  const filesSha256 = Object.fromEntries(
    Object.entries(files)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, contents]) => [path, sha256(contents)]),
  )
  const manifest: PrimeIntellectPackageManifest = {
    kind: 'tangle.primeintellect.package',
    name: validated.name,
    moduleName,
    version: validated.version,
    verifiers: VERIFIERS_RANGE,
    taskCount: validated.tasks.length,
    splits: {
      train: validated.tasks.filter((task) => task.split === 'train').length,
      eval: validated.tasks.filter((task) => task.split === 'eval').length,
    },
    taskIdsSha256: sha256(
      validated.tasks
        .map((task) => `${task.split}:${task.id}`)
        .sort()
        .join('\n'),
    ),
    filesSha256,
  }
  files['manifest.json'] = `${JSON.stringify(manifest, null, 2)}\n`
  return { manifest, files: Object.freeze(files) }
}

/** Write a bundle through a sibling temporary directory, then rename it into place. */
export async function writePrimeIntellectPackage(
  bundle: PrimeIntellectPackageBundle,
  outputDirectory: string,
  options: WritePrimeIntellectPackageOptions = {},
): Promise<string> {
  const output = resolve(outputDirectory)
  const parent = dirname(output)
  await mkdir(parent, { recursive: true })
  const replacing = await pathExists(output)
  if (replacing) {
    if (!options.replace) throw new Error(`PrimeIntellect output already exists: ${output}`)
    await assertGeneratedPackage(output)
  }

  const temporary = join(parent, `.${basename(output)}.${randomUUID()}.tmp`)
  const backup = replacing ? join(parent, `.${basename(output)}.${randomUUID()}.backup`) : undefined
  try {
    await mkdir(temporary)
    for (const [path, contents] of Object.entries(bundle.files)) {
      assertRelativePath(path, 'bundle file')
      const target = resolve(temporary, path)
      if (target !== temporary && !target.startsWith(`${temporary}${sep}`)) {
        throw new Error(`bundle file escapes output directory: ${path}`)
      }
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, contents, 'utf8')
    }
    if (backup) await rename(output, backup)
    try {
      await rename(temporary, output)
    } catch (error) {
      if (backup) {
        try {
          await rename(backup, output)
        } catch (restoreError) {
          throw new AggregateError(
            [error, restoreError],
            `failed to install PrimeIntellect package and restore ${output}`,
          )
        }
      }
      throw error
    }
    if (backup) await rm(backup, { recursive: true })
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    throw error
  }
  return output
}

function validateOptions(options: PrimeIntellectPackageOptions): PrimeIntellectPackageOptions {
  if (!PACKAGE_NAME.test(options.name)) {
    throw new Error('PrimeIntellect package name must match /^[a-z][a-z0-9-]{0,62}$/')
  }
  if (!VERSION.test(options.version)) {
    throw new Error('PrimeIntellect package version must be a numeric semantic version')
  }
  if (!Array.isArray(options.tasks) || options.tasks.length === 0) {
    throw new Error('PrimeIntellect package requires tasks')
  }
  const tasks: readonly PrimeIntellectTask[] = options.tasks
  const seen = new Set<string>()
  const seenInputs = new Map<string, { id: string; split: PrimeIntellectTask['split'] }>()
  const splitCounts = { train: 0, eval: 0 }
  for (const [index, task] of tasks.entries()) {
    validateTask(task, index, options.scoring)
    if (seen.has(task.id)) throw new Error(`duplicate PrimeIntellect task id: ${task.id}`)
    seen.add(task.id)
    const input = canonicalJson({
      prompt: task.prompt,
      systemPrompt: task.systemPrompt ?? null,
      metadata: task.metadata ?? {},
    })
    const duplicate = seenInputs.get(input)
    if (duplicate) {
      throw new Error(
        `PrimeIntellect tasks ${duplicate.id} (${duplicate.split}) and ${task.id} (${task.split}) expose the same public input`,
      )
    }
    seenInputs.set(input, { id: task.id, split: task.split })
    splitCounts[task.split] += 1
  }
  if (splitCounts.train === 0 || splitCounts.eval === 0) {
    throw new Error('PrimeIntellect package requires non-empty, disjoint train and eval splits')
  }
  validateScoring(options.scoring)
  validateCommand(options.runner.command, 'runner.command')
  validateFiles(options.runner.files ?? {}, 'runner.files')
  for (const [index, command] of (options.runner.setup ?? []).entries()) {
    validateCommand(command, `runner.setup[${index}]`)
  }
  validateEnvNames(options.runner.forwardEnv ?? [], 'runner.forwardEnv')
  if (typeof options.runner.image !== 'string' || options.runner.image.trim().length === 0) {
    throw new Error('runner.image must be a non-empty container image')
  }
  if (/(^|:)latest$/i.test(options.runner.image)) {
    throw new Error('runner.image must not use the mutable latest tag')
  }
  positiveInteger(options.maxTurns ?? DEFAULT_MAX_TURNS, 'maxTurns')
  for (const [name, value] of [
    ['maxInputTokens', options.maxInputTokens],
    ['maxOutputTokens', options.maxOutputTokens],
    ['maxTotalTokens', options.maxTotalTokens],
  ] as const) {
    if (value !== undefined) positiveInteger(value, name)
  }
  positiveNumber(options.rolloutTimeoutSeconds ?? DEFAULT_ROLLOUT_TIMEOUT, 'rolloutTimeoutSeconds')
  positiveNumber(options.scoringTimeoutSeconds ?? DEFAULT_SCORING_TIMEOUT, 'scoringTimeoutSeconds')
  return options
}

function validateTask(
  task: PrimeIntellectTask,
  index: number,
  scoring: PrimeIntellectScoring,
): void {
  const path = `tasks[${index}]`
  if (typeof task.id !== 'string' || task.id.trim().length === 0) {
    throw new Error(`${path}.id must be a non-empty string`)
  }
  if (task.split !== 'train' && task.split !== 'eval') {
    throw new Error(`${path}.split must be train or eval`)
  }
  const prompt = validatePrimeIntellectPrompt(task.prompt, `${path}.prompt`)
  if (Array.isArray(prompt)) {
    if (task.systemPrompt !== undefined && prompt.some((message) => message.role === 'system')) {
      throw new Error(`${path} must not set systemPrompt and include a system message`)
    }
  }
  if (task.systemPrompt !== undefined && typeof task.systemPrompt !== 'string') {
    throw new Error(`${path}.systemPrompt must be a string`)
  }
  if (task.metadata !== undefined) {
    validatePrimeIntellectJson(task.metadata, `${path}.metadata`)
  }
  if (scoring.kind !== 'command') {
    const answers = Array.isArray(task.answer) ? task.answer : [task.answer]
    if (
      answers.length === 0 ||
      answers.some((answer) => typeof answer !== 'string' || answer.length === 0)
    ) {
      throw new Error(`${path}.answer is required for ${scoring.kind} scoring`)
    }
  }
}

function validateScoring(scoring: PrimeIntellectScoring): void {
  if (scoring.kind === 'exact') return
  if (scoring.kind === 'reference-judge') {
    if (typeof scoring.model !== 'string' || scoring.model.length === 0) {
      throw new Error('reference-judge scoring requires a model')
    }
    return
  }
  validateCommand(scoring.command, 'scoring.command')
  validateFiles(scoring.files ?? {}, 'scoring.files')
  validateEnvNames(scoring.forwardEnv ?? [], 'scoring.forwardEnv')
  positiveNumber(scoring.timeoutSeconds ?? DEFAULT_SCORING_TIMEOUT, 'scoring.timeoutSeconds')
}

function validateCommand(command: readonly string[], path: string): void {
  if (!Array.isArray(command) || command.length === 0) {
    throw new Error(`${path} must be a non-empty argv array`)
  }
  for (const [index, argument] of command.entries()) {
    if (typeof argument !== 'string' || argument.length === 0 || argument.includes('\0')) {
      throw new Error(`${path}[${index}] must be a non-empty string without NUL bytes`)
    }
  }
}

function validateFiles(files: Readonly<Record<string, string>>, path: string): void {
  for (const [file, contents] of Object.entries(files)) {
    assertRelativePath(file, path)
    if (typeof contents !== 'string') throw new Error(`${path}.${file} must be a string`)
  }
}

function validateEnvNames(names: readonly string[], path: string): void {
  const seen = new Set<string>()
  for (const [index, name] of names.entries()) {
    if (!ENV_NAME.test(name)) throw new Error(`${path}[${index}] is not a valid environment name`)
    if (seen.has(name)) throw new Error(`${path} contains duplicate name ${name}`)
    seen.add(name)
  }
}

function assertRelativePath(path: string, label: string): void {
  const normalized = normalize(path)
  if (
    path.length === 0 ||
    path.includes('\0') ||
    isAbsolute(path) ||
    normalized === '..' ||
    normalized.startsWith(`..${sep}`) ||
    relative('.', normalized).startsWith('..')
  ) {
    throw new Error(`${label} contains unsafe path: ${path}`)
  }
}

function taskRow(task: PrimeIntellectTask, idx: number): Record<string, PrimeIntellectJson> {
  return {
    idx,
    name: task.id,
    prompt: task.prompt as PrimeIntellectJson,
    system_prompt: task.systemPrompt ?? null,
    split: task.split,
    answer: task.answer ?? null,
    metadata: task.metadata ?? {},
  }
}

function renderPyproject(options: PrimeIntellectPackageOptions, moduleName: string): string {
  const description = options.description ?? `PrimeIntellect tasks for ${options.name}`
  return `[project]\nname = ${toml(options.name)}\nversion = ${toml(options.version)}\ndescription = ${toml(description)}\nrequires-python = ">=3.11,<3.14"\ndependencies = ["verifiers${VERIFIERS_RANGE}"]\n\n[build-system]\nrequires = ["hatchling"]\nbuild-backend = "hatchling.build"\n\n[tool.hatch.build.targets.wheel]\npackages = [${toml(moduleName)}]\n\n[tool.uv]\nprerelease = "allow"\n`
}

function renderPrimeConfig(options: PrimeIntellectPackageOptions, split: 'train' | 'eval'): string {
  const limits = [
    `max_turns = ${options.maxTurns ?? DEFAULT_MAX_TURNS}`,
    options.maxInputTokens === undefined
      ? undefined
      : `max_input_tokens = ${options.maxInputTokens}`,
    options.maxOutputTokens === undefined
      ? undefined
      : `max_output_tokens = ${options.maxOutputTokens}`,
    options.maxTotalTokens === undefined
      ? undefined
      : `max_total_tokens = ${options.maxTotalTokens}`,
  ].filter((line): line is string => line !== undefined)
  return `${limits.join('\n')}\npush = false\n\n[timeout]\nrollout = ${options.rolloutTimeoutSeconds ?? DEFAULT_ROLLOUT_TIMEOUT}\nscoring = ${options.scoringTimeoutSeconds ?? DEFAULT_SCORING_TIMEOUT}\n\n[taskset]\nid = ${toml(options.name)}\nsplit = ${toml(split)}\n\n[harness]\nid = ${toml(options.name)}\nprogram = ${tomlArray(options.runner.command)}\nforward_env = ${tomlArray(options.runner.forwardEnv ?? [])}\n\n[harness.runtime]\ntype = "docker"\nimage = ${toml(options.runner.image)}\n`
}

function renderInit(moduleName: string): string {
  return `from ${moduleName}.harness import TangleRuntimeHarness\nfrom ${moduleName}.taskset import TangleTaskset\n\n__all__ = ["TangleRuntimeHarness", "TangleTaskset"]\n`
}

function renderTaskset(moduleName: string, scoring: PrimeIntellectScoring): string {
  const config = scoringConfig(scoring)
  return `import asyncio\nimport json\nimport math\nimport os\nfrom importlib.resources import files\nfrom pathlib import Path\nfrom typing import Any, Literal\n\nimport verifiers.v1 as vf\n\nSCORING = json.loads(${pythonString(JSON.stringify(config))})\nPACKAGE_ROOT = Path(__file__).resolve().parent\n\n\nclass TangleTaskData(vf.TaskData):\n    split: Literal["train", "eval"]\n    answer: str | list[str] | None = None\n    metadata: dict[str, Any] = {}\n\n\nclass TangleTaskConfig(vf.TaskConfig):\n    scoring: Literal["exact", "reference-judge", "command"] = SCORING["kind"]\n    normalization: Literal["none", "trim", "trim-casefold"] = SCORING.get("normalization", "trim")\n    judge_model: str = SCORING.get("model", "openai/gpt-5.4-nano")\n    judge_prompt: str | None = SCORING.get("prompt")\n    judge_view: Literal["last_reply", "full_trace"] = SCORING.get("view", "last_reply")\n    score_program: list[str] = SCORING.get("command", [])\n    score_forward_env: list[str] = SCORING.get("forwardEnv", [])\n    score_timeout_seconds: float = SCORING.get("timeoutSeconds", 300)\n\n\ndef _normalize(value: str, mode: str) -> str:\n    if mode == "none":\n        return value\n    value = value.strip()\n    return value.casefold() if mode == "trim-casefold" else value\n\n\nasync def _run_score_command(config: TangleTaskConfig, data: TangleTaskData, trace: vf.Trace) -> float:\n    if not config.score_program:\n        raise ValueError("command scoring requires score_program")\n    safe_env = {\n        key: os.environ[key]\n        for key in ("PATH", "HOME", "TMPDIR", "LANG")\n        if key in os.environ\n    }\n    safe_env.update(\n        {key: os.environ[key] for key in config.score_forward_env if key in os.environ}\n    )\n    request = {\n        "kind": "tangle.primeintellect.score",\n        "task": data.model_dump(mode="json", exclude_none=True),\n        "trace": trace.model_dump(mode="json", exclude_none=True),\n    }\n    process = await asyncio.create_subprocess_exec(\n        *config.score_program,\n        cwd=PACKAGE_ROOT,\n        env=safe_env,\n        stdin=asyncio.subprocess.PIPE,\n        stdout=asyncio.subprocess.PIPE,\n        stderr=asyncio.subprocess.PIPE,\n    )\n    payload = json.dumps(request, separators=(",", ":")).encode()\n    try:\n        stdout, stderr = await asyncio.wait_for(\n            process.communicate(payload), timeout=config.score_timeout_seconds\n        )\n    except TimeoutError:\n        process.kill()\n        await process.communicate()\n        raise RuntimeError(\n            f"score command timed out after {config.score_timeout_seconds}s"\n        )\n    if process.returncode != 0:\n        detail = (stderr or stdout).decode(errors="replace").strip()[-2000:]\n        raise RuntimeError(f"score command exited {process.returncode}: {detail}")\n    try:\n        result = json.loads(stdout)\n    except json.JSONDecodeError as error:\n        raise ValueError(f"score command returned invalid JSON: {error}") from error\n    if not isinstance(result, dict):\n        raise ValueError("score command must return an object")\n    reward = result.get("reward")\n    if isinstance(reward, bool) or not isinstance(reward, (int, float)) or not math.isfinite(reward):\n        raise ValueError("score command reward must be a finite number")\n    metrics = result.get("metrics", {})\n    if not isinstance(metrics, dict):\n        raise ValueError("score command metrics must be an object")\n    for name, value in metrics.items():\n        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):\n            raise ValueError(f"score command metric {name!r} must be a finite number")\n    trace.record_metrics(metrics)\n    return float(reward)\n\n\nclass TangleTask(vf.Task[TangleTaskData, vf.State, TangleTaskConfig]):\n    @vf.reward(weight=1.0)\n    async def task_reward(self, trace: vf.Trace) -> float:\n        if self.config.scoring == "command":\n            return await _run_score_command(self.config, self.data, trace)\n        if self.data.answer is None:\n            raise ValueError(f"task {self.data.name!r} has no reference answer")\n        if self.config.scoring == "reference-judge":\n            judge = vf.ReferenceJudge(\n                vf.ReferenceJudgeConfig(\n                    model=self.config.judge_model,\n                    prompt=self.config.judge_prompt,\n                    view=self.config.judge_view,\n                )\n            )\n            return await judge.score(self.data, trace)\n        expected = self.data.answer if isinstance(self.data.answer, list) else [self.data.answer]\n        actual = _normalize(trace.last_reply, self.config.normalization)\n        return float(any(actual == _normalize(answer, self.config.normalization) for answer in expected))\n\n\nclass TangleTasksetConfig(vf.TasksetConfig):\n    split: Literal["train", "eval"] = "eval"\n    task: TangleTaskConfig = TangleTaskConfig()\n\n\nclass TangleTaskset(vf.Taskset[TangleTask, TangleTasksetConfig]):\n    def load(self) -> list[TangleTask]:\n        resource = files(${pythonString(moduleName)}).joinpath("tasks.jsonl")\n        tasks: list[TangleTask] = []\n        with resource.open("r", encoding="utf-8") as handle:\n            for line in handle:\n                if not line.strip():\n                    continue\n                row = json.loads(line)\n                if row["split"] != self.config.split:\n                    continue\n                tasks.append(TangleTask(TangleTaskData.model_validate(row), self.config.task))\n        if not tasks:\n            raise ValueError(f"task split {self.config.split!r} is empty")\n        return tasks\n\n\n__all__ = ["TangleTaskset"]\n`
}

function renderHarness(moduleName: string): string {
  return `import json\nfrom importlib.resources import files\n\nimport verifiers.v1 as vf\n\nRUNNER = json.loads(files(${pythonString(moduleName)}).joinpath("runner.json").read_text(encoding="utf-8"))\n\n\nclass TangleRuntimeHarnessConfig(vf.HarnessConfig):\n    program: list[str] = RUNNER["command"]\n    setup_commands: list[list[str]] = RUNNER["setup"]\n    forward_env: list[str] = RUNNER["forwardEnv"]\n\n\nclass TangleRuntimeHarness(vf.Harness[TangleRuntimeHarnessConfig]):\n    APPENDS_SYSTEM_PROMPT = True\n    SUPPORTS_MCP = True\n    SUPPORTS_MESSAGE_PROMPT = True\n\n    async def setup(self, runtime: vf.Runtime) -> None:\n        for path, contents in RUNNER["files"].items():\n            await runtime.write(path, contents.encode())\n        for command in self.config.setup_commands:\n            result = await runtime.run(command, self.config.resolved_env)\n            if result.exit_code != 0:\n                detail = (result.stderr or result.stdout).strip()[-2000:]\n                raise RuntimeError(\n                    f"runner setup command {command[0]!r} exited {result.exit_code}: {detail}"\n                )\n\n    async def launch(\n        self,\n        ctx: vf.ModelContext,\n        trace: vf.Trace,\n        runtime: vf.Runtime,\n        endpoint: str,\n        secret: str,\n        mcp_urls: dict[str, str],\n    ) -> vf.ProgramResult:\n        data = trace.task.data\n        public_task = {\n            "id": data.name or str(data.idx),\n            "split": data.split,\n            "prompt": data.prompt,\n            "metadata": data.metadata,\n        }\n        if data.system_prompt is not None:\n            public_task["systemPrompt"] = data.system_prompt\n        env = {\n            **self.config.resolved_env,\n            "OPENAI_BASE_URL": endpoint,\n            "OPENAI_API_KEY": secret,\n            "OPENAI_MODEL": ctx.model,\n            "TANGLE_PRIME_TASK_JSON": json.dumps(public_task, separators=(",", ":")),\n            "TANGLE_PRIME_MCP_SERVERS_JSON": json.dumps(mcp_urls, separators=(",", ":")),\n        }\n        if not self.config.program:\n            raise ValueError("Tangle runtime harness requires a program argv")\n        return await runtime.run_program(self.config.program, env)\n\n\n__all__ = ["TangleRuntimeHarness"]\n`
}

function scoringConfig(scoring: PrimeIntellectScoring): Record<string, PrimeIntellectJson> {
  if (scoring.kind === 'exact') {
    return { kind: scoring.kind, normalization: scoring.normalization ?? 'trim' }
  }
  if (scoring.kind === 'reference-judge') {
    return {
      kind: scoring.kind,
      model: scoring.model,
      prompt: scoring.prompt ?? null,
      view: scoring.view ?? 'last_reply',
    }
  }
  return {
    kind: scoring.kind,
    command: [...scoring.command],
    forwardEnv: [...(scoring.forwardEnv ?? [])],
    timeoutSeconds: scoring.timeoutSeconds ?? DEFAULT_SCORING_TIMEOUT,
  }
}

function renderReadme(options: PrimeIntellectPackageOptions): string {
  return `# ${options.name}\n\nPrimeIntellect Verifiers tasks that run the caller's Tangle agent program.\n\n## Evaluate\n\n\`\`\`bash\nuv run eval @ prime.eval.toml --model <provider/model-snapshot>\n\`\`\`\n\n## Train\n\nUse \`prime.train.toml\` as the environment config for Prime RL. The train and eval rows are disjoint and selected by \`taskset.split\`.\n\nThe runner receives only the prompt, metadata, intercepted model endpoint, and MCP URLs. Reference answers remain in the task process and are never written into the runner workspace or environment.\n`
}

function toml(value: string): string {
  return JSON.stringify(value)
}

function tomlArray(values: readonly string[]): string {
  return `[${values.map(toml).join(', ')}]`
}

function pythonString(value: string): string {
  return JSON.stringify(value)
}

function positiveInteger(value: number, path: string): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${path} must be a positive integer`)
}

function positiveNumber(value: number, path: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${path} must be positive`)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function assertGeneratedPackage(output: string): Promise<void> {
  let manifest: unknown
  try {
    manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'))
  } catch (error) {
    throw new Error(
      `refusing to replace ${output}: it is not a generated PrimeIntellect package (${error instanceof Error ? error.message : String(error)})`,
    )
  }
  if (
    manifest === null ||
    typeof manifest !== 'object' ||
    (manifest as Record<string, unknown>).kind !== 'tangle.primeintellect.package'
  ) {
    throw new Error(`refusing to replace ${output}: manifest kind does not match`)
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
