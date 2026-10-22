#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '..')
const sourceRoots = ['src', 'bench', 'examples', 'scripts']

// These files use caller-supplied URLs for non-inference HTTP (OAuth, telemetry, MCP, search, or
// public benchmark data). Everywhere else a global fetch target must be statically readable so a
// computed provider endpoint cannot hide from this check.
const dynamicNonModelFetchOwners = new Set([
  'src/model-resolution.ts',
  'src/otel-export.ts',
  'src/platform/auth.ts',
  'src/platform/integrations.ts',
  'src/platform/oidc.ts',
  'src/runtime/mcp-environment.ts',
  'src/runtime/supervise/coordination-preflight.ts',
  'scripts/prove-platform-oidc.mjs',
  'bench/src/search-tool.ts',
  'bench/src/benchmarks/aec-bench.ts',
  'bench/src/benchmarks/commit0.ts',
  'bench/src/benchmarks/enterpriseops-gym.ts',
  'bench/src/benchmarks/finsearchcomp.ts',
  'bench/src/benchmarks/humaneval.ts',
  'bench/src/benchmarks/programbench.ts',
])

const providerSdkModules = new Set([
  'openai',
  '@anthropic-ai/sdk',
  '@google/genai',
  '@google/generative-ai',
  'cohere-ai',
  'groq-sdk',
  '@mistralai/mistralai',
])

const lowLevelModelCalls = new Set([
  'chatCompletionsTransport',
  'createChatClient',
  'createOpenAICompatibleBackend',
  'createPrimeIntellectBackend',
  'resolveAgentBackend',
  'routerBrain',
  'routerChatWithTools',
  'routerChatWithUsage',
  'routerToolLoop',
  'runLocalHarness',
  'streamRouterChatWithTools',
])

// `runLocalHarness` is the physical process adapter under the profiled worktree executors. It is
// deliberately callable in exactly one implementation module and must never become a public or
// benchmark-facing shortcut around AgentProfile intake.
const lowLevelModelCallOwners = new Map([
  [
    'routerBrain',
    new Set([
      'src/runtime/local-sandbox-client.ts',
      'src/runtime/supervise/supervisor-router-config.ts',
    ]),
  ],
  [
    'routerChatWithTools',
    new Set([
      'src/runtime/router-client.complete.test.ts',
      'src/runtime/supervise/router-inline-executor.ts',
      'src/runtime/supervise/router-tools-executor.ts',
    ]),
  ],
  [
    'routerChatWithUsage',
    new Set([
      'src/runtime/router-client.complete.test.ts',
      'src/runtime/supervise/router-inline-executor.ts',
    ]),
  ],
  [
    'streamRouterChatWithTools',
    new Set([
      'src/runtime/supervise/router-inline-executor.ts',
      'src/runtime/supervise/router-tools-executor.ts',
    ]),
  ],
  ['runLocalHarness', new Set(['src/mcp/worktree-harness.ts'])],
])

// The Router adapter owns exactly one fetch site. The function name and count are both checked:
// adding another raw provider request anywhere in the file fails this check instead of inheriting a
// whole-file exemption.
const ownedModelFetchAllowances = new Map([
  [
    'src/runtime/router-http-transport.ts',
    new Map([['fetchRouterResponse', 1]]),
  ],
])

const forbiddenPublicModelCalls = new Set(['runLocalHarness'])

// These implementation owners translate a validated AgentProfile into a local process or
// prove its isolated Codex execution context. Elsewhere, naming a coding-agent CLI in an
// executable command is a second model-execution path.
const directCliOwners = new Set([
  'src/mcp/local-harness-process.ts',
  'src/mcp/codex-execution-evidence.ts',
  'scripts/check-model-execution-boundary.test.mjs',
])

const processLaunchCalls = new Set([
  'dotenvxBash',
  'exec',
  'execFile',
  'execFileSync',
  'execSync',
  'run',
  'runOk',
  'runTb',
  'sh',
  'spawn',
  'spawnSync',
])

