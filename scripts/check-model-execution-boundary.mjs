#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '..')
const sourceRoots = ['src', 'bench', 'examples', 'scripts']

// Runtime owns provider transport. This list is deliberately limited to implementation adapters;
// benchmarks, examples, and probes must enter through an exact AgentProfile.
const directTransportOwners = new Set([
  'src/runtime/local-sandbox-client.ts',
  'src/runtime/router-client.ts',
  'src/runtime/router-client.complete.test.ts',
  'src/runtime/supervise/runtime.ts',
  'src/runtime/supervise/supervisor-agent.ts',
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
  'streamRouterChatWithTools',
])

const sourceExtensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.py', '.sh'])
const ignoredDirectories = new Set([
  '.git',
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

function walk(path) {
  const entries = readdirSync(path)
  const files = []
  for (const name of entries) {
    if (ignoredDirectories.has(name)) continue
    const child = resolve(path, name)
    const stats = statSync(child)
    if (stats.isDirectory()) files.push(...walk(child))
    else if (sourceExtensions.has(extension(name))) files.push(child)
  }
  return files
}

function isTestFile(path) {
  return /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]s$/.test(path)
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

function isLocalTestTarget(path, target) {
  return isTestFile(path) && /(?:localhost|127\.0\.0\.1|\[::1\]|\.test)(?::\d+)?\//i.test(target)
}

export function checkJavaScript(path, text) {
  const kind = path.endsWith('.ts') || path.endsWith('.mts') || path.endsWith('.cts')
    ? ts.ScriptKind.TS
    : ts.ScriptKind.JS
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind)
  const initializers = new Map()
  const lowLevelBindings = new Set()
  const lowLevelNamespaces = new Set()
  const failures = []

  function collect(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      initializers.set(node.name.text, node.initializer)
    }
    ts.forEachChild(node, collect)
  }
  collect(source)

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause?.namedBindings) continue
    const bindings = statement.importClause.namedBindings
    if (ts.isNamespaceImport(bindings)) {
      lowLevelNamespaces.add(bindings.name.text)
    } else {
      for (const element of bindings.elements) {
        const imported = element.propertyName?.text ?? element.name.text
        if (lowLevelModelCalls.has(imported)) lowLevelBindings.add(element.name.text)
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

  function collectCommonJs(node) {
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      if (isRequireCall(node.initializer)) {
        if (ts.isIdentifier(node.name)) lowLevelNamespaces.add(node.name.text)
        if (ts.isObjectBindingPattern(node.name)) {
          for (const element of node.name.elements) {
            if (!ts.isIdentifier(element.name)) continue
            const imported = element.propertyName?.getText(source) ?? element.name.text
            if (lowLevelModelCalls.has(imported)) lowLevelBindings.add(element.name.text)
          }
        }
      }
      if (
        ts.isIdentifier(node.name) &&
        ts.isPropertyAccessExpression(node.initializer) &&
        isRequireCall(node.initializer.expression) &&
        lowLevelModelCalls.has(node.initializer.name.text)
      ) {
        lowLevelBindings.add(node.name.text)
      }
    }
    ts.forEachChild(node, collectCommonJs)
  }
  collectCommonJs(source)

  function expressionText(node, seen = new Set()) {
    if (ts.isIdentifier(node)) {
      if (seen.has(node.text)) return node.getText(source)
      const initializer = initializers.get(node.text)
      if (initializer !== undefined) {
        seen.add(node.text)
        return `${node.getText(source)}=${expressionText(initializer, seen)}`
      }
    }
    return node.getText(source)
  }

  function inspect(node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(source)
      const first = node.arguments[0]
      const target = first === undefined ? '' : expressionText(first)
      const call = node.getText(source)
      const directFetch =
        callee === 'fetch' && namesModelEndpoint(target) && !isLocalTestTarget(path, target)
      const providerSdk =
        /(?:^|\.)(?:chat\.completions\.create|responses\.create|messages\.create|generateContent)$/.test(
          callee,
        )
      const rawHttp =
        /^(?:https?|request|axios)(?:\.|$)/.test(callee) &&
        namesModelEndpoint(call) &&
        !isLocalTestTarget(path, call)
      const lowLevelRuntimeCall =
        (ts.isIdentifier(node.expression) && lowLevelBindings.has(callee)) ||
        (ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          lowLevelNamespaces.has(node.expression.expression.text) &&
          lowLevelModelCalls.has(node.expression.name.text)) ||
        (ts.isElementAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          lowLevelNamespaces.has(node.expression.expression.text) &&
          ts.isStringLiteral(node.expression.argumentExpression) &&
          lowLevelModelCalls.has(node.expression.argumentExpression.text))
      if (directFetch || providerSdk || rawHttp || lowLevelRuntimeCall) {
        failures.push({ node, detail: call.slice(0, 180).replace(/\s+/g, ' ') })
      }
    }
    if (
      ts.isNewExpression(node) &&
      /^(?:OpenAI|Anthropic)$/.test(node.expression.getText(source))
    ) {
      failures.push({ node, detail: node.getText(source).slice(0, 180).replace(/\s+/g, ' ') })
    }
    ts.forEachChild(node, inspect)
  }
  inspect(source)
  return failures.map(({ node, detail }) => ({ location: sourceLocation(source, node), detail }))
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

export function checkPython(text) {
  const failures = []
  for (const [index, line] of executablePythonLines(text).entries()) {
    if (
      /chat\/completions|api\.anthropic\.com|\.chat\.completions\.create\s*\(|\.responses\.create\s*\(|\.messages\.create\s*\(/i.test(
        line,
      )
    ) {
      failures.push({ location: `${index + 1}:1`, detail: line.trim().slice(0, 180) })
    }
  }
  return failures
}

export function checkShell(text) {
  const failures = []
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const code = line.replace(/^\s*#.*$/, '')
    if (
      /(?:curl|wget|http)\b.*(?:chat\/completions|\/responses\b|api\.anthropic\.com)/i.test(code)
    ) {
      failures.push({ location: `${index + 1}:1`, detail: code.trim().slice(0, 180) })
    }
  }
  return failures
}

export function scanRepository() {
  const violations = []
  for (const sourceRoot of sourceRoots) {
    const path = resolve(root, sourceRoot)
    for (const file of walk(path)) {
      const repoPath = relative(root, file).replaceAll('\\', '/')
      if (directTransportOwners.has(repoPath)) continue
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