const childProcessModules = new Set(['child_process', 'node:child_process'])

const sourceExtensions = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.mts',
  '.cts',
  '.tsx',
  '.py',
  '.sh',
])
const ignoredDirectories = new Set([
  '.git',
  '.venv',
  'coverage',
  'dist',
  'fixtures',
  'generated',
  'node_modules',
])

function extension(path) {
  const match = /\.[^.\/]+$/.exec(path)
  return match?.[0] ?? ''
}

export function findSourceFiles(path) {
  const entries = readdirSync(path)
  const files = []
  for (const name of entries) {
    if (ignoredDirectories.has(name)) continue
    const child = resolve(path, name)
    const stats = statSync(child)
    if (stats.isDirectory()) files.push(...findSourceFiles(child))
    else if (sourceExtensions.has(extension(name))) files.push(child)
  }
  return files
}

function isTestFile(path) {
  return /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)
}

function sourceLocation(source, node) {
  const point = source.getLineAndCharacterOfPosition(node.getStart(source))
  return `${point.line + 1}:${point.character + 1}`
}

function namesModelEndpoint(text) {
  if (/chat\/completions|api\.anthropic\.com/i.test(text)) return true
  return (
    /\/responses(?:[?'"`]|$)/i.test(text) &&
    /openai|anthropic|tangle|router|model|inference|llm/i.test(text)
  )
}

function isLowLevelModelModule(moduleName) {
  return (
    moduleName === '@tangle-network/agent-eval' ||
    moduleName.startsWith('@tangle-network/agent-eval/') ||
    moduleName === '@tangle-network/agent-runtime' ||
    moduleName.startsWith('@tangle-network/agent-runtime/') ||
    /(?:^|\/)(?:local-harness(?:-process)?|router-client)(?:\.[cm]?[jt]sx?)?$/.test(moduleName)
  )
}

function isLocalTestTarget(path, target) {
  return isTestFile(path) && /(?:localhost|127\.0\.0\.1|\[::1\]|\.test)(?::\d+)?\//i.test(target)
}

function scriptKindOf(path) {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (path.endsWith('.ts') || path.endsWith('.mts') || path.endsWith('.cts')) return ts.ScriptKind.TS
  return ts.ScriptKind.JS
}

/** Index every initialized variable by name, so a call target can be traced to its value. */
function collectInitializers(scan, node) {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer !== undefined
  ) {
    const declarations = scan.initializers.get(node.name.text) ?? []
    declarations.push(node)
    scan.initializers.set(node.name.text, declarations)
  }
  ts.forEachChild(node, (child) => collectInitializers(scan, child))
}

/** The closest initializer declared before `identifier`. */
function initializerFor(scan, identifier) {
  const declarations = scan.initializers.get(identifier.text) ?? []
  let closest
  for (const declaration of declarations) {
    if (declaration.pos >= identifier.pos) continue
    if (!closest || declaration.pos > closest.pos) closest = declaration
  }
  return closest?.initializer
}

/** Record the names a module brings in that reach a model or launch a process. */
function recordModuleBinding(scan, moduleName, imported, local) {
  if (
    moduleName !== undefined &&
    isLowLevelModelModule(moduleName) &&
    lowLevelModelCalls.has(imported)
  ) {
    scan.lowLevelBindings.set(local, imported)
  }
  if (
    moduleName !== undefined &&
    childProcessModules.has(moduleName) &&
    processLaunchCalls.has(imported)
  ) {
    scan.processLaunchBindings.add(local)
  }
}

/** Public low-level exports, provider SDK imports, and the import bindings the call checks follow. */
function collectModuleStatements(scan) {
  for (const statement of scan.source.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause) {
      if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          const exported = element.propertyName?.text ?? element.name.text
          if (forbiddenPublicModelCalls.has(exported) && !element.isTypeOnly) {
            scan.failures.push({
              node: element,
              detail: `public low-level model executor ${JSON.stringify(exported)}`,
            })
          }
        }
      }
    }
    if (!ts.isImportDeclaration(statement)) continue
    const moduleName = ts.isStringLiteral(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : undefined
    if (moduleName !== undefined && providerSdkModules.has(moduleName)) {
      scan.failures.push({
        node: statement,
        detail: `provider SDK import ${JSON.stringify(moduleName)}`,
      })
    }
    if (!statement.importClause?.namedBindings) continue
    const bindings = statement.importClause.namedBindings
    if (ts.isNamespaceImport(bindings)) {
      if (moduleName !== undefined && isLowLevelModelModule(moduleName)) {
        scan.lowLevelNamespaces.add(bindings.name.text)
      }
      if (moduleName !== undefined && childProcessModules.has(moduleName)) {
        scan.childProcessNamespaces.add(bindings.name.text)
      }
    } else {
      for (const element of bindings.elements) {
        const imported = element.propertyName?.text ?? element.name.text
        recordModuleBinding(scan, moduleName, imported, element.name.text)
      }
    }
  }
}

function isRequireCall(node) {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'require'
  )
}

/** The member `require(<module>).member` names when `isModule` accepts the module, else undefined. */
function requiredMember(node, isModule) {
  if (
    ts.isIdentifier(node.name) &&
    ts.isPropertyAccessExpression(node.initializer) &&
    isRequireCall(node.initializer.expression) &&
    node.initializer.expression.arguments[0] !== undefined &&
    ts.isStringLiteral(node.initializer.expression.arguments[0]) &&
    isModule(node.initializer.expression.arguments[0].text)
  ) {
    return node.initializer.name.text
  }
  return undefined
}

/** Follow `const x = require(...)` forms the way the import statements are followed. */
function collectCommonJs(scan, node) {
  if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
    if (isRequireCall(node.initializer)) recordRequireDeclaration(scan, node)
    const lowLevel = requiredMember(node, isLowLevelModelModule)
    if (lowLevel !== undefined && lowLevelModelCalls.has(lowLevel)) {
      scan.lowLevelBindings.set(node.name.text, lowLevel)
    }
    const launch = requiredMember(node, (name) => childProcessModules.has(name))
    if (launch !== undefined && processLaunchCalls.has(launch)) {
      scan.processLaunchBindings.add(node.name.text)
    }
  }
  ts.forEachChild(node, (child) => collectCommonJs(scan, child))
}

function recordRequireDeclaration(scan, node) {
  const moduleArg = node.initializer.arguments[0]
  const moduleName = ts.isStringLiteral(moduleArg) ? moduleArg.text : undefined
  if (moduleName !== undefined && providerSdkModules.has(moduleName)) {
    scan.failures.push({
      node: node.initializer,
      detail: `provider SDK require ${JSON.stringify(moduleName)}`,
    })
  }
  if (moduleName !== undefined && isLowLevelModelModule(moduleName) && ts.isIdentifier(node.name)) {
    scan.lowLevelNamespaces.add(node.name.text)
  }
  if (moduleName !== undefined && childProcessModules.has(moduleName) && ts.isIdentifier(node.name)) {
    scan.childProcessNamespaces.add(node.name.text)
  }
  if (ts.isObjectBindingPattern(node.name)) {
    for (const element of node.name.elements) {
      if (!ts.isIdentifier(element.name)) continue
      const imported = element.propertyName?.getText(scan.source) ?? element.name.text
      recordModuleBinding(scan, moduleName, imported, element.name.text)
    }
  }
}

/** The string `node` evaluates to when every part is statically readable. */
function staticString(scan, node, seen = new Set()) {
  if (ts.isStringLiteralLike(node)) return node.text
  if (ts.isIdentifier(node)) {
    if (seen.has(node.text)) return undefined
    const initializer = initializerFor(scan, node)
    if (initializer === undefined) return undefined
    const nextSeen = new Set(seen)
    nextSeen.add(node.text)
    return staticString(scan, initializer, nextSeen)
  }
  if (ts.isParenthesizedExpression(node)) return staticString(scan, node.expression, seen)
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticString(scan, node.left, seen)
    const right = staticString(scan, node.right, seen)
    return left === undefined || right === undefined ? undefined : left + right
  }
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text
    for (const span of node.templateSpans) {
      const expression = staticString(scan, span.expression, seen)
      if (expression === undefined) return undefined
      value += expression + span.literal.text
    }
    return value
  }
  return undefined
}

function expressionText(scan, node, seen = new Set()) {
  if (ts.isIdentifier(node)) {
    if (seen.has(node.text)) return node.getText(scan.source)
    const initializer = initializerFor(scan, node)
    if (initializer !== undefined) {
      seen.add(node.text)
      return `${node.getText(scan.source)}=${expressionText(scan, initializer, seen)}`
    }
  }
  return node.getText(scan.source)
}

function lowLevelModelCallName(scan, node) {
  if (ts.isIdentifier(node.expression)) return scan.lowLevelBindings.get(node.expression.text)
  if (
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    scan.lowLevelNamespaces.has(node.expression.expression.text) &&
    lowLevelModelCalls.has(node.expression.name.text)
  ) {
    return node.expression.name.text
  }
  if (
    ts.isElementAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    scan.lowLevelNamespaces.has(node.expression.expression.text) &&
    ts.isStringLiteral(node.expression.argumentExpression) &&
    lowLevelModelCalls.has(node.expression.argumentExpression.text)
  ) {
    return node.expression.argumentExpression.text
  }
  return undefined
}

function isProcessLaunchExpression(scan, node, seen = new Set()) {
  if (ts.isIdentifier(node)) {
    if (processLaunchCalls.has(node.text) || scan.processLaunchBindings.has(node.text)) return true
    if (seen.has(node.text)) return false
    const initializer = initializerFor(scan, node)
    if (initializer === undefined) return false
    const nextSeen = new Set(seen)
    nextSeen.add(node.text)
    return isProcessLaunchExpression(scan, initializer, nextSeen)
  }
  return (
    ts.isPropertyAccessExpression(node) &&
    processLaunchCalls.has(node.name.text) &&
    (!ts.isIdentifier(node.expression) || scan.childProcessNamespaces.has(node.expression.text))
  )
}

function isGlobalFetchExpression(scan, node, seen = new Set()) {
  if (ts.isIdentifier(node)) {
    if (node.text === 'fetch') return true
    if (seen.has(node.text)) return false
    const initializer = initializerFor(scan, node)
    if (initializer === undefined) return false
    const nextSeen = new Set(seen)
    nextSeen.add(node.text)
    return isGlobalFetchExpression(scan, initializer, nextSeen)
  }
  return (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === 'fetch' &&
    ts.isIdentifier(node.expression) &&
    ['global', 'globalThis', 'window'].includes(node.expression.text)
  )
}

function enclosingFunctionName(node) {
  let parent = node.parent
  while (parent) {
    if (ts.isFunctionDeclaration(parent) && parent.name) return parent.name.text
    if (
      (ts.isFunctionExpression(parent) || ts.isArrowFunction(parent)) &&
      ts.isVariableDeclaration(parent.parent) &&
      ts.isIdentifier(parent.parent.name)
    ) {
      return parent.parent.name.text
    }
    parent = parent.parent
  }
  return undefined
}

/** Counts each owner's model fetch sites, so a second raw request in the owner fails. */
function isAllowedOwnedModelFetch(scan, node) {
  if (!ts.isIdentifier(node.expression) || node.expression.text !== 'fetch') return false
  const functionName = enclosingFunctionName(node)
  if (functionName === undefined) return false
  const maximum = ownedModelFetchAllowances.get(scan.path)?.get(functionName)
  if (maximum === undefined) return false
  const key = `${scan.path}:${functionName}`
  const count = (scan.ownedModelFetchCounts.get(key) ?? 0) + 1
  scan.ownedModelFetchCounts.set(key, count)
  return count <= maximum
}

/** Whether a call reaches a model endpoint, provider SDK, low-level executor, or model CLI. */
function isModelExecutionCall(scan, node) {
  const { path, source } = scan
  const callee = node.expression.getText(source)
  const first = node.arguments[0]
  const target = first === undefined ? '' : expressionText(scan, first)
  const resolvedTarget = first === undefined ? undefined : staticString(scan, first)
  const call = node.getText(source)
  const isGlobalFetch = isGlobalFetchExpression(scan, node.expression)
  const directFetch =
    isGlobalFetch &&
    (namesModelEndpoint(resolvedTarget ?? target) ||
      (resolvedTarget === undefined && !dynamicNonModelFetchOwners.has(path))) &&
    !isLocalTestTarget(path, resolvedTarget ?? target) &&
    !isAllowedOwnedModelFetch(scan, node)
  const providerSdk =
    /(?:^|\.)(?:chat\.completions\.create|responses\.(?:create|stream)|messages\.(?:create|stream)|generateContent)$/.test(
      callee,
    )
  const rawHttp =
    /^(?:https?|request|axios)(?:\.|$)/.test(callee) &&
    namesModelEndpoint(call) &&
    !isLocalTestTarget(path, call)
  const lowLevelCallName = lowLevelModelCallName(scan, node)
  const lowLevelRuntimeCall =
    lowLevelCallName !== undefined &&
    lowLevelModelCallOwners.get(lowLevelCallName)?.has(path) !== true
  const cliLaunch =
    !directCliOwners.has(path) &&
    isProcessLaunchExpression(scan, node.expression) &&
    namesModelCliInvocation(
      [callee, ...node.arguments.map((argument) => expressionText(scan, argument))].join(' '),
    )
  return directFetch || providerSdk || rawHttp || lowLevelRuntimeCall || cliLaunch
}

function inspectNode(scan, node) {
  const { source } = scan
  if (ts.isCallExpression(node) && isModelExecutionCall(scan, node)) {
    scan.failures.push({ node, detail: node.getText(source).slice(0, 180).replace(/\s+/g, ' ') })
  }
  if (ts.isNewExpression(node) && /^(?:OpenAI|Anthropic)$/.test(node.expression.getText(source))) {
    scan.failures.push({ node, detail: node.getText(source).slice(0, 180).replace(/\s+/g, ' ') })
  }
  ts.forEachChild(node, (child) => inspectNode(scan, child))
}

export function checkJavaScript(path, text) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKindOf(path))
  const scan = {
    path,
    source,
    initializers: new Map(),
    lowLevelBindings: new Map(),
    lowLevelNamespaces: new Set(),
    processLaunchBindings: new Set(),
    childProcessNamespaces: new Set(),
    ownedModelFetchCounts: new Map(),
    failures: [],
  }
  collectInitializers(scan, source)
  collectModuleStatements(scan)
  collectCommonJs(scan, source)
  inspectNode(scan, source)
  return scan.failures.map(({ node, detail }) => ({
    location: sourceLocation(source, node),
    detail,
  }))
}

function namesModelCliInvocation(text) {
  const cli =
    /(?:^|[^A-Za-z0-9_])(?:claude|codex|opencode|pi)(?:Bin|Path|Executable)?\b/i.exec(text)
  if (!cli) return false
  const afterCli = text.slice((cli.index ?? 0) + cli[0].length)
  const namesExecutionMode =
    /(?:^|[\s'"`,:[\]()])(?:-p|--print|exec|run)(?=$|[\s'"`,:[\]()])/i.test(afterCli)
  const selectsCliAgent =
    /--agent(?:-import-path)?[\s'"`,:[\]()]+(?:claude|codex|opencode|pi)\b/i.test(text)
  return namesExecutionMode || selectsCliAgent
}

function executablePythonLines(text) {
  const lines = text.split(/\r?\n/)
  let quote = null
  return lines.map((line) => {
    let code = line
    let cursor = 0
    let kept = ''
    while (cursor < code.length) {
      if (quote !== null) {
        const end = code.indexOf(quote, cursor)
        if (end === -1) return ''
        cursor = end + 3
        quote = null
        continue
      }
      const single = code.indexOf("'''", cursor)
      const double = code.indexOf('"""', cursor)
      const starts = [single, double].filter((value) => value >= 0)
      const start = starts.length === 0 ? -1 : Math.min(...starts)
      if (start === -1) {
        kept += code.slice(cursor)
        break
      }
      kept += code.slice(cursor, start)
      quote = code.slice(start, start + 3)
      cursor = start + 3
    }
    code = kept.trimStart().startsWith('#') ? '' : kept.replace(/\s+#.*$/, '')
    return code
  })
}

function namesComputedModelEndpoint(text) {
  const compact = text.replace(/[\s'"`+(){}]/g, '')
  return namesModelEndpoint(compact)
}

function expandNamedExpressions(text, expressions, tokenPattern, seen = new Set()) {
  return text.replace(tokenPattern, (token, braced, plain) => {
    const name = braced ?? plain ?? token
    if (seen.has(name) || !expressions.has(name)) return token
    const nextSeen = new Set(seen)
    nextSeen.add(name)
    return `(${expandNamedExpressions(expressions.get(name), expressions, tokenPattern, nextSeen)})`
  })
}

const pythonProviderImport =
  /^(?:from\s+(?:openai|anthropic|google\.generativeai|cohere|groq|mistralai)(?:\.[A-Za-z0-9_.]+)?\s+import\b|import\s+(?:openai|anthropic|google\.generativeai|cohere|groq|mistralai)\b)/i
const pythonProviderCall =
  /(?:^|\.)(?:chat\.completions\.(?:create|stream)|responses\.(?:create|stream)|messages\.(?:create|stream)|generate_content)\s*\(/i
const pythonHttpCall =
  /\b(?:requests|httpx|urllib3|session|client)\.(?:post|request|open|urlopen)\s*\(/i

export function checkPython(text) {
  const failures = []
  const lines = executablePythonLines(text)
  const expressions = new Map()
  const modelCallBindings = new Set()
  const processLaunchBindings = new Set(['call', 'check_call', 'check_output', 'Popen', 'run'])
  const processNamespaces = new Set(['os', 'subprocess'])
  for (const [index, line] of lines.entries()) {
    const code = line.trim()
    if (code.length === 0) continue

    let violation = pythonProviderImport.test(code)
    const subprocessImport = /^from\s+subprocess\s+import\s+(.+)$/.exec(code)
    if (subprocessImport) {
      for (const binding of subprocessImport[1].split(',')) {
        const match = /^\s*(?:run|Popen|call|check_call|check_output)(?:\s+as\s+([A-Za-z_]\w*))?\s*$/.exec(
          binding,
        )
        if (match) processLaunchBindings.add(match[1] ?? binding.trim())
      }
    }
    const namespaceImport = /^import\s+(os|subprocess)(?:\s+as\s+([A-Za-z_]\w*))?\s*$/.exec(code)
    if (namespaceImport) processNamespaces.add(namespaceImport[2] ?? namespaceImport[1])

    const assignment = /^([A-Za-z_]\w*)\s*=\s*(?!=)(.+)$/.exec(code)
    if (assignment) {
      const [, name, expression] = assignment
      expressions.set(name, expression)
      if (
        /(?:^|\.)(?:chat\.completions\.(?:create|stream)|responses\.(?:create|stream)|messages\.(?:create|stream)|generate_content)\s*$/.test(
          expression.trim(),
        )
      ) {
        modelCallBindings.add(name)
      }
      if (violation) {
        failures.push({ location: `${index + 1}:1`, detail: code.slice(0, 180) })
      }
      continue
    }

    const expanded = expandNamedExpressions(code, expressions, /\b([A-Za-z_]\w*)\b/g)
    const modelAliasCall = [...modelCallBindings].some((name) =>
      new RegExp(`(?:^|[^A-Za-z0-9_])${name}\\s*\\(`).test(code),
    )
    const processCall =
      [...processNamespaces].some((name) =>
        new RegExp(`(?:^|[^A-Za-z0-9_])${name}\\.(?:run|Popen|call|check_call|check_output|system|popen)\\s*\\(`).test(
          code,
        ),
      ) ||
      [...processLaunchBindings].some((name) =>
        new RegExp(`(?:^|[^A-Za-z0-9_])${name}\\s*\\(`).test(code),
      )
    violation ||=
      pythonProviderCall.test(code) ||
      modelAliasCall ||
      (pythonHttpCall.test(code) && namesComputedModelEndpoint(expanded)) ||
      (processCall && namesModelCliInvocation(expanded))
    if (violation) {
      failures.push({ location: `${index + 1}:1`, detail: code.slice(0, 180) })
    }
  }
  return failures
}

function shellExecutesModelCli(code) {
  return code.split(/&&|\|\||;|\|/).some((segment) => {
    const command = segment.trim().replace(/^(?:[A-Za-z_]\w*=\S+\s+)+/, '')
    return (
      (/^(?:command\s+)?(?:claude|codex|opencode|pi)(?:Bin|Path|Executable)?\b/i.test(command) &&
        namesModelCliInvocation(command)) ||
      /^(?:eval|exec|bash\s+-c|sh\s+-c|xargs)\b/i.test(command) &&
        namesModelCliInvocation(command)
    )
  })
}

export function checkShell(text) {
  const failures = []
  const expressions = new Map()
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const code = line.replace(/^\s*#.*$/, '').trim()
    if (code.length === 0) continue
    const assignment = /^(?:(?:export|local|readonly)\s+)?([A-Za-z_]\w*)=(.*)$/.exec(code)
    if (assignment) {
      expressions.set(assignment[1], assignment[2])
      continue
    }
    const expanded = expandNamedExpressions(
      code,
      expressions,
      /\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g,
    )
    if (
      (/\b(?:curl|wget|http)\b/i.test(code) && namesComputedModelEndpoint(expanded)) ||
      shellExecutesModelCli(expanded)
    ) {
      failures.push({ location: `${index + 1}:1`, detail: code.slice(0, 180) })
    }
  }
  return failures
}

export function scanRepository() {
  const violations = []
  for (const sourceRoot of sourceRoots) {
    const path = resolve(root, sourceRoot)
    for (const file of findSourceFiles(path)) {
      const repoPath = relative(root, file).replaceAll('\\', '/')
      const text = readFileSync(file, 'utf8')
      const ext = extension(file)
      const failures =
        ext === '.py'
          ? checkPython(text)
          : ext === '.sh'
            ? checkShell(text)
            : checkJavaScript(repoPath, text)
      for (const failure of failures) violations.push({ path: repoPath, ...failure })
    }
  }
  return violations
}

function main() {
  const violations = scanRepository()
  if (violations.length > 0) {
    process.stderr.write(
      'Model-provider calls must go through agent-runtime. Use AgentProfile + streamAgentTurn, ' +
        'or a profile-based supervise operation. Low-level Router clients are Runtime internals.\n',
    )
    for (const violation of violations) {
      process.stderr.write(`- ${violation.path}:${violation.location} ${violation.detail}\n`)
    }
    process.exitCode = 1
    return
  }
  process.stdout.write('model execution boundary: pass\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
